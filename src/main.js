// Página de Deslinde: cargar un archivo (o el de ejemplo), revisarlo en el Web
// Worker con el avance en pantalla, ver el veredicto, las parcelas en el mapa y
// la lista de hallazgos enlazada, y descargar las salidas.

import './estilos.css'
import ejemploUrl from '../datos/sinteticos/errores-mezclados.geojson?url'
import { AYUDA_FORMATO, AYUDA_REGLAS } from './ayuda.js'
import { unirIndices } from './lista/datos.js'
import { crearLista } from './lista/index.js'
import { COLORES, NOMBRES } from './mapa/capas.js'
import { Cancelado, crearValidador } from './validador.js'

const REPOSITORIO = 'https://github.com/gustavoapz07/deslinde'
const FORMATOS = /\.(geojson|json|csv)$/i

// El mismo dibujo que el ícono de la pestaña (public/favicon.svg).
const LOGO = `
  <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M7 11 L19 6 L26 15 L21 26 L9 23 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    <g fill="#e0a100"><circle cx="7" cy="11" r="2.6"/><circle cx="19" cy="6" r="2.6"/><circle cx="26" cy="15" r="2.6"/><circle cx="21" cy="26" r="2.6"/><circle cx="9" cy="23" r="2.6"/></g>
  </svg>`

