// Escritores de KML, KMZ y shapefile para los datos sintéticos y las pruebas.
// Reciben las mismas parcelas (Features) que textoGeoJSON y escriben cada
// coordenada con un número fijo de decimales: 6, o lo que diga `_decimales`.
//
// El shapefile sigue la especificación técnica de ESRI (julio de 1998): el
// .shp con las geometrías, el .shx con dónde empieza cada una y el .dbf (dBASE
// III) con los atributos, más el .prj (WGS 84) y el .cpg (codificación).

import { strToU8, zipSync } from 'fflate'

// ---------- KML ----------

const escaparXML = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

const tupla = ([lon, lat], d) => `${lon.toFixed(d)},${lat.toFixed(d)},0`
const anilloKML = (anillo, d) => `<coordinates>${anillo.map((p) => tupla(p, d)).join(' ')}</coordinates>`

function poligonoKML(anillos, d) {
  const [exterior, ...huecos] = anillos
  const dentro = huecos.map((h) => `<innerBoundaryIs><LinearRing>${anilloKML(h, d)}</LinearRing></innerBoundaryIs>`)
  return `<Polygon><outerBoundaryIs><LinearRing>${anilloKML(exterior, d)}</LinearRing></outerBoundaryIs>${dentro.join('')}</Polygon>`
}

function geometriaKML({ type, coordinates }, d) {
  if (type === 'Point') return `<Point><coordinates>${tupla(coordinates, d)}</coordinates></Point>`
  if (type === 'Polygon') return poligonoKML(coordinates, d)
  if (type === 'MultiPolygon') return `<MultiGeometry>${coordinates.map((p) => poligonoKML(p, d)).join('')}</MultiGeometry>`
  throw new Error(`El escritor de KML no sabe escribir ${type}`)
}

