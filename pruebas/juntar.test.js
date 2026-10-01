// Pruebas de la parte 6b de la v1: juntar archivos de varias fuentes en uno.
// Cada archivo es una fuente. Las parcelas de todas se revisan juntas, así que
// los solapes y las parcelas repetidas entre archivos salen en el informe, y
// cada hallazgo dice de qué archivo viene.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { archivosShapefile, textoKML } from '../scripts/escribir-formatos.js'
import { DIR_DATOS, textoGeoJSON } from '../scripts/generar-datos.js'
import { filtrar, unirIndices } from '../src/lista/datos.js'
import { fichaDeParcela } from '../src/mapa/capas.js'
import { leerArchivos } from '../src/motor/archivos.js'
import { analizar, ErrorDeArchivo, informeCSV, validarTexto } from '../src/motor/index.js'
import { atender, procesar } from '../src/motor/trabajo.js'

// Una parcela cuadrada de unas 1.2 ha en la zona sintética. Las que se arman
// con lon distintas a 0.01° (unos 1,080 m) no se tocan.
const cuadrado = (lon = -88.2, lat = 14.4, lado = 0.001) => [
  [lon, lat],
  [lon, lat + lado],
  [lon + lado, lat + lado],
  [lon + lado, lat],
  [lon, lat],
]
const parcela = (id, lon, extra = {}) => ({
  type: 'Feature',
  properties: { ...(id === undefined ? {} : { id }), productor: 'PR-1', area_ha: 1.2, ...extra },
  geometry: { type: 'Polygon', coordinates: [cuadrado(lon)] },
})

// Archivos como los arma el worker: nombre y bytes.
const texto = (nombre, contenido) => ({ nombre, bytes: strToU8(contenido) })
const geojson = (nombre, features) => texto(nombre, textoGeoJSON(features))
const kml = (nombre, features) => texto(nombre, textoKML(features))
const partesShapefile = (base, features) =>
  Object.entries(archivosShapefile(features)).map(([ext, bytes]) => ({ nombre: `${base}.${ext}`, bytes }))

const revisar = (archivos) => analizar(leerArchivos(archivos))
const filas = (informe) => informe.resultados.map((r) => [r.parcela, r.archivo, r.regla])

