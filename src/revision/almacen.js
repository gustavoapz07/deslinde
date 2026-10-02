// Dónde se guardan las revisiones: en este navegador, con IndexedDB, para que
// al volver a cargar el mismo archivo aparezcan. Nunca salen del equipo. Si el
// navegador no deja guardar (ventana privada, almacenamiento bloqueado), quedan
// en memoria mientras la página esté abierta, y `persistente` lo dice.

const BASE = 'deslinde'
const TABLA = 'revisiones'

function abrir() {
  return new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(BASE, 1)
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(TABLA)
    pedido.onsuccess = () => resolver(pedido.result)
    pedido.onerror = () => rechazar(pedido.error)
    pedido.onblocked = () => rechazar(new Error('IndexedDB bloqueado'))
  })
}

// Una operación sobre la tabla, como promesa.
function operar(base, modo, accion) {
  return new Promise((resolver, rechazar) => {
    const transaccion = base.transaction(TABLA, modo)
    const pedido = accion(transaccion.objectStore(TABLA))
    transaccion.oncomplete = () => resolver(pedido?.result)
    transaccion.onerror = () => rechazar(transaccion.error)
    transaccion.onabort = () => rechazar(transaccion.error)
  })
}

function enMemoria() {
  const datos = new Map()
  return {
    persistente: false,
    leer: async (clave) => datos.get(clave),
    leerVarias: async (claves) => new Map(claves.filter((c) => datos.has(c)).map((c) => [c, datos.get(c)])),
    guardar: async (clave, revision) => void datos.set(clave, revision),
    borrar: async (clave) => void datos.delete(clave),
    borrarTodo: async () => datos.clear(),
  }
}

/**
 * @returns {Promise<{persistente: boolean, leer: (clave: string) => Promise<Object|undefined>,
 *   leerVarias: (claves: string[]) => Promise<Map<string, Object>>, guardar: (clave: string, revision: Object) => Promise<void>,
 *   borrar: (clave: string) => Promise<void>, borrarTodo: () => Promise<void>}>}
 */
export async function crearAlmacen() {
  let base
  try {
    if (typeof indexedDB === 'undefined') return enMemoria()
    base = await abrir()
  } catch {
    return enMemoria()
  }
  return {
    persistente: true,
    leer: (clave) => operar(base, 'readonly', (t) => t.get(clave)),
    // Todas en una sola transacción: puede haber miles de parcelas con bosque.
    leerVarias: (claves) =>
      new Promise((resolver, rechazar) => {
        const transaccion = base.transaction(TABLA, 'readonly')
        const tabla = transaccion.objectStore(TABLA)
        const encontradas = new Map()
        for (const clave of claves) {
          const pedido = tabla.get(clave)
          pedido.onsuccess = () => pedido.result && encontradas.set(clave, pedido.result)
        }
        transaccion.oncomplete = () => resolver(encontradas)
        transaccion.onerror = () => rechazar(transaccion.error)
      }),
    guardar: (clave, revision) => operar(base, 'readwrite', (t) => t.put(revision, clave)),
    borrar: (clave) => operar(base, 'readwrite', (t) => t.delete(clave)),
    borrarTodo: () => operar(base, 'readwrite', (t) => t.clear()),
  }
}
