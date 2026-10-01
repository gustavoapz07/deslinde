// Lector de shapefile según la especificación técnica de ESRI (julio de 1998):
// el .shp trae las geometrías y el .dbf (dBASE) los atributos, en el mismo
// orden. El .cpg, si viene, dice la codificación del .dbf.
//
// Las coordenadas vienen como números binarios, no como texto: su texto es el
// más corto que representa cada número (14.4 y no 14.400000). Por eso estas
// parcelas llevan `precision: 'binaria'` y R2 las cuenta distinto (reglas.js).
//
// Sin librería: las que hay traen reproyección o polyfills de codificaciones
// que no hacen falta, y así los avisos quedan en español.

import { aNumero, codigoDe, ErrorDeArchivo, etiquetaDe } from './errores.js'

const TIPOS = {
  0: null,
  1: 'Point',
  3: 'LineString',
  5: 'Polygon',
  8: 'MultiPoint',
  11: 'Point',
  13: 'LineString',
  15: 'Polygon',
  18: 'MultiPoint',
  21: 'Point',
  23: 'LineString',
  25: 'Polygon',
  28: 'MultiPoint',
  31: 'MultiPatch',
}

const vistaDe = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

// Área con signo de un anillo: positiva si va en sentido horario. En el
// shapefile el borde exterior va en sentido horario y los huecos al revés.
function areaHoraria(anillo) {
  let suma = 0
  for (let i = 0; i < anillo.length - 1; i++) suma += (anillo[i + 1][0] - anillo[i][0]) * (anillo[i + 1][1] + anillo[i][1])
  return suma / 2
}

function dentro([x, y], anillo) {
  let adentro = false
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i]
    const [xj, yj] = anillo[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) adentro = !adentro
  }
  return adentro
}

// Arma polígonos con los anillos de un registro: cada borde exterior empieza un
// polígono y cada hueco va al exterior más chico que lo contiene. Si ningún
// anillo va en sentido horario (hay programas que no respetan el orden), todos
// son exteriores.
function armarPoligonos(anillos) {
  const conArea = anillos.map((a) => ({ anillo: a, area: areaHoraria(a) }))
  const hayExteriores = conArea.some((a) => a.area > 0)
  const exteriores = []
  const huecos = []
  for (const a of conArea) (!hayExteriores || a.area > 0 ? exteriores : huecos).push(a)
  const poligonos = exteriores.map((e) => ({ ...e, anillos: [e.anillo] }))
  for (const h of huecos) {
    const dueno = poligonos
      .filter((p) => dentro(h.anillo[0], p.anillo))
      .sort((a, b) => Math.abs(a.area) - Math.abs(b.area))[0]
    if (dueno) dueno.anillos.push(h.anillo)
    else poligonos.push({ anillo: h.anillo, area: h.area, anillos: [h.anillo] }) // hueco suelto: se trata como parcela
  }
  return poligonos.map((p) => p.anillos)
}

// Una geometría del .shp: tipo, coordenadas como números y su texto.
function leerRegistro(vista, desde, largo) {
  const codigo = vista.getInt32(desde, true)
  if (!(codigo in TIPOS)) throw new ErrorDeArchivo(`El .shp trae un tipo de geometría desconocido (${codigo}).`)
  const tipo = TIPOS[codigo]
  if (tipo === null) return { tipo: undefined }
  if (tipo === 'Point') {
    const coords = [vista.getFloat64(desde + 4, true), vista.getFloat64(desde + 12, true)]
    return { tipo, coords }
  }
  if (tipo !== 'Polygon') return { tipo } // líneas, multipuntos: R1 dice qué llegó
  if (largo < 44) throw new ErrorDeArchivo('El .shp está incompleto: un polígono viene cortado.')
  const partes = vista.getInt32(desde + 36, true)
  const puntos = vista.getInt32(desde + 40, true)
  if (partes < 0 || puntos < 0 || 44 + 4 * partes + 16 * puntos > largo) {
    throw new ErrorDeArchivo('El .shp está dañado: un polígono dice tener más puntos de los que trae.')
  }
  const inicios = Array.from({ length: partes }, (_, i) => vista.getInt32(desde + 44 + 4 * i, true))
  const base = desde + 44 + 4 * partes
  const todos = Array.from({ length: puntos }, (_, i) => [vista.getFloat64(base + 16 * i, true), vista.getFloat64(base + 16 * i + 8, true)])
  const anillos = inicios.map((inicio, i) => todos.slice(inicio, inicios[i + 1] ?? puntos))
  const poligonos = armarPoligonos(anillos.filter((a) => a.length > 0))
  if (poligonos.length === 1) return { tipo: 'Polygon', coords: poligonos[0] }
  return { tipo: 'MultiPolygon', coords: poligonos }
}

function leerShp(bytes) {
  if (bytes.byteLength < 100) throw new ErrorDeArchivo('El .shp no es un shapefile válido: es demasiado corto.')
  const vista = vistaDe(bytes)
  if (vista.getInt32(0, false) !== 9994) throw new ErrorDeArchivo('El .shp no es un shapefile válido.')
  const registros = []
  let desde = 100
  while (desde + 8 <= bytes.byteLength) {
    const largo = vista.getInt32(desde + 4, false) * 2
    if (largo < 4 || desde + 8 + largo > bytes.byteLength) {
      throw new ErrorDeArchivo('El .shp está incompleto o dañado: un registro termina después del archivo.')
    }
    registros.push(leerRegistro(vista, desde + 8, largo))
    desde += 8 + largo
  }
  return registros
}