describe('leer varios archivos', () => {
  it('cada archivo es una fuente, en el orden en que llegó', () => {
    const fuentes = leerArchivos([
      geojson('norte.geojson', [parcela('A-1', -88.2)]),
      kml('sur.kml', [parcela('B-1', -88.19), parcela('B-2', -88.18)]),
    ])
    expect(fuentes.map((f) => [f.nombre, f.formato, f.parcelas.length])).toEqual([
      ['norte.geojson', 'geojson', 1],
      ['sur.kml', 'kml', 2],
    ])
    // De qué archivos recibidos sale cada fuente: la página lo usa para quitarla.
    expect(fuentes.map((f) => f.de)).toEqual([[0], [1]])
  })

  it('un shapefile suelto es una sola fuente aunque llegue en varios archivos', () => {
    const fuentes = leerArchivos([geojson('norte.geojson', [parcela('A-1', -88.2)]), ...partesShapefile('centro', [parcela('C-1', -88.17)])])
    expect(fuentes.map((f) => [f.nombre, f.formato])).toEqual([
      ['norte.geojson', 'geojson'],
      ['centro.shp', 'shapefile'],
    ])
    expect(fuentes[1].de).toEqual([1, 2, 3, 4, 5]) // .shp, .shx, .dbf, .prj y .cpg
  })

  it('dos shapefiles sueltos se emparejan por su nombre', () => {
    const fuentes = leerArchivos([
      ...partesShapefile('norte', [parcela('N-1', -88.2), parcela('N-2', -88.19)]),
      ...partesShapefile('sur', [parcela('S-1', -88.15)]),
    ])
    expect(fuentes.map((f) => [f.nombre, f.parcelas.map((p) => p.etiqueta)])).toEqual([
      ['norte.shp', ['N-1', 'N-2']],
      ['sur.shp', ['S-1']],
    ])
  })

  it('un .zip con dos shapefiles da dos fuentes', () => {
    const archivos = Object.fromEntries(
      ['norte', 'sur'].flatMap((base, i) =>
        Object.entries(archivosShapefile([parcela(`${base}-1`, -88.2 + i / 100)])).map(([ext, b]) => [`${base}.${ext}`, b]),
      ),
    )
    const fuentes = leerArchivos([{ nombre: 'dos.zip', bytes: zipSync(archivos) }])
    expect(fuentes.map((f) => [f.nombre, f.parcelas[0].etiqueta, f.de])).toEqual([
      ['norte.shp', 'norte-1', [0]],
      ['sur.shp', 'sur-1', [0]],
    ])
  })

  it('un .zip con un solo archivo de parcelas toma el nombre del .zip', () => {
    const bytes = new Uint8Array(readFileSync(join(DIR_DATOS, 'valido-poligonos-shp.zip')))
    const [fuente] = leerArchivos([geojson('norte.geojson', [parcela('A-1', -88.2)]), { nombre: 'valido-poligonos-shp.zip', bytes }]).slice(1)
    expect(fuente.nombre).toBe('valido-poligonos-shp.zip')
    expect(fuente.formato).toBe('shapefile')
  })

  it('un archivo que no se puede leer no frena a los demás', () => {
    const fuentes = leerArchivos([
      geojson('norte.geojson', [parcela('A-1', -88.2)]),
      texto('roto.geojson', 'esto no es un geojson'),
      texto('notas.txt', 'hola'),
      ...partesShapefile('sur', [parcela('S-1', -88.15)]).filter((a) => a.nombre !== 'sur.dbf'),
    ])
    expect(fuentes.map((f) => f.nombre)).toEqual(['norte.geojson', 'roto.geojson', 'notas.txt', 'sur.shp'])
    expect(fuentes[0].error).toBeUndefined()
    expect(fuentes[1].error).toMatch(/no es un GeoJSON válido/)
    expect(fuentes[1].parcelas).toBeUndefined()
    expect(fuentes[2].error).toMatch(/no es un formato que Deslinde lea/)
    expect(fuentes[3].error).toMatch(/\.dbf/)
  })

  it('si ninguno se puede leer, el aviso nombra cada archivo', () => {
    const intento = () => leerArchivos([texto('a.geojson', 'x'), texto('b.kml', 'y')])
    expect(intento).toThrow(ErrorDeArchivo)
    expect(intento).toThrow(/a\.geojson/)
    expect(intento).toThrow(/b\.kml/)
  })

  it('un archivo solo que no se puede leer da el mismo aviso de siempre', () => {
    expect(() => leerArchivos([texto('a.geojson', 'x')])).toThrow(/^El archivo no es un GeoJSON válido: no se pudo leer como JSON\.$/)
  })

  it('dos archivos con el mismo nombre se distinguen', () => {
    const fuentes = leerArchivos([kml('parcelas.kml', [parcela('A-1', -88.2)]), kml('parcelas.kml', [parcela('B-1', -88.15)])])
    expect(fuentes.map((f) => f.nombre)).toEqual(['parcelas.kml', 'parcelas.kml (2)'])
  })
})

