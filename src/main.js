// Página de Deslinde: cargar un archivo (o el de ejemplo), revisarlo en el Web
// Worker con el avance en pantalla, ver el veredicto, las parcelas en el mapa y
// la lista de hallazgos enlazada, y descargar las salidas.
//
// Pantalla ancha: panel a la izquierda y el mapa en todo el resto, con la
// leyenda, el interruptor del mapa base y la ficha de la parcela encima.

import './estilos.css'
import ejemploUrl from '../datos/sinteticos/errores-mezclados.geojson?url'
import { AYUDA_FORMATO, AYUDA_REGLAS } from './ayuda.js'
import { ICONOS } from './iconos.js'
import { unirIndices } from './lista/datos.js'
import { crearLista } from './lista/index.js'
import { COLORES, NOMBRES } from './mapa/capas.js'
import { Cancelado, crearValidador } from './validador.js'

const REPOSITORIO = 'https://github.com/gustavoapz07/deslinde'
const FORMATOS = /\.(geojson|json|csv)$/i
const SEVERIDADES = ['error', 'advertencia', 'ok']

// El mismo dibujo que el ícono de la pestaña (public/favicon.svg): un grano de
// café oro (así se llama el café verde de exportación) dentro de las marcas de
// esquina de un encuadre, porque Deslinde revisa los límites de cada parcela.
const LOGO = `
  <svg class="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8">
      <path d="M3.5 9.5v-6h6"/><path d="M22.5 3.5h6v6"/><path d="M28.5 22.5v6h-6"/><path d="M9.5 28.5h-6v-6"/>
    </g>
    <g transform="rotate(35 16 16)">
      <ellipse cx="16" cy="16" rx="6.6" ry="9.6" fill="#d9a21b"/>
      <path d="M16 7.7C12.9 11.7 19.1 20.3 16 24.3" fill="none" stroke="#0d1411" stroke-width="1.9" stroke-linecap="round"/>
    </g>
  </svg>`

const muestra = (s) => `<span class="muestra ${s}" aria-hidden="true"></span>`

