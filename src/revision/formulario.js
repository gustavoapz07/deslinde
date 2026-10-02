// Bloque de revisión en la ficha de una parcela que cae en bosque de 2020
// (R15): muestra la revisión guardada o el formulario para registrarla. Todo
// lo que escribe la persona y los nombres de los adjuntos van como texto,
// nunca como HTML.

import { ICONOS } from '../iconos.js'
import { AYUDA_DE_DECISION, DECISIONES, nuevaRevision, validarRevision } from './datos.js'

const fechaLegible = new Intl.DateTimeFormat('es-HN', { dateStyle: 'medium', timeStyle: 'short' })
const PREFERENCIA_REVISOR = 'deslinde.revisor'

// Las miniaturas son URLs de Blob: se sueltan al dibujar el bloque siguiente.
let urlsVivas = []
function urlDe(blob) {
  const url = URL.createObjectURL(blob)
  urlsVivas.push(url)
  return url
}

function nodo(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta)
  if (clase) elemento.className = clase
  if (texto !== undefined) elemento.textContent = texto
  return elemento
}

function boton(texto, clase = 'boton-texto') {
  const b = nodo('button', clase, texto)
  b.type = 'button'
  return b
}

function recordarRevisor(nombre) {
  try {
    localStorage.setItem(PREFERENCIA_REVISOR, nombre)
  } catch {
    // sin almacenamiento: se escribe cada vez
  }
}
function revisorRecordado() {
  try {
    return localStorage.getItem(PREFERENCIA_REVISOR) ?? ''
  } catch {
    return ''
  }
}

// Fotos como miniatura; los PDF, como enlace para abrirlos.
function listaDeAdjuntos(adjuntos, { alQuitar } = {}) {
  const lista = nodo('ul', 'revision-adjuntos')
  adjuntos.forEach((a, i) => {
    const item = nodo('li')
    const nombre = a.nombre ?? a.name
    const datos = a.datos ?? a
    if ((a.tipo ?? a.type).startsWith('image/')) {
      const img = nodo('img')
      img.src = urlDe(datos)
      img.alt = nombre
      item.append(img)
    } else {
      const enlace = nodo('a', '', nombre)
      enlace.href = urlDe(datos)
      enlace.target = '_blank'
      enlace.rel = 'noopener'
      item.append(enlace)
    }
    if (alQuitar) {
      const quitar = boton('', 'quitar')
      quitar.innerHTML = ICONOS.cerrar // dibujo fijo
      quitar.setAttribute('aria-label', `Quitar ${nombre}`)
      quitar.addEventListener('click', () => alQuitar(i))
      item.append(quitar)
    }
    lista.append(item)
  })
  return lista
}

function vista(revision, { alEditar, alBorrar }) {
  const partes = [
    nodo('p', `revision-decision ${revision.decision}`, DECISIONES[revision.decision]),
    nodo('p', 'revision-motivo', revision.motivo),
    nodo('p', 'revision-firma', `Revisó ${revision.revisor} · ${fechaLegible.format(new Date(revision.fecha))}`),
  ]
  if (revision.adjuntos.length > 0) partes.push(listaDeAdjuntos(revision.adjuntos))
  const acciones = nodo('div', 'revision-acciones')
  const editar = boton('Editar')
  editar.addEventListener('click', alEditar)
  const borrar = boton('Borrar')
  borrar.addEventListener('click', () => {
    // Se confirma ahí mismo: borrar no se puede deshacer.
    const pregunta = nodo('span', 'revision-pregunta', '¿Borrar esta revisión?')
    const si = boton('Sí, borrar')
    const no = boton('No')
    si.addEventListener('click', alBorrar)
    no.addEventListener('click', () => acciones.replaceChildren(editar, borrar))
    acciones.replaceChildren(pregunta, si, no)
    no.focus()
  })
  acciones.append(editar, borrar)
  partes.push(acciones)
  return partes
}

