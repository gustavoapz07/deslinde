// R15 · Bosque en 2020. Compara cada parcela con el mapa de bosque 2020 de la
// UE (GFC2020, versión 4, del JRC), que se pide a su servicio WMS en recortes
// fijos de 0.05° ("celdas", unos 5.5 km): el servicio recibe la zona, no el
// archivo ni el contorno de las parcelas, y una celda sirve para todas las
// parcelas que caen en ella. Cada celda llega como una imagen de 600 × 600
// píxeles: el mapa original tiene píxeles de 1/12000 de grado (unos 9 m) con
// origen en grados enteros, así que cada píxel de la imagen es uno del mapa,
// sin remuestrear. Un píxel que no es transparente es bosque.
//
// La capa del WMS es `gfc2020_v4`. Ojo: el 01-10-2026, el archivo que el
// servidor de descargas de la JRC llama "V4" en su carpeta LATEST era en
// realidad la versión 3 (mismo tamaño y píxeles que la capa `gfc2020_v3`).
//
// El mapa no distingue el café con sombra del bosque: R15 alerta y pide
// revisar la parcela, nunca dictamina deforestación. Detalle en la nota "Capa
// de bosque 2020" de la bóveda.
//
// Sin dependencias: el mapa de la página importa de aquí la dirección del WMS.

export const WMS_BOSQUE = 'https://ies-ows.jrc.ec.europa.eu/iforce/gfc2020/wms.py'
export const CAPA_WMS = 'gfc2020_v4'
export const NOMBRE_DEL_MAPA = 'el mapa de la UE (GFC2020 v4)'
export const ERROR_BOSQUE =
  'No se pudo consultar el mapa de bosque de la UE: su servicio no respondió o no hay conexión. La revisión de geolocalización sigue valiendo.'

export const CELDAS_POR_GRADO = 20 // celdas de 0.05°
export const PIXELES_POR_CELDA = 600 // 0.05° × 12,000 píxeles por grado
const N = PIXELES_POR_CELDA
const PIXELES_POR_GRADO = CELDAS_POR_GRADO * N
const M_POR_GRADO_LAT = 110574
const M_POR_GRADO_LON_ECUADOR = 111320

const ACCION =
  'Revísela: el mapa no distingue el café con sombra del bosque. Si es café u otro cultivo desde antes de 2021, deje constancia con evidencia; si no, sáquela del lote.'

export const claveDeCelda = ({ x, y }) => `${x},${y}`

// Cada píxel del mapa tiene un número en una cuadrícula que empieza en 0°:
// así una parcela que cruza de una celda a otra se cuenta sin huecos ni dobles.
const pixel = (grados) => Math.floor(grados * PIXELES_POR_GRADO)
const centroDePixel = (i) => (i + 0.5) / PIXELES_POR_GRADO
const redondear = (n) => Number(n.toFixed(6))
const numero = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

// R15 mira las parcelas que se pueden dibujar. Las que se cruzan consigo mismas
// (R6) no: su área no significa nada, como en R12.
const revisable = (p, estados) => estados[p.indice].dibujable && !estados[p.indice].cruzada

const anillosDe = (p) => (p.tipo === 'Polygon' ? p.coords : p.coords.flat())
const verticesDe = (p) => (p.tipo === 'Point' ? [p.coords] : anillosDe(p).flat())

function cajaEnPixeles(p) {
  let [o, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [lon, lat] of verticesDe(p)) {
    o = Math.min(o, lon)
    e = Math.max(e, lon)
    s = Math.min(s, lat)
    n = Math.max(n, lat)
  }
  return [pixel(o), pixel(s), pixel(e), pixel(n)]
}

