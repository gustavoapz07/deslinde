// Genera los conjuntos de datos sintéticos de Deslinde.
// Ninguna coordenada corresponde a una finca real: las parcelas se dibujan sobre
// una cuadrícula en una zona interior de Honduras elegida a mano, con semilla fija
// para que cada corrida produzca exactamente los mismos archivos.
//
// Uso: npm run datos

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { area } from '@turf/turf'
import { archivosShapefile, bytesKMZ, bytesZipShapefile, textoKML } from './escribir-formatos.js'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DIR_DATOS = join(RAIZ, 'datos', 'sinteticos')

const SEMILLA = 20260928

// Esquina suroeste de la cuadrícula, lejos de las fronteras. Con 100 x 100 celdas
// la cuadrícula llega a unos 14.76 N y -87.83 O, todavía dentro del país.
const ORIGEN = { lon: -88.2, lat: 14.4 }
const PASO_M = 400 // distancia entre centros de celdas vecinas
const MOVIMIENTO_M = 30 // desplazamiento al azar del centro dentro de su celda
const M_POR_GRADO_LAT = 110574

// Con 6 ha como máximo, el radio llega a 138 m x 1.15 = 159 m. Dos vecinas ocupan
// como mucho 2 x (159 + 30) = 378 m, menos que PASO_M: las parcelas válidas no se solapan.
const HA_MIN = 0.5
const HA_MAX = 6

// Generador pseudoaleatorio mulberry32: pequeño y reproducible con una semilla.
function crearAzar(semilla) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const entre = (azar, min, max) => min + azar() * (max - min)
const redondear = (n, decimales) => Number(n.toFixed(decimales))
const codigo = (prefijo, n) => `${prefijo}-${String(n).padStart(5, '0')}`

function desplazar({ lon, lat }, esteM, norteM) {
  return {
    lon: lon + esteM / (111320 * Math.cos((lat * Math.PI) / 180)),
    lat: lat + norteM / M_POR_GRADO_LAT,
  }
}

function centroDeCelda(fila, columna, azar) {
  const mover = () => entre(azar, -MOVIMIENTO_M, MOVIMIENTO_M)
  return desplazar(ORIGEN, columna * PASO_M + mover(), fila * PASO_M + mover())
}

const aPunto = ({ lon, lat }) => [redondear(lon, 6), redondear(lat, 6)]

// Polígono en estrella alrededor del centro. Los ángulos siempre crecen, así que
// el anillo no se cruza y queda en sentido antihorario, como pide GeoJSON.
function anilloAlrededor(centro, hectareas, azar) {
  const radio = Math.sqrt((hectareas * 10000) / Math.PI)
  const lados = Math.floor(entre(azar, 6, 11))
  const anillo = []
  for (let i = 0; i < lados; i++) {
    const angulo = ((i + entre(azar, -0.3, 0.3)) / lados) * 2 * Math.PI
    const r = radio * entre(azar, 0.85, 1.15)
    anillo.push(aPunto(desplazar(centro, r * Math.cos(angulo), r * Math.sin(angulo))))
  }
  anillo.push([...anillo[0]])
  return anillo
}

const poligono = (centro, hectareas, azar) => ({
  type: 'Polygon',
  coordinates: [anilloAlrededor(centro, hectareas, azar)],
})

const hectareasDe = (geometria) => redondear(area(geometria) / 10000, 2)

function parcela(id, productor, geometria, areaHa, opciones = {}) {
  return {
    type: 'Feature',
    properties: { id, productor, area_ha: areaHa },
    geometry: geometria,
    ...opciones,
  }
}

// Parcela sin errores. Las de hasta 4 ha pueden entregarse como punto (EUDR);
// aquí una de cada cuatro de ese tamaño va como punto.
function parcelaValida(n, fila, columna, azar, soloPuntos = false) {
  const centro = centroDeCelda(fila, columna, azar)
  const hectareas = entre(azar, HA_MIN, soloPuntos ? 4 : HA_MAX)
  const id = codigo('P', n)
  const productor = codigo('PR', Math.ceil(n / 2))
  if (soloPuntos || (hectareas <= 4 && azar() < 0.25)) {
    return parcela(id, productor, { type: 'Point', coordinates: aPunto(centro) }, redondear(hectareas, 2))
  }
  const geometria = poligono(centro, hectareas, azar)
  return parcela(id, productor, geometria, hectareasDe(geometria))
}

