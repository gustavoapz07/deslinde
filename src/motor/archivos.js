// Qué llegó y cómo se lee. La persona puede soltar un archivo (GeoJSON, CSV,
// KML, KMZ o un .zip) o varios a la vez: los de un shapefile (.shp, .dbf y sus
// compañeros). Aquí se abren los comprimidos y se decide el formato; los
// lectores hacen el resto.

import { strFromU8, unzipSync } from 'fflate'
import { ErrorDeArchivo } from './errores.js'
import { leerShapefile } from './shapefile.js'

const DE_TEXTO = { geojson: 'geojson', json: 'geojson', csv: 'csv', kml: 'kml' }
const DEL_SHAPEFILE = ['shp', 'dbf', 'shx', 'prj', 'cpg', 'sbn', 'sbx', 'qix', 'qmd', 'xml']

const extension = (nombre) => /\.([^./\\]+)$/.exec(nombre)?.[1]?.toLowerCase() ?? ''
const base = (nombre) => nombre.replace(/\.[^./\\]+$/, '').toLowerCase()
const soloNombre = (ruta) => ruta.split(/[/\\]/).pop()

export const FORMATOS_ACEPTADOS =
  'GeoJSON, KML o KMZ, shapefile (un .zip, o el .shp junto con el .dbf) o CSV de puntos'

// Lo que hay dentro de un .zip. Se saltan las carpetas y lo que agrega macOS.
function abrirZip(nombre, bytes) {
  let entradas
  try {
    entradas = unzipSync(bytes)
  } catch {
    throw new ErrorDeArchivo(`"${nombre}" no se pudo abrir: el comprimido está dañado o no es un .zip.`)
  }
  return Object.entries(entradas)
    .filter(([ruta, contenido]) => !ruta.endsWith('/') && !ruta.includes('__MACOSX/') && !soloNombre(ruta).startsWith('._') && contenido.length > 0)
    .map(([ruta, contenido]) => ({ nombre: ruta, bytes: contenido }))
}

function leerKMZ(nombre, bytes) {
  const kmls = abrirZip(nombre, bytes).filter((a) => extension(a.nombre) === 'kml')
  if (kmls.length === 0) throw new ErrorDeArchivo(`"${nombre}" no trae ningún KML adentro.`)
  // Google Earth lo llama doc.kml; si no está, el primero.
  const kml = kmls.find((a) => soloNombre(a.nombre).toLowerCase() === 'doc.kml') ?? kmls[0]
  return { formato: 'kml', nombre, texto: strFromU8(kml.bytes) }
}

function leerPartesDeShapefile(partes, nombreParaMostrar) {
  const de = (ext) => partes.filter((a) => extension(a.nombre) === ext)
  const shps = de('shp')
  const dbfs = de('dbf')
  if (shps.length > 1) {
    throw new ErrorDeArchivo(
      `Llegaron ${shps.length} shapefiles. Por ahora Deslinde revisa uno a la vez: elija o comprima uno solo.`,
    )
  }
  if (shps.length === 0) {
    throw new ErrorDeArchivo('Falta el .shp del shapefile, que trae las geometrías. Elíjalo junto con el .dbf, o suba el .zip completo.')
  }
  const [shp] = shps
  const mismo = (lista) => lista.find((a) => base(a.nombre) === base(shp.nombre)) ?? (lista.length === 1 ? lista[0] : undefined)
  const dbf = mismo(dbfs)
  if (!dbf) {
    throw new ErrorDeArchivo(
      'Falta el .dbf del shapefile, que trae el código y el área de cada parcela. Elíjalo junto con el .shp, o suba el .zip completo.',
    )
  }
  const cpg = mismo(de('cpg'))
  return {
    formato: 'shapefile',
    nombre: nombreParaMostrar ?? soloNombre(shp.nombre),
    parcelas: leerShapefile({ shp: shp.bytes, dbf: dbf.bytes, cpg: cpg ? strFromU8(cpg.bytes) : undefined }),
  }
}

/**
 * Decide el formato de lo que llegó y lo prepara para el motor: el texto (GeoJSON,
 * CSV y KML) o las parcelas ya leídas (shapefile, que es binario).
 * @param {{nombre: string, bytes: Uint8Array}[]} archivos
 * @returns {{formato: 'geojson'|'csv'|'kml', nombre: string, texto: string} | {formato: 'shapefile', nombre: string, parcelas: import('./lector.js').Parcela[]}}
 */
export function leerArchivos(archivos) {
  if (archivos.length === 0) throw new ErrorDeArchivo('No llegó ningún archivo.')

  // Un KMZ es un KML comprimido.
  if (archivos.length === 1 && extension(archivos[0].nombre) === 'kmz') return leerKMZ(archivos[0].nombre, archivos[0].bytes)

  // Un .zip se abre y se mira lo que trae, como si se hubieran soltado sus archivos.
  const zips = archivos.filter((a) => extension(a.nombre) === 'zip')
  const sueltos = archivos.filter((a) => extension(a.nombre) !== 'zip')
  const todos = [...sueltos, ...zips.flatMap((z) => abrirZip(z.nombre, z.bytes))]
  const desdeZip = zips.length === 1 && sueltos.length === 0 ? zips[0].nombre : undefined

  const partes = todos.filter((a) => DEL_SHAPEFILE.includes(extension(a.nombre)))
  if (partes.some((a) => ['shp', 'dbf'].includes(extension(a.nombre)))) return leerPartesDeShapefile(partes, desdeZip)

  const kmzs = todos.filter((a) => extension(a.nombre) === 'kmz')
  const textos = todos.filter((a) => extension(a.nombre) in DE_TEXTO)
  if (textos.length + kmzs.length > 1) {
    throw new ErrorDeArchivo('Llegaron varios archivos de parcelas. Por ahora Deslinde revisa uno a la vez.')
  }
  if (kmzs.length === 1) return leerKMZ(desdeZip ?? soloNombre(kmzs[0].nombre), kmzs[0].bytes)
  if (textos.length === 1) {
    const [a] = textos
    return { formato: DE_TEXTO[extension(a.nombre)], nombre: desdeZip ?? soloNombre(a.nombre), texto: strFromU8(a.bytes) }
  }
  if (zips.length > 0) {
    throw new ErrorDeArchivo('El .zip no trae nada que Deslinde lea: debe traer un shapefile (.shp y .dbf), un KML o un GeoJSON.')
  }
  const nombres = archivos.map((a) => `"${soloNombre(a.nombre)}"`).join(', ')
  throw new ErrorDeArchivo(`${nombres} no es un formato que Deslinde lea. Use ${FORMATOS_ACEPTADOS}.`)
}
