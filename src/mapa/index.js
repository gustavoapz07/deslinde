// Mapa de Deslinde con MapLibre. Las parcelas llegan del Web Worker como URL de
// un Blob: MapLibre las lee y las corta en su propio worker, así que la página
// no toca las geometrías. El mapa base de OpenFreeMap se puede apagar; apagado,
// el mapa no pide nada a internet (ver la nota "Mapa base" de la bóveda).

import { Map, NavigationControl, Popup, ScaleControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  CAPAS_CLIC,
  capaDeHallazgos,
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
  let resultados = []
  let fondoPedido = false
  let seleccion = null

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

  const ficha = new Popup({ maxWidth: '340px' })
  ficha.on('close', () => elegir(null))

  mapa.on('click', (e) => {
    const [parcela] = mapa.queryRenderedFeatures(e.point, { layers: CAPAS_CLIC })
    if (!parcela) return
    ficha.remove() // antes de elegir: al cerrarse, la ficha anterior borra la selección
    elegir(parcela.id)
    ficha.setLngLat(e.lngLat).setDOMContent(contenidoDeFicha(fichaDeParcela(parcela.properties, resultados))).addTo(mapa)
  })
  for (const capa of CAPAS_CLIC) {
    mapa.on('mouseenter', capa, () => (mapa.getCanvas().style.cursor = 'pointer'))
    mapa.on('mouseleave', capa, () => (mapa.getCanvas().style.cursor = ''))
  }

  const api = {
    mapa,

    /**
     * Muestra el resultado de una revisión.
     * @param {{urlCapa: string, limites: number[]|null, resultados: import('../motor/index.js').Resultado[]}} datos
     */
    mostrar({ urlCapa, limites, resultados: nuevos }) {
      ficha.remove()
      seleccion = null
      resultados = nuevos
      estado.parcelas = urlCapa
      estado.hallazgos = capaDeHallazgos(nuevos)
      ponerDatos()
      if (limites) mapa.fitBounds(limites, { padding: 40, maxZoom: 16, duration: 600 })
    },

    /** Quita las parcelas, por ejemplo cuando el archivo nuevo no se pudo leer. */
    limpiar() {
      ficha.remove()
      seleccion = null
      resultados = []
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