// ---------- .dbf ----------

// Nombres de codificación que se ven en los .cpg, a los que entiende TextDecoder.
function codificacionDe(cpg) {
  const t = cpg?.trim().toLowerCase().replace(/^ansi\s*/, '')
  if (!t) return null
  if (/^utf-?8$/.test(t)) return 'utf-8'
  if (/^(cp|windows-?)?1252$/.test(t)) return 'windows-1252'
  if (/^(iso-?)?8859-?1$|^88591$|^latin-?1$/.test(t)) return 'iso-8859-1'
  return t
}

function decodificador(codificacion, bytes) {
  if (codificacion) {
    try {
      return new TextDecoder(codificacion)
    } catch {
      // codificación que el navegador no conoce: se prueba como sin .cpg
    }
  }
  // Sin .cpg: UTF-8 si todo el archivo lo es, si no Windows-1252, que es lo
  // que dejan casi todos los programas de mapas en español.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return new TextDecoder('utf-8')
  } catch {
    return new TextDecoder('windows-1252')
  }
}

function leerDbf(bytes, cpg) {
  if (bytes.byteLength < 33) throw new ErrorDeArchivo('El .dbf no es válido: es demasiado corto.')
  const vista = vistaDe(bytes)
  const cantidad = vista.getUint32(4, true)
  const largoCabecera = vista.getUint16(8, true)
  const largoRegistro = vista.getUint16(10, true)
  if (largoCabecera < 33 || largoRegistro < 1 || largoCabecera + largoRegistro * cantidad > bytes.byteLength) {
    throw new ErrorDeArchivo('El .dbf está dañado o incompleto.')
  }
  const texto = decodificador(codificacionDe(cpg), bytes.subarray(largoCabecera))
  const campos = []
  let posicion = 1 // el primer byte del registro marca si está borrado
  for (let desde = 32; desde + 32 <= largoCabecera && bytes[desde] !== 0x0d; desde += 32) {
    const fin = bytes.indexOf(0, desde)
    const nombre = new TextDecoder('latin1').decode(bytes.subarray(desde, fin === -1 || fin > desde + 11 ? desde + 11 : fin))
    const largo = bytes[desde + 16]
    campos.push({ nombre: nombre.trim().toLowerCase(), tipo: String.fromCharCode(bytes[desde + 11]), desde: posicion, largo })
    posicion += largo
  }
  const numerico = (c) => c.tipo === 'N' || c.tipo === 'F'
  const filas = []
  for (let n = 0; n < cantidad; n++) {
    const inicio = largoCabecera + largoRegistro * n
    const fila = {}
    for (const c of campos) {
      const valor = texto.decode(bytes.subarray(inicio + c.desde, inicio + c.desde + c.largo)).replace(/\0/g, '').trim()
      // Los números quedan como texto aquí: el código de la parcela no debe perder ceros ("007").
      fila[c.nombre] = numerico(c) && valor === '' ? null : valor
    }
    filas.push({ fila, borrado: bytes[inicio] === 0x2a }) // '*': registro borrado
  }
  return { filas, numericos: new Set(campos.filter(numerico).map((c) => c.nombre)) }
}

// ---------- Parcelas ----------

// Texto de cada número: el más corto que lo representa, como lo escribe JavaScript.
const comoTexto = (valor) => (Array.isArray(valor) ? valor.map(comoTexto) : String(valor))

/**
 * Lee un shapefile: los bytes del .shp y del .dbf, y el texto del .cpg si vino.
 * @param {{shp: Uint8Array, dbf: Uint8Array, cpg?: string}} archivos
 * @returns {import('./lector.js').Parcela[]}
 */
export function leerShapefile({ shp, dbf, cpg }) {
  const geometrias = leerShp(shp)
  const { filas, numericos } = leerDbf(dbf, cpg)
  if (geometrias.length !== filas.length) {
    throw new ErrorDeArchivo(
      `El .shp y el .dbf no tienen la misma cantidad de parcelas (${geometrias.length} y ${filas.length}). ` +
        'Asegúrese de que sean del mismo shapefile.',
    )
  }
  const parcelas = []
  geometrias.forEach((g, n) => {
    const { fila, borrado } = filas[n]
    if (borrado) return // registro borrado en el .dbf: ya no es parte del archivo
    const indice = parcelas.length
    const propiedades = {}
    for (const [clave, valor] of Object.entries(fila)) {
      propiedades[clave] = numericos.has(clave) && clave !== 'id' && valor !== null ? Number(valor) : valor
    }
    const areaHa = typeof propiedades.area_ha === 'number' ? propiedades.area_ha : aNumero(propiedades.area_ha)
    parcelas.push({
      indice,
      codigo: codigoDe(propiedades.id),
      etiqueta: etiquetaDe(propiedades.id, indice),
      propiedades,
      tipo: g.tipo,
      coords: g.coords,
      textos: g.coords === undefined ? undefined : comoTexto(g.coords),
      areaHa,
      precision: 'binaria',
    })
  })
  return parcelas
}
