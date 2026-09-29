// Mapa de Deslinde con MapLibre. Las parcelas llegan del Web Worker como URL de
// un Blob: MapLibre las lee y las corta en su propio worker, así que la página
// no toca las geometrías. El mapa base de OpenFreeMap se puede apagar; apagado,
// el mapa no pide nada a internet (ver la nota "Mapa base" de la bóveda).

import { Map, NavigationControl, Popup, ScaleControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  CAPAS_CLIC,
  construirEstilo,
  ESTILO_BASE,
  fichaDeParcela,
  FUENTE_HALLAZGOS,
  FUENTE_PARCELAS,
  VACIA,
  VISTA_HONDURAS,
} from './capas.js'

setWorkerUrl(workerUrl)

// Ventanita de una parcela. Todo va como texto: los códigos vienen del archivo.
function contenidoDeFicha(ficha) {
  const raiz = document.createElement('div')
  raiz.className = 'ficha'
  const titulo = document.createElement('strong')
  titulo.textContent = ficha.titulo
  const estado = document.createElement('span')
  estado.className = `ficha-estado ficha-${ficha.severidad}`
  estado.textContent = ficha.estado
  raiz.append(titulo, ' ', estado)
  if (ficha.hallazgos.length > 0) {
    const lista = document.createElement('ul')
    for (const h of ficha.hallazgos) {
      const item = document.createElement('li')
      const regla = document.createElement('b')
      regla.textContent = `${h.regla} · `
      const accion = document.createElement('small')
      accion.textContent = h.accion
      item.append(regla, h.mensaje, document.createElement('br'), accion)
      lista.append(item)
    }
    raiz.append(lista)
  }
  return raiz
}

/**
 * @param {HTMLElement} contenedor
 * @param {{conFondo?: boolean}} [ajustes]
 */
