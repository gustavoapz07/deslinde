// Motor de validación de Deslinde. Se construye en la Fase 1: en la Fase 0 solo
// existe el contrato para que las pruebas se puedan escribir antes que el código.

/**
 * @typedef {Object} Resultado
 * @property {string} parcela       Código de la parcela (propiedad `id` del archivo).
 * @property {string} regla         R1 a R12, ver la nota "Reglas de validación de geodatos".
 * @property {'error'|'advertencia'} severidad
 * @property {[number, number]|null} ubicacion  [longitud, latitud] donde mostrar el problema en el mapa.
 * @property {string} mensaje       Qué pasa, en español simple.
 * @property {string} accion        Qué hacer para corregirlo.
 */

/**
 * @typedef {Object} Informe
 * @property {number} parcelas      Cantidad de parcelas leídas.
 * @property {Resultado[]} resultados
 */

export const OPCIONES_POR_DEFECTO = {
  formato: 'geojson', // 'geojson' o 'csv'
  umbralAreaPct: 10, // R12: diferencia admitida entre área declarada y calculada [hipótesis]
}

/**
 * Valida el texto de un archivo de parcelas. Recibe el texto y no el objeto ya
 * leído porque R2 cuenta los decimales tal como vienen escritos.
 * @param {string} texto
 * @param {Partial<typeof OPCIONES_POR_DEFECTO>} [opciones]
 * @returns {Informe}
 */
export function validarTexto(texto, opciones = {}) {
  throw new Error('Motor sin implementar: se construye en la Fase 1')
}
