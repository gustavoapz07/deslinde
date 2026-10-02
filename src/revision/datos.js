// Revisión con evidencia de las parcelas que caen en bosque de 2020 (R15).
// El mapa no distingue el café con sombra del bosque, así que una persona
// decide y deja constancia: la decisión, el motivo, quién revisó, la fecha y
// adjuntos (fotos o PDF). Se guarda en este navegador (almacen.js), nunca se
// sube. Sin DOM, para poder probarlo en Node.

/** Las tres decisiones posibles, como en la nota "Revisión agroforestal" de la bóveda. */
export const DECISIONES = {
  agricola: 'Uso agrícola desde antes de 2021',
  campo: 'Pendiente de visita de campo',
  excluir: 'Se excluye del lote',
}

/** Qué quiere decir cada una, debajo de su opción en el formulario. */
export const AYUDA_DE_DECISION = {
  agricola: 'Por ejemplo, café con sombra: la parcela puede quedar en el lote.',
  campo: 'Hace falta ir a verla antes de decidir.',
  excluir: 'Puede haber deforestación después de 2020: no se envía.',
}

export const MB_POR_ADJUNTO = 10
const ES_ADJUNTO = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/

/**
 * Huella de la geometría: FNV-1a de 32 bits sobre el tipo y el texto de las
 * coordenadas. Junto con el archivo y el código, identifica a la parcela de
 * una vez a otra, aunque cambie su posición en la revisión.
 */
export function huellaDeGeometria(tipo, textos) {
  const texto = `${tipo}:${JSON.stringify(textos)}`
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Con qué se guarda la revisión de una parcela: archivo, código y huella. */
export const claveDeParcela = ({ archivo, etiqueta, huella }) => `${archivo ?? ''}|${etiqueta}|${huella}`

/**
 * Qué le falta al formulario para guardarse, en español simple.
 * @param {{decision?: string, motivo?: string, revisor?: string, adjuntos?: File[]}} campos
 */
export function validarRevision({ decision, motivo, revisor, adjuntos = [] }) {
  const errores = []
  if (!(decision in DECISIONES)) errores.push('Elija una decisión.')
  if (!motivo?.trim()) errores.push('Escriba el motivo y la evidencia.')
  if (!revisor?.trim()) errores.push('Escriba quién revisó.')
  for (const a of adjuntos) {
    if (!ES_ADJUNTO.test(a.type)) errores.push(`"${a.name}" no es una foto ni un PDF.`)
    else if (a.size > MB_POR_ADJUNTO * 1024 * 1024) errores.push(`"${a.name}" pesa más de ${MB_POR_ADJUNTO} MB.`)
  }
  return errores
}

/**
 * La revisión lista para guardar. Los adjuntos van como Blob: IndexedDB los guarda tal cual.
 * @param {{decision: string, motivo: string, revisor: string, adjuntos?: (File|{nombre: string, tipo: string, tamano: number, datos: Blob})[]}} campos
 *   Los adjuntos pueden ser archivos nuevos (File) o los que ya tenía la revisión.
 */
export function nuevaRevision({ decision, motivo, revisor, adjuntos = [] }, ahora = new Date()) {
  return {
    decision,
    motivo: motivo.trim(),
    revisor: revisor.trim(),
    fecha: ahora.toISOString(),
    adjuntos: adjuntos.map((a) =>
      a instanceof Blob && 'name' in a ? { nombre: a.name, tipo: a.type, tamano: a.size, datos: a } : a,
    ),
  }
}

/** Lo que dice la lista de hallazgos junto a un aviso R15. */
export function estadoDeRevision(revision) {
  if (!revision) return 'Sin revisar'
  const nombre = DECISIONES[revision.decision]
  return `Revisada: ${nombre.charAt(0).toLowerCase()}${nombre.slice(1)}`
}

/**
 * Cuántas parcelas con bosque ya tienen revisión, y con qué decisión.
 * @param {string[]} claves  Las de las parcelas con bosque de esta revisión.
 * @param {Map<string, {decision: string}>} revisiones
 */
export function resumenDeRevisiones(claves, revisiones) {
  const porDecision = Object.fromEntries(Object.keys(DECISIONES).map((d) => [d, 0]))
  let revisadas = 0
  for (const clave of claves) {
    const r = revisiones.get(clave)
    if (!r) continue
    revisadas++
    porDecision[r.decision]++
  }
  return { total: claves.length, revisadas, porDecision }
}
