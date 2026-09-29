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
 * @property {number[]} indices  Posición en el archivo de la parcela de cada resultado del informe, en el mismo orden.
 * @property {{mapa: Blob, hallazgos: Blob, informe: Blob, corregido: Blob}} archivos  Capas del mapa y descargas.
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

// Una parcela que se cruza consigo misma (R6) va como contorno, con sus anillos
// como líneas. MapLibre descarta al cortar en teselas los anillos de área casi
// nula, y en un moño los dos lóbulos se restan hasta dar cero: como polígono,
// la parcela desaparecía del mapa (visto el 28-09-2026).
function contorno(p) {
  const anillos = p.tipo === 'Polygon' ? p.coords : p.coords.flat()
  return { type: 'MultiLineString', coordinates: anillos }
}

// Capa del mapa: una parcela por Feature, con su peor severidad. Las que no se
// pueden dibujar (R1, anillos incompletos) quedan fuera; siguen en el informe.
export function capaDelMapa(parcelas, estados) {
  const features = []
  for (const p of parcelas) {
    const { severidad, dibujable, cruzada } = estados[p.indice]
    if (!dibujable) continue
    features.push({
      type: 'Feature',
      properties: { indice: p.indice, id: p.etiqueta, severidad },
      geometry: cruzada ? contorno(p) : { type: p.tipo, coordinates: p.coords },
    })
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Puntos de los hallazgos que traen ubicación, para la capa "deslinde-hallazgo"
 * del mapa. Se arma aquí y no en la página: con miles de hallazgos, armarla y
 * pasársela a MapLibre trababa la página.
 * @param {import('./index.js').Resultado[]} resultados
 */
export function capaDeHallazgos(resultados) {
  return {
    type: 'FeatureCollection',
    features: resultados
      .filter((r) => r.ubicacion)
      .map((r) => ({
        type: 'Feature',
        properties: { parcela: r.parcela, regla: r.regla, severidad: r.severidad },
        geometry: { type: 'Point', coordinates: r.ubicacion },
      })),
  }
}

/**
 * Revisa el texto y prepara todo lo que la página necesita.
 * @returns {ResultadoDelTrabajo}
 */
export function procesar(texto, opciones = {}) {
  const { parcelas, estados, indices, informe } = analizar(texto, opciones)
  opciones.alAvanzar?.({ fase: 'salidas' })
  const mapa = capaDelMapa(parcelas, estados)
  return {
    informe,
    limites: encuadre(mapa),
    conteo: contar(estados),
    indices,
    archivos: {
      mapa: new Blob([JSON.stringify(mapa)], { type: 'application/geo+json' }),
      hallazgos: new Blob([JSON.stringify(capaDeHallazgos(informe.resultados))], { type: 'application/geo+json' }),
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
