// Interfaz de Deslinde (Fase 2): cargar un archivo, revisarlo en el Web Worker
// con el avance en pantalla, ver las parcelas en el mapa y descargar las salidas.
// La lista de errores enlazada al mapa viene después.

import './estilos.css'
import { COLORES, NOMBRES } from './mapa/capas.js'
import { crearMapa } from './mapa/index.js'
import { Cancelado, crearValidador } from './validador.js'

document.querySelector('#app').innerHTML = `
  <header class="cabecera">
    <h1>Deslinde</h1>
    <p>Validador de parcelas de café para el EUDR</p>
  </header>
  <div class="cuerpo">
    <aside class="panel">
      <section class="carga">
        <label for="archivo">Archivo de parcelas</label>
        <input id="archivo" type="file" accept=".geojson,.json,.csv" />
        <p class="nota">GeoJSON con polígonos o puntos, o CSV de puntos. Se revisa en este equipo: el archivo no se sube a ningún servidor.</p>
        <p id="estado" role="status" aria-live="polite"></p>
      </section>
      <section id="resultado" hidden>
        <h2>Resultado</h2>
        <p id="resumen"></p>
        <ul class="leyenda">
          ${['error', 'advertencia', 'ok']
            .map((s) => `<li><span class="muestra ${s}"></span>${NOMBRES[s]}<span class="cuenta" id="cuenta-${s}"></span></li>`)
            .join('')}
        </ul>
        <p class="nota" id="sin-dibujar" hidden></p>
        <div class="descargas">
          <a id="bajar-informe">Descargar el informe (CSV)</a>
          <a id="bajar-corregido">Descargar el GeoJSON corregido</a>
        </div>
      </section>
      <section class="fondo">
        <label><input id="fondo" type="checkbox" /> Mostrar mapa base</label>
        <p class="nota">Con el mapa base, OpenFreeMap recibe qué zona del mapa se está mirando, no el archivo. Apáguelo si trabaja con parcelas reales y no quiere que nadie sepa dónde están.</p>
        <p class="nota" id="fondo-error" hidden>No se pudo cargar el mapa base (¿sin internet?). Las parcelas se ven igual sobre fondo liso.</p>
      </section>
      <p class="aviso">Herramienta de apoyo: no certifica el cumplimiento del EUDR. La responsabilidad legal sigue siendo del operador.</p>
    </aside>
    <div id="mapa" class="mapa" role="region" aria-label="Mapa de las parcelas"></div>
  </div>
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

const conFondo = leerPreferencia()
$('#fondo').checked = conFondo
const mapa = crearMapa($('#mapa'), { conFondo })
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

const FASES = {
  leyendo: () => 'Leyendo el archivo…',
  revisando: (a) => `Revisando parcelas: ${numero.format(a.hechas)} de ${numero.format(a.total)}`,
  comparando: () => 'Comparando las parcelas entre sí…',
  salidas: () => 'Preparando el mapa y las descargas…',
}

function nuevaUrl(blob) {
  const url = URL.createObjectURL(blob)
  urls.push(url)
  return url
}

function enlazar(enlace, blob, nombre) {
  enlace.href = nuevaUrl(blob)
  enlace.download = nombre
}

$('#archivo').addEventListener('change', async (evento) => {
  const archivo = evento.target.files[0]
  if (!archivo) return
  $('#resultado').hidden = true

  const formato = /\.csv$/i.test(archivo.name) ? 'csv' : 'geojson'
  const inicio = performance.now()
  try {
    const { informe, limites, conteo, archivos } = await validador.validar(archivo, {
      formato,
      alAvanzar: (avance) => ($('#estado').textContent = FASES[avance.fase](avance)),
    })
    // Las URLs del archivo anterior se sueltan recién ahora, cuando el mapa ya no las usa.
    const viejas = urls
    urls = []

    const segundos = (performance.now() - inicio) / 1000
    const { errores, advertencias } = informe.resumen
    $('#estado').textContent = segundos < 0.1 ? 'Listo.' : `Listo en ${segundos.toFixed(1)} s.`
    $('#resumen').textContent =
      `${plural(informe.parcelas, 'parcela', 'parcelas')}: ` +
      `${plural(errores, 'error', 'errores')} y ${plural(advertencias, 'advertencia', 'advertencias')}.`
    for (const severidad of ['error', 'advertencia', 'ok']) {
      $(`#cuenta-${severidad}`).textContent = numero.format(conteo[severidad])
    }
    $('#sin-dibujar').hidden = conteo.sinDibujar === 0
    $('#sin-dibujar').textContent =
      `${plural(conteo.sinDibujar, 'parcela no se puede dibujar', 'parcelas no se pueden dibujar')} ` +
      '(coordenadas ilegibles o que no están en grados). Aparecen en el informe.'
    enlazar($('#bajar-informe'), archivos.informe, `${nombreBase(archivo.name)}-informe.csv`)
    enlazar($('#bajar-corregido'), archivos.corregido, `${nombreBase(archivo.name)}-corregido.geojson`)
    $('#resultado').hidden = false

    mapa.mostrar({ urlCapa: nuevaUrl(archivos.mapa), limites, resultados: informe.resultados })
    // MapLibre lee la capa en su worker; se deja un margen antes de soltar las URLs viejas.
    setTimeout(() => viejas.forEach((url) => URL.revokeObjectURL(url)), 5000)
  } catch (e) {
    if (e instanceof Cancelado) return // llegó otro archivo; ese ya muestra su avance
    // Los mensajes de ErrorDeArchivo ya dicen qué falla en el archivo; los demás, que no es culpa del archivo.
    $('#estado').textContent = e.message
    mapa.limpiar() // que no queden a la vista las parcelas del archivo anterior
  }
})
