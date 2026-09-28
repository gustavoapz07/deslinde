// Casos de prueba de v0. Numeración igual a "Alcance del MVP" en la bóveda.
// Se escribieron en la Fase 0, antes del motor: hasta la Fase 1 todos fallan.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validarTexto } from '../src/motor/index.js'
import { DIR_DATOS } from '../scripts/generar-datos.js'

function validarArchivo(ruta) {
  const texto = readFileSync(join(DIR_DATOS, ruta), 'utf8')
  return validarTexto(texto, { formato: ruta.endsWith('.csv') ? 'csv' : 'geojson' })
}

const de = (informe, parcela) => informe.resultados.filter((r) => r.parcela === parcela)

function esperarRegla(informe, parcela, regla, severidad) {
  const resultado = de(informe, parcela).find((r) => r.regla === regla)
  expect(resultado, `${parcela} debería marcar ${regla}`).toBeDefined()
  expect(resultado.severidad).toBe(severidad)
  return resultado
}

describe('casos de v0, uno por regla', () => {
  it('01 · R6: polígono que se cruza a sí mismo → error', () => {
    esperarRegla(validarArchivo('casos/01-autointerseccion.geojson'), 'P-E01', 'R6', 'error')
  })

  it('02 · R5: anillo sin cerrar → error', () => {
    esperarRegla(validarArchivo('casos/02-anillo-sin-cerrar.geojson'), 'P-E02', 'R5', 'error')
  })

  it('03 · R2: coordenadas con 5 decimales → error', () => {
    esperarRegla(validarArchivo('casos/03-cinco-decimales.geojson'), 'P-E03', 'R2', 'error')
  })

  it('04 · R3: latitud y longitud invertidas → advertencia con sugerencia', () => {
    const informe = validarArchivo('casos/04-latitud-longitud-invertidas.geojson')
    const r = esperarRegla(informe, 'P-E04', 'R3', 'advertencia')
    expect(r.accion).toMatch(/invert/i)
    // Leídas al revés caen fuera de Honduras, pero la causa es el orden: no se repite como R4.
    expect(de(informe, 'P-E04').map((x) => x.regla)).not.toContain('R4')
  })

  it('05 · R9: parcela de más de 4 ha entregada como punto → error', () => {
    esperarRegla(validarArchivo('casos/05-punto-mayor-a-4-ha.geojson'), 'P-E05', 'R9', 'error')
  })

  it('06 · R8: multipolígono con partes alejadas → error', () => {
    esperarRegla(validarArchivo('casos/06-multipoligono-partes-alejadas.geojson'), 'P-E06', 'R8', 'error')
  })

  it('07 · R10: dos parcelas solapadas → advertencia', () => {
    const informe = validarArchivo('casos/07-parcelas-solapadas.geojson')
    const r = informe.resultados.find((x) => x.regla === 'R10')
    expect(r, 'debería marcar R10').toBeDefined()
    expect(['P-E07A', 'P-E07B']).toContain(r.parcela)
    expect(r.severidad).toBe('advertencia')
  })

  it('08 · R4: parcela fuera de Honduras → advertencia', () => {
    esperarRegla(validarArchivo('casos/08-fuera-de-honduras.geojson'), 'P-E08', 'R4', 'advertencia')
  })

  it('09 · archivo válido → informe sin errores', () => {
    const informe = validarArchivo('valido.geojson')
    expect(informe.parcelas).toBe(25)
    expect(informe.resultados).toEqual([])
  })

  // "Sin congelar el navegador" se comprueba en la Fase 2 con el Web Worker.
  // Aquí solo se mide el motor. El umbral de 5 s es [hipótesis].
  it('10 · 10,000 parcelas → termina en menos de 5 s', () => {
    const inicio = performance.now()
    const informe = validarArchivo('grande-10000.geojson')
    const ms = performance.now() - inicio
    expect(informe.parcelas).toBe(10000)
    expect(informe.resultados).toEqual([])
    expect(ms).toBeLessThan(5000)
  }, 30000)

  it('11 · R1: coordenadas en metros, no en EPSG:4326 → error', () => {
    const informe = validarArchivo('casos/11-coordenadas-proyectadas.geojson')
    esperarRegla(informe, 'P-E11', 'R1', 'error')
    // Si el sistema de coordenadas está mal, las demás reglas no tienen sentido.
    expect(de(informe, 'P-E11').map((x) => x.regla)).toEqual(['R1'])
  })

  it('12 · R7: vértice duplicado → error', () => {
    esperarRegla(validarArchivo('casos/12-vertice-duplicado.geojson'), 'P-E12', 'R7', 'error')
  })

  it('13 · R11: dos parcelas con la misma geometría → advertencia', () => {
    const informe = validarArchivo('casos/13-geometria-duplicada.geojson')
    const r = informe.resultados.find((x) => x.regla === 'R11')
    expect(r, 'debería marcar R11').toBeDefined()
    expect(['P-E13A', 'P-E13B']).toContain(r.parcela)
    expect(r.severidad).toBe('advertencia')
  })

  it('14 · R12: área declarada muy distinta de la calculada → advertencia', () => {
    esperarRegla(validarArchivo('casos/14-area-declarada-distinta.geojson'), 'P-E14', 'R12', 'advertencia')
  })
})

describe('archivo con errores mezclados', () => {
  const esperados = {
    'P-E01': 'R6',
    'P-E02': 'R5',
    'P-E03': 'R2',
    'P-E04': 'R3',
    'P-E05': 'R9',
    'P-E06': 'R8',
    'P-E08': 'R4',
    'P-E11': 'R1',
    'P-E12': 'R7',
    'P-E14': 'R12',
  }

  it('marca cada parcela con su regla y deja limpias las válidas', () => {
    const informe = validarArchivo('errores-mezclados.geojson')
    expect(informe.parcelas).toBe(24) // 10 válidas y 14 de los casos
    for (const [parcela, regla] of Object.entries(esperados)) {
      expect(de(informe, parcela).map((r) => r.regla), parcela).toContain(regla)
    }
    const reglasDe = (ids) => informe.resultados.filter((r) => ids.includes(r.parcela)).map((r) => r.regla)
    expect(reglasDe(['P-E07A', 'P-E07B'])).toContain('R10')
    expect(reglasDe(['P-E13A', 'P-E13B'])).toContain('R11')
    const validas = informe.resultados.filter((r) => /^P-\d{5}$/.test(r.parcela))
    expect(validas).toEqual([])
  })

  it('cada resultado trae parcela, regla, severidad, ubicación, mensaje y qué hacer', () => {
    const { resultados } = validarArchivo('errores-mezclados.geojson')
    expect(resultados.length).toBeGreaterThan(0)
    for (const r of resultados) {
      expect(r.parcela).toMatch(/^P-/)
      expect(r.regla).toMatch(/^R([1-9]|1[0-2])$/)
      expect(['error', 'advertencia']).toContain(r.severidad)
      if (r.ubicacion !== null) {
        expect(r.ubicacion).toHaveLength(2)
        r.ubicacion.forEach((n) => expect(Number.isFinite(n)).toBe(true))
      }
      expect(r.mensaje.length).toBeGreaterThan(0)
      expect(r.accion.length).toBeGreaterThan(0)
    }
  })
})

describe('CSV de puntos', () => {
  it('un CSV válido → informe sin errores', () => {
    const informe = validarArchivo('valido-puntos.csv')
    expect(informe.parcelas).toBe(15)
    expect(informe.resultados).toEqual([])
  })
})