document.querySelector('#app').innerHTML = `
  <aside class="panel">
    <header class="cabecera">
      <h1 class="identidad">${LOGO}<span>Deslinde</span></h1>
      <a class="enlace-codigo" href="${REPOSITORIO}" target="_blank" rel="noopener" title="Código abierto en GitHub">${ICONOS.codigo}<span class="oculto">Código abierto en GitHub</span></a>
    </header>
    <div class="panel-cuerpo">
      <section class="arriba" aria-label="Archivo y resultado">
        <div id="bienvenida" class="bienvenida">
          <h2 class="titular">Revise su archivo de parcelas antes de enviarlo</h2>
          <p class="bajada">Deslinde encuentra los errores de geolocalización que pide el EUDR para el café y le muestra en el mapa dónde está cada uno.</p>
        </div>
        <div class="carga">
          <input id="archivo" class="oculto" type="file" accept=".geojson,.json,.csv" />
          <div class="archivo-actual" id="archivo-actual" hidden>
            <span class="archivo-icono">${ICONOS.archivo}</span>
            <span class="archivo-datos"><strong id="archivo-nombre"></strong><span id="archivo-meta"></span></span>
          </div>
          <div class="zona">
            <span class="zona-icono">${ICONOS.subir}</span>
            <p class="zona-titulo"><span class="con-mouse">Arrastre aquí su archivo</span><span class="tactil">Elija su archivo de parcelas</span></p>
            <p class="zona-detalle">GeoJSON o CSV de puntos, con las coordenadas en grados</p>
            <div class="botones">
              <label for="archivo" class="boton principal" id="elegir">Elegir archivo</label>
              <button type="button" class="boton" id="ejemplo">Probar con un ejemplo</button>
            </div>
          </div>
          <p class="confianza">${ICONOS.escudo}<span>Se revisa en este equipo: el archivo no se sube a ningún servidor.</span></p>
        </div>
        <div id="estado" class="estado" hidden>
          <p id="estado-texto"></p>
          <progress id="avance" aria-labelledby="estado-texto"></progress>
        </div>
        <p id="anuncio" class="oculto" role="status" aria-live="polite"></p>
        <div id="resultado" class="resultado" hidden>
          <h2 class="oculto">Resultado</h2>
          <div id="veredicto" class="veredicto">
            <span class="veredicto-icono" id="veredicto-icono"></span>
            <div>
              <p class="veredicto-texto" id="veredicto-texto"></p>
              <p class="veredicto-alcance" id="alcance"></p>
            </div>
          </div>
          <div class="parcelas">
            <ul class="cifras">
              ${SEVERIDADES.map(
                (s) => `
                <li class="cifra ${s}">
                  <span class="cifra-numero" id="cuenta-${s}"></span>
                  <span class="cifra-nombre">${muestra(s)}${NOMBRES[s]}</span>
                </li>`,
              ).join('')}
            </ul>
            <div class="proporcion" aria-hidden="true">
              ${SEVERIDADES.map((s) => `<span class="tramo ${s}" id="tramo-${s}"></span>`).join('')}
            </div>
            <p class="nota" id="sin-dibujar" hidden></p>
          </div>
          <div class="descargas">
            <a id="bajar-informe" class="descarga" title="Una fila por hallazgo. Se abre en Excel.">${ICONOS.descargar}<span>Informe <small>CSV</small></span></a>
            <a id="bajar-corregido" class="descarga" title="Con las tres correcciones seguras. Lo demás se corrige en el archivo de origen.">${ICONOS.descargar}<span>Archivo corregido <small>GeoJSON</small></span></a>
          </div>
        </div>
      </section>
      <section id="lista" class="lista" hidden></section>
      <section class="abajo" aria-label="Ayuda y privacidad">
        <div class="acordeon">
          <details class="ayuda">
            <summary>¿Qué revisa Deslinde?${ICONOS.flecha}</summary>
            <div class="ayuda-cuerpo">${AYUDA_REGLAS}</div>
          </details>
          <details class="ayuda">
            <summary>¿Qué formato acepta?${ICONOS.flecha}</summary>
            <div class="ayuda-cuerpo">
              ${AYUDA_FORMATO}
              <p><a href="${ejemploUrl}" download="ejemplo-deslinde.geojson">Descargar el archivo de ejemplo</a> (24 parcelas inventadas, con un caso de cada regla).</p>
            </div>
          </details>
          <details class="ayuda" id="privacidad">
            <summary>Privacidad y mapa base${ICONOS.flecha}</summary>
            <div class="ayuda-cuerpo">
              <p>El archivo se lee y se revisa en este equipo. Deslinde no tiene un servidor que lo reciba, y el navegador tiene prohibido enviarlo a otro sitio.</p>
              <p>Con el mapa base encendido, OpenFreeMap recibe qué zona del mapa se está mirando, no el archivo. Si trabaja con parcelas reales y no quiere que se sepa dónde están, apague el interruptor «Mapa base» del mapa: las parcelas se ven igual sobre fondo liso.</p>
            </div>
          </details>
        </div>
        <p class="aviso">
          Herramienta de apoyo para preparar datos: no certifica el cumplimiento del EUDR ni revisa deforestación.
          La responsabilidad sigue siendo del operador.
        </p>
        <p class="aviso">
          Prototipo de portafolio: el ejemplo usa parcelas inventadas.
          <a href="${REPOSITORIO}" target="_blank" rel="noopener">Código abierto (MIT)</a>
        </p>
      </section>
    </div>
  </aside>
  <div class="mapa-envoltura">
    <div id="mapa" class="mapa" role="region" aria-label="Mapa de las parcelas"></div>
    <div class="control-fondo">
      <label class="interruptor">
        <input id="fondo" type="checkbox" role="switch" />
        <span class="interruptor-pista" aria-hidden="true"></span>
        <span>Mapa base</span>
      </label>
      <a href="#privacidad" class="control-ayuda" id="ver-privacidad" title="Qué ve OpenFreeMap">${ICONOS.info}<span class="oculto">Qué ve OpenFreeMap</span></a>
      <p class="aviso-error" id="fondo-error" hidden>No se pudo cargar el mapa base (¿sin internet?). Las parcelas se ven igual sobre fondo liso.</p>
    </div>
    <ul class="leyenda" id="leyenda" aria-label="Qué muestra el mapa">
      ${SEVERIDADES.map((s) => `<li>${muestra(s)}${NOMBRES[s]}</li>`).join('')}
      <li title="Varias parcelas juntas, con su cantidad. Del color de la peor."><span class="muestra-grupo" aria-hidden="true">12</span>Grupo de parcelas</li>
      <li title="Dónde está el problema dentro de la parcela, con el número de su regla."><span class="muestra-problema" aria-hidden="true"></span>Dónde falla</li>
    </ul>
    <section id="ficha" class="ficha" aria-label="Ficha de la parcela" hidden></section>
    <div id="globo" class="globo" aria-hidden="true" hidden></div>
    <div id="mapa-vacio" class="mapa-vacio">
      <div class="vacio-tarjeta">
        <p class="vacio-titulo" id="mapa-vacio-titulo">Aquí verá sus parcelas</p>
        <p id="mapa-vacio-texto">Cada una con el color de lo que encuentre la revisión. Cargue su archivo o pruebe con 24 parcelas inventadas.</p>
        <button type="button" class="boton principal" id="ejemplo-mapa">Probar con un ejemplo</button>
      </div>
    </div>
  </div>
  <div id="soltar" class="soltar" hidden><p>${ICONOS.subir}<span>Suelte el archivo para revisarlo</span></p></div>
`

