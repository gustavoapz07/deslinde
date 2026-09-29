// Lo que hace el Web Worker, separado de `self` para poder probarlo en Node.
// El motor corre fuera del hilo de la página: así un archivo de 10,000 parcelas
// no congela la pantalla. Al terminar, el mapa y las descargas salen como Blob:
// pasar un Blob entre hilos no copia su contenido, y MapLibre puede leer la capa
// del mapa desde su propia URL sin que la página toque las geometrías.

import { bbox } from '@turf/turf'
import { analizar, ErrorDeArchivo } from './index.js'
import { HONDURAS } from './reglas.js'
import { escribirCorregido, informeCSV } from './salidas.js'

export const MENSAJE_INTERNO =
  'Algo falló dentro de Deslinde al revisar el archivo. No es un problema del archivo: vuelva a intentarlo o avísenos.'

/**
 * @typedef {Object} ResultadoDelTrabajo
 * @property {import('./index.js').Informe} informe
 * @property {[number, number, number, number]|null} limites  Caja para encuadrar el mapa: las parcelas dibujables dentro de Honduras, o todas si ninguna lo está.
 * @property {{error: number, advertencia: number, ok: number, sinDibujar: number}} conteo  Parcelas por peor severidad, para la leyenda.
 * @property {{mapa: Blob, informe: Blob, corregido: Blob}} archivos
 */

const dentroDeHonduras = ([oeste, sur, este, norte]) =>
  oeste >= HONDURAS.lonMin && este <= HONDURAS.lonMax && sur >= HONDURAS.latMin && norte <= HONDURAS.latMax

// Caja para encuadrar el mapa: las parcelas dentro de Honduras, si hay. Una
// parcela lejana (R4) dejaría al resto diminuto; sigue dibujada y en el informe.
function encuadre(mapa) {
  if (mapa.features.length === 0) return null
  const adentro = mapa.features.filter((f) => dentroDeHonduras(bbox(f)))
  return bbox(adentro.length > 0 ? { type: 'FeatureCollection', features: adentro } : mapa)
}

function contar(estados) {
  const conteo = { error: 0, advertencia: 0, ok: 0, sinDibujar: 0 }
  for (const { severidad, dibujable } of estados) {
    conteo[severidad]++
    if (!dibujable) conteo.sinDibujar++
  }
  return conteo
}

// Capa del mapa: una parcela por Feature, con su peor severidad. Las que no se
// pueden dibujar (R1, anillos incompletos) quedan fuera; siguen en el informe.
export function capaDelMapa(parcelas, estados) {
  const features = []
  for (const p of parcelas) {
    const { severidad, dibujable } = estados[p.indice]
    if (!dibujable) continue
    features.push({
      type: 'Feature',
      properties: { indice: p.indice, id: p.etiqueta, severidad },
      geometry: { type: p.tipo, coordinates: p.coords },
    })
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Revisa el texto y prepara todo lo que la página necesita.
 * @returns {ResultadoDelTrabajo}
 */
export function procesar(texto, opciones = {}) {
  const { parcelas, estados, informe } = analizar(texto, opciones)
  opciones.alAvanzar?.({ fase: 'salidas' })
  const mapa = capaDelMapa(parcelas, estados)
  return {
    informe,
    limites: encuadre(mapa),
    conteo: contar(estados),
    archivos: {
      mapa: new Blob([JSON.stringify(mapa)], { type: 'application/geo+json' }),
      informe: new Blob([informeCSV(informe)], { type: 'text/csv;charset=utf-8' }),
      corregido: new Blob([escribirCorregido(parcelas)], { type: 'application/geo+json' }),
    },
  }
}

/**
 * Atiende un pedido de la página. `entrada` puede ser el texto o el archivo
 * (File o Blob): con el archivo, la lectura también ocurre fuera de la página.
 * Responde con mensajes { id, tipo: 'avance' | 'listo' | 'error' }.
 */
export async function atender({ id, entrada, formato, opciones = {} }, enviar) {
  try {
    const texto = typeof entrada === 'string' ? entrada : await entrada.text()
    const alAvanzar = (avance) => enviar({ id, tipo: 'avance', avance })
    const resultado = procesar(texto, { ...opciones, formato, alAvanzar })
    enviar({ id, tipo: 'listo', resultado })
  } catch (e) {
    const error =
      e instanceof ErrorDeArchivo
        ? { clase: 'archivo', mensaje: e.message }
        : { clase: 'interno', mensaje: MENSAJE_INTERNO, detalle: String(e?.message ?? e) }
    enviar({ id, tipo: 'error', error })
  }
}
