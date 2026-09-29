// Datos de la lista de hallazgos, sin DOM, para poder probarlos en Node.
// lista/index.js los dibuja.

/** Cuántos hallazgos se dibujan de una vez; el resto, con "Mostrar más". */
export const TAMANO_PAGINA = 100

/** Nombre corto de cada regla, para el filtro. Detalle en el README. */
export const NOMBRES_DE_REGLA = {
  R1: 'Coordenadas que no están en grados',
  R2: 'Menos de 6 decimales',
  R3: 'Latitud y longitud invertidas',
  R4: 'Fuera de Honduras',
  R5: 'Anillo sin cerrar o incompleto',
  R6: 'Polígono que se cruza',
  R7: 'Vértices repetidos',
  R8: 'Partes separadas',
  R9: 'Punto con más de 4 ha o sin área',
  R10: 'Solape con otra parcela',
  R11: 'Parcela duplicada',
  R12: 'Área declarada distinta',
}

/**
 * @typedef {import('../motor/index.js').Resultado & {indice: number}} Hallazgo
 * Un resultado del informe con la posición de su parcela en el archivo.
 */

/**
 * @param {import('../motor/index.js').Resultado[]} resultados
 * @param {number[]} indices  Del worker, en el mismo orden que los resultados.
 * @returns {Hallazgo[]}
 */
export function unirIndices(resultados, indices) {
  return resultados.map((r, i) => ({ ...r, indice: indices[i] }))
}

const numeroDeRegla = (regla) => Number(regla.slice(1))

/** Reglas que aparecen, en orden R1 → R12, con cuántos hallazgos tiene cada una. */
export function conteoPorRegla(hallazgos) {
  const cuenta = new Map()
  for (const h of hallazgos) cuenta.set(h.regla, (cuenta.get(h.regla) ?? 0) + 1)
  return [...cuenta]
    .map(([regla, cantidad]) => ({ regla, cantidad }))
    .sort((a, b) => numeroDeRegla(a.regla) - numeroDeRegla(b.regla))
}

/**
 * @param {Hallazgo[]} hallazgos
 * @param {{severidad?: 'todas'|'error'|'advertencia', regla?: string}} [filtro]
 */
export function filtrar(hallazgos, { severidad = 'todas', regla = 'todas' } = {}) {
  return hallazgos.filter((h) => (severidad === 'todas' || h.severidad === severidad) && (regla === 'todas' || h.regla === regla))
}

/** Peor severidad de un grupo de hallazgos: 'error', 'advertencia' u 'ok' si no hay. */
export function peorSeveridad(hallazgos) {
  if (hallazgos.some((h) => h.severidad === 'error')) return 'error'
  return hallazgos.length > 0 ? 'advertencia' : 'ok'
}

/**
 * Tramo de la lista que hay que dibujar, [desde, hasta), para que se vea el
 * primer hallazgo de una parcela. Si ya se ve, o el filtro la deja fuera, no
 * cambia. Si no, salta a la página donde cae en vez de dibujar todo lo
 * anterior: con 10,000 hallazgos, dibujarlos todos congelaba la página casi 2 s.
 * @param {{desde: number, hasta: number}} tramo
 */
export function tramoPara(filtrados, indice, tramo) {
  const posicion = filtrados.findIndex((h) => h.indice === indice)
  if (posicion === -1 || (posicion >= tramo.desde && posicion < tramo.hasta)) return tramo
  const desde = Math.floor(posicion / TAMANO_PAGINA) * TAMANO_PAGINA
  return { desde, hasta: desde + TAMANO_PAGINA }
}