const $ = (selector) => document.querySelector(selector)
const numero = new Intl.NumberFormat('en-US')
const plural = (n, una, varias) => `${numero.format(n)} ${n === 1 ? una : varias}`
const nombreBase = (nombre) => nombre.replace(/\.[^.]+$/, '')

// La preferencia del mapa base se recuerda en este navegador, si se puede.
const PREFERENCIA = 'deslinde.mapaBase'
function leerPreferencia() {
  try {
    return localStorage.getItem(PREFERENCIA) !== 'no'
  } catch {
    return true
  }
}
function guardarPreferencia(visible) {
  try {
    localStorage.setItem(PREFERENCIA, visible ? 'si' : 'no')
  } catch {
    // sin almacenamiento: la preferencia dura hasta cerrar la página
  }
}

// Lo que se dice a los lectores de pantalla: el final de la revisión y los fallos.
// El avance no se anuncia, porque con archivos grandes serían veinte avisos seguidos.
function anunciar(texto) {
  $('#anuncio').textContent = ''
  requestAnimationFrame(() => ($('#anuncio').textContent = texto)) // así se repite aunque el texto sea igual
}

const conFondo = leerPreferencia()
$('#fondo').checked = conFondo

// MapLibre es casi todo el peso de la página (unos 430 KB comprimidos con su
// worker). Se carga aparte para que la página se pueda usar antes con conexiones
// lentas: el archivo se revisa y la lista aparece aunque el mapa no haya llegado.
const mapaListo = import('./mapa/index.js').then(({ crearMapa }) =>
  crearMapa($('#mapa'), {
    conFondo,
    ficha: $('#ficha'),
    globo: $('#globo'),
    controles: { fondo: $('.control-fondo'), leyenda: $('#leyenda') },
  }),
)
let sinMapa = false
mapaListo.catch(() => {
  sinMapa = true
  $('#mapa-vacio-titulo').textContent = 'No se pudo cargar el mapa'
  $('#mapa-vacio-texto').textContent =
    '¿Se cortó la conexión? La lista y las descargas funcionan igual. Vuelva a cargar la página para ver el mapa.'
  $('#ejemplo-mapa').hidden = true
  $('#mapa-vacio').hidden = false
})
// Mientras MapLibre no llega, las órdenes esperan. De mostrar y limpiar solo vale
// la última: las URLs de un resultado viejo pueden estar ya liberadas.
let ordenDelMapa = 0
const mapa = {
  mostrar: (datos) => {
    const orden = ++ordenDelMapa
    mapaListo.then((m) => orden === ordenDelMapa && m.mostrar(datos), () => {})
  },
  limpiar: () => {
    const orden = ++ordenDelMapa
    mapaListo.then((m) => orden === ordenDelMapa && m.limpiar(), () => {})
  },
  enfocar: (hallazgo) => mapaListo.then((m) => m.enfocar(hallazgo), () => {}),
  alElegir: (funcion) => mapaListo.then((m) => m.alElegir(funcion), () => {}),
  ponerFondo: (visible) => mapaListo.then((m) => m.ponerFondo(visible), () => !visible), // sin mapa, apagar no falla
}
const lista = crearLista($('#lista'), {
  alElegir: (hallazgo) => {
    mapa.enfocar(hallazgo)
    // En celular el mapa queda entre el resumen y la lista: se trae a la vista.
    // En pantallas anchas ya está a la vista y esto no mueve nada.
    // MapLibre ya evita sus animaciones si se pidió menos movimiento; el desplazamiento también.
    const suave = !matchMedia('(prefers-reduced-motion: reduce)').matches
    $('.mapa-envoltura').scrollIntoView({ block: 'nearest', behavior: suave ? 'smooth' : 'auto' })
  },
})
mapa.alElegir((indice) => lista.marcar(indice))
const validador = crearValidador()
let urls = []

