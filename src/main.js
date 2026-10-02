// Página de Deslinde: cargar un archivo (o el de ejemplo), revisarlo en el Web
// Worker con el avance en pantalla, ver el veredicto, las parcelas en el mapa y
// la lista de hallazgos enlazada, y descargar las salidas. Se pueden sumar
// archivos de otras fuentes: se revisan juntos y se descargan en uno solo.
//
// Pantalla ancha: panel a la izquierda y el mapa en todo el resto, con la
// leyenda, el interruptor del mapa base y la ficha de la parcela encima.

import './estilos.css'
import ejemploUrl from '../datos/sinteticos/errores-mezclados.geojson?url'
import beneficioUrl from '../datos/sinteticos/juntar/beneficio-sur.kml?url'
import cooperativaUrl from '../datos/sinteticos/juntar/cooperativa-norte.geojson?url'
import tecnicosUrl from '../datos/sinteticos/juntar/tecnicos-centro-shp.zip?url'
import { AYUDA_FORMATO, AYUDA_REGLAS } from './ayuda.js'
import { ICONOS } from './iconos.js'
import { unirIndices } from './lista/datos.js'
import { crearLista } from './lista/index.js'
import { COLORES, NOMBRES } from './mapa/capas.js'
import { crearAlmacen } from './revision/almacen.js'
import { estadoDeRevision, resumenDeRevisiones } from './revision/datos.js'
import { bloqueDeRevision } from './revision/formulario.js'
import { Cancelado, crearValidador } from './validador.js'

