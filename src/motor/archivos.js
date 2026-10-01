// Qué llegó y cómo se lee. La persona puede soltar uno o varios archivos de
// parcelas (GeoJSON, CSV, KML, KMZ, shapefile o un .zip), de fuentes y
// formatos distintos. Cada archivo de parcelas es una fuente; un shapefile son
// varios archivos (.shp, .dbf y sus compañeros) que forman una sola. Aquí se
// abren los comprimidos, se decide el formato de cada fuente por su extensión
// y se leen sus parcelas. analizar (index.js) las revisa todas juntas.
//
// Un archivo que no se puede leer no frena a los demás: vuelve como una fuente
// con su `error`, y la página lo muestra en la lista de archivos.

import { strFromU8, unzipSync } from 'fflate'
import { ErrorDeArchivo } from './errores.js'
import { leer } from './lector.js'
import { leerShapefile } from './shapefile.js'

const DE_TEXTO = { geojson: 'geojson', json: 'geojson', csv: 'csv', kml: 'kml' }
const DEL_SHAPEFILE = ['shp', 'dbf', 'shx', 'prj', 'cpg', 'sbn', 'sbx', 'qix', 'qmd', 'xml']

const extension = (nombre) => /\.([^./\\]+)$/.exec(nombre)?.[1]?.toLowerCase() ?? ''
const base = (nombre) => nombre.replace(/\.[^./\\]+$/, '').toLowerCase()
const soloNombre = (ruta) => ruta.split(/[/\\]/).pop()

export const FORMATOS_ACEPTADOS =
  'GeoJSON, KML o KMZ, shapefile (un .zip, o el .shp junto con el .dbf) o CSV de puntos'

/**
 * @typedef {Object} Fuente  Un archivo de parcelas, o los de un shapefile.
 * @property {string} nombre  Para mostrar: el del archivo, el del .shp o el del .zip que lo traía.
 * @property {number[]} de    Posición, entre los archivos recibidos, de los que sale. La
 *   página la usa para quitar la fuente de la lista.
 * @property {'geojson'|'csv'|'kml'|'shapefile'} [formato]
 * @property {import('./lector.js').Parcela[]} [parcelas]
 * @property {string} [error]  Por qué no se pudo leer; entonces no trae parcelas.
 */

// Lee una fuente. Un ErrorDeArchivo queda como su `error`; cualquier otro
// error es un fallo de Deslinde y sigue de largo.
function intentar(nombre, de, formato, lectura) {
  try {
    return { nombre, de, formato, parcelas: lectura() }
  } catch (e) {
    if (!(e instanceof ErrorDeArchivo)) throw e
    return { nombre, de, formato, error: e.message }
  }
}

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
    .map(([ruta, contenido]) => ({ ruta, bytes: contenido }))
}

function leerKMZ(nombre, bytes) {
  const kmls = abrirZip(nombre, bytes).filter((a) => extension(a.ruta) === 'kml')
  if (kmls.length === 0) throw new ErrorDeArchivo(`"${nombre}" no trae ningún KML adentro.`)
  // Google Earth lo llama doc.kml; si no está, el primero.
  const kml = kmls.find((a) => soloNombre(a.ruta).toLowerCase() === 'doc.kml') ?? kmls[0]
  return leer(strFromU8(kml.bytes), 'kml')
}

const FALTA_DBF =
  'Falta el .dbf del shapefile, que trae el código y el área de cada parcela. Elíjalo junto con el .shp, o suba el .zip completo.'
const FALTA_SHP = 'Falta el .shp del shapefile, que trae las geometrías. Elíjalo junto con el .dbf, o suba el .zip completo.'

// Los shapefiles entre unas partes (de los archivos sueltos o de un mismo .zip):
// cada .shp con el .dbf y el .cpg de su mismo nombre. Si hay un solo .shp y un
// solo .dbf, van juntos aunque se llamen distinto. Las partes sueltas que no
// acompañan a ningún .shp ni .dbf (un .prj, un .xml) no son una fuente.
function shapefiles(partes) {
  const de = (lista, ext) => lista.filter((a) => extension(a.ruta) === ext)
  const grupos = new Map()
  if (de(partes, 'shp').length === 1 && de(partes, 'dbf').length === 1) grupos.set('', partes)
  else {
    for (const parte of partes) {
      const clave = base(parte.ruta)
      if (!grupos.has(clave)) grupos.set(clave, [])
      grupos.get(clave).push(parte)
    }
  }
  const fuentes = []
  for (const grupo of grupos.values()) {
    const [shp] = de(grupo, 'shp')
    const [dbf] = de(grupo, 'dbf')
    const [cpg] = de(grupo, 'cpg')
    if (!shp && !dbf) continue
    const origen = [...new Set(grupo.map((a) => a.de))].sort((a, b) => a - b)
    const nombre = soloNombre((shp ?? dbf).ruta)
    fuentes.push(
      intentar(nombre, origen, 'shapefile', () => {
        if (!shp) throw new ErrorDeArchivo(FALTA_SHP)
        if (!dbf) throw new ErrorDeArchivo(FALTA_DBF)
        return leerShapefile({ shp: shp.bytes, dbf: dbf.bytes, cpg: cpg ? strFromU8(cpg.bytes) : undefined })
      }),
    )
  }
  return fuentes
}