document.querySelector('#app').innerHTML = `
  <header class="cabecera">
    <h1 class="identidad">${LOGO}<span>Deslinde</span></h1>
    <p class="lema">Validador de parcelas de café para el EUDR</p>
    <span class="insignia" title="Prototipo de portafolio. Los ejemplos usan parcelas inventadas.">Prototipo v0</span>
  </header>
  <main class="cuerpo">
    <div class="panel">
      <section class="arriba" aria-label="Archivo y resultado">
        <div id="bienvenida">
          <h2 class="titular">Revise su archivo de parcelas antes de enviarlo</h2>
          <ol class="pasos">
            <li><strong>Cargue</strong> un GeoJSON o un CSV de puntos.</li>
            <li><strong>Vea en el mapa</strong> qué parcelas tienen errores y por qué.</li>
            <li><strong>Descargue</strong> el informe y el archivo con las correcciones seguras.</li>
          </ol>
        </div>
        <div class="carga">
          <input id="archivo" class="oculto" type="file" accept=".geojson,.json,.csv" />
          <div class="botones">
            <label for="archivo" class="boton principal" id="elegir">Elegir archivo</label>
            <button type="button" class="boton" id="ejemplo">Probar con un ejemplo</button>
          </div>
          <p class="nota">También puede arrastrar el archivo a la página. Se revisa en este equipo: no se sube a ningún servidor.</p>
        </div>
        <div id="estado" class="estado" hidden>
          <p id="estado-texto"></p>
          <progress id="avance" aria-labelledby="estado-texto"></progress>
        </div>
        <p id="anuncio" class="oculto" role="status" aria-live="polite"></p>
        <div id="resultado" hidden>
          <h2 class="oculto">Resultado</h2>
          <p class="archivo-actual" id="archivo-actual"></p>
          <p id="veredicto" class="veredicto"></p>
          <p class="nota" id="alcance"></p>
          <ul class="leyenda">
            ${['error', 'advertencia', 'ok']
              .map((s) => `<li><span class="muestra ${s}"></span>${NOMBRES[s]}<span class="cuenta" id="cuenta-${s}"></span></li>`)
              .join('')}
          </ul>
          <p class="nota" id="sin-dibujar" hidden></p>
          <div class="descargas">
            <a id="bajar-informe" class="boton">Descargar el informe (CSV)</a>
            <a id="bajar-corregido" class="boton">Descargar el GeoJSON corregido</a>
          </div>
          <p class="nota">El GeoJSON corregido solo trae las correcciones seguras: pares invertidos, bordes cerrados y vértices repetidos quitados. Lo demás hay que corregirlo en el archivo de origen.</p>
        </div>
      </section>
      <section id="lista" class="lista" hidden></section>
      <section class="abajo" aria-label="Ayuda y privacidad">
        <details class="ayuda">
          <summary>¿Qué revisa Deslinde?</summary>
          ${AYUDA_REGLAS}
        </details>
        <details class="ayuda">
          <summary>¿Qué formato acepta?</summary>
          ${AYUDA_FORMATO}
          <p><a href="${ejemploUrl}" download="ejemplo-deslinde.geojson">Descargar el archivo de ejemplo</a> (24 parcelas inventadas, con un caso de cada regla).</p>
        </details>
        <div class="privacidad">
          <h2>Privacidad</h2>
          <label class="interruptor"><input id="fondo" type="checkbox" /> Mostrar mapa base</label>
          <p class="nota">El archivo no sale de este equipo. Con el mapa base, OpenFreeMap recibe qué zona del mapa se está mirando. Apáguelo si trabaja con parcelas reales y no quiere que nadie sepa dónde están.</p>
          <p class="nota aviso-error" id="fondo-error" hidden>No se pudo cargar el mapa base (¿sin internet?). Las parcelas se ven igual sobre fondo liso.</p>
        </div>
        <p class="aviso">
          Herramienta de apoyo para preparar datos: no certifica el cumplimiento del EUDR ni revisa deforestación.
          La responsabilidad sigue siendo del operador.
          <a href="${REPOSITORIO}" target="_blank" rel="noopener">Código abierto (MIT)</a>
        </p>
      </section>
    </div>
    <div class="mapa-envoltura">
      <div id="mapa" class="mapa" role="region" aria-label="Mapa de las parcelas"></div>
      <div id="mapa-vacio" class="mapa-vacio"><p id="mapa-vacio-texto">Aquí verá sus parcelas, coloreadas según lo que encuentre la revisión.</p></div>
    </div>
  </main>
  <div id="soltar" class="soltar" hidden><p>Suelte el archivo para revisarlo</p></div>
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
const mapaListo = import('./mapa/index.js').then(({ crearMapa }) => crearMapa($('#mapa'), { conFondo }))
let sinMapa = false
mapaListo.catch(() => {
  sinMapa = true
  $('#mapa-vacio-texto').textContent =
    'No se pudo cargar el mapa (¿se cortó la conexión?). La lista y las descargas funcionan igual. Vuelva a cargar la página para ver el mapa.'
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
    $('#mapa').scrollIntoView({ block: 'nearest', behavior: suave ? 'smooth' : 'auto' })
  },
})
mapa.alElegir((indice) => lista.marcar(indice))
const validador = crearValidador()
let urls = []

// Leyenda: los colores salen de los mismos valores que usa el mapa.
for (const [severidad, color] of Object.entries(COLORES)) document.documentElement.style.setProperty(`--${severidad}`, color)

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
  $('#elegir').textContent = 'Elegir otro archivo'
  $('#archivo-actual').textContent = `${archivo.name} · ${plural(informe.parcelas, 'parcela', 'parcelas')} · revisado ${
    segundos < 0.1 ? 'al instante' : `en ${segundos.toFixed(1)} s`
  }`
  const v = veredicto(conteo)
  $('#veredicto').className = `veredicto ${v.clase}`
  $('#veredicto').textContent = v.texto
  const { errores, advertencias } = informe.resumen
  $('#alcance').textContent =
    `En total, ${plural(errores, 'error', 'errores')} y ${plural(advertencias, 'advertencia', 'advertencias')} ` +
    'en 12 reglas de geolocalización. Deslinde no revisa deforestación.'
  for (const severidad of ['error', 'advertencia', 'ok']) {
    $(`#cuenta-${severidad}`).textContent = numero.format(conteo[severidad])
  }
  $('#sin-dibujar').hidden = conteo.sinDibujar === 0
  $('#sin-dibujar').textContent =
    `${plural(conteo.sinDibujar, 'parcela no se puede dibujar', 'parcelas no se pueden dibujar')} ` +
    '(coordenadas ilegibles o que no están en grados). Aparecen en la lista y en el informe.'
  enlazar($('#bajar-informe'), archivos.informe, `${nombreBase(archivo.name)}-informe.csv`)
  enlazar($('#bajar-corregido'), archivos.corregido, `${nombreBase(archivo.name)}-corregido.geojson`)
  $('#resultado').hidden = false
  anunciar(`Revisión terminada. ${v.texto}`)

  const hallazgos = unirIndices(informe.resultados, indices)
  lista.mostrar(hallazgos)
  $('#lista').hidden = false
  $('#mapa-vacio').hidden = !sinMapa // si el mapa no cargó, su aviso se queda
  mapa.mostrar({ urlCapa: nuevaUrl(archivos.mapa), urlHallazgos: nuevaUrl(archivos.hallazgos), limites, hallazgos })
  // MapLibre lee las capas en su worker; se deja un margen antes de soltar las URLs viejas.
  setTimeout(() => viejas.forEach((url) => URL.revokeObjectURL(url)), 5000)
}

function mostrarFallo(mensaje) {
  mostrarEstado(mensaje, { error: true })
  anunciar(mensaje)
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

$('#ejemplo').addEventListener('click', async () => {
  try {
    const respuesta = await fetch(ejemploUrl)
    revisar(new File([await respuesta.blob()], 'ejemplo-deslinde.geojson'))
  } catch {
    mostrarFallo('No se pudo abrir el archivo de ejemplo. Vuelva a cargar la página e intente de nuevo.')
  }
})

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
