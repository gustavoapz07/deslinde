// Estilo de las capas de Deslinde sobre el mapa base, sin depender de MapLibre,
// para poder probarlo en Node. mapa/index.js lo usa para dibujar.

export const ESTILO_BASE = 'https://tiles.openfreemap.org/styles/positron'

// Caja aproximada de Honduras, la misma de R4: vista inicial antes de cargar un archivo.
export const VISTA_HONDURAS = [-89.4, 12.9, -83.1, 16.6]

// Colores por severidad. Se distinguen por tono y por claridad (rojo oscuro,
// ámbar claro, azul), para que también se separen con daltonismo rojo-verde.
// El borde del error además es más grueso.
export const COLORES = {
  error: '#b3202a',
  advertencia: '#e0a100',
  ok: '#2a74b0',
}

export const NOMBRES = {
  error: 'Con errores',
  advertencia: 'Solo advertencias',
  ok: 'Sin hallazgos',
}

const porSeveridad = (valores) => ['match', ['get', 'severidad'], 'error', valores.error, 'advertencia', valores.advertencia, valores.ok]
const seleccionada = (si, no) => ['case', ['boolean', ['feature-state', 'seleccionada'], false], si, no]

export const FUENTE_PARCELAS = 'parcelas'
export const FUENTE_HALLAZGOS = 'hallazgos'

/** Capas propias, en orden de dibujo. Todas empiezan con "deslinde-". */
export const CAPAS = [
  {
    id: 'deslinde-relleno',
    type: 'fill',
    source: FUENTE_PARCELAS,
    filter: ['!=', ['geometry-type'], 'Point'],
    paint: {
      'fill-color': porSeveridad(COLORES),
      'fill-opacity': seleccionada(0.65, porSeveridad({ error: 0.4, advertencia: 0.4, ok: 0.25 })),
    },
  },
  {
    id: 'deslinde-borde',
    type: 'line',
    source: FUENTE_PARCELAS,
    filter: ['!=', ['geometry-type'], 'Point'],
    paint: {
      'line-color': porSeveridad(COLORES),
      'line-width': seleccionada(4, porSeveridad({ error: 2.5, advertencia: 2, ok: 1 })),
    },
  },
  {
    id: 'deslinde-punto',
    type: 'circle',
    source: FUENTE_PARCELAS,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': porSeveridad(COLORES),
      'circle-radius': seleccionada(9, 6),
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  },
  {
    // Dónde está cada problema dentro de la parcela (el cruce, el vértice repetido…).
    id: 'deslinde-hallazgo',
    type: 'circle',
    source: FUENTE_HALLAZGOS,
    minzoom: 12,
    paint: {
      'circle-color': '#1f1f1f',
      'circle-radius': 3.5,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  },
]

export const VACIA = { type: 'FeatureCollection', features: [] }
const FONDO_LISO = { id: 'fondo-liso', type: 'background', paint: { 'background-color': '#eeede9' } }

/**
 * Estilo completo del mapa: el mapa base (si está activado y cargado) y encima
 * las capas de Deslinde. Sin mapa base, el estilo no pide nada a internet: solo
 * un fondo liso y las parcelas, que vienen de URLs `blob:` locales.
 * @param {{base?: Object|null, parcelas?: string|Object, hallazgos?: Object}} partes
 *   `base` es el estilo de OpenFreeMap ya descargado; `parcelas`, la URL del Blob de la capa.
 */
export function construirEstilo({ base = null, parcelas = VACIA, hallazgos = VACIA } = {}) {
  const propias = {
    [FUENTE_PARCELAS]: { type: 'geojson', data: parcelas, promoteId: 'indice' },
    [FUENTE_HALLAZGOS]: { type: 'geojson', data: hallazgos },
  }
  if (!base) return { version: 8, sources: propias, layers: [FONDO_LISO, ...CAPAS] }
  // Sin la vista propia del estilo base: si no, al cargarlo el mapa salta a
  // esa vista y pierde el encuadre de Honduras o de las parcelas.
  const { center, zoom, bearing, pitch, ...resto } = base
  return {
    ...resto,
    sources: { ...base.sources, ...propias },
    layers: [...base.layers, ...CAPAS],
  }
}

/** Capas donde un clic elige una parcela. */
export const CAPAS_CLIC = ['deslinde-relleno', 'deslinde-punto']

export const esCapaPropia = (id) => id.startsWith('deslinde-')

/**
 * Puntos de los hallazgos que traen ubicación, para la capa "deslinde-hallazgo".
 * @param {import('../motor/index.js').Resultado[]} resultados
 */
export function capaDeHallazgos(resultados) {
  return {
    type: 'FeatureCollection',
    features: resultados
      .filter((r) => r.ubicacion)
      .map((r) => ({
        type: 'Feature',
        properties: { parcela: r.parcela, regla: r.regla, severidad: r.severidad },
        geometry: { type: 'Point', coordinates: r.ubicacion },
      })),
  }
}

/**
 * Lo que dice la ventanita al hacer clic en una parcela: código, estado y sus
 * hallazgos. Devuelve datos, no HTML: los textos vienen del archivo del usuario
 * y la página los escribe como texto.
 */
export function fichaDeParcela({ id, severidad }, resultados) {
  const hallazgos = resultados.filter((r) => r.parcela === id)
  return {
    titulo: id,
    estado: NOMBRES[severidad],
    severidad,
    hallazgos: hallazgos.map((r) => ({ regla: r.regla, severidad: r.severidad, mensaje: r.mensaje, accion: r.accion })),
  }
}