function cuadricula(cantidad, columnas, azar, soloPuntos = false) {
  return Array.from({ length: cantidad }, (_, i) =>
    parcelaValida(i + 1, Math.floor(i / columnas), i % columnas, azar, soloPuntos),
  )
}

// Un caso por regla. Numeración igual a "Alcance del MVP" en la bóveda;
// el 09 es valido.geojson y el 10 es grande-10000.geojson.
// Cada caso usa sus propias celdas (fila 10 en adelante) para no tocar a los demás.
function casosDeError(azar) {
  const centro = (columna, fila = 10) => centroDeCelda(fila, columna, azar)
  const productor = 'PR-E0001'
  const valida = (id, columna, hectareas = 2) => {
    const geometria = poligono(centro(columna), hectareas, azar)
    return parcela(id, productor, geometria, hectareasDe(geometria))
  }

  const casos = []
  const caso = (numero, nombre, regla, features) => casos.push({ numero, nombre, regla, features })

  // 01 · R6: el anillo cruza sobre sí mismo (forma de moño).
  {
    const c = centro(0)
    const esquina = (este, norte) => aPunto(desplazar(c, este, norte))
    const anillo = [esquina(-70, -70), esquina(70, 70), esquina(70, -70), esquina(-70, 70)]
    anillo.push([...anillo[0]])
    caso('01', 'autointerseccion', 'R6', [
      parcela('P-E01', productor, { type: 'Polygon', coordinates: [anillo] }, 2),
    ])
  }

  // 02 · R5: el último punto no repite el primero.
  {
    const f = valida('P-E02', 1)
    f.geometry.coordinates[0].pop()
    caso('02', 'anillo-sin-cerrar', 'R5', [f])
  }

  // 03 · R2: coordenadas escritas con 5 decimales.
  caso('03', 'cinco-decimales', 'R2', [{ ...valida('P-E03', 2), _decimales: 5 }])

  // 04 · R3: cada par viene como [latitud, longitud].
  {
    const f = valida('P-E04', 3)
    f.geometry.coordinates[0] = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon])
    caso('04', 'latitud-longitud-invertidas', 'R3', [f])
  }

  // 05 · R9: parcela de 6.5 ha entregada como punto.
  caso('05', 'punto-mayor-a-4-ha', 'R9', [
    parcela('P-E05', productor, { type: 'Point', coordinates: aPunto(centro(4)) }, 6.5),
  ])

  // 06 · R8: un multipolígono con dos partes a unos 2 km.
  {
    const partes = [poligono(centro(5), 1.5, azar), poligono(centro(5, 15), 1.5, azar)]
    const geometria = { type: 'MultiPolygon', coordinates: partes.map((p) => p.coordinates) }
    caso('06', 'multipoligono-partes-alejadas', 'R8', [
      parcela('P-E06', productor, geometria, hectareasDe(geometria)),
    ])
  }

  // 07 · R10: dos parcelas de 2 ha con los centros a 60 m.
  {
    const c = centro(6)
    const a = poligono(c, 2, azar)
    const b = poligono(desplazar(c, 60, 0), 2, azar)
    caso('07', 'parcelas-solapadas', 'R10', [
      parcela('P-E07A', productor, a, hectareasDe(a)),
      parcela('P-E07B', productor, b, hectareasDe(b)),
    ])
  }

  // 08 · R4: un punto en Costa Rica, fuera de la caja aproximada de Honduras.
  caso('08', 'fuera-de-honduras', 'R4', [
    parcela('P-E08', productor, { type: 'Point', coordinates: [-84.0, 10.0] }, 1.5),
  ])

  // 11 · R1: coordenadas en metros (UTM zona 16N), no en grados EPSG:4326.
  {
    const anillo = anilloAlrededor({ lon: 0, lat: 0 }, 2, azar).map(([lon, lat]) => [
      redondear(403000 + lon * 111320, 2),
      redondear(1614000 + lat * M_POR_GRADO_LAT, 2),
    ])
    caso('11', 'coordenadas-proyectadas', 'R1', [
      { ...parcela('P-E11', productor, { type: 'Polygon', coordinates: [anillo] }, 2), _decimales: 2 },
    ])
  }

  // 12 · R7: un vértice repetido seguido.
  {
    const f = valida('P-E12', 7)
    const anillo = f.geometry.coordinates[0]
    anillo.splice(3, 0, [...anillo[2]])
    caso('12', 'vertice-duplicado', 'R7', [f])
  }

  // 13 · R11: dos parcelas con la misma geometría y distinto código.
  {
    const f = valida('P-E13A', 8)
    const copia = structuredClone(f)
    copia.properties.id = 'P-E13B'
    caso('13', 'geometria-duplicada', 'R11', [f, copia])
  }

  // 14 · R12: se declaran 5 ha y el polígono mide unas 2 ha.
  {
    const f = valida('P-E14', 9)
    f.properties.area_ha = 5
    caso('14', 'area-declarada-distinta', 'R12', [f])
  }

  return casos
}

