// Salidas del motor: el informe de hallazgos en CSV y el GeoJSON corregido (con
// varios archivos, uno solo con las parcelas de todos).

import { analizar } from './index.js'

const NUMERO_COMPLETO = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/

function campoCSV(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor)
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/**
 * Informe de hallazgos en CSV, una fila por hallazgo, con el archivo de cada
 * parcela (al juntar varios, para saber a quién pedir la corrección). Lleva
 * BOM para que Excel muestre bien las tildes.
 * @param {import('./index.js').Informe} informe
 */
export function informeCSV(informe) {
  const cabecera = ['parcela', 'archivo', 'regla', 'severidad', 'longitud', 'latitud', 'mensaje', 'accion']
  const filas = informe.resultados.map((r) =>
    [r.parcela, r.archivo, r.regla, r.severidad, r.ubicacion?.[0], r.ubicacion?.[1], r.mensaje, r.accion].map(campoCSV).join(','),
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

/**
 * Igual que geojsonCorregido, pero con las parcelas que ya devolvió `analizar`.
 * Con `origen`, al juntar varios archivos, cada parcela lleva `archivo_origen`:
 * el archivo de donde vino, salvo que ya lo traiga de una unión anterior.
 */
export function escribirCorregido(parcelas, { origen = false } = {}) {
  const lineas = parcelas.map((p) => {
    const geometry = p.tipo === undefined ? null : { type: p.tipo, coordinates: p.textos === undefined ? null : marcar(p.textos) }
    const properties = origen ? { ...p.propiedades, archivo_origen: p.propiedades.archivo_origen || p.archivo } : p.propiedades
    return JSON.stringify({ type: 'Feature', properties, geometry }).replace(/"#(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)#"/g, '$1')
  })
  return `{"type":"FeatureCollection","features":[\n${lineas.join(',\n')}\n]}\n`
}
