// Pruebas de los datos de la lista de hallazgos: filtros, conteo por regla y
// cuántos mostrar. La lista dibujada y su enlace con el mapa se revisan en el navegador.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { conteoPorRegla, filtrar, NOMBRES_DE_REGLA, peorSeveridad, TAMANO_PAGINA, tramoPara, unirIndices } from '../src/lista/datos.js'
import { procesar } from '../src/motor/trabajo.js'
import { DIR_DATOS } from '../scripts/generar-datos.js'

const archivo = (ruta) => readFileSync(join(DIR_DATOS, ruta), 'utf8')
const { informe, indices, archivos } = procesar(archivo('errores-mezclados.geojson'))
const hallazgos = unirIndices(informe.resultados, indices)

describe('hallazgos con la posición de su parcela', () => {
  it('cada hallazgo apunta a la parcela correcta del archivo', async () => {
    const mapa = JSON.parse(await archivos.mapa.text())
    const idDe = new Map(mapa.features.map((f) => [f.properties.indice, f.properties.id]))
    expect(indices).toHaveLength(informe.resultados.length)
    for (const h of hallazgos) {
      if (idDe.has(h.indice)) expect(idDe.get(h.indice)).toBe(h.parcela)
    }
    // La de R1 no se dibuja, pero igual trae su posición.
    expect(Number.isInteger(hallazgos.find((h) => h.regla === 'R1').indice)).toBe(true)
  })

  it('no cambia los resultados del informe', () => {
    expect(hallazgos.map(({ indice, ...r }) => r)).toEqual(informe.resultados)
  })
})

describe('filtros', () => {
  it('cuenta los hallazgos por regla, en orden de R1 a R12', () => {
    const conteo = conteoPorRegla(hallazgos)
    expect(conteo.map((c) => c.regla)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12'])
    expect(conteo.reduce((suma, c) => suma + c.cantidad, 0)).toBe(hallazgos.length)
    expect(conteo.every((c) => NOMBRES_DE_REGLA[c.regla])).toBe(true)
  })

  it('R10 va después de R9, no después de R1', () => {
    const conteo = conteoPorRegla([{ regla: 'R10' }, { regla: 'R9' }, { regla: 'R1' }])
    expect(conteo.map((c) => c.regla)).toEqual(['R1', 'R9', 'R10'])
  })

  it('filtra por severidad y por regla', () => {
    expect(filtrar(hallazgos)).toHaveLength(hallazgos.length)
    expect(filtrar(hallazgos, { severidad: 'error' })).toHaveLength(informe.resumen.errores)
    expect(filtrar(hallazgos, { severidad: 'advertencia' })).toHaveLength(informe.resumen.advertencias)
    expect(filtrar(hallazgos, { regla: 'R6' }).map((h) => h.parcela)).toEqual(['P-E01'])
    expect(filtrar(hallazgos, { severidad: 'advertencia', regla: 'R6' })).toEqual([])
  })
})

describe('peor severidad', () => {
  it('error si hay alguno, advertencia si solo hay advertencias, ok si no hay nada', () => {
    expect(peorSeveridad([{ severidad: 'advertencia' }, { severidad: 'error' }])).toBe('error')
    expect(peorSeveridad([{ severidad: 'advertencia' }])).toBe('advertencia')
    expect(peorSeveridad([])).toBe('ok')
  })
})

describe('tramo que se dibuja', () => {
  // 10,000 hallazgos de 10,000 parcelas distintas.
  const muchos = Array.from({ length: 10000 }, (_, i) => ({ indice: i, regla: 'R2', severidad: 'error' }))
  const inicial = { desde: 0, hasta: TAMANO_PAGINA }

  it('si la parcela ya se ve, no cambia', () => {
    expect(tramoPara(muchos, 10, inicial)).toBe(inicial)
  })

  it('si está más abajo, salta a su página sin dibujar las anteriores', () => {
    expect(tramoPara(muchos, 150, inicial)).toEqual({ desde: 100, hasta: 200 })
    const alFinal = tramoPara(muchos, 9901, inicial)
    expect(alFinal).toEqual({ desde: 9900, hasta: 10000 })
    expect(alFinal.hasta - alFinal.desde).toBe(TAMANO_PAGINA)
  })

  it('si está más arriba del tramo, también salta', () => {
    expect(tramoPara(muchos, 5, { desde: 300, hasta: 400 })).toEqual({ desde: 0, hasta: 100 })
  })

  it('si el filtro la deja fuera, no cambia', () => {
    const tramo = { desde: 200, hasta: 300 }
    expect(tramoPara(muchos, 99999, tramo)).toBe(tramo)
  })
})
