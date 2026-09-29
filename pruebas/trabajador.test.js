// Pruebas del Web Worker (Fase 2). Node no carga el worker del navegador, así
// que se prueba su lógica (trabajo.js) y el lado de la página (validador.js)
// con un worker falso. Que la página no se congele se mide en el navegador.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { geojsonCorregido, informeCSV, validarTexto } from '../src/motor/index.js'
import { HONDURAS } from '../src/motor/reglas.js'
import { atender, MENSAJE_INTERNO, procesar } from '../src/motor/trabajo.js'
import { Cancelado, crearValidador, ErrorDeArchivo } from '../src/validador.js'
import { DIR_DATOS } from '../scripts/generar-datos.js'

const archivo = (ruta) => readFileSync(join(DIR_DATOS, ruta), 'utf8')
const leerJSON = async (blob) => JSON.parse(await blob.text())

describe('trabajo del worker', () => {
  it('devuelve el mismo informe que el motor', () => {
    const texto = archivo('errores-mezclados.geojson')
    expect(procesar(texto).informe).toEqual(validarTexto(texto))
  })

  it('la capa del mapa trae las parcelas dibujables con su peor severidad', async () => {
    const { informe, archivos } = procesar(archivo('errores-mezclados.geojson'))
    const mapa = await leerJSON(archivos.mapa)
    const conR1 = informe.resultados.filter((r) => r.regla === 'R1').map((r) => r.parcela)
    expect(conR1.length).toBeGreaterThan(0)
    expect(mapa.features).toHaveLength(informe.parcelas - conR1.length)
    expect(mapa.features.map((f) => f.properties.id)).not.toEqual(expect.arrayContaining(conR1))

    const severidadDe = (id) => mapa.features.find((f) => f.properties.id === id).properties.severidad
    for (const r of informe.resultados.filter((r) => !conR1.includes(r.parcela))) {
      if (r.severidad === 'error') expect(severidadDe(r.parcela)).toBe('error')
      else expect(['error', 'advertencia']).toContain(severidadDe(r.parcela))
    }
    // Las 10 válidas y la primera de cada par solapado o duplicado (R10 y R11
    // marcan solo la segunda).
    const conHallazgos = new Set(informe.resultados.map((r) => r.parcela))
    const sanas = mapa.features.filter((f) => !conHallazgos.has(f.properties.id)).map((f) => f.properties)
    const validas = Array.from({ length: 10 }, (_, i) => `P-${String(i + 1).padStart(5, '0')}`)
    expect(sanas.map((p) => p.id)).toEqual([...validas, 'P-E07A', 'P-E13A'])
    expect(sanas.every((p) => p.severidad === 'ok')).toBe(true)
  })

  it('una parcela que se cruza (R6) va como contorno, con los mismos vértices', async () => {
    const { informe, archivos } = procesar(archivo('errores-mezclados.geojson'))
    const cruzada = informe.resultados.find((r) => r.regla === 'R6').parcela
    const feature = (await leerJSON(archivos.mapa)).features.find((f) => f.properties.id === cruzada)
    const original = JSON.parse(archivo('casos/01-autointerseccion.geojson')).features[0].geometry
    expect(feature.geometry).toEqual({ type: 'MultiLineString', coordinates: original.coordinates })
    expect(feature.properties.severidad).toBe('error')
  })

  it('las demás parcelas siguen como polígonos o puntos', async () => {
    const { archivos } = procesar(archivo('valido.geojson'))
    const tipos = new Set((await leerJSON(archivos.mapa)).features.map((f) => f.geometry.type))
    expect([...tipos].every((t) => ['Polygon', 'MultiPolygon', 'Point'].includes(t))).toBe(true)
  })

  it('las parcelas con pares invertidos se dibujan ya corregidas, en Honduras', async () => {
    const { informe, archivos } = procesar(archivo('errores-mezclados.geojson'))
    const invertida = informe.resultados.find((r) => r.regla === 'R3').parcela
    const mapa = await leerJSON(archivos.mapa)
    const vertices = mapa.features.find((f) => f.properties.id === invertida).geometry.coordinates.flat()
    for (const [lon, lat] of vertices) {
      expect(lon).toBeGreaterThan(HONDURAS.lonMin)
      expect(lon).toBeLessThan(HONDURAS.lonMax)
      expect(lat).toBeGreaterThan(HONDURAS.latMin)
      expect(lat).toBeLessThan(HONDURAS.latMax)
    }
  })

  // Caja de un grupo de parcelas, calculada a mano: aplana cada geometría a sus
  // números (longitud, latitud, longitud…).
  function caja(features) {
    const numeros = features.flatMap((f) => f.geometry.coordinates.flat(3))
    const lons = numeros.filter((_, i) => i % 2 === 0)
    const lats = numeros.filter((_, i) => i % 2 === 1)
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
  }

  it('el encuadre deja fuera la parcela lejana y toma todas las de Honduras', async () => {
    const { informe, limites, archivos } = procesar(archivo('errores-mezclados.geojson'))
    const lejana = informe.resultados.find((r) => r.regla === 'R4').parcela
    const features = (await leerJSON(archivos.mapa)).features
    expect(features.some((f) => f.properties.id === lejana)).toBe(true) // se dibuja igual
    expect(limites).toEqual(caja(features.filter((f) => f.properties.id !== lejana)))
  })

  it('si ninguna parcela cae en Honduras, encuadra todas', async () => {
    const { limites, archivos } = procesar(archivo('casos/08-fuera-de-honduras.geojson'))
    expect(limites).toEqual(caja((await leerJSON(archivos.mapa)).features))
  })

  it('cuenta las parcelas por su peor severidad', () => {
    const { conteo, informe } = procesar(archivo('errores-mezclados.geojson'))
    expect(conteo.error + conteo.advertencia + conteo.ok).toBe(informe.parcelas)
    expect(conteo.error).toBe(informe.resumen.parcelasConErrores)
    expect(conteo.ok).toBe(12)
    expect(conteo.sinDibujar).toBe(1) // la de R1
  })

  it('un archivo sin parcelas dibujables no trae límites', () => {
    expect(procesar(archivo('casos/11-coordenadas-proyectadas.geojson')).limites).toBeNull()
  })

  it('las descargas son iguales a las salidas del motor', async () => {
    const texto = archivo('errores-mezclados.geojson')
    const { informe, archivos } = procesar(texto)
    expect(archivos.informe.type).toBe('text/csv;charset=utf-8')
    // Blob.text() quita el BOM al leer; se compara sin él.
    expect(await archivos.informe.text()).toBe(informeCSV(informe).replace(/^﻿/, ''))
    expect(new Uint8Array(await archivos.informe.slice(0, 3).arrayBuffer())).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
    expect(await archivos.corregido.text()).toBe(geojsonCorregido(texto))
  })

  it('avisa el avance en orden y termina con todas las parcelas revisadas', () => {
    const avances = []
    procesar(archivo('grande-10000.geojson'), { alAvanzar: (a) => avances.push(a) })
    expect(avances[0]).toEqual({ fase: 'leyendo' })
    const revisando = avances.filter((a) => a.fase === 'revisando')
    expect(revisando.length).toBe(20)
    expect(revisando.at(-1)).toEqual({ fase: 'revisando', hechas: 10000, total: 10000 })
    expect(revisando.every((a, i) => i === 0 || a.hechas > revisando[i - 1].hechas)).toBe(true)
    expect(avances.slice(-2).map((a) => a.fase)).toEqual(['comparando', 'salidas'])
  })

  it('10,000 parcelas con mapa y descargas en menos de 5 s', async () => {
    const inicio = performance.now()
    const { informe, archivos } = procesar(archivo('grande-10000.geojson'))
    const ms = performance.now() - inicio
    expect(informe.parcelas).toBe(10000)
    expect((await leerJSON(archivos.mapa)).features).toHaveLength(10000)
    expect(ms).toBeLessThan(5000)
  }, 30000)

  it('lee el archivo también como Blob, como lo manda la página', async () => {
    const mensajes = []
    const texto = archivo('valido-puntos.csv')
    await atender({ id: 7, entrada: new Blob([texto]), formato: 'csv' }, (m) => mensajes.push(m))
    const final = mensajes.at(-1)
    expect(final.id).toBe(7)
    expect(final.tipo).toBe('listo')
    expect(final.resultado.informe).toEqual(validarTexto(texto, { formato: 'csv' }))
  })

  it('un archivo ilegible responde con un error de archivo', async () => {
    const mensajes = []
    await atender({ id: 1, entrada: 'esto no es un geojson', formato: 'geojson' }, (m) => mensajes.push(m))
    expect(mensajes.at(-1)).toEqual({
      id: 1,
      tipo: 'error',
      error: { clase: 'archivo', mensaje: 'El archivo no es un GeoJSON válido: no se pudo leer como JSON.' },
    })
  })

  it('un fallo interno no se presenta como culpa del archivo', async () => {
    const mensajes = []
    const roto = { text: async () => { throw new Error('disco') } }
    await atender({ id: 2, entrada: roto, formato: 'geojson' }, (m) => mensajes.push(m))
    expect(mensajes.at(-1).error).toEqual({ clase: 'interno', mensaje: MENSAJE_INTERNO, detalle: 'disco' })
  })
})

