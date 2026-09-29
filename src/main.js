// Interfaz de Deslinde (Fase 2). Por ahora: cargar un archivo, revisarlo en el
// Web Worker con el avance en pantalla, ver el resumen y descargar las salidas.
// El mapa y la lista de errores vienen después.

import { Cancelado, crearValidador, ErrorDeArchivo } from './validador.js'

document.querySelector('#app').innerHTML = `
  <h1>Deslinde</h1>
  <p>Validador de parcelas de café para el EUDR.</p>
  <label>
    Archivo de parcelas (GeoJSON o CSV de puntos)
    <input id="archivo" type="file" accept=".geojson,.json,.csv" />
  </label>
  <p id="estado" role="status" aria-live="polite"></p>
  <section id="resultado" hidden>
    <p id="resumen"></p>
    <p>
      <a id="bajar-informe">Descargar el informe (CSV)</a> ·
      <a id="bajar-corregido">Descargar el GeoJSON corregido</a>
    </p>
  </section>
  <p><small>Herramienta de apoyo: no certifica el cumplimiento del EUDR. El archivo se revisa en este equipo y no se sube a ningún servidor.</small></p>
`

const $ = (selector) => document.querySelector(selector)
const numero = new Intl.NumberFormat('en-US')
const validador = crearValidador()
let urls = []

const FASES = {
  leyendo: () => 'Leyendo el archivo…',
  revisando: (a) => `Revisando parcelas: ${numero.format(a.hechas)} de ${numero.format(a.total)}`,
  comparando: () => 'Comparando las parcelas entre sí…',
  salidas: () => 'Preparando las descargas…',
}

const plural = (n, una, varias) => `${numero.format(n)} ${n === 1 ? una : varias}`
const nombreBase = (nombre) => nombre.replace(/\.[^.]+$/, '')

function enlazar(enlace, blob, nombre) {
  const url = URL.createObjectURL(blob)
  urls.push(url)
  enlace.href = url
  enlace.download = nombre
}

$('#archivo').addEventListener('change', async (evento) => {
  const archivo = evento.target.files[0]
  if (!archivo) return
  for (const url of urls) URL.revokeObjectURL(url)
  urls = []
  $('#resultado').hidden = true

  const formato = /\.csv$/i.test(archivo.name) ? 'csv' : 'geojson'
  const inicio = performance.now()
  try {
    const { informe, archivos } = await validador.validar(archivo, {
      formato,
      alAvanzar: (avance) => ($('#estado').textContent = FASES[avance.fase](avance)),
    })
    const segundos = ((performance.now() - inicio) / 1000).toFixed(1)
    const { errores, advertencias } = informe.resumen
    $('#estado').textContent = `Listo en ${segundos} s.`
    $('#resumen').textContent =
      `${plural(informe.parcelas, 'parcela', 'parcelas')}: ` +
      `${plural(errores, 'error', 'errores')} y ${plural(advertencias, 'advertencia', 'advertencias')}.`
    enlazar($('#bajar-informe'), archivos.informe, `${nombreBase(archivo.name)}-informe.csv`)
    enlazar($('#bajar-corregido'), archivos.corregido, `${nombreBase(archivo.name)}-corregido.geojson`)
    $('#resultado').hidden = false
  } catch (e) {
    if (e instanceof Cancelado) return // llegó otro archivo; ese ya muestra su avance
    // Los mensajes de ErrorDeArchivo ya dicen qué falla en el archivo; los demás, que no es culpa del archivo.
    $('#estado').textContent = e.message
  }
})
