// Error de un archivo que no se puede leer. Su mensaje se muestra tal cual en la
// página, así que dice en español simple qué falla en el archivo y qué hacer.

export class ErrorDeArchivo extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'ErrorDeArchivo'
  }
}

/** Código de la parcela tal como viene en el archivo, o null si no trae. */
export const codigoDe = (id) => (id === undefined || id === null || id === '' ? null : String(id))

/** Código de la parcela para el informe: el `id`, o uno de reserva si falta. */
export const etiquetaDe = (id, indice) => codigoDe(id) ?? `sin código (n.º ${indice + 1})`

/** Número de un texto, o NaN si viene vacío. */
export const aNumero = (t) => (typeof t === 'string' && t.trim() !== '' ? Number(t) : NaN)
