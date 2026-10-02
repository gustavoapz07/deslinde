// Lo que hace el Web Worker, separado de `self` para poder probarlo en Node.
// El motor corre fuera del hilo de la página: así un archivo de 10,000 parcelas
// no congela la pantalla. Al terminar, el mapa y las descargas salen como Blob:
// pasar un Blob entre hilos no copia su contenido, y MapLibre puede leer la capa
// del mapa desde su propia URL sin que la página toque las geometrías.

import { bbox, centroid, pointOnFeature } from '@turf/turf'
import { leerArchivos } from './archivos.js'
import { claveDeCelda, mascaraDePixeles, PIXELES_POR_CELDA, urlDeCelda } from './bosque.js'
import { analizar, analizarConBosque, ErrorDeArchivo } from './index.js'
import { HONDURAS } from './reglas.js'
import { escribirCorregido, informeCSV } from './salidas.js'

export const MENSAJE_INTERNO =
  'Algo falló dentro de Deslinde al revisar el archivo. No es un problema del archivo: vuelva a intentarlo o avísenos.'

/**
 * @typedef {Object} ResultadoDelTrabajo
 * @property {import('./index.js').Informe} informe
 * @property {[number, number, number, number]|null} limites  Caja para encuadrar el mapa: las parcelas dibujables dentro de Honduras, o todas si ninguna lo está.
 * @property {{error: number, advertencia: number, ok: number, sinDibujar: number}} conteo  Parcelas por peor severidad, para la leyenda.
 * @property {number[]} indices  Posición en la revisión de la parcela de cada resultado del informe, en el mismo orden.
 * @property {{mapa: Blob, centros: Blob, hallazgos: Blob, informe: Blob, corregido: Blob}} archivos  Capas del mapa y descargas.
 * @property {{revisado: boolean, celdas?: number, parcelasConBosque?: number, error?: string}} [bosque]
 *   Solo si se pidió revisar el bosque 2020: si se pudo y cuántas parcelas lo tocan.
 */

const dentroDeHonduras = ([oeste, sur, este, norte]) =>
  oeste >= HONDURAS.lonMin && este <= HONDURAS.lonMax && sur >= HONDURAS.latMin && norte <= HONDURAS.latMax

// Caja para encuadrar el mapa: las parcelas dentro de Honduras, si hay. Una
// parcela lejana (R4) dejaría al resto diminuto; sigue dibujada y en el informe.
function encuadre(mapa) {
  if (mapa.features.length === 0) return null
  const adentro = mapa.features.filter((f) => dentroDeHonduras(bbox(f)))
  return bbox(adentro.length > 0 ? { type: 'FeatureCollection', features: adentro } : mapa)
}

function contar(estados) {
  const conteo = { error: 0, advertencia: 0, ok: 0, sinDibujar: 0 }
  for (const { severidad, dibujable } of estados) {
    conteo[severidad]++
    if (!dibujable) conteo.sinDibujar++
  }
  return conteo
}

// Una parcela que se cruza consigo misma (R6) va como contorno, con sus anillos
// como líneas. MapLibre descarta al cortar en teselas los anillos de área casi
// nula, y en un moño los dos lóbulos se restan hasta dar cero: como polígono,
// la parcela desaparecía del mapa (visto el 28-09-2026).
function contorno(p) {
  const anillos = p.tipo === 'Polygon' ? p.coords : p.coords.flat()
  return { type: 'MultiLineString', coordinates: anillos }
}

// Lo que sabe el mapa de cada parcela. Con varios archivos, también de cuál
// viene, para la ficha y el globo.
const propiedadesEnElMapa = (p, severidad, conArchivo) => ({
  indice: p.indice,
  id: p.etiqueta,
  severidad,
  ...(conArchivo && { archivo: p.archivo }),
})

// Capa del mapa: una parcela por Feature, con su peor severidad. Las que no se
// pueden dibujar (R1, anillos incompletos) quedan fuera; siguen en el informe.
export function capaDelMapa(parcelas, estados, { conArchivo = false } = {}) {
  const features = []
  for (const p of parcelas) {
    const { severidad, dibujable, cruzada } = estados[p.indice]
    if (!dibujable) continue
    features.push({
      type: 'Feature',
      properties: propiedadesEnElMapa(p, severidad, conArchivo),
      geometry: cruzada ? contorno(p) : { type: p.tipo, coordinates: p.coords },
    })
  }
  return { type: 'FeatureCollection', features }
}