/** KML con una parcela por Placemark: el código como nombre y los atributos en ExtendedData. */
export function textoKML(features, { titulo = 'Parcelas de Deslinde' } = {}) {
  const marcas = features.map(({ _decimales = 6, properties: p, geometry: g }) => {
    const datos = Object.entries(p)
      .map(([clave, valor]) => `<Data name="${escaparXML(clave)}"><value>${escaparXML(valor)}</value></Data>`)
      .join('')
    return `<Placemark><name>${escaparXML(p.id)}</name><ExtendedData>${datos}</ExtendedData>${geometriaKML(g, _decimales)}</Placemark>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
    `<name>${escaparXML(titulo)}</name>`,
    ...marcas,
    '</Document></kml>',
    '',
  ].join('\n')
}

// Fecha fija dentro de los comprimidos: sin ella, cada corrida los escribe
// distintos (guardan la hora) y Git los ve cambiados. Sin zona horaria, para que
// dé lo mismo en cualquier equipo.
const FECHA_FIJA = { mtime: '2026-09-28T12:00:00' }

/** KMZ: el KML comprimido en un .zip, con el nombre doc.kml como lo deja Google Earth. */
export const bytesKMZ = (textoDeKML) => zipSync({ 'doc.kml': strToU8(textoDeKML) }, FECHA_FIJA)

// ---------- Shapefile ----------

const TIPO = { Point: 1, PointZ: 11, Polygon: 5, PolygonZ: 15 }

// Área con signo de un anillo: positiva si va en sentido horario (con y hacia
// arriba). El shapefile pide el borde exterior en sentido horario y los huecos al revés.
function areaHoraria(anillo) {
  let suma = 0
  for (let i = 0; i < anillo.length - 1; i++) {
    const [x1, y1] = anillo[i]
    const [x2, y2] = anillo[i + 1]
    suma += (x2 - x1) * (y2 + y1)
  }
  return suma / 2
}

const orientar = (anillo, horario) => ((areaHoraria(anillo) > 0) === horario ? anillo : [...anillo].reverse())

function anillosDe({ type, coordinates }) {
  const poligonos = type === 'Polygon' ? [coordinates] : coordinates
  return poligonos.flatMap(([exterior, ...huecos]) => [orientar(exterior, true), ...huecos.map((h) => orientar(h, false))])
}

const caja = (puntos) => [
  Math.min(...puntos.map((p) => p[0])),
  Math.min(...puntos.map((p) => p[1])),
  Math.max(...puntos.map((p) => p[0])),
  Math.max(...puntos.map((p) => p[1])),
]

// Contenido de un registro del .shp, sin su cabecera.
function contenidoShp(tipo, geometria, redondear) {
  if (tipo === TIPO.Point || tipo === TIPO.PointZ) {
    const [x, y] = geometria.coordinates.map(redondear)
    const vista = new DataView(new ArrayBuffer(tipo === TIPO.Point ? 20 : 36))
    vista.setInt32(0, tipo, true)
    vista.setFloat64(4, x, true)
    vista.setFloat64(12, y, true)
    // PointZ lleva Z y M; aquí, ceros.
    return { bytes: new Uint8Array(vista.buffer), puntos: [[x, y]] }
  }
  const anillos = anillosDe(geometria).map((a) => a.map((p) => p.map(redondear)))
  const puntos = anillos.flat()
  const base = 44 + 4 * anillos.length + 16 * puntos.length
  const largo = tipo === TIPO.Polygon ? base : base + 16 + 8 * puntos.length // PolygonZ: rango y lista de Z
  const vista = new DataView(new ArrayBuffer(largo))
  vista.setInt32(0, tipo, true)
  caja(puntos).forEach((v, i) => vista.setFloat64(4 + 8 * i, v, true))
  vista.setInt32(36, anillos.length, true)
  vista.setInt32(40, puntos.length, true)
  let inicio = 0
  anillos.forEach((a, i) => {
    vista.setInt32(44 + 4 * i, inicio, true)
    inicio += a.length
  })
  const desde = 44 + 4 * anillos.length
  puntos.forEach(([x, y], i) => {
    vista.setFloat64(desde + 16 * i, x, true)
    vista.setFloat64(desde + 16 * i + 8, y, true)
  })
  return { bytes: new Uint8Array(vista.buffer), puntos }
}

function cabeceraShp(vista, largoEnPalabras, tipo, [xmin, ymin, xmax, ymax]) {
  vista.setInt32(0, 9994, false)
  vista.setInt32(24, largoEnPalabras, false)
  vista.setInt32(28, 1000, true)
  vista.setInt32(32, tipo, true)
  vista.setFloat64(36, xmin, true)
  vista.setFloat64(44, ymin, true)
  vista.setFloat64(52, xmax, true)
  vista.setFloat64(60, ymax, true)
}

// Texto en Windows-1252 para lo que hay en las parcelas de prueba (Latin-1).
const enLatin1 = (texto) => Uint8Array.from(texto, (c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63))

function bytesDbf(features, codificar) {
  const campos = [
    { nombre: 'ID', tipo: 'C', largo: 20, valor: (p) => p.id ?? '' },
    { nombre: 'PRODUCTOR', tipo: 'C', largo: 30, valor: (p) => p.productor ?? '' },
    { nombre: 'AREA_HA', tipo: 'N', largo: 12, decimales: 2, valor: (p) => (typeof p.area_ha === 'number' ? p.area_ha.toFixed(2) : '') },
  ]
  const largoRegistro = 1 + campos.reduce((s, c) => s + c.largo, 0)
  const largoCabecera = 32 + 32 * campos.length + 1
  const bytes = new Uint8Array(largoCabecera + largoRegistro * features.length + 1)
  const vista = new DataView(bytes.buffer)
  vista.setUint8(0, 0x03)
  vista.setUint8(1, 126) // 2026
  vista.setUint8(2, 9)
  vista.setUint8(3, 30)
  vista.setUint32(4, features.length, true)
  vista.setUint16(8, largoCabecera, true)
  vista.setUint16(10, largoRegistro, true)
  campos.forEach((c, i) => {
    const desde = 32 + 32 * i
    bytes.set(strToU8(c.nombre), desde)
    bytes[desde + 11] = c.tipo.charCodeAt(0)
    bytes[desde + 16] = c.largo
    bytes[desde + 17] = c.decimales ?? 0
  })
  bytes[largoCabecera - 1] = 0x0d
  features.forEach(({ properties }, n) => {
    let desde = largoCabecera + largoRegistro * n
    bytes[desde++] = 0x20 // registro vigente
    for (const c of campos) {
      const texto = String(c.valor(properties))
      const valor = codificar(c.tipo === 'N' ? texto.padStart(c.largo) : texto).slice(0, c.largo)
      bytes.fill(0x20, desde, desde + c.largo)
      bytes.set(valor, desde)
      desde += c.largo
    }
  })
  bytes[bytes.length - 1] = 0x1a
  return bytes
}

const PRJ_WGS84 =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

/**
 * Los archivos de un shapefile para estas parcelas, como bytes. Todas deben ser
 * del mismo tipo (puntos, o polígonos y multipolígonos): un shapefile no los mezcla.
 * @param {{conZ?: boolean, codificacion?: 'utf-8'|'1252', cpg?: boolean}} [ajustes]
 * @returns {{shp: Uint8Array, shx: Uint8Array, dbf: Uint8Array, prj: Uint8Array, cpg?: Uint8Array}}
 */
export function archivosShapefile(features, { conZ = false, codificacion = 'utf-8', cpg = true } = {}) {
  const puntos = features.every((f) => f.geometry.type === 'Point')
  if (!puntos && !features.every((f) => ['Polygon', 'MultiPolygon'].includes(f.geometry.type))) {
    throw new Error('Un shapefile lleva solo puntos o solo polígonos')
  }
  const tipo = puntos ? (conZ ? TIPO.PointZ : TIPO.Point) : conZ ? TIPO.PolygonZ : TIPO.Polygon
  const registros = features.map(({ _decimales = 6, geometry }) =>
    contenidoShp(tipo, geometry, (v) => Number(v.toFixed(_decimales))),
  )

  const largoShp = 100 + registros.reduce((s, r) => s + 8 + r.bytes.length, 0)
  const shp = new Uint8Array(largoShp)
  const shx = new Uint8Array(100 + 8 * registros.length)
  const vistaShp = new DataView(shp.buffer)
  const vistaShx = new DataView(shx.buffer)
  const cajaTotal = caja(registros.flatMap((r) => r.puntos))
  cabeceraShp(vistaShp, largoShp / 2, tipo, cajaTotal)
  cabeceraShp(vistaShx, shx.length / 2, tipo, cajaTotal)

  let desde = 100
  registros.forEach((r, n) => {
    vistaShx.setInt32(100 + 8 * n, desde / 2, false)
    vistaShx.setInt32(104 + 8 * n, r.bytes.length / 2, false)
    vistaShp.setInt32(desde, n + 1, false)
    vistaShp.setInt32(desde + 4, r.bytes.length / 2, false)
    shp.set(r.bytes, desde + 8)
    desde += 8 + r.bytes.length
  })

  const codificar = codificacion === '1252' ? enLatin1 : strToU8
  const archivos = { shp, shx, dbf: bytesDbf(features, codificar), prj: strToU8(PRJ_WGS84) }
  if (cpg) archivos.cpg = strToU8(codificacion === '1252' ? '1252' : 'UTF-8')
  return archivos
}

/** Los archivos del shapefile dentro de un .zip, como se suelen compartir. */
export function bytesZipShapefile(nombre, archivos) {
  return zipSync(Object.fromEntries(Object.entries(archivos).map(([ext, bytes]) => [`${nombre}.${ext}`, bytes])), FECHA_FIJA)
}