// Leyenda: los colores salen de los mismos valores que usa el mapa.
for (const [severidad, color] of Object.entries(COLORES)) document.documentElement.style.setProperty(`--${severidad}`, color)

// El enlace del control del mapa abre la explicación de privacidad en el panel.
$('#ver-privacidad').addEventListener('click', () => ($('#privacidad').open = true))

$('#fondo').addEventListener('change', async (evento) => {
  const visible = evento.target.checked
  guardarPreferencia(visible)
  $('#fondo-error').hidden = true
  if (!(await mapa.ponerFondo(visible))) {
    evento.target.checked = false
    $('#fondo-error').hidden = false
  }
})

// ---------- Estado y avance ----------

function mostrarEstado(texto, { error = false, avance } = {}) {
  $('#estado').hidden = false
  $('#estado').classList.toggle('error', error)
  $('#estado-texto').textContent = texto
  const barra = $('#avance')
  barra.hidden = avance === undefined
  if (avance === null) barra.removeAttribute('value') // sin cifra: barra en movimiento
  else if (avance) {
    barra.max = avance.total
    barra.value = avance.hechas
  }
}

const FASES = {
  leyendo: () => ['Leyendo el archivo…', null],
  revisando: (a) => [`Revisando parcelas: ${numero.format(a.hechas)} de ${numero.format(a.total)}`, a],
  comparando: () => ['Comparando las parcelas entre sí…', null],
  salidas: () => ['Preparando el mapa y las descargas…', null],
}

// ---------- Resultado ----------

function nuevaUrl(blob) {
  const url = URL.createObjectURL(blob)
  urls.push(url)
  return url
}

function enlazar(enlace, blob, nombre) {
  enlace.href = nuevaUrl(blob)
  enlace.download = nombre
}

// Qué hacer ahora, en una frase. Cuenta parcelas, no hallazgos: es lo que hay que ir a corregir.
function veredicto(conteo) {
  if (conteo.error > 0) {
    return {
      clase: 'error',
      texto: `${plural(conteo.error, 'parcela tiene errores', 'parcelas tienen errores')}. Corríjalas antes de enviar el archivo.`,
    }
  }
  if (conteo.advertencia > 0) {
    return {
      clase: 'advertencia',
      texto: `Ninguna parcela tiene errores. ${plural(conteo.advertencia, 'tiene advertencias', 'tienen advertencias')}: revíselas antes de enviar.`,
    }
  }
  return { clase: 'ok', texto: 'Ninguna parcela tiene hallazgos en las 12 reglas revisadas.' }
}

function mostrarResultado(archivo, { informe, limites, conteo, indices, archivos }, segundos) {
  // Las URLs del archivo anterior se sueltan recién ahora, cuando el mapa ya no las usa.
  const viejas = urls
  urls = []

  $('#estado').hidden = true
  $('#bienvenida').hidden = true
  $('#app').dataset.vista = 'resultado' // la zona de carga se achica: ya no es lo principal
  $('#elegir').textContent = 'Elegir otro archivo'
  $('#archivo-nombre').textContent = archivo.name
  $('#archivo-meta').textContent = `${plural(informe.parcelas, 'parcela', 'parcelas')} · revisado ${
    segundos < 0.1 ? 'al instante' : `en ${segundos.toFixed(1)} s`
  }`
  $('#archivo-actual').hidden = false
  const v = veredicto(conteo)
  $('#veredicto').className = `veredicto ${v.clase}`
  $('#veredicto-icono').innerHTML = ICONOS[v.clase]
  $('#veredicto-texto').textContent = v.texto
  const { errores, advertencias } = informe.resumen
  $('#alcance').textContent =
    `${plural(errores, 'error', 'errores')} y ${plural(advertencias, 'advertencia', 'advertencias')} en 12 reglas de geolocalización. ` +
    'No revisa deforestación.'
  for (const severidad of SEVERIDADES) {
    $(`#cuenta-${severidad}`).textContent = numero.format(conteo[severidad])
    // Cada tramo de la barra ocupa lo que su grupo de parcelas.
    $(`#tramo-${severidad}`).style.flexGrow = String(conteo[severidad])
    $(`#tramo-${severidad}`).hidden = conteo[severidad] === 0
  }
  $('#sin-dibujar').hidden = conteo.sinDibujar === 0
  $('#sin-dibujar').textContent =
    `${plural(conteo.sinDibujar, 'parcela no se puede dibujar', 'parcelas no se pueden dibujar')}: ` +
    'sus coordenadas no están en grados o no se pueden leer. Está en la lista y en el informe.'
  enlazar($('#bajar-informe'), archivos.informe, `${nombreBase(archivo.name)}-informe.csv`)
  enlazar($('#bajar-corregido'), archivos.corregido, `${nombreBase(archivo.name)}-corregido.geojson`)
  $('#resultado').hidden = false
  anunciar(`Revisión terminada. ${v.texto}`)

  const hallazgos = unirIndices(informe.resultados, indices)
  lista.mostrar(hallazgos)
  $('#lista').hidden = false
  $('#mapa-vacio').hidden = !sinMapa // si el mapa no cargó, su aviso se queda
  mapa.mostrar({
    urlCapa: nuevaUrl(archivos.mapa),
    urlCentros: nuevaUrl(archivos.centros),
    urlHallazgos: nuevaUrl(archivos.hallazgos),
    limites,
    hallazgos,
  })
  // MapLibre lee las capas en su worker; se deja un margen antes de soltar las URLs viejas.
  setTimeout(() => viejas.forEach((url) => URL.revokeObjectURL(url)), 5000)
}

