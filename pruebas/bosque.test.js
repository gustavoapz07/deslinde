// Pruebas de R15, el bosque de 2020 (parte 6c de la v1). Deslinde compara cada
// parcela con el mapa de bosque 2020 de la UE (GFC2020 v4), que pide al WMS de
// la JRC en recortes fijos ("celdas") de 0.05°. Aquí la consulta se reemplaza
// por máscaras armadas a mano: la de verdad se prueba en el navegador.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { textoGeoJSON } from '../scripts/generar-datos.js'
import { construirEstilo, CAPAS } from '../src/mapa/capas.js'
import {
  CAPA_WMS,
  celdasParaParcelas,
  claveDeCelda,
  mascaraDePixeles,
  PIXELES_POR_CELDA as N,
  revisarBosque,
  urlDeCelda,
  WMS_BOSQUE,
} from '../src/motor/bosque.js'
import { analizar, analizarConBosque, informeCSV } from '../src/motor/index.js'
import { procesarConBosque } from '../src/motor/trabajo.js'

// La celda que va de -88.20 a -88.15 de longitud y de 14.40 a 14.45 de latitud.
const CELDA = { x: -1764, y: 288 }
const OESTE = -88.2
const SUR = 14.4

// Un cuadrado de `lado` grados con la esquina suroeste en (lon, lat).
const cuadrado = (lon, lat, lado = 0.001) => [
  [lon, lat],
  [lon + lado, lat],
  [lon + lado, lat + lado],
  [lon, lat + lado],
  [lon, lat],
]
const parcela = (id, coordinates, tipo = 'Polygon') => ({
  type: 'Feature',
  properties: { id },
  geometry: { type: tipo, coordinates },
})
const revisadas = (features) => analizar(textoGeoJSON(features))

// Máscaras de una celda: fila 0 al norte, columna 0 al oeste.
const llena = (valor) => new Uint8Array(N * N).fill(valor)
function mitadOeste() {
  const m = new Uint8Array(N * N)
  for (let fila = 0; fila < N; fila++) m.fill(1, fila * N, fila * N + Math.floor(N / 2))
  return m
}
const LON_MITAD = OESTE + Math.floor(N / 2) / (20 * N) // borde entre la mitad con bosque y la sin bosque

const conMascara = (mascara) => new Map([[claveDeCelda(CELDA), mascara]])

describe('celdas y consulta al WMS', () => {
  it('cada parcela pide las celdas que toca, sin repetir', () => {
    const { parcelas, estados } = revisadas([
      parcela('A', [cuadrado(-88.19, 14.41)]),
      parcela('B', [cuadrado(-88.18, 14.42)]), // la misma celda
      parcela('C', [cuadrado(-88.1505, 14.41)]), // cruza al este: dos celdas
    ])
    const celdas = celdasParaParcelas(parcelas, estados).map(claveDeCelda)
    expect(celdas).toEqual(['-1764,288', '-1763,288'])
  })

  it('una parcela que no se puede dibujar no pide nada', () => {
    const { parcelas, estados } = revisadas([parcela('M', [403000.12, 1614000.34], 'Point')])
    expect(celdasParaParcelas(parcelas, estados)).toEqual([])
  })

  it('la consulta pide la capa v4 de la celda, píxel a píxel con el mapa original, en PNG', () => {
    const url = new URL(urlDeCelda(CELDA))
    expect(`${url.origin}${url.pathname}`).toBe(WMS_BOSQUE)
    const p = Object.fromEntries(url.searchParams)
    expect(p).toMatchObject({
      SERVICE: 'WMS',
      REQUEST: 'GetMap',
      LAYERS: CAPA_WMS,
      SRS: 'EPSG:4326',
      BBOX: '-88.20,14.40,-88.15,14.45',
      WIDTH: String(N),
      HEIGHT: String(N),
      FORMAT: 'image/png',
    })
    expect(CAPA_WMS).toBe('gfc2020_v4')
    // El GeoTIFF oficial tiene píxeles de 1/12000 de grado (unos 9 m), con origen
    // en grados enteros: una celda de 0.05° son justo 600 píxeles, sin remuestrear.
    expect(N).toBe(600)
    expect(0.05 / N).toBeCloseTo(1 / 12000, 12)
  })

  it('un píxel es bosque si no es transparente', () => {
    // Verde del WMS, transparente y un verde a medio cubrir.
    const rgba = new Uint8ClampedArray([77, 146, 33, 255, 0, 0, 0, 0, 77, 146, 33, 100])
    expect([...mascaraDePixeles(rgba, 3, 1)]).toEqual([1, 0, 0])
  })
})