export function crearMapa(contenedor, { conFondo = true } = {}) {
  const estado = { base: null, parcelas: undefined, hallazgos: undefined }
  /** @type {import('../lista/datos.js').Hallazgo[]} */
  let hallazgos = []
  let fondoPedido = false
  let seleccion = null
  let avisarEleccion = () => {}

  // Auditoría de privacidad: MapLibre pasa por aquí cada petición del mapa
  // (estilo, teselas, fuentes, íconos). Se cuentan las que salen del equipo y el
  // número queda en `data-peticiones-externas` del contenedor. Con el mapa base
  // apagado no debería subir.
  let externas = 0
  const esLocal = (url) => url.startsWith('blob:') || url.startsWith('data:') || url.startsWith(location.origin)
  const anotarExterna = () => (contenedor.dataset.peticionesExternas = String(++externas))
  const transformRequest = (url) => {
    if (!esLocal(url)) anotarExterna()
    return { url }
  }
  contenedor.dataset.peticionesExternas = '0'

  const mapa = new Map({
    container: contenedor,
    style: construirEstilo(),
    bounds: VISTA_HONDURAS,
    fitBoundsOptions: { padding: 20 },
    attributionControl: { compact: false },
    transformRequest,
  })
  mapa.addControl(new NavigationControl({ showCompass: false }))
  mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

  const dibujar = () => mapa.setStyle(construirEstilo({ ...estado, base: fondoPedido ? estado.base : null }))

  // Cambia solo los datos. Si el estilo todavía está cargando y las fuentes no
  // existen, rehace el estilo: `estado` ya trae los datos nuevos.
  function ponerDatos() {
    const parcelas = mapa.getSource(FUENTE_PARCELAS)
    const hallazgos = mapa.getSource(FUENTE_HALLAZGOS)
    if (!parcelas || !hallazgos) return dibujar()
    parcelas.setData(estado.parcelas ?? VACIA)
    hallazgos.setData(estado.hallazgos ?? VACIA)
  }

  function elegir(indice) {
    if (seleccion !== null) mapa.setFeatureState({ source: FUENTE_PARCELAS, id: seleccion }, { seleccionada: false })
    seleccion = indice
    if (indice !== null) mapa.setFeatureState({ source: FUENTE_PARCELAS, id: indice }, { seleccionada: true })
  }

  // La ficha no se cierra sola con un clic en el mapa: el clic de abajo decide si
  // abre otra o la cierra. Si no, al pasar de una parcela a otra se cerraba la nueva.
  const ficha = new Popup({ maxWidth: '340px', closeOnClick: false })
  let cerrandoPorCodigo = false
  ficha.on('close', () => {
    elegir(null)
    if (!cerrandoPorCodigo) avisarEleccion(null) // la cerró la persona
  })

  function cerrarFicha() {
    cerrandoPorCodigo = true
    ficha.remove()
    cerrandoPorCodigo = false
  }

  function abrirFicha(indice, lugar, id) {
    cerrarFicha() // antes de elegir: al cerrarse, la ficha anterior borra la selección
    elegir(indice)
    ficha.setLngLat(lugar).setDOMContent(contenidoDeFicha(fichaDeParcela(indice, hallazgos, id))).addTo(mapa)
  }

  // Primero lo que está justo bajo el clic; si no hay nada, un margen de unos
  // píxeles, para acertarle a un contorno (R6) o a un punto con el dedo.
  const MARGEN_CLIC = 6
  function parcelaEn({ x, y }) {
    const exacta = mapa.queryRenderedFeatures([x, y], { layers: CAPAS_CLIC })
    if (exacta.length > 0) return exacta[0]
    const caja = [
      [x - MARGEN_CLIC, y - MARGEN_CLIC],
      [x + MARGEN_CLIC, y + MARGEN_CLIC],
    ]
    return mapa.queryRenderedFeatures(caja, { layers: CAPAS_CLIC })[0]
  }

  mapa.on('click', (e) => {
    const parcela = parcelaEn(e.point)
    if (!parcela) return ficha.remove() // clic fuera de las parcelas: cierra la ficha
    abrirFicha(parcela.id, e.lngLat, parcela.properties.id)
    avisarEleccion(parcela.id)
  })
  for (const capa of CAPAS_CLIC) {
    mapa.on('mouseenter', capa, () => (mapa.getCanvas().style.cursor = 'pointer'))
    mapa.on('mouseleave', capa, () => (mapa.getCanvas().style.cursor = ''))
  }

  const api = {
    mapa,

    /**
     * Muestra el resultado de una revisión.
     * @param {{urlCapa: string, urlHallazgos: string, limites: number[]|null, hallazgos: import('../lista/datos.js').Hallazgo[]}} datos
     *   Las dos URLs son de los Blob que arma el worker: MapLibre las lee en su propio worker.
     */
    mostrar({ urlCapa, urlHallazgos, limites, hallazgos: nuevos }) {
      cerrarFicha()
      seleccion = null
      hallazgos = nuevos
      estado.parcelas = urlCapa
      estado.hallazgos = urlHallazgos
      ponerDatos()
      if (limites) mapa.fitBounds(limites, { padding: 40, maxZoom: 16, duration: 600 })
    },

    /**
     * Lleva el mapa a un hallazgo y abre la ficha de su parcela. Un hallazgo sin
     * ubicación (R1) no se puede mostrar.
     * @param {import('../lista/datos.js').Hallazgo} hallazgo
     */
    enfocar({ indice, ubicacion }) {
      if (!ubicacion) return
      mapa.flyTo({ center: ubicacion, zoom: Math.max(mapa.getZoom(), 16), duration: 800 })
      abrirFicha(indice, ubicacion)
    },

    /** `alElegir(indice)` se llama cuando la persona elige una parcela en el mapa, o `null` al cerrar su ficha. */
    alElegir(funcion) {
      avisarEleccion = funcion
    },

    /** Quita las parcelas, por ejemplo cuando el archivo nuevo no se pudo leer. */
    limpiar() {
      cerrarFicha()
      seleccion = null
      hallazgos = []
      estado.parcelas = undefined
      estado.hallazgos = undefined
      ponerDatos()
    },

    /**
     * Enciende o apaga el mapa base. Devuelve false si no se pudo descargar
     * (sin internet o con el servicio caído): las parcelas se siguen viendo.
     */
    async ponerFondo(visible) {
      fondoPedido = visible
      if (visible && !estado.base) {
        try {
          anotarExterna() // el estilo base se descarga aquí, no en MapLibre
          const respuesta = await fetch(ESTILO_BASE)
          if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`)
          estado.base = await respuesta.json()
        } catch {
          fondoPedido = false
          dibujar()
          return false
        }
        if (!fondoPedido) return true // se apagó mientras se descargaba
      }
      dibujar()
      return true
    },
  }

  // El fondo se pide cuando el estilo inicial terminó de cargar, para que MapLibre
  // pueda sumar las capas nuevas en vez de rehacer todo el estilo.
  if (conFondo) mapa.once('load', () => api.ponerFondo(true))
  return api
}
