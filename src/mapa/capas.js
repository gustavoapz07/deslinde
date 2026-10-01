// Estilo de las capas de Deslinde sobre el mapa base, sin depender de MapLibre,
// para poder probarlo en Node. mapa/index.js lo usa para dibujar.
//
// De lejos, cada parcela es una marca de color en su centro y las cercanas se
// agrupan en un círculo con su cantidad: así un archivo no se ve como manchas
// diminutas al abrirlo. De cerca (desde ZOOM_DETALLE) aparecen el borde, el
// código de la parcela y, en cada problema, un punto con el número de su regla.

import { peorSeveridad } from '../lista/datos.js'
import { CAPA_WMS, WMS_BOSQUE } from '../motor/bosque.js'

export const ESTILO_BASE = 'https://tiles.openfreemap.org/styles/dark'

// Caja aproximada de Honduras, la misma de R4: vista inicial antes de cargar un archivo.
export const VISTA_HONDURAS = [-89.4, 12.9, -83.1, 16.6]

// Desde este zoom se ven los bordes de las parcelas; antes, sus marcas.
export const ZOOM_DETALLE = 13

// Letras de las etiquetas propias (códigos, cantidades, reglas). Se sirven
// desde el sitio (public/glyphs, licencia OFL) para que las etiquetas se vean
// también con el mapa base apagado, sin pedir nada a otro sitio.
export const FUENTE_ETIQUETAS = 'Noto Sans Bold'

// Colores por severidad, pensados para el mapa oscuro. Se distinguen por tono
// y por claridad (rojo, ámbar claro, azul), para que también se separen con
// daltonismo rojo-verde. El borde del error además es más grueso.
export const COLORES = {
  error: '#e5484d',
  advertencia: '#f2b33d',
  ok: '#4c9be8',
}

export const NOMBRES = {
  error: 'Con errores',
  advertencia: 'Solo advertencias',
  ok: 'Sin hallazgos',
}

// El fondo casi negro de la página, para los bordes de las marcas y los halos del texto.
const TINTA = '#0a0f0d'

/**
 * Colores del mapa base: el "dark" de OpenFreeMap con un verde apenas
 * insinuado. Los bosques y el agua se distinguen; el resto se queda atrás para
 * que manden las parcelas.
 */
export const PALETA_MAPA = {
  fondo: '#0c1210',
  agua: '#0e222b',
  bosque: '#12261b',
  residencial: '#101815',
  edificio: '#0d1411',
  camino: '#1b2621',
  caminoMayor: '#25332c',
  bordeCamino: '#2d3e36',
  limite: '#3f544a',
  lugar: '#93a39a',
  calle: '#728279',
  halo: '#060a08',
}

// Qué cambia en cada capa del estilo "dark". Las capas que no están aquí
// quedan como vienen; si OpenFreeMap cambia el estilo, se ve gris, no se rompe.
const p = PALETA_MAPA
const TINTE = {
  background: { 'background-color': p.fondo },
  water: { 'fill-color': p.agua },
  waterway: { 'line-color': p.agua },
  landcover_wood: { 'fill-color': p.bosque, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 14, 0.9] },
  landuse_park: { 'fill-color': p.bosque },
  landuse_residential: { 'fill-color': p.residencial, 'fill-opacity': 0.8 },
  building: { 'fill-color': p.edificio, 'fill-outline-color': p.camino },
  highway_path: { 'line-color': p.camino },
  highway_minor: { 'line-color': p.camino },
  highway_major_casing: { 'line-color': p.bordeCamino },
  highway_major_inner: { 'line-color': p.camino },
  highway_major_subtle: { 'line-color': p.caminoMayor },
  highway_motorway_casing: { 'line-color': p.bordeCamino },
  highway_motorway_inner: { 'line-color': p.caminoMayor },
  highway_motorway_subtle: { 'line-color': p.caminoMayor },
  boundary_state: { 'line-color': p.limite },
  'boundary_country_z0-4': { 'line-color': p.limite },
  'boundary_country_z5-': { 'line-color': p.limite },
  water_name: { 'text-color': '#6a8e9b', 'text-halo-color': p.halo },
  highway_name_other: { 'text-color': p.calle, 'text-halo-color': p.halo },
  highway_name_motorway: { 'text-color': p.calle },
}
for (const lugar of ['place_other', 'place_suburb', 'place_village', 'place_town', 'place_city', 'place_city_large', 'place_state', 'place_country_other', 'place_country_minor', 'place_country_major']) {
  TINTE[lugar] = { 'text-color': p.lugar, 'text-halo-color': p.halo }
}