const REPOSITORIO = 'https://github.com/gustavoapz07/deslinde'
// Lo que se puede elegir. Un shapefile son varios archivos: se eligen juntos,
// o en un .zip. El worker decide el formato por la extensión (motor/archivos.js).
const ACEPTA = '.geojson,.json,.csv,.kml,.kmz,.zip,.shp,.dbf,.shx,.prj,.cpg'
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
          <input id="archivo" class="oculto" type="file" accept="${ACEPTA}" multiple />
          <div class="archivos" id="archivos" hidden>
            <ul class="fuentes" id="fuentes" aria-label="Archivos revisados"></ul>
            <input id="sumar" class="oculto" type="file" accept="${ACEPTA}" multiple />
            <label for="sumar" class="sumar"><span class="archivo-icono">${ICONOS.sumar}</span><span>Sumar otro archivo</span></label>
            <p class="archivos-meta" id="archivos-meta" hidden></p>
          </div>
          <div class="zona">
            <span class="zona-icono">${ICONOS.subir}</span>
            <p class="zona-titulo"><span class="con-mouse">Arrastre aquí su archivo</span><span class="tactil">Elija su archivo de parcelas</span></p>
            <p class="zona-detalle">GeoJSON, KML o KMZ, shapefile (en .zip, o el .shp con su .dbf) o CSV de puntos</p>
            <div class="botones">
              <label for="archivo" class="boton principal" id="elegir">Elegir archivo</label>
              <button type="button" class="boton" id="ejemplo">Probar con un ejemplo</button>
              <button type="button" class="boton enlace" id="ejemplo-juntar">Juntar tres archivos de ejemplo</button>
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
          <div class="paso-bosque">
            <button type="button" class="pedir-bosque" id="revisar-bosque">
              <span class="archivo-icono">${ICONOS.arbol}</span>
              <span class="archivo-datos"><strong>Revisar bosque 2020</strong><span>Compara cada parcela con el mapa de bosque de la UE. La UE recibe la zona, no el archivo.</span></span>
            </button>
            <p class="bosque-estado" id="bosque-estado" tabindex="-1" hidden></p>
          </div>
          <div class="descargas">
            <a id="bajar-informe" class="descarga" title="Una fila por hallazgo. Se abre en Excel.">${ICONOS.descargar}<span>Informe <small>CSV</small></span></a>
            <a id="bajar-corregido" class="descarga">${ICONOS.descargar}<span><span id="bajar-corregido-nombre">Archivo corregido</span> <small>GeoJSON</small></span></a>
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
            <summary>Privacidad y mapas${ICONOS.flecha}</summary>
            <div class="ayuda-cuerpo">
              <p>El archivo se lee y se revisa en este equipo. Deslinde no tiene un servidor que lo reciba, y el navegador tiene prohibido enviarlo a otro sitio.</p>
              <p>Con el mapa base encendido, OpenFreeMap recibe qué zona del mapa se está mirando, no el archivo. Si trabaja con parcelas reales y no quiere que se sepa dónde están, apague el interruptor «Mapa base» del mapa: las parcelas se ven igual sobre fondo liso.</p>
              <p>«Revisar bosque 2020» le pide al servicio de la UE (el JRC) el mapa de bosque de recortes de unos 5 km alrededor de las parcelas, y la capa de bosque del mapa pide los de la zona que se mira. La UE recibe esas zonas, no el archivo ni los códigos. Solo pasa si aprieta el botón.</p>
              <p>Las revisiones de las parcelas con bosque, con sus fotos y documentos, se guardan en este navegador para la próxima vez. No se suben a ningún servidor.</p>
              <p><button type="button" class="boton-texto" id="borrar-revisiones">Borrar las revisiones guardadas en este navegador</button></p>
            </div>
          </details>
        </div>
        <p class="aviso">
          Herramienta de apoyo para preparar datos: no certifica el cumplimiento del EUDR ni dictamina deforestación.
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
      <label class="interruptor" id="interruptor-bosque" hidden>
        <input id="capa-bosque" type="checkbox" role="switch" checked />
        <span class="interruptor-pista" aria-hidden="true"></span>
        <span>Bosque 2020</span>
      </label>
      <a href="#privacidad" class="control-ayuda" id="ver-privacidad" title="Qué ven OpenFreeMap y la UE">${ICONOS.info}<span class="oculto">Qué ven OpenFreeMap y la UE</span></a>
      <p class="aviso-error" id="fondo-error" hidden>No se pudo cargar el mapa base (¿sin internet?). Las parcelas se ven igual sobre fondo liso.</p>
    </div>
    <ul class="leyenda" id="leyenda" aria-label="Qué muestra el mapa">
      ${SEVERIDADES.map((s) => `<li>${muestra(s)}${NOMBRES[s]}</li>`).join('')}
      <li title="Varias parcelas juntas, con su cantidad. Del color de la peor."><span class="muestra-grupo" aria-hidden="true">12</span>Grupo de parcelas</li>
      <li title="Dónde está el problema dentro de la parcela, con el número de su regla."><span class="muestra-problema" aria-hidden="true"></span>Dónde falla</li>
      <li id="leyenda-bosque" title="Donde había bosque en 2020 según el mapa de la UE (GFC2020 v4). No distingue el café con sombra." hidden><span class="muestra bosque" aria-hidden="true"></span>Bosque 2020 (UE)</li>
    </ul>
    <section id="ficha" class="ficha" aria-label="Ficha de la parcela" hidden></section>
    <div id="globo" class="globo" aria-hidden="true" hidden></div>
    <div id="mapa-vacio" class="mapa-vacio">
      <div class="vacio-tarjeta">
        <p class="vacio-titulo" id="mapa-vacio-titulo">Aquí verá sus parcelas</p>
        <p id="mapa-vacio-texto">Cada una con el color de lo que encuentre la revisión. Cargue su archivo o pruebe con 24 parcelas inventadas.</p>
        <button type="button" class="boton principal" id="ejemplo-mapa">Probar con un ejemplo</button>
        <button type="button" class="boton enlace" id="ejemplo-juntar-mapa">Juntar tres archivos de ejemplo</button>
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
    extraFicha: (indice) => bloqueDeLaFicha(indice),
  }),
)
let sinMapa = false
mapaListo.catch(() => {
  sinMapa = true
  $('#mapa-vacio-titulo').textContent = 'No se pudo cargar el mapa'
  $('#mapa-vacio-texto').textContent =
    '¿Se cortó la conexión? La lista y las descargas funcionan igual. Vuelva a cargar la página para ver el mapa.'
  $('#ejemplo-mapa').hidden = true
  $('#ejemplo-juntar-mapa').hidden = true
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
  ponerBosque: (visible) => mapaListo.then((m) => m.ponerBosque(visible), () => {}),
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

// La capa de bosque 2020 se puede apagar en el mapa; R15 sigue en la lista.
$('#capa-bosque').addEventListener('change', (evento) => {
  mapa.ponerBosque(evento.target.checked)
  $('#leyenda-bosque').hidden = !evento.target.checked
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

const leyendo = (cuantos) => (cuantos > 1 ? 'Leyendo los archivos…' : 'Leyendo el archivo…')
const FASES = {
  leyendo: (a, cuantos) => [leyendo(cuantos), null],
  revisando: (a) => [`Revisando parcelas: ${numero.format(a.hechas)} de ${numero.format(a.total)}`, a],
  comparando: () => ['Comparando las parcelas entre sí…', null],
  bosque: (a) => [`Consultando el mapa de bosque de la UE: ${numero.format(a.hechas)} de ${plural(a.total, 'zona', 'zonas')}`, a],
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
function veredicto(conteo, conBosque) {
  if (conteo.error > 0) {
    return {
      clase: 'error',
      texto: `${plural(conteo.error, 'parcela tiene errores', 'parcelas tienen errores')}. ${conteo.error === 1 ? 'Corríjala' : 'Corríjalas'} antes de enviar el archivo.`,
    }
  }
  if (conteo.advertencia > 0) {
    return {
      clase: 'advertencia',
      texto: `Ninguna parcela tiene errores. ${plural(conteo.advertencia, 'tiene advertencias', 'tienen advertencias')}: ${conteo.advertencia === 1 ? 'revísela' : 'revíselas'} antes de enviar.`,
    }
  }
  return {
    clase: 'ok',
    texto: conBosque
      ? 'Ninguna parcela tiene hallazgos en las 12 reglas ni cae en bosque de 2020.'
      : 'Ninguna parcela tiene hallazgos en las 12 reglas revisadas.',
  }
}

// Qué se revisó y qué no, debajo del veredicto.
function alcance({ errores, advertencias }, bosque) {
  const cuantos = `${plural(errores, 'error', 'errores')} y ${plural(advertencias, 'advertencia', 'advertencias')}`
  if (bosque?.revisado) {
    return `${cuantos} en 12 reglas de geolocalización y en el mapa de bosque 2020 de la UE, que no distingue el café con sombra.`
  }
  return `${cuantos} en 12 reglas de geolocalización. No revisa deforestación.`
}

// ---------- Revisión con evidencia ----------

// Las revisiones se guardan en este navegador (IndexedDB); si no deja, en memoria.
let almacen = null
const almacenListo = crearAlmacen().then((a) => (almacen = a))
let revisables = new Map() // posición en la revisión → { clave, etiqueta, archivo }: las parcelas con bosque
let revisiones = new Map() // clave → revisión guardada
let ordenDeRevisiones = 0

// Las parcelas con bosque de este resultado y sus revisiones guardadas de antes.
async function prepararRevisiones(parcelas) {
  const orden = ++ordenDeRevisiones
  revisables = new Map(parcelas.map((r) => [r.indice, r]))
  revisiones = new Map()
  if (parcelas.length === 0) return
  const guardadas = await (await almacenListo).leerVarias(parcelas.map((r) => r.clave))
  if (orden !== ordenDeRevisiones) return // llegó otra revisión mientras tanto
  revisiones = guardadas
  cambiaronLasRevisiones()
}

function cambiaronLasRevisiones() {
  lista.refrescar()
  mostrarResumenDeRevisiones()
}

// Lo que dice la lista debajo de un aviso R15.
function estadoEnLaLista(h) {
  const parcela = h.regla === 'R15' ? revisables.get(h.indice) : undefined
  if (!parcela) return null
  const revision = revisiones.get(parcela.clave)
  return { texto: estadoDeRevision(revision), revisada: Boolean(revision) }
}

// El bloque de revisión de la ficha, si la parcela cae en bosque.
function bloqueDeLaFicha(indice) {
  const parcela = revisables.get(indice)
  if (!parcela) return null
  return bloqueDeRevision({
    revision: revisiones.get(parcela.clave),
    persistente: almacen?.persistente ?? true,
    alGuardar: async (revision) => {
      await (await almacenListo).guardar(parcela.clave, revision)
      revisiones.set(parcela.clave, revision)
      cambiaronLasRevisiones()
      anunciar(`Revisión de ${parcela.etiqueta} guardada.`)
    },
    alBorrar: async () => {
      await (await almacenListo).borrar(parcela.clave)
      revisiones.delete(parcela.clave)
      cambiaronLasRevisiones()
      anunciar(`Revisión de ${parcela.etiqueta} borrada.`)
    },
  })
}

let textoDelBosque = ''
function mostrarResumenDeRevisiones() {
  if (!textoDelBosque) return
  const claves = [...revisables.values()].map((r) => r.clave)
  const { total, revisadas } = resumenDeRevisiones(claves, revisiones)
  const avance = total === 0 ? '' : revisadas === total ? ' Todas revisadas.' : ` Revisadas: ${numero.format(revisadas)} de ${numero.format(total)}. Elija una en el mapa para revisarla.`
  $('#bosque-estado').textContent = textoDelBosque + avance
}

// El paso del bosque 2020: el botón para pedirlo, o lo que dio. Si el servicio
// de la UE no respondió, el botón queda para intentarlo de nuevo.
function mostrarBosque(bosque) {
  const estado = $('#bosque-estado')
  $('#revisar-bosque').hidden = Boolean(bosque?.revisado)
  estado.hidden = !bosque
  estado.classList.toggle('error', Boolean(bosque?.error))
  textoDelBosque = ''
  if (bosque?.error) estado.textContent = bosque.error
  else if (bosque?.revisado) {
    const cuantas = bosque.parcelasConBosque
    textoDelBosque =
      cuantas === 0
        ? 'Bosque 2020 revisado con el mapa de la UE (GFC2020 v4): ninguna parcela cae en bosque.'
        : `Bosque 2020 revisado con el mapa de la UE (GFC2020 v4): ${plural(cuantas, 'parcela cae', 'parcelas caen')} en bosque, del todo o en parte. Es una alerta para revisar, no un dictamen: el mapa no distingue el café con sombra.`
    estado.textContent = textoDelBosque
  }
  $('#interruptor-bosque').hidden = !bosque?.revisado
  $('#leyenda-bosque').hidden = !bosque?.revisado || !$('#capa-bosque').checked
}

// Borrar todas las revisiones guardadas: se confirma con un segundo clic.
$('#borrar-revisiones').addEventListener('click', async (evento) => {
  const boton = evento.currentTarget
  if (boton.dataset.confirmar !== 'si') {
    boton.dataset.confirmar = 'si'
    boton.textContent = 'Confirmar: borrar todas las revisiones guardadas'
    return
  }
  await (await almacenListo).borrarTodo()
  revisiones = new Map()
  cambiaronLasRevisiones()
  delete boton.dataset.confirmar
  boton.textContent = 'Borrar las revisiones guardadas en este navegador'
  anunciar('Se borraron las revisiones guardadas en este navegador.')
})

// Los archivos de la revisión a la vista (File), en el orden en que se mandaron
// al worker: cada fuente del informe dice cuáles son los suyos (`de`).
let actuales = []

// Botón para quitar una fuente de la revisión: se vuelve a revisar sin sus
// archivos. Un .zip que trae varias fuentes sale entero.
function botonQuitar(fuente) {
  const boton = document.createElement('button')
  boton.type = 'button'
  boton.className = 'quitar'
  boton.innerHTML = ICONOS.cerrar // dibujo fijo, no viene del archivo
  boton.title = 'Quitar de la revisión'
  boton.setAttribute('aria-label', `Quitar ${fuente.nombre}`)
  boton.addEventListener('click', () => revisar(actuales.filter((_, i) => !fuente.de.includes(i)), { alTerminar: () => $('#sumar').focus() }))
  return boton
}

// Lista de archivos revisados. Con uno solo, su nombre y cuántas parcelas trae;
// con varios, además el total, y cada uno se puede quitar. Un archivo que no se
// pudo leer aparece con el motivo, sin frenar a los demás.
function mostrarFuentes(fuentes, revisado) {
  const varias = fuentes.length > 1
  const filas = fuentes.map((f) => {
    const fila = document.createElement('li')
    fila.className = f.error ? 'fuente con-error' : 'fuente'
    const icono = document.createElement('span')
    icono.className = 'archivo-icono'
    icono.innerHTML = f.error ? ICONOS.error : ICONOS.archivo
    const datos = document.createElement('span')
    datos.className = 'archivo-datos'
    const nombre = document.createElement('strong')
    nombre.textContent = f.nombre
    const detalle = document.createElement('span')
    const parcelas = plural(f.parcelas, 'parcela', 'parcelas')
    detalle.textContent = f.error ? `No se pudo leer. ${f.error}` : varias ? parcelas : `${parcelas} · ${revisado}`
    datos.append(nombre, detalle)
    fila.append(icono, datos)
    // Se puede quitar mientras quede otro archivo que revisar.
    if (varias && f.de.length < actuales.length) fila.append(botonQuitar(f))
    return fila
  })
  $('#fuentes').replaceChildren(...filas)
  const legibles = fuentes.filter((f) => !f.error)
  const total = legibles.reduce((suma, f) => suma + f.parcelas, 0)
  $('#archivos-meta').hidden = !varias
  $('#archivos-meta').textContent = `${plural(total, 'parcela', 'parcelas')} en ${plural(legibles.length, 'archivo', 'archivos')} · ${revisado}`
  $('#archivos').hidden = false
}

function mostrarResultado(enviados, { informe, limites, conteo, indices, archivos, bosque, revisables: conBosque = [] }, segundos) {
  // Las URLs del archivo anterior se sueltan recién ahora, cuando el mapa ya no las usa.
  const viejas = urls
  urls = []
  actuales = enviados

  $('#estado').hidden = true
  $('#bienvenida').hidden = true
  $('#app').dataset.vista = 'resultado' // la zona de carga se achica: ya no es lo principal
  $('#elegir').textContent = informe.fuentes.length > 1 ? 'Elegir otros archivos' : 'Elegir otro archivo'
  mostrarFuentes(informe.fuentes, segundos < 0.1 ? 'revisado al instante' : `revisado en ${segundos.toFixed(1)} s`)
  // Con varios archivos legibles, las descargas son de todos juntos.
  const legibles = informe.fuentes.filter((f) => !f.error)
  const varias = legibles.length > 1
  const v = veredicto(conteo, bosque?.revisado)
  $('#veredicto').className = `veredicto ${v.clase}`
  $('#veredicto-icono').innerHTML = ICONOS[v.clase]
  $('#veredicto-texto').textContent = v.texto
  $('#alcance').textContent = alcance(informe.resumen, bosque)
  mostrarBosque(bosque)
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
  const base = varias ? 'parcelas-unidas' : nombreBase(legibles[0].nombre)
  enlazar($('#bajar-informe'), archivos.informe, `${base}-informe.csv`)
  enlazar($('#bajar-corregido'), archivos.corregido, varias ? `${base}.geojson` : `${base}-corregido.geojson`)
  $('#bajar-corregido-nombre').textContent = varias ? 'Archivo unido' : 'Archivo corregido'
  $('#bajar-corregido').title = varias
    ? `Las parcelas de los ${legibles.length} archivos en uno solo, con las tres correcciones seguras y el archivo de origen de cada una.`
    : 'Con las tres correcciones seguras. Lo demás se corrige en el archivo de origen.'
  $('#resultado').hidden = false
  anunciar(`Revisión terminada. ${v.texto}${bosque ? ` ${$('#bosque-estado').textContent}` : ''}`)

  const hallazgos = unirIndices(informe.resultados, indices)
  prepararRevisiones(conBosque) // las revisiones guardadas llegan después y refrescan la lista
  lista.mostrar(hallazgos, { archivos: varias ? legibles.map((f) => f.nombre) : [], estadoDe: estadoEnLaLista })
  $('#lista').hidden = false
  $('#mapa-vacio').hidden = !sinMapa // si el mapa no cargó, su aviso se queda
  mapa.mostrar({
    urlCapa: nuevaUrl(archivos.mapa),
    urlCentros: nuevaUrl(archivos.centros),
    urlHallazgos: nuevaUrl(archivos.hallazgos),
    limites,
    hallazgos,
    varias,
    bosque: Boolean(bosque?.revisado),
  })
  // MapLibre lee las capas en su worker; se deja un margen antes de soltar las URLs viejas.
  setTimeout(() => viejas.forEach((url) => URL.revokeObjectURL(url)), 5000)
}

function mostrarFallo(mensaje) {
  mostrarEstado(mensaje, { error: true })
  anunciar(mensaje)
  $('#archivos').hidden = true
  $('#resultado').hidden = true
  $('#lista').hidden = true
  $('#mapa-vacio').hidden = false
  mapa.limpiar() // que no queden a la vista las parcelas del archivo anterior
  lista.limpiar()
  prepararRevisiones([])
}

// ---------- Revisar uno o varios archivos ----------

/**
 * @param {File[]} archivos  Uno, los de un shapefile o los de varias fuentes: se revisan juntos.
 * @param {{bosque?: boolean, alTerminar?: () => void}} [ajustes]
 *   `bosque`: también con el mapa de bosque 2020 de la UE. Solo cuando la
 *   persona aprieta "Revisar bosque 2020"; al cambiar los archivos, se vuelve a pedir.
 */
async function revisar(archivos, { bosque = false, alTerminar } = {}) {
  $('#archivos').hidden = true
  $('#resultado').hidden = true
  mostrarEstado(leyendo(archivos.length), { avance: null })
  const inicio = performance.now()
  try {
    const resultado = await validador.validar(archivos, {
      opciones: { bosque },
      alAvanzar: (avance) => {
        const [texto, cifra] = FASES[avance.fase](avance, archivos.length)
        mostrarEstado(texto, { avance: cifra })
      },
    })
    mostrarResultado(archivos, resultado, (performance.now() - inicio) / 1000)
    alTerminar?.()
  } catch (e) {
    if (e instanceof Cancelado) return // llegó otro archivo; ese ya muestra su avance
    // Los mensajes de ErrorDeArchivo ya dicen qué falla en el archivo; los demás, que no es culpa del archivo.
    mostrarFallo(e.message)
  }
}

$('#archivo').addEventListener('change', (evento) => {
  const archivos = [...evento.target.files]
  evento.target.value = '' // permite volver a elegir el mismo archivo después de corregirlo
  if (archivos.length > 0) revisar(archivos)
})

// Las mismas parcelas, ahora también con el mapa de bosque 2020 de la UE.
$('#revisar-bosque').addEventListener('click', () => revisar(actuales, { bosque: true, alTerminar: () => $('#bosque-estado').focus() }))

// Sumar archivos a la revisión a la vista. Uno que ya está (mismo nombre,
// tamaño y fecha) no se suma de nuevo: sus parcelas saldrían todas repetidas.
const mismoArchivo = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
$('#sumar').addEventListener('change', (evento) => {
  const elegidos = [...evento.target.files]
  evento.target.value = ''
  const nuevos = elegidos.filter((a) => !actuales.some((b) => mismoArchivo(a, b)))
  if (nuevos.length > 0) return revisar([...actuales, ...nuevos])
  if (elegidos.length > 0) {
    const texto = elegidos.length === 1 ? 'Ese archivo ya está en la revisión.' : 'Esos archivos ya están en la revisión.'
    mostrarEstado(texto)
    anunciar(texto)
  }
})

async function probarEjemplo() {
  try {
    const respuesta = await fetch(ejemploUrl)
    revisar([new File([await respuesta.blob()], 'ejemplo-deslinde.geojson')])
  } catch {
    mostrarFallo('No se pudo abrir el archivo de ejemplo. Vuelva a cargar la página e intente de nuevo.')
  }
}
$('#ejemplo').addEventListener('click', probarEjemplo)
$('#ejemplo-mapa').addEventListener('click', probarEjemplo)

// Tres fuentes inventadas de un mismo exportador, cada una en su formato, para
// ver cómo se juntan: traen la misma parcela en dos archivos, una medida dos
// veces, un solape entre archivos y un código cruzado.
const EJEMPLO_JUNTAR = [
  [cooperativaUrl, 'cooperativa-norte.geojson'],
  [beneficioUrl, 'beneficio-sur.kml'],
  [tecnicosUrl, 'tecnicos-centro-shp.zip'],
]
async function probarJuntar() {
  try {
    const archivos = await Promise.all(
      EJEMPLO_JUNTAR.map(async ([url, nombre]) => {
        const respuesta = await fetch(url)
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`)
        return new File([await respuesta.blob()], nombre)
      }),
    )
    revisar(archivos)
  } catch {
    mostrarFallo('No se pudieron abrir los archivos de ejemplo. Vuelva a cargar la página e intente de nuevo.')
  }
}
$('#ejemplo-juntar').addEventListener('click', probarJuntar)
$('#ejemplo-juntar-mapa').addEventListener('click', probarJuntar)

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
  const archivos = [...e.dataTransfer.files]
  if (archivos.length > 0) revisar(archivos)
})