// JSON.stringify quita los ceros finales (14.500000 queda como 14.5) y eso haría
// fallar R2 en un archivo válido. Por eso cada coordenada se escribe con un número
// fijo de decimales: 6 por defecto, o lo que diga _decimales en la parcela.
function marcar(valor, decimales) {
  return Array.isArray(valor) ? valor.map((v) => marcar(v, decimales)) : `#${valor.toFixed(decimales)}#`
}

export function textoGeoJSON(features) {
  const lineas = features.map(({ _decimales = 6, ...f }) =>
    JSON.stringify(f, (clave, valor) => (clave === 'coordinates' ? marcar(valor, _decimales) : valor)).replace(
      /"#(-?\d+(?:\.\d+)?)#"/g,
      '$1',
    ),
  )
  return `{"type":"FeatureCollection","features":[\n${lineas.join(',\n')}\n]}\n`
}

function textoCSV(features) {
  const filas = features.map(({ properties: p, geometry: g }) => {
    const [lon, lat] = g.coordinates
    return [p.id, p.productor, lat.toFixed(6), lon.toFixed(6), p.area_ha.toFixed(2)].join(',')
  })
  return ['id,productor,latitud,longitud,area_ha', ...filas].join('\n') + '\n'
}

// Ejemplo para juntar archivos (v1, parte 6b): un exportador recibe las parcelas
// de tres fuentes, cada una en su formato. Usan un código de registro común
// ("HN-…"), así que la misma parcela puede llegar de dos lados. Van en las filas
// 20 a 22 de la cuadrícula, lejos de las demás parcelas sintéticas.
export function parcelasParaJuntar() {
  const azar = crearAzar(SEMILLA + 6)
  const celda = (fila, columna) => centroDeCelda(20 + fila, columna, azar)
  const codigoHN = (n) => `HN-${String(n).padStart(4, '0')}`
  const poligonal = (id, productor, centro, hectareas) => {
    const geometria = poligono(centro, hectareas, azar)
    return parcela(id, productor, geometria, hectareasDe(geometria))
  }

  // La cooperativa: diez parcelas, dos de ellas como punto.
  const centrosNorte = Array.from({ length: 10 }, (_, i) => celda(0, i))
  const norte = centrosNorte.map((centro, i) => {
    const id = codigoHN(101 + i)
    const productor = codigo('PR-N', Math.ceil((i + 1) / 2))
    const hectareas = entre(azar, 1, 4)
    if (i === 3 || i === 8) return parcela(id, productor, { type: 'Point', coordinates: aPunto(centro) }, redondear(hectareas, 2))
    return poligonal(id, productor, centro, hectareas)
  })

  // El beneficio: seis parcelas suyas, una que también manda la cooperativa
  // (HN-0103, idéntica) y otra que volvió a medir (HN-0107, 15 m al este).
  const centrosSur = Array.from({ length: 6 }, (_, i) => celda(1, i))
  const sur = [
    ...centrosSur.map((centro, i) => poligonal(codigoHN(201 + i), codigo('PR-S', i + 1), centro, entre(azar, 1, 4))),
    structuredClone(norte[2]),
    poligonal('HN-0107', norte[6].properties.productor, desplazar(centrosNorte[6], 15, 0), 2.5),
  ]

  // Los técnicos de campo: cuatro parcelas suyas (una exportada con 5
  // decimales), una que se mete en HN-0204 del beneficio y otra parcela que
  // trae el código HN-0202 del beneficio, lejos de ella.
  const centro = [
    ...Array.from({ length: 4 }, (_, i) => {
      const f = poligonal(codigoHN(301 + i), codigo('PR-C', i + 1), celda(2, i), entre(azar, 1, 4))
      return i === 2 ? { ...f, _decimales: 5 } : f
    }),
    poligonal('HN-0305', codigo('PR-C', 5), desplazar(centrosSur[3], 70, 0), 2),
    poligonal('HN-0202', codigo('PR-C', 6), celda(2, 6), 2),
  ]
  return { norte, sur, centro }
}