/** Copia del estilo base con los colores de Deslinde. No cambia el que recibe. */
export function colorearBase(base) {
  return {
    ...base,
    layers: base.layers.map((capa) => (TINTE[capa.id] ? { ...capa, paint: { ...capa.paint, ...TINTE[capa.id] } } : capa)),
  }
}

const porSeveridad = (valores) => ['match', ['get', 'severidad'], 'error', valores.error, 'advertencia', valores.advertencia, valores.ok]
const estado = (clave) => ['boolean', ['feature-state', clave], false]
const seleccionada = (si, no) => ['case', estado('seleccionada'), si, no]
const encima = (si, no) => ['case', estado('seleccionada'), si, estado('encima'), si, no]

// Color de un grupo: el de su peor parcela.
const colorDeGrupo = [
  'case',
  ['>', ['get', 'errores'], 0],
  COLORES.error,
  ['>', ['get', 'advertencias'], 0],
  COLORES.advertencia,
  COLORES.ok,
]

export const FUENTE_PARCELAS = 'parcelas'
export const FUENTE_CENTROS = 'centros'
export const FUENTE_HALLAZGOS = 'hallazgos'

const texto = (campo, tamano) => ({
  'text-field': ['get', campo],
  'text-font': [FUENTE_ETIQUETAS],
  'text-size': tamano,
})