// Worker falso: corre `atender` en el mismo proceso, en diferido como uno real,
// y deja de responder cuando se termina.
function fabricaDeTrabajadores() {
  const creados = []
  const crear = () => {
    const w = {
      terminado: false,
      onmessage: null,
      onerror: null,
      postMessage(m) {
        setTimeout(() => atender(m, (r) => w.terminado || w.onmessage({ data: r })))
      },
      terminate() {
        w.terminado = true
      },
    }
    creados.push(w)
    return w
  }
  return { crear, creados }
}

describe('validador de la página', () => {
  it('resuelve con el resultado y pasa el avance', async () => {
    const { crear } = fabricaDeTrabajadores()
    const validador = crearValidador(crear)
    const fases = []
    const { informe } = await validador.validar(archivo('valido.geojson'), { alAvanzar: (a) => fases.push(a.fase) })
    expect(informe.parcelas).toBe(25)
    expect(fases).toEqual(['leyendo', 'revisando', 'comparando', 'salidas'])
  })

  it('un archivo ilegible rechaza con ErrorDeArchivo', async () => {
    const validador = crearValidador(fabricaDeTrabajadores().crear)
    await expect(validador.validar('id,x\n1,2\n', { formato: 'csv' })).rejects.toThrow(ErrorDeArchivo)
  })

  it('un archivo nuevo cancela el anterior y reinicia el worker', async () => {
    const { crear, creados } = fabricaDeTrabajadores()
    const validador = crearValidador(crear)
    const primero = validador.validar(archivo('grande-10000.geojson'))
    const segundo = validador.validar(archivo('valido.geojson'))
    await expect(primero).rejects.toThrow(Cancelado)
    expect((await segundo).informe.parcelas).toBe(25)
    expect(creados).toHaveLength(2)
    expect(creados[0].terminado).toBe(true)
  })

  it('el worker se reutiliza entre revisiones que no se cruzan', async () => {
    const { crear, creados } = fabricaDeTrabajadores()
    const validador = crearValidador(crear)
    await validador.validar(archivo('valido.geojson'))
    await validador.validar(archivo('errores-mezclados.geojson'))
    expect(creados).toHaveLength(1)
  })

  it('cancelar sin revisión en curso no hace nada', () => {
    const validador = crearValidador(fabricaDeTrabajadores().crear)
    expect(() => validador.cancelar()).not.toThrow()
  })

  it('si el worker no arranca, rechaza con un mensaje claro', async () => {
    const validador = crearValidador(() => {
      const w = { postMessage: () => setTimeout(() => w.onerror({ message: 'sin módulos' })), terminate() {} }
      return w
    })
    await expect(validador.validar('{}')).rejects.toThrow('No se pudo iniciar la revisión en este navegador.')
  })
})
