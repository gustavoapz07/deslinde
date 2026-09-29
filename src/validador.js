// Lado de la página: manda el archivo al Web Worker y devuelve una promesa con
// el resultado. Si llega un archivo nuevo mientras se revisa otro, la revisión
// anterior se cancela y el worker se reinicia, para no esperar a que termine.

import { ErrorDeArchivo } from './motor/lector.js'

export { ErrorDeArchivo }

export class Cancelado extends Error {
  constructor() {
    super('Se canceló la revisión.')
    this.name = 'Cancelado'
  }
}

const trabajadorDelNavegador = () => new Worker(new URL('./motor/trabajador.js', import.meta.url), { type: 'module' })

function aError({ clase, mensaje, detalle }) {
  if (clase === 'archivo') return new ErrorDeArchivo(mensaje)
  return new Error(mensaje, { cause: detalle })
}

/**
 * @param {() => Worker} [crearTrabajador]  Se reemplaza en las pruebas.
 */
export function crearValidador(crearTrabajador = trabajadorDelNavegador) {
  let trabajador = null
  let pendiente = null // { id, resolver, rechazar, alAvanzar }
  let siguienteId = 1

  function terminar(error) {
    trabajador?.terminate()
    trabajador = null
    const p = pendiente
    pendiente = null
    p?.rechazar(error)
  }

  function recibir({ id, tipo, avance, resultado, error }) {
    if (!pendiente || id !== pendiente.id) return // respuesta de una revisión cancelada
    if (tipo === 'avance') return pendiente.alAvanzar?.(avance)
    const p = pendiente
    pendiente = null
    if (tipo === 'listo') p.resolver(resultado)
    else p.rechazar(aError(error))
  }

  function iniciar() {
    trabajador = crearTrabajador()
    trabajador.onmessage = (evento) => recibir(evento.data)
    // Solo pasa si el worker no pudo arrancar o falló fuera de `atender`.
    trabajador.onerror = (evento) => {
      evento.preventDefault?.()
      terminar(new Error('No se pudo iniciar la revisión en este navegador.', { cause: evento.message }))
    }
  }

  return {
    /**
     * @param {string|Blob} entrada  Texto del archivo o el archivo mismo.
     * @param {{formato?: 'geojson'|'csv', opciones?: Object, alAvanzar?: (a: import('./motor/index.js').Avance) => void}} [ajustes]
     * @returns {Promise<import('./motor/trabajo.js').ResultadoDelTrabajo>}
     */
    validar(entrada, { formato = 'geojson', opciones = {}, alAvanzar } = {}) {
      if (pendiente) terminar(new Cancelado())
      if (!trabajador) iniciar()
      const id = siguienteId++
      return new Promise((resolver, rechazar) => {
        pendiente = { id, resolver, rechazar, alAvanzar }
        trabajador.postMessage({ id, entrada, formato, opciones })
      })
    },

    /** Detiene la revisión en curso, si hay una. */
    cancelar() {
      if (pendiente) terminar(new Cancelado())
    },
  }
}
