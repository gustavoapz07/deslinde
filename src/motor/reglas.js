// Reglas R1 a R12 de la nota "Reglas de validación de geodatos", una función por regla.
// Cada función recibe una parcela (ver lector.js) y devuelve hallazgos sin el código
// de parcela; index.js lo agrega. Las correcciones automáticas (invertir pares,
// cerrar anillos, quitar vértices repetidos) cambian la parcela en su lugar y se
// aplican a los números y a los textos por igual.

import { area, bbox, booleanIntersects, centroid, distance, feature, featureCollection, intersect, kinks } from '@turf/turf'
import { decimales } from './lector.js'

// Caja aproximada de Honduras [por verificar]: detecta errores gruesos, no fronteras.
export const HONDURAS = { lonMin: -89.4, lonMax: -83.1, latMin: 12.9, latMax: 16.6 }
const DECIMALES_MINIMOS = 6
const HA_MAXIMAS_PUNTO = 4

const numero = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const fmt = (n) => numero.format(n)
const redondear = (n) => Number(n.toFixed(6))
const ubicar = ([lon, lat]) => [redondear(lon), redondear(lat)]

const error = (regla, ubicacion, mensaje, accion) => ({ regla, severidad: 'error', ubicacion, mensaje, accion })
const advertencia = (regla, ubicacion, mensaje, accion) => ({ regla, severidad: 'advertencia', ubicacion, mensaje, accion })

export const esPoligonal = (p) => p.tipo === 'Polygon' || p.tipo === 'MultiPolygon'
export const geometria = (p) => ({ type: p.tipo, coordinates: p.coords })

// Anillos de la parcela con su texto gemelo y su ubicación dentro de la geometría.
function anillos(p) {
  const partes = p.tipo === 'Polygon' ? [p.coords] : p.coords
  const textos = p.tipo === 'Polygon' ? [p.textos] : p.textos
  return partes.flatMap((parte, i) =>
    parte.map((anillo, j) => ({ parte: i, anillo: j, pos: anillo, txt: textos[i][j] })),
  )
}

function posiciones(p) {
  if (p.tipo === 'Point') return [{ pos: p.coords, txt: p.textos }]
  return anillos(p).flatMap((a) => a.pos.map((pos, k) => ({ pos, txt: a.txt[k] })))
}

function dondeEnAnillo(p, { parte, anillo }) {
  const partes = p.tipo === 'MultiPolygon' ? ` de la parte ${parte + 1}` : ''
  const hueco = anillo > 0 ? ` del hueco ${anillo}` : ''
  return `${partes}${hueco}`
}

const mismaPosicion = (a, b) => a[0] === b[0] && a[1] === b[1]

// ---------- R1 · Sistema de coordenadas EPSG:4326 ----------
// GeoJSON ya no declara el sistema de coordenadas, así que se deduce de los valores.
// R1 también cubre geometrías que no se pueden leer como coordenadas.

const esPos = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
const esAnillo = (a) => Array.isArray(a) && a.length > 0 && a.every(esPos)
const esPoligono = (p) => Array.isArray(p) && p.length > 0 && p.every(esAnillo)

export function reglaR1(p) {
  const formas = { Point: esPos, Polygon: esPoligono, MultiPolygon: (m) => Array.isArray(m) && m.length > 0 && m.every(esPoligono) }
  if (!(p.tipo in formas)) {
    return error(
      'R1',
      null,
      p.tipo ? `La geometría es de tipo ${p.tipo}; se esperaba Point, Polygon o MultiPolygon.` : 'La parcela no tiene geometría.',
      'Cargue la parcela como punto (hasta 4 ha) o como polígono.',
    )
  }
  if (!formas[p.tipo](p.coords)) {
    return error(
      'R1',
      null,
      'La parcela tiene coordenadas vacías o que no son números.',
      'Revise que cada punto tenga dos números: longitud y latitud.',
    )
  }
  const fuera = posiciones(p).find(({ pos: [lon, lat] }) => Math.abs(lon) > 180 || Math.abs(lat) > 90)
  if (fuera) {
    return error(
      'R1',
      null,
      `Las coordenadas no están en grados de longitud y latitud (EPSG:4326): hay valores como ${fuera.txt.join(', ')}, que parecen metros de otra proyección.`,
      'Exporte el archivo en EPSG:4326 (WGS 84, grados decimales) desde su programa de mapas y vuelva a cargarlo.',
    )
  }
  return null
}

