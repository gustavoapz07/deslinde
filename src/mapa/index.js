// Mapa de Deslinde con MapLibre. Las parcelas llegan del Web Worker como URL de
// un Blob: MapLibre las lee y las corta en su propio worker, así que la página
// no toca las geometrías. El mapa base de OpenFreeMap se puede apagar; apagado,
// el mapa no pide nada fuera del sitio (ver la nota "Mapa base" de la bóveda).
//
// La ficha de la parcela elegida no es una ventanita sobre el mapa: va fija a
// un costado (abajo en el celular), y el mapa deja la parcela a la vista fuera
// de ella. Al pasar el mouse, un globo dice qué parcela es.

import { Map, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ICONOS } from '../iconos.js'
import { NOMBRES_DE_REGLA } from '../lista/datos.js'
import {
  CAPA_GRUPO,
  CAPAS_CLIC,
  construirEstilo,
  ESTILO_BASE,
  fichaDeParcela,
  FUENTE_CENTROS,
  FUENTE_HALLAZGOS,
  FUENTE_PARCELAS,
  NOMBRES,
  VACIA,
  VISTA_HONDURAS,
  ZOOM_DETALLE,
} from './capas.js'

setWorkerUrl(workerUrl)

// Textos de los controles de MapLibre en español: los leen los lectores de
// pantalla y salen como ayuda al pasar el mouse. Faltan los de controles que
// Deslinde no usa (pantalla completa, ubicación, globo).
const TEXTOS = {
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar los créditos del mapa',
  'AttributionControl.MapFeedback': 'Reportar un error del mapa',
  'LogoControl.Title': 'Logo de MapLibre',
  'Map.Title': 'Mapa',
  'Marker.Title': 'Marcador',
  'NavigationControl.ResetBearing': 'Arrastre para girar el mapa; haga clic para volver al norte',
  'NavigationControl.ZoomIn': 'Acercar',
  'NavigationControl.ZoomOut': 'Alejar',
}

