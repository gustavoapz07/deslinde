// Salidas del motor: el informe de hallazgos en CSV y el GeoJSON corregido.

import { analizar } from './index.js'

const NUMERO_COMPLETO = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/

function campoCSV(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor)
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/**
 * Informe de hallazgos en CSV, una fila por hallazgo. Lleva BOM para que Excel
 * muestre bien las tildes.
 * @param {import('./index.js').Informe} informe
 */
export function informeCSV(informe) {
  const cabecera = ['parcela', 'regla', 'severidad', 'longitud', 'latitud', 'mensaje', 'accion']
  const filas = informe.resultados.map((r) =>
    [r.parcela, r.regla, r.severidad, r.ubicacion?.[0], r.ubicacion?.[1], r.mensaje, r.accion].map(campoCSV).join(','),
  )
  return '﻿' + [cabecera.join(','), ...filas].join('\r\n') + '\r\n'
}

// Cada número se escribe con su texto original: el GeoJSON corregido no pierde
// ceros finales ni agrega decimales que el archivo no traía.
function marcar(valor) {
  if (Array.isArray(valor)) return valor.map(marcar)
  return NUMERO_COMPLETO.test(valor) ? `#${valor}#` : valor
}

/**
 * GeoJSON en EPSG:4326 con las correcciones seguras ya aplicadas: pares
 * invertidos (R3), anillos cerrados (R5) y vértices repetidos seguidos quitados
 * (R7). Lo demás queda como venía y sigue apareciendo en el informe.
 * Acepta también el CSV de puntos, que sale convertido a GeoJSON.
 */
export function geojsonCorregido(texto, opciones = {}) {
  return escribirCorregido(analizar(texto, opciones).parcelas)
}

/** Igual que geojsonCorregido, pero con las parcelas que ya devolvió `analizar`. */
export function escribirCorregido(parcelas) {
  const lineas = parcelas.map((p) => {
    const geometry = p.tipo === undefined ? null : { type: p.tipo, coordinates: p.textos === undefined ? null : marcar(p.textos) }
    return JSON.stringify({ type: 'Feature', properties: p.propiedades, geometry }).replace(/"#(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)#"/g, '$1')
  })
  return `{"type":"FeatureCollection","features":[\n${lineas.join(',\n')}\n]}\n`
}
