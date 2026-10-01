// Pruebas de la parte del mapa que no necesita MapLibre: el estilo, las capas
// de centros y de hallazgos y la ficha de una parcela. El dibujo se revisa en
// el navegador.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { booleanPointInPolygon } from '@turf/turf'
import { describe, expect, it } from 'vitest'
import { unirIndices } from '../src/lista/datos.js'
import { analizar, validarTexto } from '../src/motor/index.js'
import { capaDeCentros, capaDeHallazgos, procesar } from '../src/motor/trabajo.js'
import {
  CAPAS,
  CAPAS_CLIC,
  construirEstilo,
  esCapaPropia,
  fichaDeParcela,
  FUENTE_ETIQUETAS,
  PALETA_MAPA,
  ZOOM_DETALLE,
} from '../src/mapa/capas.js'
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

// Dirección de la página: las letras de las etiquetas se sirven desde ahí.
const ORIGEN = 'http://localhost:4173'

// Todas las cadenas del estilo que parecen direcciones de otro sitio. Las URLs
// `blob:` son locales aunque lleven "http" adentro, y las del propio sitio también.
const direcciones = (estilo) =>
  (JSON.stringify(estilo).match(/(?<!blob:)https?:\/\/[^"]+/g) ?? []).filter((url) => !url.startsWith(ORIGEN))

const capa = (estilo, id) => estilo.layers.find((c) => c.id === id)

describe('estilo del mapa', () => {
  it('sin mapa base no pide nada fuera del sitio', () => {
    const estilo = construirEstilo({
      parcelas: 'blob:http://localhost/abc',
      hallazgos: capaDeHallazgos(informe.resultados),
      origen: ORIGEN,
    })
    expect(direcciones(estilo)).toEqual([])
    expect(estilo.sprite).toBeUndefined()
    expect(Object.keys(estilo.sources)).toEqual(['parcelas', 'centros', 'hallazgos'])
  })

  it('sin mapa base, las etiquetas usan las letras del propio sitio', () => {
    const estilo = construirEstilo({ origen: ORIGEN })
    expect(estilo.glyphs).toBe(`${ORIGEN}/glyphs/{fontstack}/{range}.pbf`)
    for (const rango of ['0-255', '256-511']) {
      expect(existsSync(join('public', 'glyphs', FUENTE_ETIQUETAS, `${rango}.pbf`))).toBe(true)
    }
    const etiquetas = estilo.layers.filter((c) => c.type === 'symbol')
    expect(etiquetas.length).toBeGreaterThan(0)
    for (const c of etiquetas) expect(c.layout['text-font']).toEqual([FUENTE_ETIQUETAS])
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

  it('el mapa base se tiñe con el verde oscuro de Deslinde', () => {
    const base = {
      ...BASE,
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
        { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': 'rgb(27,27,29)' } },
        { id: 'landcover_wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', paint: { 'fill-color': 'rgb(32,32,32)' } },
        { id: 'capa_desconocida', type: 'line', source: 'openmaptiles', 'source-layer': 'x', paint: { 'line-color': 'red' } },
      ],
    }
    const estilo = construirEstilo({ base })
    expect(capa(estilo, 'background').paint['background-color']).toBe(PALETA_MAPA.fondo)
    expect(capa(estilo, 'water').paint['fill-color']).toBe(PALETA_MAPA.agua)
    expect(capa(estilo, 'landcover_wood').paint['fill-color']).toBe(PALETA_MAPA.bosque)
    // Las capas que no conoce las deja como vienen, y no toca el estilo que recibe.
    expect(capa(estilo, 'capa_desconocida').paint['line-color']).toBe('red')
    expect(base.layers[0].paint['background-color']).toBe('rgb(12,12,12)')
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

describe('las parcelas de lejos y de cerca', () => {
  const estilo = construirEstilo({ origen: ORIGEN })

  it('de lejos, cada parcela es una marca y las cercanas se agrupan con su cantidad', () => {
    const centros = estilo.sources.centros
    expect(centros.cluster).toBe(true)
    expect(centros.clusterMaxZoom).toBeLessThan(ZOOM_DETALLE)
    expect(Object.keys(centros.clusterProperties)).toEqual(['errores', 'advertencias'])
    expect(capa(estilo, 'deslinde-grupo').filter).toEqual(['has', 'point_count'])
    expect(capa(estilo, 'deslinde-grupo-cifra').layout['text-field']).toEqual(['get', 'point_count_abbreviated'])
    expect(capa(estilo, 'deslinde-centro').filter).toEqual(['!', ['has', 'point_count']])
    for (const id of ['deslinde-grupo', 'deslinde-grupo-cifra', 'deslinde-centro']) {
      expect(capa(estilo, id).maxzoom).toBe(ZOOM_DETALLE)
    }
  })

  it('de cerca se ve el borde de cada parcela', () => {
    for (const id of ['deslinde-relleno', 'deslinde-borde', 'deslinde-punto']) {
      expect(capa(estilo, id).minzoom).toBeLessThan(ZOOM_DETALLE)
    }
  })

  it('en cuanto una parcela sale de su grupo, lleva su código', () => {
    // El código va sobre el centro de la parcela, que siempre cae adentro: en
    // un polígono que se cruza o partido entre teselas, MapLibre lo ubica mal.
    const nombre = capa(estilo, 'deslinde-nombre')
    expect(nombre.source).toBe('centros')
    expect(nombre.filter).toEqual(['!', ['has', 'point_count']])
    expect(nombre.layout['text-field']).toEqual(['get', 'id'])
    expect(nombre.minzoom).toBe(estilo.sources.centros.clusterMaxZoom + 1)
  })

  it('el punto del problema dice qué regla falla', () => {
    const regla = capa(estilo, 'deslinde-hallazgo-regla')
    expect(regla.source).toBe('hallazgos')
    expect(regla.layout['text-field']).toEqual(['get', 'regla'])
  })

  it('se puede elegir una parcela tanto de lejos como de cerca', () => {
    expect(CAPAS_CLIC).toContain('deslinde-centro')
    expect(CAPAS_CLIC).toContain('deslinde-relleno')
  })
})

describe('capa de centros', () => {
  const texto = readFileSync(join(DIR_DATOS, 'errores-mezclados.geojson'), 'utf8')
  const { parcelas, estados } = analizar(texto)

  it('un punto por parcela que se puede dibujar, con su peor severidad', () => {
    const centros = capaDeCentros(parcelas, estados)
    const dibujables = parcelas.filter((p) => estados[p.indice].dibujable)
    expect(centros.features).toHaveLength(dibujables.length)
    for (const f of centros.features) {
      expect(f.geometry.type).toBe('Point')
      expect(f.properties).toEqual({
        indice: expect.any(Number),
        id: expect.any(String),
        severidad: estados[f.properties.indice].severidad,
      })
    }
  })

  it('el punto de un polígono cae dentro de la parcela', () => {
    const centros = capaDeCentros(parcelas, estados)
    const poligonos = parcelas.filter((p) => estados[p.indice].dibujable && !estados[p.indice].cruzada && p.tipo === 'Polygon')
    expect(poligonos.length).toBeGreaterThan(0)
    for (const p of poligonos) {
      const centro = centros.features.find((f) => f.properties.indice === p.indice)
      expect(booleanPointInPolygon(centro.geometry.coordinates, { type: 'Polygon', coordinates: p.coords })).toBe(true)
    }
  })

  it('el worker la entrega lista como Blob', async () => {
    const { archivos } = procesar(texto)
    expect(JSON.parse(await archivos.centros.text())).toEqual(capaDeCentros(parcelas, estados))
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