/** Las parcelas válidas de valido.geojson y valido-puntos.csv, para armar otros formatos en las pruebas. */
export const parcelasValidas = () => cuadricula(25, 5, crearAzar(SEMILLA + 1))
export const puntosValidos = () => cuadricula(15, 5, crearAzar(SEMILLA + 2), true)
/** Diez parcelas válidas y todos los casos de error: el contenido de errores-mezclados. */
export const parcelasMezcladas = () => [
  ...cuadricula(10, 5, crearAzar(SEMILLA + 5)),
  ...casosDeError(crearAzar(SEMILLA + 4)).flatMap((c) => c.features),
]

export function generarTodo(dir = DIR_DATOS) {
  mkdirSync(join(dir, 'casos'), { recursive: true })
  mkdirSync(join(dir, 'juntar'), { recursive: true })
  const escribir = (nombre, texto) => writeFileSync(join(dir, nombre), texto, 'utf8')
  const escribirBytes = (nombre, bytes) => writeFileSync(join(dir, nombre), bytes)

  const validas = parcelasValidas()
  escribir('valido.geojson', textoGeoJSON(validas))
  escribir('valido-puntos.csv', textoCSV(puntosValidos()))

  // Las mismas parcelas en los formatos de v1. Un shapefile lleva un solo tipo
  // de geometría: los polígonos y los puntos van en archivos aparte.
  escribir('valido.kml', textoKML(validas))
  escribirBytes('valido.kmz', bytesKMZ(textoKML(validas)))
  const poligonos = validas.filter((f) => f.geometry.type !== 'Point')
  escribirBytes('valido-poligonos-shp.zip', bytesZipShapefile('valido-poligonos', archivosShapefile(poligonos)))
  escribirBytes('valido-puntos-shp.zip', bytesZipShapefile('valido-puntos', archivosShapefile(puntosValidos())))
  escribir('grande-10000.geojson', textoGeoJSON(cuadricula(10000, 100, crearAzar(SEMILLA + 3))))

  const casos = casosDeError(crearAzar(SEMILLA + 4))
  for (const { numero, nombre, features } of casos) {
    escribir(join('casos', `${numero}-${nombre}.geojson`), textoGeoJSON(features))
  }

  // Diez parcelas válidas junto a todos los casos, para la demo y para probar
  // que el motor marca solo las parcelas con problemas.
  escribir('errores-mezclados.geojson', textoGeoJSON(parcelasMezcladas()))
  escribir('errores-mezclados.kml', textoKML(parcelasMezcladas()))

  // Tres fuentes, cada una en su formato, para juntarlas.
  const { norte, sur, centro } = parcelasParaJuntar()
  escribir(join('juntar', 'cooperativa-norte.geojson'), textoGeoJSON(norte))
  escribir(join('juntar', 'beneficio-sur.kml'), textoKML(sur, { titulo: 'Parcelas del beneficio' }))
  escribirBytes(join('juntar', 'tecnicos-centro-shp.zip'), bytesZipShapefile('tecnicos-centro', archivosShapefile(centro)))

  return casos.map(({ numero, nombre, regla }) => ({ numero, nombre, regla }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const casos = generarTodo()
  console.log(`Datos sintéticos en ${DIR_DATOS}`)
  for (const c of casos) console.log(`  caso ${c.numero} (${c.regla}): ${c.nombre}`)
}