const FUENTES_ELEGIBLES = [FUENTE_PARCELAS, FUENTE_CENTROS]
const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`

const nodo = (etiqueta, clase, texto) => {
  const elemento = document.createElement(etiqueta)
  if (clase) elemento.className = clase
  if (texto !== undefined) elemento.textContent = texto
  return elemento
}

// Contenido de la ficha. Todo va como texto: los códigos y mensajes vienen del
// archivo o del motor; solo los íconos, que son dibujos fijos, van como HTML.
function contenidoDeFicha(ficha, alCerrar) {
  const cabeza = nodo('div', 'ficha-cabeza')
  const titulos = nodo('div', 'ficha-titulos')
  const codigo = nodo('h2', 'ficha-codigo', ficha.titulo)
  const estado = nodo('p', `ficha-estado ${ficha.severidad}`)
  const icono = nodo('span', 'ficha-icono')
  icono.innerHTML = ICONOS[ficha.severidad]
  const cuantos = ficha.hallazgos.length > 0 ? ` · ${plural(ficha.hallazgos.length, 'hallazgo', 'hallazgos')}` : ''
  estado.append(icono, `${ficha.estado}${cuantos}`)
  titulos.append(codigo)
  if (ficha.archivo) titulos.append(nodo('p', 'ficha-archivo', ficha.archivo)) // al juntar varios archivos
  titulos.append(estado)
  const cerrar = nodo('button', 'ficha-cerrar')
  cerrar.type = 'button'
  cerrar.setAttribute('aria-label', 'Cerrar la ficha')
  cerrar.innerHTML = ICONOS.cerrar
  cerrar.addEventListener('click', alCerrar)
  cabeza.append(titulos, cerrar)

  if (ficha.hallazgos.length === 0) {
    return [cabeza, nodo('p', 'ficha-limpia', 'Esta parcela pasó las 12 reglas de geolocalización.')]
  }
  const lista = nodo('ul', 'ficha-hallazgos')
  for (const h of ficha.hallazgos) {
    const item = nodo('li', `ficha-hallazgo ${h.severidad}`)
    const regla = nodo('p', 'ficha-regla')
    regla.append(nodo('b', '', h.regla), ` ${NOMBRES_DE_REGLA[h.regla] ?? ''}`)
    const accion = nodo('p', 'ficha-accion')
    accion.append(nodo('strong', '', 'Qué hacer: '), h.accion)
    item.append(regla, nodo('p', 'ficha-mensaje', h.mensaje), accion)
    lista.append(item)
  }
  return [cabeza, lista]
}

/**
 * @param {HTMLElement} contenedor
 * @param {{conFondo?: boolean, ficha: HTMLElement, globo: HTMLElement, controles?: {fondo?: HTMLElement, leyenda?: HTMLElement}}} ajustes
 *   `ficha` y `globo` son elementos de la página, encima del mapa, que el mapa llena.
 *   `controles` son las otras tarjetas sobre el mapa: el encuadre las esquiva.
 */
export function crearMapa(contenedor, { conFondo = true, ficha, globo, controles = {} }) {
  const estado = { base: null, parcelas: undefined, centros: undefined, hallazgos: undefined }
  /** @type {import('../lista/datos.js').Hallazgo[]} */
  let hallazgos = []
  let conArchivo = false // se juntaron varios archivos: la ficha dice de cuál es cada parcela
  let conBosque = false // la revisión trae el bosque 2020: se puede dibujar su capa
  let bosqueVisible = true
  let fondoPedido = false
  let seleccion = null
  let encima = null
  let avisarEleccion = () => {}

  // Auditoría de privacidad: MapLibre pasa por aquí cada petición del mapa
  // (estilo, teselas, letras, íconos). Se cuentan las que salen del equipo y el
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
    locale: TEXTOS,
    transformRequest,
  })
  mapa.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
  mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')

  const dibujar = () =>
    mapa.setStyle(construirEstilo({ ...estado, base: fondoPedido ? estado.base : null, bosque: conBosque && bosqueVisible }))

  // Cambia solo los datos. Si el estilo todavía está cargando y las fuentes no
  // existen, rehace el estilo: `estado` ya trae los datos nuevos.
  function ponerDatos() {
    const fuentes = [FUENTE_PARCELAS, FUENTE_CENTROS, FUENTE_HALLAZGOS].map((id) => mapa.getSource(id))
    if (fuentes.some((f) => !f)) return dibujar()
    fuentes[0].setData(estado.parcelas ?? VACIA)
    fuentes[1].setData(estado.centros ?? VACIA)
    fuentes[2].setData(estado.hallazgos ?? VACIA)
  }

  // Marca de una parcela (elegida o con el mouse encima) en sus dos formas: el
  // borde de cerca y la marca de lejos, que comparten el índice como id. Si el
  // estilo se está armando (el mapa recién llegó, se prendió el fondo o hay
  // datos nuevos), MapLibre no acepta marcas: se ponen cuando termina.
  function marcar(clave, anterior, actual) {
    const aplicar = () => {
      for (const source of FUENTES_ELEGIBLES) {
        if (!mapa.getSource(source)) return
        if (anterior !== null) mapa.setFeatureState({ source, id: anterior }, { [clave]: false })
        if (actual !== null) mapa.setFeatureState({ source, id: actual }, { [clave]: true })
      }
    }
    if (mapa.isStyleLoaded()) aplicar()
    else mapa.once('idle', aplicar)
  }

  function elegir(indice) {
    marcar('seleccionada', seleccion, indice)
    seleccion = indice
  }

  function cerrarFicha({ avisar = true } = {}) {
    if (ficha.hidden) return
    ficha.hidden = true
    ficha.replaceChildren()
    elegir(null)
    if (avisar) avisarEleccion(null)
  }

  function abrirFicha(indice, id, archivo) {
    elegir(indice)
    const datos = fichaDeParcela(indice, hallazgos, id, conArchivo ? archivo : undefined)
    ficha.replaceChildren(...contenidoDeFicha(datos, () => cerrarFicha()))
    ficha.hidden = false
    ficha.scrollTop = 0
  }

  // Lo que tapan las tarjetas que flotan sobre el mapa, para encuadrar las
  // parcelas fuera de ellas: el interruptor arriba, la leyenda abajo y la
  // ficha a la derecha (abajo en el celular).
  function margenes() {
    const caja = contenedor.getBoundingClientRect()
    const relleno = { top: 40, right: 40, bottom: 40, left: 40 }
    const tapa = (elemento) => (elemento && elemento.offsetParent ? elemento.getBoundingClientRect() : null)
    const control = tapa(controles.fondo)
    if (control) relleno.top = Math.max(relleno.top, control.bottom - caja.top + 20)
    const leyenda = tapa(controles.leyenda)
    if (leyenda) relleno.bottom = Math.max(relleno.bottom, caja.bottom - leyenda.top + 20)
    const lateral = ficha.hidden ? null : tapa(ficha)
    if (lateral && lateral.left > caja.left + caja.width / 2) relleno.right = caja.right - lateral.left + 30
    else if (lateral) relleno.bottom = Math.max(relleno.bottom, caja.bottom - lateral.top + 30)
    // Si las tarjetas dejan muy poco mapa (celular, pantallas bajas), manda la
    // ficha: el interruptor se puede tapar un momento, la parcela elegida no.
    if (relleno.top + relleno.bottom > caja.height * 0.8) {
      relleno.top = 20
      relleno.bottom = Math.min(relleno.bottom, caja.height * 0.6)
    }
    if (relleno.left + relleno.right > caja.width * 0.8) {
      relleno.left = 20
      relleno.right = Math.min(relleno.right, caja.width * 0.6)
    }
    return relleno
  }

  // Primero lo que está justo bajo el puntero; si no hay nada, un margen de unos
  // píxeles, para acertarle a un contorno (R6) o a una marca con el dedo.
  const MARGEN_CLIC = 6
  function elementoEn({ x, y }, capas) {
    const exacta = mapa.queryRenderedFeatures([x, y], { layers: capas })
    if (exacta.length > 0) return exacta[0]
    const caja = [
      [x - MARGEN_CLIC, y - MARGEN_CLIC],
      [x + MARGEN_CLIC, y + MARGEN_CLIC],
    ]
    return mapa.queryRenderedFeatures(caja, { layers: capas })[0]
  }
  const capasPresentes = (capas) => capas.filter((id) => mapa.getLayer(id))

  mapa.on('click', async (e) => {
    const grupo = elementoEn(e.point, capasPresentes([CAPA_GRUPO]))
    if (grupo) {
      // Un grupo se abre acercando el mapa hasta que sus parcelas se separan.
      const zoom = await mapa.getSource(FUENTE_CENTROS).getClusterExpansionZoom(grupo.properties.cluster_id)
      mapa.easeTo({ center: grupo.geometry.coordinates, zoom: Math.min(zoom, ZOOM_DETALLE + 1) })
      return
    }
    const parcela = elementoEn(e.point, capasPresentes(CAPAS_CLIC))
    if (!parcela) return cerrarFicha() // clic fuera de las parcelas: cierra la ficha
    abrirFicha(parcela.id, parcela.properties.id, parcela.properties.archivo)
    avisarEleccion(parcela.id)
  })

  // Globo con el código y el estado de la parcela bajo el mouse.
  function ocultarGlobo() {
    globo.hidden = true
    marcar('encima', encima, null)
    encima = null
    mapa.getCanvas().style.cursor = ''
  }
  mapa.on('mousemove', (e) => {
    const grupo = elementoEn(e.point, capasPresentes([CAPA_GRUPO]))
    const parcela = grupo ? null : elementoEn(e.point, capasPresentes(CAPAS_CLIC))
    if (!grupo && !parcela) return ocultarGlobo()
    mapa.getCanvas().style.cursor = 'pointer'
    if (grupo) {
      const { point_count: total, errores, advertencias } = grupo.properties
      globo.textContent = `${total} parcelas: ${errores} con errores, ${advertencias} solo con advertencias. Haga clic para acercarse.`
    } else {
      const { id, archivo, severidad } = parcela.properties
      globo.textContent = [id, archivo, NOMBRES[severidad]].filter(Boolean).join(' · ')
    }
    const id = parcela ? parcela.id : null
    if (id !== encima) {
      marcar('encima', encima, id)
      encima = id
    }
    globo.style.transform = `translate(${Math.round(e.point.x + 14)}px, ${Math.round(e.point.y + 14)}px)`
    globo.hidden = false
  })
  mapa.getCanvas().addEventListener('mouseleave', ocultarGlobo)

  // Escape cierra la ficha, esté donde esté el foco.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ficha.hidden) cerrarFicha()
  })

  const api = {
    mapa,

    /**
     * Muestra el resultado de una revisión.
     * @param {{urlCapa: string, urlCentros: string, urlHallazgos: string, limites: number[]|null, hallazgos: import('../lista/datos.js').Hallazgo[], varias?: boolean, bosque?: boolean}} datos
     *   Las URLs son de los Blob que arma el worker: MapLibre las lee en su propio worker.
     *   `varias`: se juntaron varios archivos. `bosque`: se revisó el bosque 2020, y
     *   su capa se dibuja debajo de las parcelas (la persona lo pidió).
     */
    mostrar({ urlCapa, urlCentros, urlHallazgos, limites, hallazgos: nuevos, varias = false, bosque = false }) {
      cerrarFicha({ avisar: false })
      seleccion = null
      encima = null
      hallazgos = nuevos
      conArchivo = varias
      estado.parcelas = urlCapa
      estado.centros = urlCentros
      estado.hallazgos = urlHallazgos
      // Agregar o quitar la capa de bosque cambia el estilo; si no, basta cambiar los datos.
      if (conBosque !== bosque) {
        conBosque = bosque
        dibujar()
      } else ponerDatos()
      if (limites) mapa.fitBounds(limites, { padding: margenes(), maxZoom: 16, duration: 600 })
    },

    /**
     * Lleva el mapa a un hallazgo y abre la ficha de su parcela. Un hallazgo sin
     * ubicación (R1) no se puede mostrar.
     * @param {import('../lista/datos.js').Hallazgo} hallazgo
     */
    enfocar({ indice, ubicacion, parcela, archivo }) {
      if (!ubicacion) return
      abrirFicha(indice, parcela, archivo)
      mapa.flyTo({ center: ubicacion, zoom: Math.max(mapa.getZoom(), 16), duration: 800, padding: margenes() })
    },

    /** `alElegir(indice)` se llama cuando la persona elige una parcela en el mapa, o `null` al cerrar su ficha. */
    alElegir(funcion) {
      avisarEleccion = funcion
    },

    /** Quita las parcelas, por ejemplo cuando el archivo nuevo no se pudo leer. */
    limpiar() {
      cerrarFicha({ avisar: false })
      seleccion = null
      hallazgos = []
      estado.parcelas = undefined
      estado.centros = undefined
      estado.hallazgos = undefined
      if (conBosque) {
        conBosque = false
        dibujar()
      } else ponerDatos()
    },

    /** Muestra u oculta la capa de bosque 2020 (si la revisión la trae). */
    ponerBosque(visible) {
      bosqueVisible = visible
      if (!conBosque) return
      dibujar()
      if (seleccion !== null) marcar('seleccionada', null, seleccion) // al rehacer el estilo se pierden las marcas
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
      // Al rehacer el estilo se pierden las marcas: se vuelve a marcar la elegida.
      if (seleccion !== null) marcar('seleccionada', null, seleccion)
      return true
    },
  }

  // El fondo se pide cuando el estilo inicial terminó de cargar, para que MapLibre
  // pueda sumar las capas nuevas en vez de rehacer todo el estilo.
  if (conFondo) mapa.once('load', () => api.ponerFondo(true))
  return api
}