describe('R15 por parcela', () => {
  it('una parcela dentro del bosque: R15 con el 100 %', () => {
    const { parcelas, estados } = revisadas([parcela('A', [cuadrado(-88.19, 14.41)])])
    const [h] = revisarBosque(parcelas, estados, conMascara(llena(1)))
    expect(h).toMatchObject({ regla: 'R15', severidad: 'advertencia' })
    expect(h.mensaje).toMatch(/^El 100 % de la parcela \(unas 1\.\d+ ha\) cae en bosque de 2020/)
    expect(h.mensaje).toMatch(/GFC2020/)
    expect(h.accion).toMatch(/café con sombra/)
  })

  it('sin bosque, nada', () => {
    const { parcelas, estados } = revisadas([parcela('A', [cuadrado(-88.19, 14.41)])])
    expect(revisarBosque(parcelas, estados, conMascara(llena(0)))).toEqual([])
  })

  it('media parcela en bosque: cerca del 50 %, y el punto del aviso cae en la parte con bosque', () => {
    const { parcelas, estados } = revisadas([parcela('A', [cuadrado(LON_MITAD - 0.0005, 14.41)])])
    const [h] = revisarBosque(parcelas, estados, conMascara(mitadOeste()))
    const pct = Number(h.mensaje.match(/El (\d+) %/)[1])
    expect(pct).toBeGreaterThanOrEqual(45)
    expect(pct).toBeLessThanOrEqual(55)
    expect(h.ubicacion[0]).toBeLessThan(LON_MITAD)
  })

  it('un punto en bosque lo dice; fuera del bosque, nada', () => {
    const { parcelas, estados } = revisadas([
      parcela('P1', [LON_MITAD - 0.001, 14.41], 'Point'),
      parcela('P2', [LON_MITAD + 0.001, 14.41], 'Point'),
    ])
    const hallazgos = revisarBosque(parcelas, estados, conMascara(mitadOeste()))
    expect(hallazgos.map((h) => h.parcela.etiqueta)).toEqual(['P1'])
    expect(hallazgos[0].mensaje).toMatch(/punto/)
  })

  it('el bosque dentro de un hueco de la parcela no cuenta', () => {
    // Una parcela que asoma un poco al bosque, con un hueco grande justo en esa parte.
    const exterior = cuadrado(LON_MITAD - 0.0004, 14.41, 0.002)
    const [o, s, e, n] = [LON_MITAD - 0.00035, 14.4103, LON_MITAD - 0.00005, 14.4117]
    const hueco = [[o, s], [o, n], [e, n], [e, s], [o, s]]
    const revisar = (anillos) => {
      const { parcelas, estados } = revisadas([parcela('A', anillos)])
      return revisarBosque(parcelas, estados, conMascara(mitadOeste()))
    }
    const pct = (r) => Number(r[0].mensaje.match(/El (\d+) %/)[1])
    const sinHueco = pct(revisar([exterior]))
    const conHueco = pct(revisar([exterior, hueco]))
    expect(sinHueco).toBeGreaterThanOrEqual(15)
    expect(conHueco).toBeLessThan(sinHueco - 5)
  })

  it('una parcela que se cruza consigo misma (R6) no se revisa: su área no significa nada', () => {
    const mono = [[-88.19, 14.41], [-88.189, 14.411], [-88.189, 14.41], [-88.19, 14.411], [-88.19, 14.41]]
    const { parcelas, estados } = revisadas([parcela('X', [mono])])
    expect(estados[0].cruzada).toBe(true)
    expect(revisarBosque(parcelas, estados, conMascara(llena(1)))).toEqual([])
  })

  it('una parcela muy chica, sin ningún centro de píxel adentro, se mira en su centro', () => {
    const { parcelas, estados } = revisadas([parcela('Chica', [cuadrado(-88.19003, 14.41003, 0.00003)])])
    const [h] = revisarBosque(parcelas, estados, conMascara(llena(1)))
    expect(h.mensaje).toMatch(/El 100 %/)
  })
})