function formulario(revision, { persistente, alGuardar, alCancelar }) {
  const form = nodo('form', 'revision-formulario')
  form.noValidate = true
  let adjuntos = [...(revision?.adjuntos ?? [])]

  const decisiones = nodo('fieldset', 'revision-opciones')
  decisiones.append(nodo('legend', 'oculto', 'Decisión'))
  for (const [valor, nombre] of Object.entries(DECISIONES)) {
    const etiqueta = nodo('label', 'revision-opcion')
    const radio = nodo('input')
    radio.type = 'radio'
    radio.name = 'decision'
    radio.value = valor
    radio.checked = revision?.decision === valor
    const textos = nodo('span')
    textos.append(nodo('strong', '', nombre), nodo('span', '', AYUDA_DE_DECISION[valor]))
    etiqueta.append(radio, textos)
    decisiones.append(etiqueta)
  }

  const motivo = nodo('textarea')
  motivo.name = 'motivo'
  motivo.rows = 3
  motivo.value = revision?.motivo ?? ''
  motivo.placeholder = 'Por ejemplo: café con sombra sembrado en 2012, según el registro de la cooperativa y las fotos.'
  const campoMotivo = nodo('label', 'revision-campo')
  campoMotivo.append(nodo('span', '', 'Motivo y evidencia'), motivo)

  const revisor = nodo('input')
  revisor.name = 'revisor'
  revisor.autocomplete = 'name'
  revisor.value = revision?.revisor ?? revisorRecordado()
  const campoRevisor = nodo('label', 'revision-campo')
  campoRevisor.append(nodo('span', '', 'Revisado por'), revisor)

  // Adjuntos: el campo real está oculto y se usa con su etiqueta.
  const archivos = nodo('input', 'oculto')
  archivos.type = 'file'
  archivos.multiple = true
  archivos.accept = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'
  archivos.id = `adjuntos-${Math.random().toString(36).slice(2)}`
  const adjuntar = nodo('label', 'revision-adjuntar')
  adjuntar.htmlFor = archivos.id
  adjuntar.innerHTML = ICONOS.sumar // dibujo fijo
  adjuntar.append('Adjuntar fotos o documentos')
  const zonaDeAdjuntos = nodo('div')
  const redibujarAdjuntos = () =>
    zonaDeAdjuntos.replaceChildren(
      ...(adjuntos.length > 0 ? [listaDeAdjuntos(adjuntos, { alQuitar: (i) => (adjuntos.splice(i, 1), redibujarAdjuntos()) })] : []),
    )
  archivos.addEventListener('change', () => {
    adjuntos = [...adjuntos, ...archivos.files]
    archivos.value = ''
    redibujarAdjuntos()
  })
  redibujarAdjuntos()

  const errores = nodo('div', 'revision-errores')
  errores.setAttribute('role', 'alert')

  const acciones = nodo('div', 'revision-acciones')
  const guardar = nodo('button', 'boton principal', 'Guardar')
  guardar.type = 'submit'
  acciones.append(guardar)
  if (alCancelar) {
    const cancelar = boton('Cancelar')
    cancelar.addEventListener('click', alCancelar)
    acciones.append(cancelar)
  }

  const aviso = nodo(
    'p',
    'revision-aviso',
    persistente
      ? 'Se guarda en este navegador; no se sube a ningún servidor.'
      : 'Este navegador no deja guardar: la revisión dura mientras la página esté abierta.',
  )

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    const campos = {
      decision: form.elements.decision.value,
      motivo: motivo.value,
      revisor: revisor.value,
      adjuntos,
    }
    // Solo los archivos nuevos se revisan; los que ya estaban guardados pasaron antes.
    const problemas = validarRevision({ ...campos, adjuntos: adjuntos.filter((a) => a instanceof File) })
    errores.replaceChildren(...problemas.map((p) => nodo('p', '', p)))
    if (problemas.length > 0) return
    recordarRevisor(campos.revisor.trim())
    guardar.disabled = true
    try {
      await alGuardar(nuevaRevision(campos))
    } catch {
      guardar.disabled = false
      errores.replaceChildren(nodo('p', '', 'No se pudo guardar la revisión en este navegador. Intente de nuevo.'))
    }
  })

  form.append(decisiones, campoMotivo, campoRevisor, archivos, adjuntar, zonaDeAdjuntos, errores, acciones, aviso)
  return [form]
}

/**
 * El bloque de revisión de una parcela, para la ficha.
 * @param {{revision?: Object, persistente: boolean, alGuardar: (r: Object) => Promise<void>, alBorrar: () => Promise<void>}} ajustes
 * @returns {HTMLElement}
 */
export function bloqueDeRevision({ revision, persistente, alGuardar, alBorrar }) {
  urlsVivas.forEach((url) => URL.revokeObjectURL(url))
  urlsVivas = []
  const bloque = nodo('section', 'revision')
  bloque.setAttribute('aria-label', 'Revisión de la parcela')
  let actual = revision
  const titulo = () => nodo('h3', 'revision-titulo', actual ? 'Revisión' : 'Registrar la revisión')

  function mostrarVista() {
    bloque.replaceChildren(
      titulo(),
      ...vista(actual, {
        alEditar: () => mostrarFormulario(true),
        alBorrar: async () => {
          await alBorrar()
          actual = undefined
          mostrarFormulario(false)
        },
      }),
    )
  }
  function mostrarFormulario(editando) {
    bloque.replaceChildren(
      titulo(),
      ...formulario(actual, {
        persistente,
        alGuardar: async (nueva) => {
          await alGuardar(nueva)
          actual = nueva
          mostrarVista()
        },
        alCancelar: editando ? mostrarVista : undefined,
      }),
    )
  }

  if (actual) mostrarVista()
  else mostrarFormulario(false)
  return bloque
}
