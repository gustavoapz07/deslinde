// Motor de validación de Deslinde: lee el archivo, revisa cada parcela con las
// reglas R1 a R12 y arma el informe. No usa servidor: todo corre donde se llame.

import { leer } from './lector.js'
import {
  reglaR1,
  reglaR10,
  reglaR11,
  reglaR12,
  reglaR2,
  reglaR3yR4,
  reglaR5,
  reglaR6,
  reglaR7,
  reglaR8,
  reglaR9,
} from './reglas.js'

export { ErrorDeArchivo } from './lector.js'
export { escribirCorregido, geojsonCorregido, informeCSV } from './salidas.js'

/**
 * @typedef {Object} Resultado
 * @property {string} parcela       Código de la parcela (propiedad `id` del archivo).
 * @property {string} regla         R1 a R12, ver la nota "Reglas de validación de geodatos".
 * @property {'error'|'advertencia'} severidad
 * @property {[number, number]|null} ubicacion  [longitud, latitud] donde mostrar el problema en el mapa.
 * @property {string} mensaje       Qué pasa, en español simple.
 * @property {string} accion        Qué hacer para corregirlo.
 */

/**
 * @typedef {Object} Informe
 * @property {number} parcelas      Cantidad de parcelas leídas.
 * @property {Resultado[]} resultados
 * @property {{errores: number, advertencias: number, parcelasConErrores: number}} resumen
 */

export const OPCIONES_POR_DEFECTO = {
  formato: 'geojson', // 'geojson' o 'csv'
  umbralAreaPct: 10, // R12: diferencia admitida entre área declarada y calculada [hipótesis]
  solapeMinimoM2: 10, // R10: solapes menores se toman como ruido de medición [hipótesis]
}

// Cada cuántas parcelas se avisa el avance: unas 20 veces con 10,000 parcelas.
const AVISAR_CADA = 500

// Revisa una parcela sola. Devuelve sus hallazgos, si su geometría sirve para
// compararla con las demás (R10 y R11) y si se puede dibujar en el mapa.
function revisarParcela(p, opciones) {
  const r1 = reglaR1(p)
  if (r1) return { hallazgos: [r1], comparable: false, dibujable: false }

  const hallazgos = [reglaR3yR4(p, opciones.formato), reglaR2(p)]
  if (p.tipo === 'Point') {
    hallazgos.push(reglaR9(p))
    return { hallazgos, comparable: true, dibujable: true }
  }

  const r5 = reglaR5(p)
  hallazgos.push(...r5.hallazgos)
  if (r5.incompleto) return { hallazgos, comparable: false, dibujable: false }

  const r6 = reglaR6(p) // antes de R7, para que los números de vértice sean los del archivo
  hallazgos.push(r6, ...reglaR7(p), reglaR8(p))
  if (!r6) hallazgos.push(reglaR12(p, opciones.umbralAreaPct))
  return { hallazgos, comparable: !r6, dibujable: true, cruzada: Boolean(r6) }
}

/**
 * @typedef {Object} Avance
 * @property {'leyendo'|'revisando'|'comparando'|'salidas'} fase
 * @property {number} [hechas]  Parcelas revisadas (solo en 'revisando').
 * @property {number} [total]
 */

/**
 * Lee y revisa un archivo. Devuelve también las parcelas ya corregidas
 * (pares invertidos, anillos cerrados, vértices repetidos quitados) para
 * escribir el GeoJSON corregido, y el estado de cada parcela para el mapa.
 * `opciones.alAvanzar(avance)` recibe el avance, para mostrarlo en pantalla.
 */
export function analizar(texto, opciones = {}) {
  const o = { ...OPCIONES_POR_DEFECTO, ...opciones }
  const avisar = o.alAvanzar ?? (() => {})
  avisar({ fase: 'leyendo' })
  const parcelas = leer(texto, o.formato)
  const encontrados = []
  const comparables = []
  const dibujables = []
  const cruzadas = new Set()

  for (const p of parcelas) {
    const { hallazgos, comparable, dibujable, cruzada } = revisarParcela(p, o)
    for (const h of hallazgos) if (h) encontrados.push({ parcela: p, ...h })
    if (comparable) comparables.push(p)
    dibujables[p.indice] = dibujable
    if (cruzada) cruzadas.add(p.indice)
    const hechas = p.indice + 1
    if (hechas % AVISAR_CADA === 0 || hechas === parcelas.length) {
      avisar({ fase: 'revisando', hechas, total: parcelas.length })
    }
  }

  avisar({ fase: 'comparando' })
  const r11 = reglaR11(comparables)
  encontrados.push(...r11.hallazgos, ...reglaR10(comparables, r11.duplicadas, o.solapeMinimoM2))

  const numeroDeRegla = (r) => Number(r.regla.slice(1))
  encontrados.sort(
    (a, b) =>
      a.parcela.indice - b.parcela.indice || numeroDeRegla(a) - numeroDeRegla(b) || (a.otra ?? 0) - (b.otra ?? 0),
  )

  const resultados = encontrados.map(({ parcela, regla, severidad, ubicacion, mensaje, accion }) => ({
    parcela: parcela.etiqueta,
    regla,
    severidad,
    ubicacion,
    mensaje,
    accion,
  }))
  const conError = new Set(encontrados.filter((r) => r.severidad === 'error').map((r) => r.parcela.indice))
  const conAdvertencia = new Set(encontrados.filter((r) => r.severidad === 'advertencia').map((r) => r.parcela.indice))
  const errores = resultados.filter((r) => r.severidad === 'error').length

  /** @type {{severidad: 'error'|'advertencia'|'ok', dibujable: boolean, cruzada: boolean}[]} */
  const estados = parcelas.map((p) => ({
    severidad: conError.has(p.indice) ? 'error' : conAdvertencia.has(p.indice) ? 'advertencia' : 'ok',
    dibujable: dibujables[p.indice],
    cruzada: cruzadas.has(p.indice), // R6: se dibuja como contorno, ver trabajo.js
  }))

  return {
    parcelas,
    estados,
    // Posición en el archivo de la parcela de cada resultado, en el mismo orden.
    // El código (`parcela`) puede repetirse en un archivo; la posición no.
    indices: encontrados.map((r) => r.parcela.indice),
    informe: {
      parcelas: parcelas.length,
      resultados,
      resumen: { errores, advertencias: resultados.length - errores, parcelasConErrores: conError.size },
    },
  }
}

/**
 * Valida el texto de un archivo de parcelas. Recibe el texto y no el objeto ya
 * leído porque R2 cuenta los decimales tal como vienen escritos.
 * Lanza ErrorDeArchivo si el archivo no se puede leer.
 * @param {string} texto
 * @param {Partial<typeof OPCIONES_POR_DEFECTO>} [opciones]
 * @returns {Informe}
 */
export function validarTexto(texto, opciones = {}) {
  return analizar(texto, opciones).informe
}