// ---------- R3 · Orden longitud, latitud · R4 · Dentro de Honduras ----------

const enHonduras = ([lon, lat]) =>
  lon >= HONDURAS.lonMin && lon <= HONDURAS.lonMax && lat >= HONDURAS.latMin && lat <= HONDURAS.latMax

function invertirPares(p) {
  for (const { pos, txt } of posiciones(p)) {
    pos.reverse()
    txt.reverse()
  }
}

// Si leídas al revés las coordenadas caen en Honduras, la causa es el orden (R3) y
// se corrige; si no, y están fuera, es R4.
export function reglaR3yR4(p, formato) {
  const lista = posiciones(p)
  if (lista.every(({ pos }) => enHonduras(pos))) return null
  if (lista.every(({ pos: [lon, lat] }) => enHonduras([lat, lon]))) {
    invertirPares(p)
    return advertencia(
      'R3',
      ubicar(lista[0].pos),
      'La latitud y la longitud parecen invertidas: leídas al revés, la parcela cae en Honduras.',
      formato === 'csv'
        ? 'Revise que las columnas latitud y longitud no estén intercambiadas.'
        : 'Invierta el orden de cada par: GeoJSON usa [longitud, latitud]. El GeoJSON corregido ya trae los pares invertidos.',
    )
  }
  const fuera = lista.find(({ pos }) => !enHonduras(pos))
  return advertencia(
    'R4',
    ubicar(fuera.pos),
    `La parcela queda fuera de Honduras (punto ${fuera.txt.join(', ')}).`,
    'Revise las coordenadas: puede ser un error de signo o de digitación.',
  )
}

// ---------- R2 · Al menos 6 decimales ----------
// Se cuentan sobre el texto: al leer 14.500000 como número quedaría 14.5.

export function reglaR2(p) {
  let peor = null
  for (const { pos, txt } of posiciones(p)) {
    for (const t of txt) {
      const d = decimales(t)
      if (!peor || d < peor.d) peor = { d, pos, t }
    }
  }
  if (peor.d >= DECIMALES_MINIMOS) return null
  return error(
    'R2',
    ubicar(peor.pos),
    `Hay coordenadas con solo ${peor.d} decimales (por ejemplo ${peor.t}). El EUDR pide al menos ${DECIMALES_MINIMOS}.`,
    `Exporte las coordenadas con ${DECIMALES_MINIMOS} decimales o más. Si el GPS no dio esa precisión, vuelva a levantar la parcela: agregar ceros no la hace más precisa.`,
  )
}

// ---------- R9 · Parcelas de más de 4 ha como polígono ----------

export function reglaR9(p) {
  if (p.tipo !== 'Point') return null
  if (Number.isNaN(p.areaHa)) {
    return advertencia(
      'R9',
      ubicar(p.coords),
      `Punto sin área declarada: no se puede confirmar que la parcela mida ${HA_MAXIMAS_PUNTO} ha o menos.`,
      'Agregue el área en hectáreas (area_ha).',
    )
  }
  if (p.areaHa <= HA_MAXIMAS_PUNTO) return null
  return error(
    'R9',
    ubicar(p.coords),
    `Parcela de ${fmt(p.areaHa)} ha entregada como punto. Las de más de ${HA_MAXIMAS_PUNTO} ha deben ir como polígono.`,
    'Levante el borde de la parcela y cárguela como polígono.',
  )
}

// ---------- R5 · Anillo cerrado ----------
// Cierra los anillos abiertos. Devuelve también si algún anillo quedó incompleto
// (menos de 3 puntos distintos): con eso no hay polígono que revisar.