describe('revisar varias fuentes juntas', () => {
  it('las parcelas de todas se revisan juntas, cada una con su archivo', () => {
    const { parcelas, informe } = revisar([
      geojson('norte.geojson', [parcela('A-1', -88.2), parcela('A-2', -88.19)]),
      kml('sur.kml', [parcela('B-1', -88.18)]),
    ])
    expect(informe.parcelas).toBe(3)
    expect(parcelas.map((p) => [p.indice, p.posicion, p.archivo])).toEqual([
      [0, 0, 'norte.geojson'],
      [1, 1, 'norte.geojson'],
      [2, 0, 'sur.kml'],
    ])
    expect(informe.fuentes).toEqual([
      { nombre: 'norte.geojson', formato: 'geojson', parcelas: 2, de: [0] },
      { nombre: 'sur.kml', formato: 'kml', parcelas: 1, de: [1] },
    ])
    expect(informe.resultados).toEqual([])
  })

  it('la misma parcela en dos archivos: R11 en las dos, y cada aviso nombra el otro archivo', () => {
    const a = parcela('A-1', -88.2)
    const { informe } = revisar([geojson('norte.geojson', [a]), kml('sur.kml', [a])])
    // Un solo aviso por copia: el código repetido no se avisa aparte.
    expect(filas(informe)).toEqual([
      ['A-1', 'norte.geojson', 'R11'],
      ['A-1', 'sur.kml', 'R11'],
    ])
    expect(informe.resultados[0].mensaje).toMatch(/misma geometría que la parcela A-1 \(n\.º 1\) de sur\.kml/)
    expect(informe.resultados[1].mensaje).toMatch(/A-1 \(n\.º 1\) de norte\.geojson/)
  })

  it('el mismo código con otra geometría en otro archivo: R11 en las dos, con la posición y el archivo de la otra', () => {
    const { informe } = revisar([
      geojson('norte.geojson', [parcela('X-1', -88.19), parcela('A-1', -88.2)]),
      kml('sur.kml', [parcela('A-1', -88.15)]),
    ])
    expect(filas(informe)).toEqual([
      ['A-1', 'norte.geojson', 'R11'],
      ['A-1', 'sur.kml', 'R11'],
    ])
    expect(informe.resultados[0].mensaje).toMatch(/mismo código/)
    expect(informe.resultados[0].mensaje).toMatch(/la n\.º 1 de sur\.kml/)
    expect(informe.resultados[1].mensaje).toMatch(/la n\.º 2 de norte\.geojson/)
    expect(informe.resultados[0].ubicacion).not.toBeNull()
  })

  it('el mismo código dos veces en un solo archivo también se avisa', () => {
    const informe = validarTexto(textoGeoJSON([parcela('A-1', -88.2), parcela('A-1', -88.15)]))
    expect(informe.resultados.map((r) => r.regla)).toEqual(['R11', 'R11'])
    expect(informe.resultados[0].mensaje).toMatch(/la n\.º 2 de este archivo/)
    expect(informe.resultados[1].mensaje).toMatch(/la n\.º 1 de este archivo/)
  })

  it('el código se compara sin espacios ni mayúsculas, y las parcelas sin código no cuentan', () => {
    const informe = validarTexto(
      textoGeoJSON([parcela('hn-1 ', -88.2), parcela('HN-1', -88.15), parcela(undefined, -88.1), parcela(undefined, -88.05)]),
    )
    expect(informe.resultados.map((r) => [r.parcela, r.regla])).toEqual([
      ['hn-1 ', 'R11'],
      ['HN-1', 'R11'],
    ])
  })

  it('una parcela con coordenadas que no se leen (R1) igual avisa si repite un código', () => {
    const enMetros = { ...parcela('A-1', -88.2), geometry: { type: 'Point', coordinates: [403000.12, 1614000.34] } }
    const { informe } = revisar([geojson('norte.geojson', [parcela('A-1', -88.2)]), geojson('sur.geojson', [enMetros])])
    expect(filas(informe)).toEqual([
      ['A-1', 'norte.geojson', 'R11'],
      ['A-1', 'sur.geojson', 'R1'],
      ['A-1', 'sur.geojson', 'R11'],
    ])
    // Sin coordenadas en grados no hay dónde mostrarla en el mapa.
    expect(informe.resultados[2].ubicacion).toBeNull()
  })

  it('un solape entre archivos nombra el archivo de la otra parcela', () => {
    const { informe } = revisar([geojson('norte.geojson', [parcela('A-1', -88.2)]), kml('sur.kml', [parcela('B-1', -88.1995)])])
    expect(filas(informe)).toEqual([
      ['A-1', 'norte.geojson', 'R10'],
      ['B-1', 'sur.kml', 'R10'],
    ])
    expect(informe.resultados[0].mensaje).toMatch(/parcela B-1 de sur\.kml/)
    expect(informe.resultados[1].mensaje).toMatch(/parcela A-1 de norte\.geojson/)
  })

  it('R3 da el consejo del formato de cada archivo', () => {
    const csv = texto('puntos.csv', 'id;latitud;longitud;area_ha\nP-1;-88.000000;14.500000;1.00\n')
    const invertida = { ...parcela('K-1', -88.2), geometry: { type: 'Polygon', coordinates: [cuadrado().map(([lon, lat]) => [lat, lon])] } }
    const { informe } = revisar([csv, kml('sur.kml', [invertida])])
    const r3 = informe.resultados.filter((r) => r.regla === 'R3')
    expect(r3.map((r) => r.archivo)).toEqual(['puntos.csv', 'sur.kml'])
    expect(r3[0].accion).toMatch(/columnas/)
    expect(r3[1].accion).toMatch(/KML/)
  })

  it('con un solo archivo, los mensajes no nombran archivos', async () => {
    const ejemplo = new File([readFileSync(join(DIR_DATOS, 'errores-mezclados.geojson'))], 'ejemplo.geojson')
    const mensajes = []
    await atender({ id: 1, entrada: [ejemplo] }, (m) => mensajes.push(m))
    const { informe } = mensajes.find((m) => m.tipo === 'listo').resultado
    expect(informe.resultados.every((r) => r.archivo === 'ejemplo.geojson')).toBe(true)
    expect(informe.resultados.some((r) => r.mensaje.includes('ejemplo.geojson'))).toBe(false)
  })
})