describe('revisión con bosque', () => {
  const archivo = () =>
    textoGeoJSON([
      parcela('A', [cuadrado(-88.19, 14.41)]),
      { ...parcela('B', [cuadrado(-88.18, 14.42)]), _decimales: 5 }, // también R2
      parcela('C', [cuadrado(-88.1505, 14.41)]), // cruza a otra celda, sin bosque
    ])

  it('suma R15 al informe, en su orden, y cuenta las parcelas de nuevo', async () => {
    const consultadas = []
    const consultarCelda = async (celda) => {
      consultadas.push(claveDeCelda(celda))
      return celda.x === CELDA.x ? llena(1) : llena(0)
    }
    const { informe, estados, bosque } = await analizarConBosque(archivo(), { consultarCelda })
    expect(informe.resultados.map((r) => [r.parcela, r.regla])).toEqual([
      ['A', 'R15'],
      ['B', 'R2'],
      ['B', 'R15'],
      ['C', 'R15'], // su parte oeste cae en la celda con bosque
    ])
    expect(estados.map((e) => e.severidad)).toEqual(['advertencia', 'error', 'advertencia'])
    expect(informe.resumen).toEqual({ errores: 1, advertencias: 3, parcelasConErrores: 1 })
    expect(bosque).toEqual({ revisado: true, celdas: 2, parcelasConBosque: 3 })
    expect(consultadas).toEqual(['-1764,288', '-1763,288'])
  })

  it('avisa el avance de la consulta, celda por celda', async () => {
    const avances = []
    await analizarConBosque(archivo(), { consultarCelda: async () => llena(0), alAvanzar: (a) => avances.push(a) })
    const bosque = avances.filter((a) => a.fase === 'bosque')
    expect(bosque.at(0)).toEqual({ fase: 'bosque', hechas: 0, total: 2 })
    expect(bosque.at(-1)).toEqual({ fase: 'bosque', hechas: 2, total: 2 })
  })

  it('no pide más de unas pocas celdas a la vez', async () => {
    const muchas = textoGeoJSON(Array.from({ length: 12 }, (_, i) => parcela(`P${i}`, [cuadrado(-88.19 + i * 0.05, 14.41)])))
    let activas = 0
    let maximo = 0
    const consultarCelda = async () => {
      maximo = Math.max(maximo, ++activas)
      await new Promise((r) => setTimeout(r, 5))
      activas--
      return llena(0)
    }
    const { bosque } = await analizarConBosque(muchas, { consultarCelda })
    expect(bosque.celdas).toBe(12)
    expect(maximo).toBeLessThanOrEqual(4)
  })

  it('si el servicio no responde, lo dice y el resto del informe sigue igual', async () => {
    const sinBosque = analizar(archivo())
    const { informe, bosque } = await analizarConBosque(archivo(), {
      consultarCelda: async () => {
        throw new Error('HTTP 503')
      },
    })
    expect(informe).toEqual(sinBosque.informe)
    expect(bosque.revisado).toBe(false)
    expect(bosque.error).toMatch(/mapa de bosque de la UE/)
  })

  it('el informe CSV y la capa de hallazgos llevan R15', async () => {
    const resultado = await procesarConBosque(archivo(), { consultarCelda: async () => llena(1) })
    expect(informeCSV(resultado.informe)).toMatch(/\nA,,R15,advertencia,/)
    const capa = JSON.parse(await resultado.archivos.hallazgos.text())
    expect(capa.features.filter((f) => f.properties.regla === 'R15')).toHaveLength(3)
    expect(resultado.bosque.revisado).toBe(true)
  })
})

describe('el bosque en el mapa y en la política de seguridad', () => {
  it('sin pedirlo, el mapa no consulta a la UE', () => {
    expect(JSON.stringify(construirEstilo())).not.toMatch(/jrc/)
  })

  it('con la revisión de bosque, el mapa dibuja la capa de la UE debajo de las parcelas', () => {
    const estilo = construirEstilo({ bosque: true })
    const fuente = estilo.sources.bosque
    expect(fuente.type).toBe('raster')
    expect(fuente.tiles[0]).toMatch(/^https:\/\/ies-ows\.jrc\.ec\.europa\.eu\/iforce\/gfc2020\/wms\.py\?/)
    expect(fuente.tiles[0]).toMatch(/SRS=EPSG:3857/)
    expect(fuente.tiles[0]).toMatch(/BBOX=\{bbox-epsg-3857\}/)
    expect(fuente.tiles[0]).toMatch(/LAYERS=gfc2020_v4/)
    expect(fuente.attribution).toMatch(/JRC/)
    const ids = estilo.layers.map((c) => c.id)
    expect(ids.indexOf('deslinde-bosque')).toBeLessThan(ids.indexOf(CAPAS[0].id))
  })

  it('la política de seguridad deja consultar el WMS de la JRC, y nada más nuevo', () => {
    const csp = readFileSync('public/_headers', 'utf8').match(/Content-Security-Policy: (.+)/)[1]
    const directiva = (nombre) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(nombre))
    expect(directiva('connect-src')).toBe("connect-src 'self' blob: https://tiles.openfreemap.org https://ies-ows.jrc.ec.europa.eu")
    expect(directiva('img-src')).toBe("img-src 'self' data: blob: https://ies-ows.jrc.ec.europa.eu")
  })
})