export function reglaR5(p) {
  const hallazgos = []
  let incompleto = false
  for (const a of anillos(p)) {
    if (!mismaPosicion(a.pos[0], a.pos.at(-1))) {
      a.pos.push([...a.pos[0]])
      a.txt.push([...a.txt[0]])
      hallazgos.push(
        error(
          'R5',
          ubicar(a.pos[0]),
          `El polígono${dondeEnAnillo(p, a)} no está cerrado: el último punto no repite el primero.`,
          'Agregue al final un punto igual al primero. El GeoJSON corregido ya lo cierra.',
        ),
      )
    }
    const distintos = new Set(a.pos.map((pos) => pos.join(','))).size
    if (distintos < 3) {
      incompleto = true
      hallazgos.push(
        error(
          'R5',
          ubicar(a.pos[0]),
          `El polígono${dondeEnAnillo(p, a)} tiene menos de 3 puntos distintos.`,
          'Vuelva a levantar o dibujar la parcela.',
        ),
      )
    }
  }
  return { hallazgos, incompleto }
}

// ---------- R6 · Sin autointersecciones ----------
// Se revisa sobre una copia sin vértices repetidos seguidos, porque turf.kinks
// cuenta un vértice repetido como cruce (eso ya lo marca R7).

function sinRepetidosSeguidos(anillo) {
  return anillo.filter((pos, k) => k === 0 || !mismaPosicion(pos, anillo[k - 1]))
}

function verticeMasCercano(p, [lon, lat]) {
  let mejor = null
  for (const a of anillos(p)) {
    a.pos.forEach(([x, y], k) => {
      const d = (x - lon) ** 2 + (y - lat) ** 2
      if (!mejor || d < mejor.d) mejor = { d, a, vertice: k + 1 }
    })
  }
  return mejor
}

export function reglaR6(p) {
  const limpio =
    p.tipo === 'Polygon'
      ? p.coords.map(sinRepetidosSeguidos)
      : p.coords.map((parte) => parte.map(sinRepetidosSeguidos))
  const cruces = kinks({ type: p.tipo, coordinates: limpio }).features
  if (cruces.length === 0) return null
  const punto = cruces[0].geometry.coordinates
  const { a, vertice } = verticeMasCercano(p, punto)
  return error(
    'R6',
    ubicar(punto),
    `El polígono${dondeEnAnillo(p, a)} se cruza consigo mismo cerca del vértice ${vertice}.`,
    'Revise el orden de los puntos: el borde debe recorrerse sin cruzarse.',
  )
}

// ---------- R7 · Sin vértices duplicados ----------
// Los repetidos seguidos se quitan (corrección segura). Un vértice que reaparece
// más adelante significa que el borde se toca a sí mismo: se marca y no se toca.

export function reglaR7(p) {
  const hallazgos = []
  for (const a of anillos(p)) {
    const vistos = new Map()
    const ultimo = a.pos.length - 1 // el cierre repite el primero a propósito
    a.pos.forEach((pos, k) => {
      if (k === ultimo) return
      const clave = pos.join(',')
      if (k > 0 && mismaPosicion(pos, a.pos[k - 1])) {
        hallazgos.push(
          error(
            'R7',
            ubicar(pos),
            `El vértice ${k + 1}${dondeEnAnillo(p, a)} repite al anterior.`,
            'Borre el punto repetido. El GeoJSON corregido ya lo quita.',
          ),
        )
      } else if (vistos.has(clave)) {
        hallazgos.push(
          error(
            'R7',
            ubicar(pos),
            `El vértice ${k + 1}${dondeEnAnillo(p, a)} repite al vértice ${vistos.get(clave) + 1}: el borde se toca a sí mismo.`,
            'Revise el borde de la parcela en ese punto.',
          ),
        )
      }
      if (!vistos.has(clave)) vistos.set(clave, k)
    })
    const limpio = a.pos.map((pos, k) => k === 0 || !mismaPosicion(pos, a.pos[k - 1]))
    const pos = a.pos.filter((_, k) => limpio[k])
    const txt = a.txt.filter((_, k) => limpio[k])
    a.pos.splice(0, a.pos.length, ...pos)
    a.txt.splice(0, a.txt.length, ...txt)
  }
  return hallazgos
}

// ---------- R8 · Un polígono no cubre varias parcelas ----------

export function reglaR8(p) {
  if (p.tipo !== 'MultiPolygon' || p.coords.length < 2) return null
  const partes = p.coords.map((c) => ({ type: 'Polygon', coordinates: c }))
  const separada = partes.some((a, i) => partes.every((b, j) => i === j || !booleanIntersects(a, b)))
  if (!separada) return null
  const centros = partes.map((parte) => centroid(parte))
  const lejania = Math.max(...centros.slice(1).map((c) => distance(centros[0], c, { units: 'meters' })))
  return error(
    'R8',
    ubicar(centros[0].geometry.coordinates),
    `El multipolígono tiene ${partes.length} partes separadas, a hasta unos ${fmt(Math.round(lejania))} m entre sí. Cada parcela debe tener su propia geometría.`,
    'Separe cada parte en una parcela con su propio código.',
  )
}

