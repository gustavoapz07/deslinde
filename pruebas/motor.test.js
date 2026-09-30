// Pruebas de los bordes del motor y de sus salidas. Los casos por regla están en
// casos.test.js; aquí van los detalles de lectura, correcciones y formatos.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ErrorDeArchivo, geojsonCorregido, informeCSV, validarTexto } from '../src/motor/index.js'
import { decimales } from '../src/motor/lector.js'
import { DIR_DATOS } from '../scripts/generar-datos.js'

const archivo = (ruta) => readFileSync(join(DIR_DATOS, ruta), 'utf8')
const reglas = (informe) => informe.resultados.map((r) => r.regla)

// Parcelas escritas a mano, en la zona sintética de Honduras. Las coordenadas van
// como texto para controlar exactamente los decimales.
const coleccion = (...features) => `{"type":"FeatureCollection","features":[${features.join(',')}]}`
const parcela = (id, geometria, extra = '') =>
  `{"type":"Feature","properties":{"id":"${id}"${extra}},"geometry":${geometria}}`
const poligono = (...pares) => `{"type":"Polygon","coordinates":[[${pares.map((p) => `[${p}]`).join(',')}]]}`

// Un cuadrado de casi 1 ha, sin área declarada (así R12 no interviene).
const A = '-88.000000,14.500000'
const B = '-87.999100,14.500000'
const C = '-87.999100,14.500900'
const D = '-88.000000,14.500900'

describe('lectura', () => {
  it('cuenta los decimales escritos, no los del número', () => {
    expect(decimales('14.500000')).toBe(6)
    expect(decimales('-88.19186')).toBe(5)
    expect(decimales('-88')).toBe(0)
    expect(decimales('1.5e-3')).toBe(4)
  })

  it('14.500000 cumple R2 aunque como número sea 14.5', () => {
    const informe = validarTexto(coleccion(parcela('P-1', poligono(A, B, C, D, A))))
    expect(informe.resultados).toEqual([])
  })

  it('14.5 escrito así no cumple R2', () => {
    const corto = poligono('-88.000000,14.5', B, C, D, '-88.000000,14.5')
    expect(reglas(validarTexto(coleccion(parcela('P-1', corto))))).toEqual(['R2'])
  })

  it('una parcela sin id recibe un código de reserva', () => {
    const informe = validarTexto(coleccion(`{"type":"Feature","properties":{},"geometry":${poligono(A, B, C, D)}}`))
    expect(informe.resultados[0].parcela).toBe('sin código (n.º 1)')
  })

  it('un archivo que no es JSON da un error claro', () => {
    expect(() => validarTexto('esto no es un geojson')).toThrow(ErrorDeArchivo)
  })

  it('un JSON que no es un FeatureCollection da un error claro', () => {
    expect(() => validarTexto('{"type":"Point","coordinates":[-88,14.5]}')).toThrow(/FeatureCollection/)
  })

  it('un CSV sin columnas de latitud y longitud da un error claro', () => {
    expect(() => validarTexto('id,x,y\nP-1,1,2\n', { formato: 'csv' })).toThrow(/latitud/)
  })

  it('un CSV con punto y coma y columnas intercambiadas → R3 con mensaje para CSV', () => {
    const csv = 'id;latitud;longitud;area_ha\nP-1;-88.000000;14.500000;1.00\n'
    const [r] = validarTexto(csv, { formato: 'csv' }).resultados
    expect(r.regla).toBe('R3')
    expect(r.accion).toMatch(/columnas/)
  })
})