describe('salidas de varias fuentes', () => {
  const fuentes = () =>
    leerArchivos([
      geojson('norte.geojson', [parcela('A-1', -88.2)]),
      kml('sur.kml', [parcela('A-1', -88.2), parcela('B-1', -88.15)]),
    ])

  it('el informe CSV dice de qué archivo es cada hallazgo', () => {
    const csv = informeCSV(analizar(fuentes()).informe)
    const lineas = csv.slice(1).split('\r\n').filter(Boolean)
    expect(lineas[0]).toBe('parcela,archivo,regla,severidad,longitud,latitud,mensaje,accion')
    expect(lineas[1].startsWith('A-1,norte.geojson,R11,advertencia,')).toBe(true)
    expect(lineas[2].startsWith('A-1,sur.kml,R11,advertencia,')).toBe(true)
  })

  it('el GeoJSON corregido junta todas las parcelas y dice de qué archivo viene cada una', async () => {
    const { archivos } = procesar(fuentes())
    const unido = JSON.parse(await archivos.corregido.text())
    expect(unido.features.map((f) => [f.properties.id, f.properties.archivo_origen])).toEqual([
      ['A-1', 'norte.geojson'],
      ['A-1', 'sur.kml'],
      ['B-1', 'sur.kml'],
    ])
    // Se puede volver a revisar: sigue siendo un GeoJSON con 6 decimales escritos.
    expect(validarTexto(await archivos.corregido.text()).parcelas).toBe(3)
  })

  it('si una parcela ya trae su archivo de origen, se respeta', async () => {
    const ya = parcela('A-1', -88.2, { archivo_origen: 'cooperativa.kml' })
    const { archivos } = procesar(leerArchivos([geojson('unido.geojson', [ya]), kml('sur.kml', [parcela('B-1', -88.15)])]))
    const unido = JSON.parse(await archivos.corregido.text())
    expect(unido.features.map((f) => f.properties.archivo_origen)).toEqual(['cooperativa.kml', 'sur.kml'])
  })

  it('con un solo archivo, el corregido queda como antes, sin archivo de origen', async () => {
    const { archivos } = procesar(leerArchivos([geojson('norte.geojson', [parcela('A-1', -88.2)])]))
    const corregido = JSON.parse(await archivos.corregido.text())
    expect(corregido.features[0].properties).not.toHaveProperty('archivo_origen')
  })
})

describe('en el worker', () => {
  const comoFile = ({ nombre, bytes }) => new File([bytes], nombre)

  it('recibe archivos de varias fuentes y responde un solo informe', async () => {
    const lista = [
      geojson('norte.geojson', [parcela('A-1', -88.2)]),
      kml('sur.kml', [parcela('A-1', -88.2)]),
      // En el shapefile van números, no texto: con longitudes redondas como
      // -88.1, R2 la tomaría por redondeada.
      ...partesShapefile('centro', [parcela('C-1', -88.100123)]),
    ].map(comoFile)
    const mensajes = []
    await atender({ id: 1, entrada: lista }, (m) => mensajes.push(m))
    const { informe, indices, conteo } = mensajes.find((m) => m.tipo === 'listo').resultado
    expect(informe.fuentes.map((f) => [f.nombre, f.parcelas])).toEqual([
      ['norte.geojson', 1],
      ['sur.kml', 1],
      ['centro.shp', 1],
    ])
    expect(indices).toEqual([0, 1])
    expect(conteo).toMatchObject({ advertencia: 2, ok: 1 })
  })

  it('con varias fuentes, las capas del mapa dicen el archivo de cada parcela', async () => {
    const { archivos } = procesar(leerArchivos([geojson('norte.geojson', [parcela('A-1', -88.2)]), kml('sur.kml', [parcela('B-1', -88.15)])]))
    for (const capa of [archivos.mapa, archivos.centros]) {
      const { features } = JSON.parse(await capa.text())
      expect(features.map((f) => f.properties.archivo)).toEqual(['norte.geojson', 'sur.kml'])
    }
  })

  it('un archivo roto entre varios vuelve en las fuentes, no como error', async () => {
    const lista = [geojson('norte.geojson', [parcela('A-1', -88.2)]), texto('roto.kml', 'nada')].map(comoFile)
    const mensajes = []
    await atender({ id: 2, entrada: lista }, (m) => mensajes.push(m))
    const { informe } = mensajes.find((m) => m.tipo === 'listo').resultado
    expect(informe.parcelas).toBe(1)
    expect(informe.fuentes[1]).toMatchObject({ nombre: 'roto.kml', parcelas: 0, error: expect.stringMatching(/no es un KML/) })
  })
})