// ---------- R12 · Área declarada contra área calculada ----------

export function reglaR12(p, umbralPct) {
  if (!esPoligonal(p) || Number.isNaN(p.areaHa)) return null
  const calculada = area(geometria(p)) / 10000
  if (calculada === 0) return null
  const diferencia = (Math.abs(p.areaHa - calculada) / calculada) * 100
  if (diferencia <= umbralPct) return null
  return advertencia(
    'R12',
    ubicar(centroid(geometria(p)).geometry.coordinates),
    `El área declarada (${fmt(p.areaHa)} ha) difiere de la calculada (${fmt(calculada)} ha) en ${fmt(Math.round(diferencia))} %.`,
    'Revise el área declarada o el borde del polígono.',
  )
}

// ---------- R10 · Solapes · R11 · Geometrías duplicadas (entre parcelas) ----------

const CELDA_GRADOS = 0.01 // unos 1.1 km: cada parcela se compara solo con sus vecinas

function claveGeometria(p) {
  const redondeada = JSON.stringify(p.coords, (_, v) => (typeof v === 'number' ? Number(v.toFixed(7)) : v))
  return `${p.tipo}:${redondeada}`
}

export function reglaR11(parcelas) {
  const primeras = new Map()
  const hallazgos = []
  const duplicadas = new Set()
  for (const p of parcelas) {
    const clave = claveGeometria(p)
    const original = primeras.get(clave)
    if (!original) {
      primeras.set(clave, p)
      continue
    }
    duplicadas.add(`${original.indice}|${p.indice}`)
    hallazgos.push({
      parcela: p,
      ...advertencia(
        'R11',
        ubicar(p.tipo === 'Point' ? p.coords : centroid(geometria(p)).geometry.coordinates),
        `Tiene la misma geometría que la parcela ${original.etiqueta}.`,
        'Si es la misma parcela, deje un solo registro; si no, corrija la geometría.',
      ),
    })
  }
  return { hallazgos, duplicadas }
}

export function reglaR10(parcelas, duplicadas, solapeMinimoM2) {
  const poligonos = parcelas.filter(esPoligonal).map((p) => ({ p, caja: bbox(geometria(p)) }))
  const celdas = new Map()
  for (const item of poligonos) {
    const [x0, y0, x1, y1] = item.caja.map((v) => Math.floor(v / CELDA_GRADOS))
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const clave = `${x},${y}`
        if (!celdas.has(clave)) celdas.set(clave, [])
        celdas.get(clave).push(item)
      }
    }
  }

  const hallazgos = []
  const revisados = new Set()
  for (const grupo of celdas.values()) {
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const [a, b] = grupo[i].p.indice < grupo[j].p.indice ? [grupo[i], grupo[j]] : [grupo[j], grupo[i]]
        const par = `${a.p.indice}|${b.p.indice}`
        if (revisados.has(par) || duplicadas.has(par)) continue
        revisados.add(par)
        const [ax0, ay0, ax1, ay1] = a.caja
        const [bx0, by0, bx1, by1] = b.caja
        if (ax0 > bx1 || bx0 > ax1 || ay0 > by1 || by0 > ay1) continue
        let solape = null
        try {
          solape = intersect(featureCollection([feature(geometria(a.p)), feature(geometria(b.p))]))
        } catch {
          continue // geometrías que la librería no puede cruzar: ya las marcan otras reglas
        }
        const m2 = solape ? area(solape) : 0
        if (m2 <= solapeMinimoM2) continue
        hallazgos.push({
          parcela: b.p,
          ...advertencia(
            'R10',
            ubicar(centroid(solape).geometry.coordinates),
            `Se solapa con la parcela ${a.p.etiqueta} en unos ${fmt(Math.round(m2))} m².`,
            'Revise los bordes de ambas parcelas; si son la misma finca, deje una sola.',
          ),
        })
      }
    }
  }
  return hallazgos
}