// Un punto que represente a la parcela. En un polígono, uno que caiga adentro
// (el centroide de una parcela en forma de U puede caer afuera). En el contorno
// de una parcela que se cruza, el centroide de sus puntos: no tiene un adentro.
function centroDe(p, cruzada) {
  if (p.tipo === 'Point') return p.coords
  if (cruzada) return centroid(contorno(p)).geometry.coordinates
  try {
    return pointOnFeature({ type: p.tipo, coordinates: p.coords }).geometry.coordinates
  } catch {
    return centroid({ type: p.tipo, coordinates: p.coords }).geometry.coordinates
  }
}

/**
 * Un punto por parcela, para verlas de lejos: el mapa las muestra como marcas
 * de color, agrupadas con su cantidad cuando están cerca, y pone su código
 * encima al acercarse. Las que no se pueden dibujar quedan fuera, como en la
 * capa del mapa.
 */
export function capaDeCentros(parcelas, estados, { conArchivo = false } = {}) {
  const features = []
  for (const p of parcelas) {
    const { severidad, dibujable, cruzada } = estados[p.indice]
    if (!dibujable) continue
    features.push({
      type: 'Feature',
      properties: propiedadesEnElMapa(p, severidad, conArchivo),
      geometry: { type: 'Point', coordinates: centroDe(p, cruzada) },
    })
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Puntos de los hallazgos que traen ubicación, para la capa "deslinde-hallazgo"
 * del mapa. Se arma aquí y no en la página: con miles de hallazgos, armarla y
 * pasársela a MapLibre trababa la página.
 * @param {import('./index.js').Resultado[]} resultados
 */
export function capaDeHallazgos(resultados) {
  return {
    type: 'FeatureCollection',
    features: resultados
      .filter((r) => r.ubicacion)
      .map((r) => ({
        type: 'Feature',
        properties: { parcela: r.parcela, regla: r.regla, severidad: r.severidad },
        geometry: { type: 'Point', coordinates: r.ubicacion },
      })),
  }
}

/**
 * Revisa el archivo, o varios juntos, y prepara todo lo que la página necesita.
 * Con varios archivos legibles, las capas del mapa dicen de cuál viene cada
 * parcela y el GeoJSON corregido los junta en uno, con el archivo de origen.
 * @param {string | {formato: string, parcelas: import('./lector.js').Parcela[]} | import('./archivos.js').Fuente[]} entrada
 *   El texto, las parcelas ya leídas (shapefile) o las fuentes de leerArchivos.
 * @returns {ResultadoDelTrabajo}
 */
export function procesar(entrada, opciones = {}) {
  return salidas(analizar(entrada, opciones), opciones)
}

/**
 * Como `procesar`, y además compara las parcelas con el mapa de bosque 2020 de
 * la UE (R15). `opciones.consultarCelda` trae cada celda del mapa; en el
 * worker es la del WMS de la JRC (consultarCeldaDelWMS).
 */
export async function procesarConBosque(entrada, opciones = {}) {
  const analisis = await analizarConBosque(entrada, opciones)
  return { ...salidas(analisis, opciones), bosque: analisis.bosque, revisables: analisis.revisables }
}

// El mapa, las descargas y los conteos de una revisión.
function salidas({ parcelas, estados, indices, informe }, opciones) {
  opciones.alAvanzar?.({ fase: 'salidas' })
  const varias = informe.fuentes.filter((f) => !f.error).length > 1
  const mapa = capaDelMapa(parcelas, estados, { conArchivo: varias })
  return {
    informe,
    limites: encuadre(mapa),
    conteo: contar(estados),
    indices,
    archivos: {
      mapa: new Blob([JSON.stringify(mapa)], { type: 'application/geo+json' }),
      centros: new Blob([JSON.stringify(capaDeCentros(parcelas, estados, { conArchivo: varias }))], { type: 'application/geo+json' }),
      hallazgos: new Blob([JSON.stringify(capaDeHallazgos(informe.resultados))], { type: 'application/geo+json' }),
      informe: new Blob([informeCSV(informe)], { type: 'text/csv;charset=utf-8' }),
      corregido: new Blob([escribirCorregido(parcelas, { origen: varias })], { type: 'application/geo+json' }),
    },
  }
}

// ---------- Mapa de bosque 2020 (R15) ----------

// Celdas ya pedidas al WMS mientras viva el worker: al sumar o quitar un
// archivo, las zonas ya consultadas no se piden de nuevo.
const celdasPedidas = new Map()

async function pedirCelda(celda) {
  const respuesta = await fetch(urlDeCelda(celda))
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`)
  if (!respuesta.headers.get('content-type')?.startsWith('image/png')) throw new Error('El servicio no devolvió una imagen.')
  // Sin corregir colores ni premultiplicar: solo importa si el píxel es transparente.
  const imagen = await createImageBitmap(await respuesta.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  if (imagen.width !== PIXELES_POR_CELDA || imagen.height !== PIXELES_POR_CELDA) throw new Error('La imagen no tiene el tamaño pedido.')
  const lienzo = new OffscreenCanvas(imagen.width, imagen.height).getContext('2d', { willReadFrequently: true })
  lienzo.drawImage(imagen, 0, 0)
  return mascaraDePixeles(lienzo.getImageData(0, 0, imagen.width, imagen.height).data, imagen.width, imagen.height)
}

/** Máscara de bosque de una celda, del WMS de la JRC. Si falla, lo intenta una vez más. */
export function consultarCeldaDelWMS(celda) {
  const clave = claveDeCelda(celda)
  if (!celdasPedidas.has(clave)) {
    const pedido = pedirCelda(celda).catch(() => pedirCelda(celda))
    pedido.catch(() => celdasPedidas.delete(clave)) // una que falló se vuelve a pedir la próxima vez
    celdasPedidas.set(clave, pedido)
  }
  return celdasPedidas.get(clave)
}

// Lo que mandó la página, listo para el motor. Con archivos (File, uno o
// varios), el formato sale de su extensión y los comprimidos se abren aquí,
// fuera de la página. Con texto o un Blob sin nombre, vale el formato que vino.
async function prepararEntrada(entrada, formato) {
  if (typeof entrada === 'string') return { entrada, formato }
  const lista = Array.isArray(entrada) ? entrada : [entrada]
  if (lista.length === 1 && !lista[0].name) return { entrada: await lista[0].text(), formato }
  const archivos = await Promise.all(lista.map(async (a) => ({ nombre: a.name, bytes: new Uint8Array(await a.arrayBuffer()) })))
  return { entrada: leerArchivos(archivos), formato }
}

/**
 * Atiende un pedido de la página. `entrada` puede ser el texto, un Blob o los
 * archivos (File, uno o varios: los de un shapefile o de varias fuentes): con
 * los archivos, la lectura también ocurre fuera de la página.
 * Responde con mensajes { id, tipo: 'avance' | 'listo' | 'error' }.
 */
export async function atender({ id, entrada, formato, opciones = {} }, enviar) {
  try {
    const preparada = await prepararEntrada(entrada, formato)
    const alAvanzar = (avance) => enviar({ id, tipo: 'avance', avance })
    const ajustes = { ...opciones, formato: preparada.formato, alAvanzar }
    // El mapa de bosque se pide solo si la persona lo pidió (botón "Revisar bosque 2020").
    const resultado = opciones.bosque
      ? await procesarConBosque(preparada.entrada, { ...ajustes, consultarCelda: consultarCeldaDelWMS })
      : procesar(preparada.entrada, ajustes)
    enviar({ id, tipo: 'listo', resultado })
  } catch (e) {
    const error =
      e instanceof ErrorDeArchivo
        ? { clase: 'archivo', mensaje: e.message }
        : { clase: 'interno', mensaje: MENSAJE_INTERNO, detalle: String(e?.message ?? e) }
    enviar({ id, tipo: 'error', error })
  }
}
