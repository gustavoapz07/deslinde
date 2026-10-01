// Lista de hallazgos enlazada al mapa: al elegir un hallazgo, el mapa va a su
// parcela; al elegir una parcela en el mapa, la lista marca sus hallazgos.
// Se dibuja solo un tramo de TAMANO_PAGINA en TAMANO_PAGINA, para que un
// archivo con miles de hallazgos no llene la página de golpe.

import { ICONOS } from '../iconos.js'
import { conteoPorRegla, filtrar, NOMBRES_DE_REGLA, TAMANO_PAGINA, tramoPara } from './datos.js'

const numero = new Intl.NumberFormat('en-US')

// En pantallas anchas el panel tiene su propio desplazamiento: ahí sí conviene
// llevar el hallazgo a la vista. En celular movería toda la página y sacaría
// el mapa de la vista.
const panelConDesplazamiento = () => window.matchMedia('(min-width: 901px)').matches

/**
 * @param {HTMLElement} contenedor
 * @param {{alElegir: (h: import('./datos.js').Hallazgo) => void}} ajustes
 */
export function crearLista(contenedor, { alElegir }) {
  contenedor.innerHTML = `
    <div class="lista-cabeza">
      <h2>Hallazgos</h2>
      <span class="contador"></span>
    </div>
    <div class="filtros">
      <fieldset class="segmentos filtro-severidad">
        <legend class="oculto">Severidad</legend>
      </fieldset>
      <label class="filtro-regla-etiqueta">
        <span>Regla</span>
        <select class="filtro-regla"></select>
      </label>
      <label class="filtro-regla-etiqueta" hidden>
        <span>Archivo</span>
        <select class="filtro-regla filtro-archivo"></select>
      </label>
    </div>
    <p class="lista-cuenta" aria-live="polite"></p>
    <button type="button" class="mas antes" hidden></button>
    <ul class="hallazgos"></ul>
    <button type="button" class="mas despues" hidden></button>
  `
  const $ = (selector) => contenedor.querySelector(selector)
  const lista = $('.hallazgos')
  let todos = []
  let filtrados = []
  let tramo = { desde: 0, hasta: TAMANO_PAGINA }
  let activa = null
  let archivos = [] // al juntar varios, sus nombres: cada hallazgo dice de cuál es

  function opcion(valor, texto) {
    const o = document.createElement('option')
    o.value = valor
    o.textContent = texto
    return o
  }

  // Un botón de radio por severidad: se ve como un control segmentado y se usa
  // con las flechas del teclado, como cualquier grupo de radios.
  function segmento(valor, texto, cantidad) {
    const etiqueta = document.createElement('label')
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'severidad'
    radio.value = valor
    radio.checked = valor === 'todas'
    const cara = document.createElement('span')
    const cifra = document.createElement('b')
    cifra.textContent = numero.format(cantidad)
    cara.append(`${texto} `, cifra)
    etiqueta.append(radio, cara)
    return etiqueta
  }

  const severidadElegida = () => contenedor.querySelector('input[name="severidad"]:checked')?.value ?? 'todas'

  function llenarFiltros() {
    const errores = todos.filter((h) => h.severidad === 'error').length
    $('.contador').textContent = numero.format(todos.length)
    $('.filtro-severidad').replaceChildren(
      $('.filtro-severidad legend'),
      segmento('todas', 'Todos', todos.length),
      segmento('error', 'Errores', errores),
      segmento('advertencia', 'Advertencias', todos.length - errores),
    )
    $('.filtro-regla').replaceChildren(
      opcion('todas', 'Todas las reglas'),
      ...conteoPorRegla(todos).map(({ regla, cantidad }) =>
        opcion(regla, `${regla} · ${NOMBRES_DE_REGLA[regla] ?? regla} (${numero.format(cantidad)})`),
      ),
    )
    // Al juntar varios archivos, también por archivo: para ver qué pedirle a cada fuente.
    $('.filtro-archivo').closest('label').hidden = archivos.length < 2
    $('.filtro-archivo').replaceChildren(
      opcion('todos', 'Todos los archivos'),
      ...archivos.map((nombre) => opcion(nombre, `${nombre} (${numero.format(todos.filter((h) => h.archivo === nombre).length)})`)),
    )
  }

  function item(h, posicion) {
    const li = document.createElement('li')
    // Con ubicación es un botón que lleva al mapa; sin ella (R1), solo texto.
    const cuerpo = document.createElement(h.ubicacion ? 'button' : 'div')
    cuerpo.className = `hallazgo ${h.severidad}`
    cuerpo.dataset.posicion = String(posicion)
    if (h.ubicacion) cuerpo.type = 'button'

    // La severidad se ve por la forma del ícono y se lee como texto oculto.
    const icono = document.createElement('span')
    icono.className = 'hallazgo-icono'
    icono.innerHTML = ICONOS[h.severidad] // dibujo fijo, no viene del archivo
    const severidad = document.createElement('span')
    severidad.className = 'oculto'
    severidad.textContent = h.severidad === 'error' ? 'Error: ' : 'Advertencia: '

    const texto = document.createElement('span')
    texto.className = 'hallazgo-texto'
    const cabeza = document.createElement('span')
    cabeza.className = 'hallazgo-cabeza'
    const parcela = document.createElement('strong')
    parcela.className = 'hallazgo-parcela'
    parcela.textContent = h.parcela
    const regla = document.createElement('span')
    regla.className = 'regla'
    regla.textContent = `${h.regla} · ${NOMBRES_DE_REGLA[h.regla] ?? ''}`
    cabeza.append(parcela)
    if (archivos.length > 1) {
      const archivo = document.createElement('span')
      archivo.className = 'hallazgo-archivo'
      archivo.textContent = h.archivo
      cabeza.append(archivo)
    }
    cabeza.append(regla)

    const mensaje = document.createElement('span')
    mensaje.className = 'hallazgo-mensaje'
    mensaje.textContent = h.ubicacion ? h.mensaje : `${h.mensaje} No se puede mostrar en el mapa.`
    texto.append(cabeza, mensaje)
    cuerpo.append(icono, severidad, texto)
    li.append(cuerpo)
    return li
  }

  function cuenta() {
    const total = filtrados.length
    if (total === 0) {
      return todos.length === 0 ? 'Ninguna parcela tiene hallazgos en las reglas R1 a R12.' : 'Ningún hallazgo con este filtro.'
    }
    const hasta = Math.min(tramo.hasta, total)
    if (tramo.desde === 0 && hasta === total) return `${numero.format(total)} ${total === 1 ? 'hallazgo' : 'hallazgos'}.`
    return `Se muestran del ${numero.format(tramo.desde + 1)} al ${numero.format(hasta)} de ${numero.format(total)} hallazgos.`
  }

  function dibujar() {
    const visibles = filtrados.slice(tramo.desde, tramo.hasta)
    lista.replaceChildren(...visibles.map((h, i) => item(h, tramo.desde + i)))
    const antes = Math.min(tramo.desde, TAMANO_PAGINA)
    const despues = Math.min(filtrados.length - tramo.hasta, TAMANO_PAGINA)
    $('.antes').hidden = antes <= 0
    $('.antes').textContent = `Mostrar ${numero.format(antes)} anteriores`
    $('.despues').hidden = despues <= 0
    $('.despues').textContent = `Mostrar ${numero.format(despues)} más`
    $('.lista-cuenta').textContent = cuenta()
    resaltar(false)
  }

  // Marca los hallazgos de la parcela activa; con `llevar`, el primero a la vista.
  function resaltar(llevar) {
    let primero = null
    for (const elemento of lista.querySelectorAll('.hallazgo')) {
      const h = filtrados[Number(elemento.dataset.posicion)]
      const esActiva = activa !== null && h.indice === activa
      elemento.classList.toggle('activa', esActiva)
      if (esActiva) elemento.setAttribute('aria-current', 'true')
      else elemento.removeAttribute('aria-current')
      if (esActiva && !primero) primero = elemento
    }
    if (llevar && primero && panelConDesplazamiento()) primero.scrollIntoView({ block: 'center' })
  }

  // Al sumar hallazgos arriba, lo que la persona estaba mirando no debe saltar.
  function sinSaltar(cambiar) {
    const primero = lista.firstElementChild?.firstElementChild
    const posicion = primero?.dataset.posicion
    const antes = primero?.getBoundingClientRect().top
    cambiar()
    const mismo = posicion && lista.querySelector(`[data-posicion="${posicion}"]`)
    if (!mismo) return
    const panel = contenedor.closest('.panel-cuerpo')
    const desplazable = panel && panel.scrollHeight > panel.clientHeight ? panel : window
    desplazable.scrollBy(0, mismo.getBoundingClientRect().top - antes)
  }

  function aplicarFiltro() {
    filtrados = filtrar(todos, { severidad: severidadElegida(), regla: $('.filtro-regla').value, archivo: $('.filtro-archivo').value })
    tramo = { desde: 0, hasta: TAMANO_PAGINA }
    dibujar()
  }

  $('.filtro-severidad').addEventListener('change', aplicarFiltro)
  $('.filtro-regla').addEventListener('change', aplicarFiltro)
  $('.filtro-archivo').addEventListener('change', aplicarFiltro)
  $('.despues').addEventListener('click', () => {
    tramo = { ...tramo, hasta: tramo.hasta + TAMANO_PAGINA }
    dibujar()
  })
  $('.antes').addEventListener('click', () =>
    sinSaltar(() => {
      tramo = { ...tramo, desde: Math.max(0, tramo.desde - TAMANO_PAGINA) }
      dibujar()
    }),
  )
  lista.addEventListener('click', (e) => {
    const boton = e.target.closest('button.hallazgo')
    if (!boton) return
    const h = filtrados[Number(boton.dataset.posicion)]
    activa = h.indice
    resaltar(false)
    alElegir(h)
  })

  return {
    /**
     * @param {import('./datos.js').Hallazgo[]} hallazgos
     * @param {{archivos?: string[]}} [ajustes]  Los archivos, si se juntaron varios.
     */
    mostrar(hallazgos, { archivos: nombres = [] } = {}) {
      todos = hallazgos
      archivos = nombres
      activa = null
      llenarFiltros()
      aplicarFiltro()
    },

    /** Marca los hallazgos de una parcela elegida en el mapa (`null` para ninguna). */
    marcar(indice) {
      activa = indice
      if (indice === null) return resaltar(false)
      const nuevo = tramoPara(filtrados, indice, tramo)
      if (nuevo !== tramo) {
        tramo = nuevo
        dibujar()
      }
      resaltar(true)
    },

    limpiar() {
      todos = []
      filtrados = []
      activa = null
      lista.replaceChildren()
    },
  }
}