/** Capas propias, en orden de dibujo. Todas empiezan con "deslinde-". */
export const CAPAS = [
  // ---- De cerca: el borde de cada parcela ----
  {
    // Solo polígonos: las parcelas que se cruzan (R6) vienen como contorno y no se rellenan.
    id: 'deslinde-relleno',
    type: 'fill',
    source: FUENTE_PARCELAS,
    minzoom: ZOOM_DETALLE - 1,
    filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
    paint: {
      'fill-color': porSeveridad(COLORES),
      'fill-opacity': encima(0.55, porSeveridad({ error: 0.32, advertencia: 0.3, ok: 0.2 })),
    },
  },
  {
    id: 'deslinde-borde',
    type: 'line',
    source: FUENTE_PARCELAS,
    minzoom: ZOOM_DETALLE - 1,
    filter: ['!=', ['geometry-type'], 'Point'],
    paint: {
      'line-color': porSeveridad(COLORES),
      'line-width': porSeveridad({ error: 2.5, advertencia: 2, ok: 1.5 }),
    },
  },
  {
    // La parcela elegida lleva un borde claro encima del de su color.
    id: 'deslinde-seleccion',
    type: 'line',
    source: FUENTE_PARCELAS,
    minzoom: ZOOM_DETALLE - 1,
    filter: ['!=', ['geometry-type'], 'Point'],
    paint: {
      'line-color': '#ffffff',
      'line-width': 3,
      'line-opacity': seleccionada(1, 0),
    },
  },
  {
    id: 'deslinde-punto',
    type: 'circle',
    source: FUENTE_PARCELAS,
    minzoom: ZOOM_DETALLE - 1,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': porSeveridad(COLORES),
      'circle-radius': encima(10, 7),
      'circle-stroke-color': seleccionada('#ffffff', TINTA),
      'circle-stroke-width': seleccionada(3, 2),
    },
  },

  // ---- De lejos: una marca por parcela, agrupadas con su cantidad ----
  {
    id: 'deslinde-grupo',
    type: 'circle',
    source: FUENTE_CENTROS,
    maxzoom: ZOOM_DETALLE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': colorDeGrupo,
      'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 100, 24, 1000, 30],
      'circle-stroke-color': TINTA,
      'circle-stroke-width': 3,
      'circle-stroke-opacity': 0.9,
    },
  },
  {
    id: 'deslinde-grupo-cifra',
    type: 'symbol',
    source: FUENTE_CENTROS,
    maxzoom: ZOOM_DETALLE,
    filter: ['has', 'point_count'],
    layout: { ...texto('point_count_abbreviated', 13), 'text-allow-overlap': true },
    paint: { 'text-color': TINTA },
  },
  {
    id: 'deslinde-centro',
    type: 'circle',
    source: FUENTE_CENTROS,
    maxzoom: ZOOM_DETALLE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': porSeveridad(COLORES),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5, 12, 8],
      'circle-stroke-color': seleccionada('#ffffff', TINTA),
      'circle-stroke-width': seleccionada(3, 2),
    },
  },

  // ---- De cerca: dónde está cada problema y con qué regla ----
  {
    id: 'deslinde-hallazgo',
    type: 'circle',
    source: FUENTE_HALLAZGOS,
    minzoom: ZOOM_DETALLE,
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': 4.5,
      'circle-stroke-color': porSeveridad(COLORES),
      'circle-stroke-width': 2.5,
    },
  },
  {
    id: 'deslinde-hallazgo-regla',
    type: 'symbol',
    source: FUENTE_HALLAZGOS,
    minzoom: ZOOM_DETALLE + 1,
    layout: {
      ...texto('regla', 12),
      'text-anchor': 'left',
      'text-offset': [0.75, 0],
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': TINTA, 'text-halo-width': 2 },
  },
  {
    // El código de la parcela, sobre su centro, en cuanto sale de su grupo.
    // Si no entran todos, MapLibre muestra los que no se pisan y el resto
    // aparece al acercarse.
    id: 'deslinde-nombre',
    type: 'symbol',
    source: FUENTE_CENTROS,
    minzoom: ZOOM_DETALLE - 1,
    filter: ['!', ['has', 'point_count']],
    layout: { ...texto('id', 13), 'text-anchor': 'top', 'text-offset': [0, 0.6] },
    paint: { 'text-color': '#eef3ef', 'text-halo-color': TINTA, 'text-halo-width': 2 },
  },
]

export const VACIA = { type: 'FeatureCollection', features: [] }
const FONDO_LISO = { id: 'fondo-liso', type: 'background', paint: { 'background-color': PALETA_MAPA.fondo } }

// Bosque 2020 de la UE (GFC2020 v4), en teselas del WMS de la JRC: verde donde
// había bosque, transparente en lo demás. Solo después de "Revisar bosque
// 2020", y debajo de las parcelas. Desde el zoom 10, para no pedirle al
// servicio imágenes de medio país.
export const FUENTE_BOSQUE = 'bosque'
const TESELA_BOSQUE =
  `${WMS_BOSQUE}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${CAPA_WMS}&STYLES=` +
  '&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE'
const FUENTE_DE_BOSQUE = {
  type: 'raster',
  tiles: [TESELA_BOSQUE],
  tileSize: 256,
  minzoom: 10,
  maxzoom: 18,
  attribution: 'Bosque 2020: <a href="https://forobs.jrc.ec.europa.eu/GFC">JRC, Comisión Europea</a> (GFC2020 v4)',
}
const CAPA_BOSQUE = {
  id: 'deslinde-bosque',
  type: 'raster',
  source: FUENTE_BOSQUE,
  minzoom: 10,
  paint: { 'raster-opacity': 0.45, 'raster-resampling': 'nearest' },
}

const origenDeLaPagina = () => (typeof location === 'undefined' ? '' : location.origin)

