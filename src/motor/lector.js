// Lectores de GeoJSON y CSV de puntos. Cada parcela guarda sus coordenadas dos
// veces: como números, para calcular, y como el texto tal como venía escrito,
// para contar decimales (R2) y para escribir el GeoJSON corregido sin inventar
// ni perder precisión.

export class ErrorDeArchivo extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'ErrorDeArchivo'
  }
}

/**
 * @typedef {Object} Parcela
 * @property {number} indice      Posición en el archivo, desde 0.
 * @property {string} etiqueta    Código para el informe: `id`, o uno de reserva si falta.
 * @property {Object} propiedades Propiedades originales, para el GeoJSON corregido.
 * @property {string|undefined} tipo  Point, Polygon, MultiPolygon u otro.
 * @property {any} coords         Coordenadas como números (NaN si no se pudo leer).
 * @property {any} textos         Mismas coordenadas, como texto original.
 * @property {number} areaHa      Área declarada; NaN si no viene.
 */

const NUMERO = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

export function leer(texto, formato = 'geojson') {
  if (formato === 'csv') return leerCSV(texto)
  if (formato === 'geojson') return leerGeoJSON(texto)
  throw new ErrorDeArchivo(`Formato no admitido: ${formato}. Use GeoJSON o CSV.`)
}

/** Decimales escritos en un número: "14.500000" tiene 6, "1.5e-3" tiene 4. */
export function decimales(texto) {
  const m = /^-?\d+(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(texto)
  if (!m) return 0
  return Math.max(0, (m[1]?.length ?? 0) - Number(m[2] ?? 0))
}

const aNumero = (t) => (typeof t === 'string' && t.trim() !== '' ? Number(t) : NaN)

function etiquetaDe(id, indice) {
  return id === undefined || id === null || id === '' ? `sin código (n.º ${indice + 1})` : String(id)
}

// ---------- GeoJSON ----------

// Envuelve cada número de los bloques "coordinates" en una cadena "#…" antes de
// JSON.parse, para que el texto original sobreviva a la lectura.
function marcarNumeros(texto) {
  const partes = []
  const clave = /"coordinates"\s*:\s*\[/g
  let desde = 0
  let m
  while ((m = clave.exec(texto))) {
    const inicio = m.index + m[0].length - 1
    let profundidad = 0
    let fin = inicio
    for (; fin < texto.length; fin++) {
      const c = texto[fin]
      if (c === '[') profundidad++
      else if (c === ']' && --profundidad === 0) break
      else if (c === '"') break // un texto dentro de las coordenadas: se deja como está
    }
    partes.push(texto.slice(desde, inicio), texto.slice(inicio, fin + 1).replace(NUMERO, '"#$&"'))
    desde = fin + 1
    clave.lastIndex = desde
  }
  partes.push(texto.slice(desde))
  return partes.join('')
}

// Convierte las coordenadas marcadas en dos estructuras paralelas: números y textos.
function separar(valor) {
  if (Array.isArray(valor)) {
    const pares = valor.map(separar)
    return [pares.map((p) => p[0]), pares.map((p) => p[1])]
  }
  if (typeof valor === 'string' && valor.startsWith('#')) {
    const t = valor.slice(1)
    return [Number(t), t]
  }
  return [NaN, String(valor)]
}

function leerGeoJSON(texto) {
  let datos
  try {
    datos = JSON.parse(marcarNumeros(texto.replace(/^﻿/, '')))
  } catch {
    throw new ErrorDeArchivo('El archivo no es un GeoJSON válido: no se pudo leer como JSON.')
  }
  let features
  if (datos?.type === 'FeatureCollection' && Array.isArray(datos.features)) features = datos.features
  else if (datos?.type === 'Feature') features = [datos]
  else throw new ErrorDeArchivo('El GeoJSON debe ser un FeatureCollection con una parcela por Feature.')

  return features.map((f, indice) => {
    const propiedades = f?.properties ?? {}
    const geometria = f?.geometry
    const [coords, textos] = geometria?.coordinates === undefined ? [undefined, undefined] : separar(geometria.coordinates)
    return {
      indice,
      etiqueta: etiquetaDe(propiedades.id ?? f?.id, indice),
      propiedades,
      tipo: geometria?.type,
      coords,
      textos,
      areaHa: typeof propiedades.area_ha === 'number' ? propiedades.area_ha : aNumero(propiedades.area_ha),
    }
  })
}

// ---------- CSV de puntos ----------

const COLUMNAS = {
  latitud: ['latitud', 'lat'],
  longitud: ['longitud', 'lon', 'lng'],
}

function dividirLinea(linea, separador) {
  const campos = []
  let actual = ''
  let entreComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"'
        i++
      } else if (c === '"') entreComillas = false
      else actual += c
    } else if (c === '"') entreComillas = true
    else if (c === separador) {
      campos.push(actual.trim())
      actual = ''
    } else actual += c
  }
  campos.push(actual.trim())
  return campos
}

function leerCSV(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lineas.length === 0) throw new ErrorDeArchivo('El CSV está vacío.')
  const separador = lineas[0].includes(';') && !lineas[0].includes(',') ? ';' : ','
  const cabecera = dividirLinea(lineas[0], separador).map((c) => c.toLowerCase())
  const columna = (nombres) => cabecera.findIndex((c) => nombres.includes(c))
  const iLat = columna(COLUMNAS.latitud)
  const iLon = columna(COLUMNAS.longitud)
  if (iLat < 0 || iLon < 0) {
    throw new ErrorDeArchivo('El CSV necesita las columnas "latitud" y "longitud".')
  }

  return lineas.slice(1).map((linea, indice) => {
    const campos = dividirLinea(linea, separador)
    const propiedades = {}
    cabecera.forEach((nombre, i) => {
      if (i !== iLat && i !== iLon) propiedades[nombre] = campos[i] ?? ''
    })
    const areaHa = aNumero(propiedades.area_ha)
    if (!Number.isNaN(areaHa)) propiedades.area_ha = areaHa
    const textos = [campos[iLon] ?? '', campos[iLat] ?? '']
    return {
      indice,
      etiqueta: etiquetaDe(propiedades.id, indice),
      propiedades,
      tipo: 'Point',
      coords: textos.map(aNumero),
      textos,
      areaHa,
    }
  })
}
