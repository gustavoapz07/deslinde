// Pruebas de la parte del mapa que no necesita MapLibre: el estilo, la capa de
// hallazgos y la ficha de una parcela. El dibujo se revisa en el navegador.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unirIndices } from '../src/lista/datos.js'
import { validarTexto } from '../src/motor/index.js'
import { capaDeHallazgos, procesar } from '../src/motor/trabajo.js'
import { CAPAS, CAPAS_CLIC, construirEstilo, esCapaPropia, fichaDeParcela } from '../src/mapa/capas.js'
import { DIR_DATOS } from '../scripts/generar-datos.js'

const informe = validarTexto(readFileSync(join(DIR_DATOS, 'errores-mezclados.geojson'), 'utf8'))

// Un estilo base mínimo con la forma del de OpenFreeMap.
const BASE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://tiles.openfreemap.org/sprites/ofm',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
  ],
}

// Todas las cadenas del estilo que parecen direcciones de internet. Las URLs
// `blob:` son locales aunque lleven "http" adentro.
const direcciones = (estilo) => JSON.stringify(estilo).match(/(?<!blob:)https?:\/\/[^"]+/g) ?? []

describe('estilo del mapa', () => {
  it('sin mapa base no pide nada a internet', () => {
    const estilo = construirEstilo({ parcelas: 'blob:http://localhost/abc', hallazgos: capaDeHallazgos(informe.resultados) })
    expect(direcciones(estilo)).toEqual([])
    expect(estilo.glyphs).toBeUndefined()
    expect(estilo.sprite).toBeUndefined()
    expect(Object.keys(estilo.sources)).toEqual(['parcelas', 'hallazgos'])
  })

  it('con mapa base, las capas propias quedan encima', () => {
    const estilo = construirEstilo({ base: BASE, parcelas: 'blob:http://localhost/abc' })
    const ids = estilo.layers.map((c) => c.id)
    expect(ids.slice(0, 2)).toEqual(['background', 'water'])
    expect(ids.slice(2)).toEqual(CAPAS.map((c) => c.id))
    expect(estilo.glyphs).toBe(BASE.glyphs)
    expect(estilo.sources.openmaptiles).toEqual(BASE.sources.openmaptiles)
    expect(estilo.sources.parcelas.data).toBe('blob:http://localhost/abc')
  })

  it('no hereda la vista del estilo base, para no perder el encuadre', () => {
    const estilo = construirEstilo({ base: { ...BASE, center: [0, 0], zoom: 1, bearing: 0, pitch: 0 } })
    for (const clave of ['center', 'zoom', 'bearing', 'pitch']) expect(estilo).not.toHaveProperty(clave)
  })

  it('no cambia el estilo base que recibe', () => {
    const copia = structuredClone(BASE)
    construirEstilo({ base: BASE })
    expect(BASE).toEqual(copia)
  })

  it('las parcelas usan el índice como id, para marcar la elegida', () => {
    expect(construirEstilo().sources.parcelas.promoteId).toBe('indice')
  })

  it('las capas propias se reconocen por su nombre y el clic cae en ellas', () => {
    expect(CAPAS.every((c) => esCapaPropia(c.id))).toBe(true)
    expect(esCapaPropia('water')).toBe(false)
    expect(CAPAS_CLIC.every((id) => CAPAS.some((c) => c.id === id))).toBe(true)
  })
})

describe('capa de hallazgos', () => {
  it('un punto por hallazgo con ubicación', () => {
    const capa = capaDeHallazgos(informe.resultados)
    const conUbicacion = informe.resultados.filter((r) => r.ubicacion)
    expect(capa.features).toHaveLength(conUbicacion.length)
    expect(capa.features[0].geometry).toEqual({ type: 'Point', coordinates: conUbicacion[0].ubicacion })
    expect(capa.features[0].properties).toEqual({ parcela: conUbicacion[0].parcela, regla: conUbicacion[0].regla, severidad: conUbicacion[0].severidad })
  })

  it('el worker la entrega lista como Blob', async () => {
    const { archivos, informe: inf } = procesar(readFileSync(join(DIR_DATOS, 'errores-mezclados.geojson'), 'utf8'))
    expect(JSON.parse(await archivos.hallazgos.text())).toEqual(capaDeHallazgos(inf.resultados))
  })

  it('un hallazgo sin ubicación no se dibuja', () => {
    const capa = capaDeHallazgos([{ parcela: 'P-1', regla: 'R1', severidad: 'error', ubicacion: null, mensaje: '', accion: '' }])
    expect(capa.features).toEqual([])
  })
})

describe('ficha de una parcela', () => {
  const texto = readFileSync(join(DIR_DATOS, 'errores-mezclados.geojson'), 'utf8')
  const { informe: inf, indices } = procesar(texto)
  const hallazgos = unirIndices(inf.resultados, indices)
  const indiceDe = (id) => hallazgos.find((h) => h.parcela === id).indice

  it('trae el estado y los hallazgos de esa parcela', () => {
    const ficha = fichaDeParcela(indiceDe('P-E01'), hallazgos, 'P-E01')
    expect(ficha.titulo).toBe('P-E01')
    expect(ficha.estado).toBe('Con errores')
    expect(ficha.hallazgos.map((h) => h.regla)).toEqual(['R6'])
    expect(ficha.hallazgos[0].mensaje).toMatch(/se cruza consigo mismo/)
  })

  it('desde la lista, sin código a mano, lo toma de los hallazgos', () => {
    const ficha = fichaDeParcela(indiceDe('P-E14'), hallazgos)
    expect(ficha.titulo).toBe('P-E14')
    expect(ficha.estado).toBe('Solo advertencias')
  })

  it('una parcela sin hallazgos lo dice', () => {
    const ficha = fichaDeParcela(0, hallazgos, 'P-00001')
    expect(ficha.estado).toBe('Sin hallazgos')
    expect(ficha.hallazgos).toEqual([])
  })

  it('dos parcelas con el mismo código no mezclan sus hallazgos', () => {
    const repetidas = [
      { parcela: 'P-1', indice: 0, regla: 'R2', severidad: 'error', ubicacion: [-88, 14.5], mensaje: 'a', accion: '' },
      { parcela: 'P-1', indice: 1, regla: 'R12', severidad: 'advertencia', ubicacion: [-88, 14.6], mensaje: 'b', accion: '' },
    ]
    expect(fichaDeParcela(1, repetidas).hallazgos.map((h) => h.regla)).toEqual(['R12'])
    expect(fichaDeParcela(1, repetidas).estado).toBe('Solo advertencias')
  })
})
