// Lector de KML (y del KML que viene dentro de un KMZ). Cada Placemark es una
// parcela. Como en el GeoJSON, las coordenadas se guardan dos veces: como
// números y como el texto tal como venía, para contar decimales (R2) y escribir
// el GeoJSON corregido sin inventar ni perder precisión.
//
// El XML lo lee txml, que funciona dentro del Web Worker (allí no hay DOMParser)
// y deja el texto de las coordenadas sin tocar. Atributos de la parcela:
// ExtendedData (Data/value o SchemaData/SimpleData) con `id`, `area_ha` y
// `productor`; sin `id`, el código es el nombre del Placemark o, si no tiene,
// su atributo id.

import { parse } from 'txml'
import { aNumero, ErrorDeArchivo, etiquetaDe } from './errores.js'

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

// txml deja las entidades como vienen: "Finca &amp; Sol".
const decodificar = (texto) =>
  texto.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (todo, e) => {
    if (e[0] !== '#') return ENTIDADES[e.toLowerCase()] ?? todo
    const codigo = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : todo
  })

// "kml:Placemark" y "Placemark" son lo mismo.
const local = (nodo) => (typeof nodo === 'string' ? null : nodo.tagName.replace(/^.*:/, ''))
const hijos = (nodo, nombre) => (nodo.children ?? []).filter((h) => local(h) === nombre)
const hijo = (nodo, nombre) => hijos(nodo, nombre)[0]
const texto = (nodo) =>
  nodo ? decodificar((nodo.children ?? []).map((h) => (typeof h === 'string' ? h : texto(h))).join('')).trim() : ''

function buscar(nodos, nombre, encontrados = []) {
  for (const n of nodos) {
    if (typeof n === 'string') continue
    if (local(n) === nombre) encontrados.push(n)
    else buscar(n.children ?? [], nombre, encontrados) // un Placemark no lleva otros adentro
  }
  return encontrados
}

// "lon,lat[,alt] lon,lat[,alt] …" → números y textos de [lon, lat]. Se toleran
// espacios alrededor de las comas, que algunos programas escriben.
function tuplas(nodo) {
  const crudo = texto(nodo).replace(/\s*,\s*/g, ',')
  const pares = crudo.split(/\s+/).filter(Boolean).map((t) => t.split(',').slice(0, 2))
  const textos = pares.map(([lon = '', lat = '']) => [lon, lat])
  const coords = textos.map((par) => par.map((t) => (t === '' ? NaN : Number(t))))
  return { coords, textos }
}

function anillos(poligono) {
  const exterior = hijo(hijo(hijo(poligono, 'outerBoundaryIs') ?? {}, 'LinearRing') ?? {}, 'coordinates')
  const interiores = hijos(poligono, 'innerBoundaryIs').map((b) => hijo(hijo(b, 'LinearRing') ?? {}, 'coordinates'))
  const leidos = [exterior, ...interiores].filter(Boolean).map(tuplas)
  return { coords: leidos.map((a) => a.coords), textos: leidos.map((a) => a.textos) }
}

const GEOMETRIAS = ['Point', 'Polygon', 'MultiGeometry', 'LineString', 'LinearRing', 'Track', 'MultiTrack', 'Model']

// Geometría de un Placemark: Point, Polygon o, con MultiGeometry, MultiPolygon
// (varios polígonos) o Point (un solo punto). Lo demás vuelve con su tipo para que
// R1 diga qué llegó.
function geometria(nodo) {
  const tipo = local(nodo)
  if (tipo === 'Point') {
    const { coords, textos } = tuplas(hijo(nodo, 'coordinates'))
    return { tipo: 'Point', coords: coords[0], textos: textos[0] }
  }
  if (tipo === 'Polygon') return { tipo: 'Polygon', ...anillos(nodo) }
  if (tipo === 'MultiGeometry') {
    const partes = (nodo.children ?? []).filter((h) => GEOMETRIAS.includes(local(h))).map(geometria)
    if (partes.length === 1) return partes[0]
    if (partes.length > 0 && partes.every((p) => p.tipo === 'Polygon')) {
      return { tipo: 'MultiPolygon', coords: partes.map((p) => p.coords), textos: partes.map((p) => p.textos) }
    }
    if (partes.length > 0 && partes.every((p) => p.tipo === 'Point')) return { tipo: 'MultiPoint' }
    return { tipo: partes.length > 0 ? 'GeometryCollection' : undefined }
  }
  return { tipo }
}

// Atributos de ExtendedData, en Data/value o en SchemaData/SimpleData.
function datosDe(marca) {
  const extendidos = hijo(marca, 'ExtendedData')
  const propiedades = {}
  if (!extendidos) return propiedades
  for (const d of hijos(extendidos, 'Data')) {
    if (d.attributes?.name) propiedades[d.attributes.name] = texto(hijo(d, 'value'))
  }
  for (const esquema of hijos(extendidos, 'SchemaData')) {
    for (const s of hijos(esquema, 'SimpleData')) {
      if (s.attributes?.name) propiedades[s.attributes.name] = texto(s)
    }
  }
  return propiedades
}

const vacio = (v) => v === undefined || v === null || v === ''

/** @returns {import('./lector.js').Parcela[]} */
export function leerKML(textoKML) {
  const limpio = textoKML.replace(/^﻿/, '')
  if (!/<(?:\w+:)?kml[\s>]|<(?:\w+:)?Placemark[\s>]/.test(limpio)) {
    throw new ErrorDeArchivo('El archivo no es un KML: no trae la etiqueta <kml> ni ningún <Placemark>.')
  }
  let nodos
  try {
    nodos = parse(limpio)
  } catch {
    throw new ErrorDeArchivo('El KML no se pudo leer: el XML está incompleto o dañado.')
  }
  const marcas = buscar(nodos, 'Placemark')
  if (marcas.length === 0) throw new ErrorDeArchivo('El KML no trae ninguna parcela: no hay ningún <Placemark>.')

  return marcas.map((marca, indice) => {
    const propiedades = datosDe(marca)
    const nombre = texto(hijo(marca, 'name'))
    if (vacio(propiedades.id)) propiedades.id = nombre || marca.attributes?.id || undefined
    else if (nombre && nombre !== propiedades.id) propiedades.nombre = nombre
    if (vacio(propiedades.id)) delete propiedades.id
    const areaHa = aNumero(propiedades.area_ha)
    if (!Number.isNaN(areaHa)) propiedades.area_ha = areaHa

    const nodoGeometria = (marca.children ?? []).find((h) => GEOMETRIAS.includes(local(h)))
    const { tipo, coords, textos } = nodoGeometria ? geometria(nodoGeometria) : {}
    return {
      indice,
      etiqueta: etiquetaDe(propiedades.id, indice),
      propiedades,
      tipo,
      coords,
      textos,
      areaHa,
    }
  })
}