/**
 * Estilo completo del mapa: el mapa base (si está activado y cargado) y encima
 * las capas de Deslinde. Sin mapa base, el estilo no pide nada fuera del sitio:
 * un fondo liso, las parcelas de URLs `blob:` locales y las letras de las
 * etiquetas, que se sirven desde el propio sitio.
 * @param {{base?: Object|null, parcelas?: string|Object, centros?: string|Object, hallazgos?: string|Object, bosque?: boolean, origen?: string}} partes
 *   `base` es el estilo de OpenFreeMap ya descargado; las demás, URLs de los Blob
 *   del worker. `bosque` dibuja el bosque 2020 de la UE debajo de las parcelas.
 */
export function construirEstilo({ base = null, parcelas = VACIA, centros = VACIA, hallazgos = VACIA, bosque = false, origen = origenDeLaPagina() } = {}) {
  const deBosque = bosque ? [CAPA_BOSQUE] : []
  const propias = {
    [FUENTE_PARCELAS]: { type: 'geojson', data: parcelas, promoteId: 'indice' },
    [FUENTE_CENTROS]: {
      type: 'geojson',
      data: centros,
      promoteId: 'indice',
      cluster: true,
      clusterMaxZoom: ZOOM_DETALLE - 2,
      clusterRadius: 42,
      // Cuántas parcelas del grupo tienen errores y cuántas solo advertencias: dan el color del grupo.
      clusterProperties: {
        errores: ['+', ['case', ['==', ['get', 'severidad'], 'error'], 1, 0]],
        advertencias: ['+', ['case', ['==', ['get', 'severidad'], 'advertencia'], 1, 0]],
      },
    },
    [FUENTE_HALLAZGOS]: { type: 'geojson', data: hallazgos },
    ...(bosque && { [FUENTE_BOSQUE]: FUENTE_DE_BOSQUE }),
  }
  if (!base) {
    return {
      version: 8,
      glyphs: `${origen}/glyphs/{fontstack}/{range}.pbf`,
      sources: propias,
      layers: [FONDO_LISO, ...deBosque, ...CAPAS],
    }
  }
  // Sin la vista propia del estilo base: si no, al cargarlo el mapa salta a
  // esa vista y pierde el encuadre de Honduras o de las parcelas.
  const { center, zoom, bearing, pitch, ...resto } = colorearBase(base)
  return {
    ...resto,
    sources: { ...base.sources, ...propias },
    layers: [...resto.layers, ...deBosque, ...CAPAS],
  }
}

/** Capas donde un clic elige una parcela. El borde cuenta para las que solo tienen contorno. */
export const CAPAS_CLIC = ['deslinde-relleno', 'deslinde-borde', 'deslinde-punto', 'deslinde-centro']

/** Capa de los grupos: un clic acerca el mapa hasta separarlos. */
export const CAPA_GRUPO = 'deslinde-grupo'

export const esCapaPropia = (id) => id.startsWith('deslinde-')

/**
 * Lo que dice la ficha de una parcela: código, estado y sus hallazgos. Busca
 * por posición en el archivo, porque dos parcelas pueden traer el mismo código.
 * Devuelve datos, no HTML: los textos vienen del archivo del usuario y la
 * página los escribe como texto.
 * @param {number} indice
 * @param {import('../lista/datos.js').Hallazgo[]} hallazgos  Todos los de la revisión.
 * @param {string} [id]  Código de la parcela, si se conoce (una parcela sin hallazgos no lo trae en la lista).
 * @param {string} [archivo]  De qué archivo viene, cuando se juntaron varios.
 */
export function fichaDeParcela(indice, hallazgos, id, archivo) {
  const propios = hallazgos.filter((h) => h.indice === indice)
  const severidad = peorSeveridad(propios)
  return {
    titulo: id ?? propios[0]?.parcela ?? `n.º ${indice + 1}`,
    archivo,
    estado: NOMBRES[severidad],
    severidad,
    hallazgos: propios.map((h) => ({ regla: h.regla, severidad: h.severidad, mensaje: h.mensaje, accion: h.accion })),
  }
}