function mostrarFallo(mensaje) {
  mostrarEstado(mensaje, { error: true })
  anunciar(mensaje)
  $('#archivo-actual').hidden = true
  $('#resultado').hidden = true
  $('#lista').hidden = true
  $('#mapa-vacio').hidden = false
  mapa.limpiar() // que no queden a la vista las parcelas del archivo anterior
  lista.limpiar()
}

// ---------- Revisar un archivo ----------

async function revisar(archivo) {
  if (!FORMATOS.test(archivo.name)) {
    return mostrarFallo(`"${archivo.name}" no es un GeoJSON ni un CSV. Deslinde v0 lee esos dos formatos; KML y shapefile llegan en una versión futura.`)
  }
  $('#archivo-actual').hidden = true
  $('#resultado').hidden = true
  mostrarEstado('Leyendo el archivo…', { avance: null })
  const formato = /\.csv$/i.test(archivo.name) ? 'csv' : 'geojson'
  const inicio = performance.now()
  try {
    const resultado = await validador.validar(archivo, {
      formato,
      alAvanzar: (avance) => {
        const [texto, cifra] = FASES[avance.fase](avance)
        mostrarEstado(texto, { avance: cifra })
      },
    })
    mostrarResultado(archivo, resultado, (performance.now() - inicio) / 1000)
  } catch (e) {
    if (e instanceof Cancelado) return // llegó otro archivo; ese ya muestra su avance
    // Los mensajes de ErrorDeArchivo ya dicen qué falla en el archivo; los demás, que no es culpa del archivo.
    mostrarFallo(e.message)
  }
}

$('#archivo').addEventListener('change', (evento) => {
  const archivo = evento.target.files[0]
  evento.target.value = '' // permite volver a elegir el mismo archivo después de corregirlo
  if (archivo) revisar(archivo)
})

async function probarEjemplo() {
  try {
    const respuesta = await fetch(ejemploUrl)
    revisar(new File([await respuesta.blob()], 'ejemplo-deslinde.geojson'))
  } catch {
    mostrarFallo('No se pudo abrir el archivo de ejemplo. Vuelva a cargar la página e intente de nuevo.')
  }
}
$('#ejemplo').addEventListener('click', probarEjemplo)
$('#ejemplo-mapa').addEventListener('click', probarEjemplo)

// ---------- Arrastrar y soltar ----------

const traeArchivos = (e) => e.dataTransfer?.types?.includes('Files')
let arrastres = 0 // dragenter y dragleave llegan por cada elemento que se cruza
window.addEventListener('dragenter', (e) => {
  if (!traeArchivos(e)) return
  arrastres++
  $('#soltar').hidden = false
})
window.addEventListener('dragleave', (e) => {
  if (!traeArchivos(e)) return
  arrastres = Math.max(0, arrastres - 1)
  if (arrastres === 0) $('#soltar').hidden = true
})
window.addEventListener('dragover', (e) => {
  if (traeArchivos(e)) e.preventDefault() // sin esto el navegador abre el archivo en vez de soltarlo aquí
})
window.addEventListener('drop', (e) => {
  if (!traeArchivos(e)) return
  e.preventDefault()
  arrastres = 0
  $('#soltar').hidden = true
  const archivo = e.dataTransfer.files[0]
  if (archivo) revisar(archivo)
})
