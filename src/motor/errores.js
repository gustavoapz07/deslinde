// Error de un archivo que no se puede leer. Su mensaje se muestra tal cual en la
// página, así que dice en español simple qué falla en el archivo y qué hacer.

export class ErrorDeArchivo extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'ErrorDeArchivo'
  }
}

/** Código de la parcela para el informe: el `id`, o uno de reserva si falta. */
export function etiquetaDe(id, indice) {
  return id === undefined || id === null || id === '' ? `sin código (n.º ${indice + 1})` : String(id)
}

/** Número de un texto, o NaN si viene vacío. */
export const aNumero = (t) => (typeof t === 'string' && t.trim() !== '' ? Number(t) : NaN)