// Fuentes entre unos archivos: los shapefiles y cada archivo de texto o KMZ.
// Lo que no es de parcelas se informa como fuente fallida si llegó suelto; si
// venía en un .zip (un léame, una imagen), se ignora.
function fuentesEntre(archivos, { sueltos }) {
  const partes = archivos.filter((a) => DEL_SHAPEFILE.includes(extension(a.ruta)))
  const fuentes = shapefiles(partes)
  for (const a of archivos) {
    const ext = extension(a.ruta)
    const nombre = soloNombre(a.ruta)
    if (ext in DE_TEXTO) fuentes.push(intentar(nombre, [a.de], DE_TEXTO[ext], () => leer(strFromU8(a.bytes), DE_TEXTO[ext])))
    else if (ext === 'kmz') fuentes.push(intentar(nombre, [a.de], 'kml', () => leerKMZ(nombre, a.bytes)))
    else if (sueltos && !DEL_SHAPEFILE.includes(ext)) {
      fuentes.push({ nombre, de: [a.de], error: `"${nombre}" no es un formato que Deslinde lea. Use ${FORMATOS_ACEPTADOS}.` })
    }
  }
  return fuentes
}

// Un .zip: lo que trae, como si se hubieran soltado sus archivos. Si trae una
// sola fuente, se llama como el .zip.
function fuentesDelZip(nombre, bytes, de) {
  let archivos
  try {
    archivos = abrirZip(nombre, bytes).map((a) => ({ ...a, de }))
  } catch (e) {
    return [{ nombre, de: [de], error: e.message }]
  }
  const fuentes = fuentesEntre(archivos, { sueltos: false })
  if (fuentes.length === 0) {
    return [{ nombre, de: [de], error: 'El .zip no trae nada que Deslinde lea: debe traer un shapefile (.shp y .dbf), un KML o un GeoJSON.' }]
  }
  if (fuentes.length === 1) fuentes[0].nombre = nombre
  return fuentes
}

// Dos fuentes con el mismo nombre (dos "parcelas.kml" de carpetas distintas)
// se distinguen con un número, para que el informe diga cuál es cuál.
function nombresUnicos(fuentes) {
  const vistos = new Map()
  for (const f of fuentes) {
    const veces = (vistos.get(f.nombre) ?? 0) + 1
    vistos.set(f.nombre, veces)
    if (veces > 1) f.nombre = `${f.nombre} (${veces})`
  }
  return fuentes
}

/**
 * Lee lo que llegó: decide el formato de cada fuente y lee sus parcelas. Las
 * fuentes van en el orden en que llegaron sus archivos. Si ninguna se puede
 * leer, lanza ErrorDeArchivo: con un solo archivo, con el mismo aviso de
 * siempre; con varios, con el aviso de cada uno.
 * @param {{nombre: string, bytes: Uint8Array}[]} archivos
 * @returns {Fuente[]}
 */
export function leerArchivos(archivos) {
  if (archivos.length === 0) throw new ErrorDeArchivo('No llegó ningún archivo.')
  const conPosicion = archivos.map((a, de) => ({ ruta: a.nombre, bytes: a.bytes, de }))
  const sueltos = conPosicion.filter((a) => extension(a.ruta) !== 'zip')
  const fuentes = [
    ...fuentesEntre(sueltos, { sueltos: true }),
    ...conPosicion.filter((a) => extension(a.ruta) === 'zip').flatMap((z) => fuentesDelZip(soloNombre(z.ruta), z.bytes, z.de)),
  ].sort((a, b) => a.de[0] - b.de[0])

  if (fuentes.length === 0) {
    // Solo partes sueltas de un shapefile que no son ni el .shp ni el .dbf.
    throw new ErrorDeArchivo(
      'Llegaron partes de un shapefile, pero faltan el .shp (las geometrías) y el .dbf (el código y el área). Elíjalos juntos, o suba el .zip completo.',
    )
  }
  if (fuentes.every((f) => f.error)) {
    if (fuentes.length === 1) throw new ErrorDeArchivo(fuentes[0].error)
    const avisos = fuentes.map((f) => `${f.nombre}: ${f.error}`).join(' ')
    throw new ErrorDeArchivo(`Ninguno de los ${fuentes.length} archivos se pudo leer. ${avisos}`)
  }
  return nombresUnicos(fuentes)
}