describe('reglas: bordes', () => {
  it('R1 · una línea no es una parcela', () => {
    const linea = '{"type":"LineString","coordinates":[[-88.000000,14.500000],[-87.999100,14.500000]]}'
    expect(reglas(validarTexto(coleccion(parcela('P-1', linea))))).toEqual(['R1'])
  })

  it('R1 · una parcela sin geometría', () => {
    expect(reglas(validarTexto(coleccion(parcela('P-1', 'null'))))).toEqual(['R1'])
  })

  it('R5 · un anillo con menos de 3 puntos distintos se marca sin romper el motor', () => {
    const informe = validarTexto(coleccion(parcela('P-1', poligono(A, B, A))))
    expect(reglas(informe)).toEqual(['R5'])
    expect(informe.resultados[0].mensaje).toMatch(/menos de 3/)
  })

  it('R7 · un vértice que reaparece más adelante: el borde se toca a sí mismo', () => {
    const E = '-87.998200,14.500900'
    const informe = validarTexto(coleccion(parcela('P-1', poligono(A, B, E, C, B, D, A))))
    const r7 = informe.resultados.find((r) => r.regla === 'R7')
    expect(r7?.mensaje).toMatch(/se toca/)
  })

  it('R9 · un punto sin área declarada → advertencia', () => {
    const punto = '{"type":"Point","coordinates":[-88.000000,14.500000]}'
    const [r] = validarTexto(coleccion(parcela('P-1', punto))).resultados
    expect(r).toMatchObject({ regla: 'R9', severidad: 'advertencia' })
  })

  it('R10 · parcelas que solo comparten un borde no se solapan', () => {
    const E = '-87.998200,14.500000'
    const F = '-87.998200,14.500900'
    const informe = validarTexto(coleccion(parcela('P-1', poligono(A, B, C, D, A)), parcela('P-2', poligono(B, E, F, C, B))))
    expect(informe.resultados).toEqual([])
  })

  it('R10 · una parcela solapada con dos vecinas lleva un aviso por vecina, en el orden del archivo', () => {
    // P-2 cruza a P-1 por la izquierda y a P-3 por la derecha; P-1 y P-3 no se tocan.
    const G = '-87.998500,14.500000'
    const H = '-87.998500,14.500900'
    const I = '-87.999400,14.500000'
    const J = '-87.999400,14.500900'
    const K = '-87.997600,14.500000'
    const L = '-87.997600,14.500900'
    const informe = validarTexto(
      coleccion(
        parcela('P-1', poligono(A, B, C, D, A)),
        parcela('P-2', poligono(I, G, H, J, I)),
        parcela('P-3', poligono('-87.998800,14.500000', K, L, '-87.998800,14.500900', '-87.998800,14.500000')),
      ),
    )
    const r10 = informe.resultados.filter((r) => r.regla === 'R10')
    expect(r10.map((r) => r.parcela)).toEqual(['P-1', 'P-2', 'P-2', 'P-3'])
    expect(r10.map((r) => r.mensaje.match(/parcela (P-\d)/)[1])).toEqual(['P-2', 'P-1', 'P-3', 'P-2'])
    // Las dos caras de un mismo solape señalan el mismo lugar.
    expect(r10[0].ubicacion).toEqual(r10[1].ubicacion)
  })

  it('R11 · tres copias de la misma parcela: un aviso para cada una, que nombra a las otras', () => {
    const cuadrado = poligono(A, B, C, D, A)
    const informe = validarTexto(coleccion(parcela('P-1', cuadrado), parcela('P-2', cuadrado), parcela('P-3', cuadrado)))
    expect(informe.resultados.map((r) => [r.parcela, r.regla])).toEqual([
      ['P-1', 'R11'],
      ['P-2', 'R11'],
      ['P-3', 'R11'],
    ])
    expect(informe.resultados[0].mensaje).toMatch(/parcelas P-2 y P-3/)
    expect(informe.resultados[2].mensaje).toMatch(/parcelas P-1 y P-2/)
  })
})

describe('salidas', () => {
  it('el informe CSV lleva BOM, cabecera y una fila por hallazgo', () => {
    const informe = validarTexto(archivo('errores-mezclados.geojson'))
    const csv = informeCSV(informe)
    expect(csv.startsWith('﻿')).toBe(true)
    const filas = csv.slice(1).split('\r\n').filter(Boolean)
    expect(filas[0]).toBe('parcela,regla,severidad,longitud,latitud,mensaje,accion')
    expect(filas).toHaveLength(informe.resultados.length + 1)
    // El mensaje de R4 lleva una coma: va entre comillas.
    expect(csv).toContain('"La parcela queda fuera de Honduras (punto -84.000000, 10.000000)."')
  })

  it('el GeoJSON corregido de un archivo válido es igual al original', () => {
    const original = archivo('valido.geojson')
    const corregido = geojsonCorregido(original)
    expect(JSON.parse(corregido)).toEqual(JSON.parse(original))
    expect(validarTexto(corregido).resultados).toEqual([])
  })

  it('el GeoJSON corregido ya no trae R3, R5 ni R7, y conserva lo que no se corrige solo', () => {
    const informe = validarTexto(geojsonCorregido(archivo('errores-mezclados.geojson')))
    expect(informe.parcelas).toBe(24)
    const quedan = new Set(reglas(informe))
    for (const regla of ['R3', 'R5', 'R7']) expect(quedan.has(regla), regla).toBe(false)
    for (const regla of ['R1', 'R2', 'R4', 'R6', 'R8', 'R9', 'R10', 'R11', 'R12']) expect(quedan.has(regla), regla).toBe(true)
  })

  it('el GeoJSON corregido no agrega decimales que el archivo no traía', () => {
    const corregido = geojsonCorregido(archivo('casos/03-cinco-decimales.geojson'))
    expect(corregido).toContain('-88.19186')
    expect(reglas(validarTexto(corregido))).toEqual(['R2'])
  })

  it('un CSV de puntos sale convertido a GeoJSON válido', () => {
    const corregido = geojsonCorregido(archivo('valido-puntos.csv'), { formato: 'csv' })
    const informe = validarTexto(corregido)
    expect(informe.parcelas).toBe(15)
    expect(informe.resultados).toEqual([])
  })
})