describe('en la página', () => {
  function hallazgos() {
    const { informe, indices } = procesar(
      leerArchivos([geojson('norte.geojson', [parcela('A-1', -88.2)]), kml('sur.kml', [parcela('A-1', -88.2)])]),
    )
    return unirIndices(informe.resultados, indices)
  }

  it('la lista se filtra por archivo', () => {
    expect(filtrar(hallazgos(), { archivo: 'sur.kml' }).map((h) => h.indice)).toEqual([1])
    expect(filtrar(hallazgos(), { archivo: 'todos' })).toHaveLength(2)
  })

  it('la ficha dice de qué archivo es la parcela', () => {
    expect(fichaDeParcela(1, hallazgos(), 'A-1', 'sur.kml').archivo).toBe('sur.kml')
    expect(fichaDeParcela(1, hallazgos(), 'A-1').archivo).toBeUndefined()
  })
})

describe('ejemplo para juntar', () => {
  const NOMBRES = ['cooperativa-norte.geojson', 'beneficio-sur.kml', 'tecnicos-centro-shp.zip']
  const leidos = () => NOMBRES.map((nombre) => ({ nombre, bytes: new Uint8Array(readFileSync(join(DIR_DATOS, 'juntar', nombre))) }))

  it('tres archivos de tres fuentes, con repetidos y solapes entre ellos', () => {
    const { informe } = analizar(leerArchivos(leidos()))
    expect(informe.fuentes.map((f) => [f.nombre, f.formato, f.parcelas])).toEqual([
      ['cooperativa-norte.geojson', 'geojson', 10],
      ['beneficio-sur.kml', 'kml', 8],
      ['tecnicos-centro-shp.zip', 'shapefile', 6],
    ])
    const de = (archivo, parcela) => informe.resultados.filter((r) => r.archivo === archivo && r.parcela === parcela).map((r) => r.regla)
    const [norte, sur, centro] = NOMBRES
    // La cooperativa y el beneficio mandan la misma parcela.
    expect(de(norte, 'HN-0103')).toEqual(['R11'])
    expect(de(sur, 'HN-0103')).toEqual(['R11'])
    // El beneficio volvió a medir una parcela de la cooperativa: mismo código, otra geometría, se solapan.
    expect(de(norte, 'HN-0107')).toEqual(['R10', 'R11'])
    expect(de(sur, 'HN-0107')).toEqual(['R10', 'R11'])
    // Una parcela de los técnicos se mete en una del beneficio.
    expect(de(sur, 'HN-0204')).toEqual(['R10'])
    expect(de(centro, 'HN-0305')).toEqual(['R10'])
    // Dos parcelas distintas, lejos una de otra, con el mismo código.
    expect(de(sur, 'HN-0202')).toEqual(['R11'])
    expect(de(centro, 'HN-0202')).toEqual(['R11'])
    // Y un problema de un solo archivo: un shapefile exportado con 5 decimales.
    expect(de(centro, 'HN-0303')).toEqual(['R2'])
    // Las demás, sin hallazgos.
    const conHallazgos = new Set(informe.resultados.map((r) => `${r.archivo}|${r.parcela}`))
    expect(conHallazgos.size).toBe(9)
    expect(informe.resumen.parcelasConErrores).toBe(1)
  })
})