/** Las celdas que hay que pedir para revisar estas parcelas, sin repetir. */
export function celdasParaParcelas(parcelas, estados) {
  const celdas = new Map()
  for (const p of parcelas) {
    if (!revisable(p, estados)) continue
    const [gx0, gy0, gx1, gy1] = cajaEnPixeles(p)
    for (let y = Math.floor(gy0 / N); y <= Math.floor(gy1 / N); y++) {
      for (let x = Math.floor(gx0 / N); x <= Math.floor(gx1 / N); x++) celdas.set(claveDeCelda({ x, y }), { x, y })
    }
  }
  return [...celdas.values()]
}

/** Pedido al WMS de la JRC: la imagen de una celda, en PNG, píxel a píxel con el mapa original. */
export function urlDeCelda({ x, y }) {
  const grados = (i) => (i / CELDAS_POR_GRADO).toFixed(2)
  const parametros = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: CAPA_WMS,
    STYLES: '',
    SRS: 'EPSG:4326',
    BBOX: [grados(x), grados(y), grados(x + 1), grados(y + 1)].join(','),
    WIDTH: String(N),
    HEIGHT: String(N),
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
  })
  return `${WMS_BOSQUE}?${parametros}`
}

/** De los píxeles RGBA de la imagen, cuáles son bosque (1): los que no son transparentes. */
export function mascaraDePixeles(rgba, ancho, alto) {
  const mascara = new Uint8Array(ancho * alto)
  for (let i = 0; i < mascara.length; i++) mascara[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0
  return mascara
}

/**
 * Pide las celdas, unas pocas a la vez para no cargar un servidor de
 * investigación, y avisa el avance. Si una falla, deja de pedir y falla.
 * @param {{x: number, y: number}[]} celdas
 * @param {(celda: {x: number, y: number}) => Promise<Uint8Array>} consultarCelda
 */
export async function consultarCeldas(celdas, consultarCelda, { alAvanzar = () => {}, simultaneas = 4 } = {}) {
  const mascaras = new Map()
  let siguiente = 0
  let hechas = 0
  let fallo = false
  alAvanzar({ fase: 'bosque', hechas: 0, total: celdas.length })
  async function pedir() {
    while (!fallo && siguiente < celdas.length) {
      const celda = celdas[siguiente++]
      try {
        mascaras.set(claveDeCelda(celda), await consultarCelda(celda))
      } catch (e) {
        fallo = true
        throw e
      }
      alAvanzar({ fase: 'bosque', hechas: ++hechas, total: celdas.length })
    }
  }
  await Promise.all(Array.from({ length: Math.min(simultaneas, celdas.length) }, pedir))
  return mascaras
}

function esBosque(gx, gy, mascaras) {
  const x = Math.floor(gx / N)
  const y = Math.floor(gy / N)
  const mascara = mascaras.get(claveDeCelda({ x, y }))
  if (!mascara) throw new Error(`Falta la celda ${claveDeCelda({ x, y })} del mapa de bosque.`)
  const columna = gx - x * N
  const fila = N - 1 - (gy - y * N) // la fila 0 de la imagen es el norte
  return mascara[fila * N + columna] === 1
}

// Metros cuadrados de un píxel a esa latitud.
const areaDePixel = (lat) =>
  (M_POR_GRADO_LON_ECUADOR * Math.cos((lat * Math.PI) / 180) * M_POR_GRADO_LAT) / PIXELES_POR_GRADO ** 2

const advertencia = (ubicacion, mensaje) => ({ regla: 'R15', severidad: 'advertencia', ubicacion, mensaje, accion: ACCION })

function bosqueEnPunto(p, mascaras) {
  const [lon, lat] = p.coords
  if (!esBosque(pixel(lon), pixel(lat), mascaras)) return null
  return advertencia([redondear(lon), redondear(lat)], `El punto de la parcela cae en bosque de 2020 según ${NOMBRE_DEL_MAPA}.`)
}

// Recorre el polígono fila por fila de píxeles: en cada fila, los bordes lo
// cortan en tramos (adentro, afuera, adentro…, también con huecos y varias
// partes) y se cuentan los píxeles cuyo centro cae adentro.
function bosqueEnPoligono(p, mascaras) {
  const anillos = anillosDe(p)
  const [, gy0, , gy1] = cajaEnPixeles(p)
  let total = 0
  let metros = 0
  const conBosque = [] // centros de los píxeles con bosque: [lon, lat, lon, lat…]
  for (let gy = gy0; gy <= gy1; gy++) {
    const lat = centroDePixel(gy)
    const cortes = []
    for (const anillo of anillos) {
      for (let k = 0; k < anillo.length - 1; k++) {
        const [x1, y1] = anillo[k]
        const [x2, y2] = anillo[k + 1]
        if (y1 > lat !== y2 > lat) cortes.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1))
      }
    }
    cortes.sort((a, b) => a - b)
    for (let k = 0; k + 1 < cortes.length; k += 2) {
      const desde = Math.ceil(cortes[k] * PIXELES_POR_GRADO - 0.5)
      const hasta = Math.ceil(cortes[k + 1] * PIXELES_POR_GRADO - 0.5) - 1
      for (let gx = desde; gx <= hasta; gx++) {
        total++
        if (!esBosque(gx, gy, mascaras)) continue
        metros += areaDePixel(lat)
        conBosque.push(centroDePixel(gx), lat)
      }
    }
  }
  // Una parcela más chica que un píxel puede no tener ningún centro adentro: se mira su centro.
  if (total === 0) {
    const vertices = anillos[0].slice(0, -1)
    const lon = vertices.reduce((s, v) => s + v[0], 0) / vertices.length
    const lat = vertices.reduce((s, v) => s + v[1], 0) / vertices.length
    if (!esBosque(pixel(lon), pixel(lat), mascaras)) return null
    return advertencia([redondear(lon), redondear(lat)], `El 100 % de la parcela cae en bosque de 2020 según ${NOMBRE_DEL_MAPA}.`)
  }
  if (conBosque.length === 0) return null

  const cuantos = conBosque.length / 2
  const pct = (cuantos / total) * 100
  const porcentaje = pct < 1 ? 'Menos del 1 %' : `El ${cuantos === total ? 100 : Math.min(99, Math.round(pct))} %`
  const superficie = metros >= 1000 ? `unas ${numero.format(metros / 10000)} ha` : `unos ${numero.format(Math.round(metros))} m²`
  return advertencia(
    dondeHayBosque(conBosque),
    `${porcentaje} de la parcela (${superficie}) cae en bosque de 2020 según ${NOMBRE_DEL_MAPA}.`,
  )
}

// El punto del aviso: el píxel con bosque más cercano al promedio de todos.
// El promedio solo podría caer fuera del bosque si la mancha tiene forma de U.
function dondeHayBosque(centros) {
  let lon = 0
  let lat = 0
  for (let i = 0; i < centros.length; i += 2) {
    lon += centros[i]
    lat += centros[i + 1]
  }
  lon /= centros.length / 2
  lat /= centros.length / 2
  let mejor = 0
  let distancia = Infinity
  for (let i = 0; i < centros.length; i += 2) {
    const d = (centros[i] - lon) ** 2 + (centros[i + 1] - lat) ** 2
    if (d < distancia) [mejor, distancia] = [i, d]
  }
  return [redondear(centros[mejor]), redondear(centros[mejor + 1])]
}

/**
 * Hallazgos R15 de las parcelas, con las máscaras de las celdas ya pedidas.
 * @param {Map<string, Uint8Array>} mascaras  Por celda (claveDeCelda).
 */
export function revisarBosque(parcelas, estados, mascaras) {
  const hallazgos = []
  for (const p of parcelas) {
    if (!revisable(p, estados)) continue
    const h = p.tipo === 'Point' ? bosqueEnPunto(p, mascaras) : bosqueEnPoligono(p, mascaras)
    if (h) hallazgos.push({ parcela: p, ...h })
  }
  return hallazgos
}
