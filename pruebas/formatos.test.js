// Pruebas de los formatos de v1: KML, KMZ y shapefile (suelto o en .zip).
// Los archivos se arman con los mismos escritores que los datos sintéticos
// (scripts/escribir-formatos.js), validados aparte con pyshp.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { area } from '@turf/turf'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { archivosShapefile, bytesKMZ, bytesZipShapefile, textoKML } from '../scripts/escribir-formatos.js'
import { DIR_DATOS, parcelasMezcladas, parcelasValidas, puntosValidos } from '../scripts/generar-datos.js'
import { leerArchivos } from '../src/motor/archivos.js'
import { analizar, ErrorDeArchivo, validarTexto } from '../src/motor/index.js'
import { atender } from '../src/motor/trabajo.js'

const datos = (nombre) => readFileSync(join(DIR_DATOS, nombre), 'utf8')
const sinAccion = ({ accion, ...resto }) => resto

// Una parcela cuadrada de unas 1.2 ha cerca del origen de los datos sintéticos.
const cuadrado = (lon = -88.2, lat = 14.4, lado = 0.001) => [
  [lon, lat],
  [lon, lat + lado],
  [lon + lado, lat + lado],
  [lon + lado, lat],
  [lon, lat],
]
const parcela = (id, geometry, extra = {}) => ({ type: 'Feature', properties: { id, productor: 'PR-1', area_ha: 1.2, ...extra }, geometry, })

// Lista de archivos como la arma el worker: nombre y bytes.
const comoArchivos = (base, archivos) => Object.entries(archivos).map(([ext, bytes]) => ({ nombre: `${base}.${ext}`, bytes }))
// La única fuente que sale de los archivos recibidos (juntar varias se prueba en juntar.test.js).
function unaFuente(archivos) {
  const fuentes = leerArchivos(archivos)
  expect(fuentes).toHaveLength(1)
  return fuentes[0]
}
const shapefileDe = (features, ajustes) => unaFuente(comoArchivos('parcelas', archivosShapefile(features, ajustes)))
const revisar = (entrada) => analizar(entrada).informe

describe('KML', () => {
  it('el mismo archivo en KML da los mismos hallazgos que en GeoJSON', () => {
    const geojson = validarTexto(datos('errores-mezclados.geojson'))
    const kml = validarTexto(datos('errores-mezclados.kml'), { formato: 'kml' })
    expect(kml.parcelas).toBe(geojson.parcelas)
    expect(kml.resultados.map(sinAccion)).toEqual(geojson.resultados.map(sinAccion))
    // Lo único que cambia es el consejo de R3, que habla del orden en KML.
    const r3 = kml.resultados.find((r) => r.regla === 'R3')
    expect(r3.accion).toMatch(/KML/)
  })

  it('un KML válido no tiene hallazgos y trae el código y el área de cada parcela', () => {
    const informe = validarTexto(datos('valido.kml'), { formato: 'kml' })
    expect(informe.parcelas).toBe(25)
    expect(informe.resultados).toEqual([])
    const { parcelas } = analizar(datos('valido.kml'), { formato: 'kml' })
    expect(parcelas[0].etiqueta).toBe('P-00001')
    expect(parcelas[0].areaHa).toBe(parcelasValidas()[0].properties.area_ha)
  })

  it('cuenta los decimales tal como vienen escritos', () => {
    // En el texto, 14.400000 tiene seis decimales aunque como número sea 14.4.
    const seis = textoKML([parcela('P-1', { type: 'Polygon', coordinates: [cuadrado()] })])
    expect(seis).toContain('14.400000')
    expect(validarTexto(seis, { formato: 'kml' }).resultados.filter((r) => r.regla === 'R2')).toEqual([])
    const cinco = textoKML([{ ...parcela('P-1', { type: 'Polygon', coordinates: [cuadrado()] }), _decimales: 5 }])
    expect(validarTexto(cinco, { formato: 'kml' }).resultados.map((r) => r.regla)).toContain('R2')
  })

  it('sin código en ExtendedData usa el nombre, y sin nombre, el id del Placemark', () => {
    const texto = `<kml><Document>
      <Placemark><name>Finca &amp; Sol</name><Point><coordinates>-88.200000,14.400000</coordinates></Point></Placemark>
      <Placemark id="pm-7"><Point><coordinates>-88.210000,14.400000</coordinates></Point></Placemark>
    </Document></kml>`
    const { parcelas } = analizar(texto, { formato: 'kml' })
    expect(parcelas.map((p) => p.etiqueta)).toEqual(['Finca & Sol', 'pm-7'])
  })

  it('encuentra las parcelas dentro de carpetas, con prefijo kml: y con SimpleData', () => {
    const texto = `<?xml version="1.0"?><kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Document><kml:Folder><kml:Folder>
      <kml:Placemark><kml:ExtendedData><kml:SchemaData schemaUrl="#s">
        <kml:SimpleData name="id">P-9</kml:SimpleData><kml:SimpleData name="area_ha">5</kml:SimpleData>
      </kml:SchemaData></kml:ExtendedData>
      <kml:Polygon><kml:outerBoundaryIs><kml:LinearRing><kml:coordinates>
        ${cuadrado().map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)},0`).join('\n        ')}
      </kml:coordinates></kml:LinearRing></kml:outerBoundaryIs></kml:Polygon></kml:Placemark>
    </kml:Folder></kml:Folder></kml:Document></kml:kml>`
    const { parcelas, informe } = analizar(texto, { formato: 'kml' })
    expect(parcelas).toHaveLength(1)
    expect(parcelas[0].etiqueta).toBe('P-9')
    expect(parcelas[0].tipo).toBe('Polygon')
    // El área declarada (5 ha) no coincide con el cuadrado (unas 1.2 ha): R12.
    expect(informe.resultados.map((r) => r.regla)).toEqual(['R12'])
  })

  it('un polígono con huecos y varias partes se leen como en GeoJSON', () => {
    const hueco = cuadrado(-88.1997, 14.4003, 0.0003).reverse()
    const lejos = cuadrado(-88.18, 14.42)
    const texto = textoKML([
      parcela('P-H', { type: 'Polygon', coordinates: [cuadrado(), hueco] }),
      parcela('P-M', { type: 'MultiPolygon', coordinates: [[cuadrado(-88.205)], [lejos]] }),
    ])
    const { parcelas, informe } = analizar(texto, { formato: 'kml' })
    expect(parcelas[0].tipo).toBe('Polygon')
    expect(parcelas[0].coords).toHaveLength(2)
    expect(parcelas[1].tipo).toBe('MultiPolygon')
    expect(informe.resultados.filter((r) => r.parcela === 'P-M').map((r) => r.regla)).toContain('R8')
  })

  it('una línea no es una parcela', () => {
    const texto = '<kml><Placemark><name>L-1</name><LineString><coordinates>-88.200000,14.400000 -88.210000,14.400000</coordinates></LineString></Placemark></kml>'
    const [r] = validarTexto(texto, { formato: 'kml' }).resultados
    expect(r.regla).toBe('R1')
    expect(r.mensaje).toMatch(/LineString/)
  })

  it('un archivo que no es KML da un aviso claro', () => {
    expect(() => validarTexto('{"type":"FeatureCollection"}', { formato: 'kml' })).toThrow(ErrorDeArchivo)
    expect(() => validarTexto('<kml><Document></Document></kml>', { formato: 'kml' })).toThrow(/ninguna parcela/)
  })
})

describe('KMZ y .zip', () => {
  it('un KMZ se abre como su KML', () => {
    const kml = datos('valido.kml')
    const entrada = unaFuente([{ nombre: 'valido.kmz', bytes: bytesKMZ(kml) }])
    expect(entrada.formato).toBe('kml')
    expect(entrada.nombre).toBe('valido.kmz')
    const directo = analizar(kml, { formato: 'kml' }).parcelas
    expect(entrada.parcelas.map((p) => [p.etiqueta, p.textos])).toEqual(directo.map((p) => [p.etiqueta, p.textos]))
  })

  it('un .zip con un shapefile se lee como shapefile', () => {
    const bytes = readFileSync(join(DIR_DATOS, 'valido-poligonos-shp.zip'))
    const entrada = unaFuente([{ nombre: 'valido-poligonos-shp.zip', bytes: new Uint8Array(bytes) }])
    expect(entrada.formato).toBe('shapefile')
    expect(revisar(entrada).resultados).toEqual([])
  })

  it('un .zip sin nada que Deslinde lea da un aviso claro', () => {
    const bytes = zipSync({ 'notas.txt': strToU8('hola') })
    expect(() => leerArchivos([{ nombre: 'algo.zip', bytes }])).toThrow(/no trae/)
  })

  it('reconoce cada formato por su extensión, sin importar mayúsculas', () => {
    const vacio = '{"type":"FeatureCollection","features":[]}'
    expect(unaFuente([{ nombre: 'A.GEOJSON', bytes: strToU8(vacio) }]).formato).toBe('geojson')
    expect(unaFuente([{ nombre: 'b.json', bytes: strToU8(vacio) }]).formato).toBe('geojson')
    expect(unaFuente([{ nombre: 'c.csv', bytes: strToU8('id,latitud,longitud') }]).formato).toBe('csv')
    expect(unaFuente([{ nombre: 'd.KML', bytes: strToU8('<kml><Placemark/></kml>') }]).formato).toBe('kml')
    expect(() => leerArchivos([{ nombre: 'e.gpx', bytes: strToU8('') }])).toThrow(ErrorDeArchivo)
  })
})

describe('shapefile', () => {
  const poligonos = parcelasValidas().filter((f) => f.geometry.type === 'Polygon')

  it('un shapefile válido no tiene hallazgos y trae el código y el área del .dbf', () => {
    const entrada = shapefileDe(poligonos)
    expect(entrada.formato).toBe('shapefile')
    expect(entrada.nombre).toBe('parcelas.shp')
    expect(revisar(entrada).resultados).toEqual([])
    expect(entrada.parcelas.map((p) => p.etiqueta)).toEqual(poligonos.map((f) => f.properties.id))
    expect(entrada.parcelas.map((p) => p.areaHa)).toEqual(poligonos.map((f) => f.properties.area_ha))
    expect(entrada.parcelas[0].propiedades).toMatchObject({ id: 'P-00001', productor: 'PR-00001' })
  })

  it('lee shapefiles de puntos y con altura (Z)', () => {
    expect(revisar(shapefileDe(puntosValidos())).resultados).toEqual([])
    const conZ = shapefileDe(poligonos, { conZ: true })
    expect(conZ.parcelas[0].coords).toEqual(shapefileDe(poligonos).parcelas[0].coords)
    expect(revisar(conZ).resultados).toEqual([])
  })

  it('un hueco queda dentro de su parcela y las partes lejanas forman un multipolígono', () => {
    const hueco = cuadrado(-88.1997, 14.4003, 0.0003)
    const { parcelas } = shapefileDe([
      parcela('P-H', { type: 'Polygon', coordinates: [cuadrado(), hueco] }),
      parcela('P-M', { type: 'MultiPolygon', coordinates: [[cuadrado(-88.205)], [cuadrado(-88.18, 14.42)]] }),
    ])
    expect(parcelas[0].tipo).toBe('Polygon')
    expect(parcelas[0].coords).toHaveLength(2)
    expect(parcelas[1].tipo).toBe('MultiPolygon')
    expect(parcelas[1].coords).toHaveLength(2)
    const informe = revisar({ formato: 'shapefile', parcelas })
    expect(informe.resultados.filter((r) => r.parcela === 'P-M').map((r) => r.regla)).toContain('R8')
  })

  it('R2 marca un shapefile redondeado a 5 decimales', () => {
    const redondeado = { ...parcela('P-5', { type: 'Polygon', coordinates: [cuadrado(-88.200123, 14.400123)] }), _decimales: 5 }
    const [r] = revisar(shapefileDe([redondeado])).resultados
    expect(r.regla).toBe('R2')
    expect(r.mensaje).toMatch(/redondeadas a 5 decimales/)
  })

  it('R2 no marca un shapefile con 6 decimales aunque algunas coordenadas terminen en cero', () => {
    // -88.2 y 14.4 se guardan como esos números: escritos, tienen 1 decimal,
    // pero las demás coordenadas de la parcela muestran que se midió con 6.
    const geometria = {
      type: 'Polygon',
      coordinates: [[[-88.2, 14.4], [-88.2, 14.401234], [-88.198765, 14.401234], [-88.198765, 14.4], [-88.2, 14.4]]],
    }
    const conCeros = parcela('P-6', geometria, { area_ha: Number((area(geometria) / 10000).toFixed(2)) })
    expect(revisar(shapefileDe([conCeros])).resultados).toEqual([])
  })

  it('lee el .dbf en Windows-1252, con o sin .cpg', () => {
    const f = [parcela('P-Ñ1', { type: 'Polygon', coordinates: [cuadrado()] }, { productor: 'Peña' })]
    expect(shapefileDe(f, { codificacion: '1252' }).parcelas[0].propiedades.productor).toBe('Peña')
    expect(shapefileDe(f, { codificacion: '1252', cpg: false }).parcelas[0].propiedades.productor).toBe('Peña')
    expect(shapefileDe(f).parcelas[0].etiqueta).toBe('P-Ñ1')
  })

  it('sin el .dbf avisa qué falta', () => {
    const { shp, shx } = archivosShapefile(poligonos)
    expect(() => leerArchivos(comoArchivos('parcelas', { shp, shx }))).toThrow(/\.dbf/)
    const { dbf } = archivosShapefile(poligonos)
    expect(() => leerArchivos(comoArchivos('parcelas', { dbf }))).toThrow(/\.shp/)
  })

  it('si el .shp y el .dbf no coinciden, lo dice', () => {
    const { shp } = archivosShapefile(poligonos)
    const { dbf } = archivosShapefile(poligonos.slice(0, 3))
    expect(() => leerArchivos(comoArchivos('parcelas', { shp, dbf }))).toThrow(/no tienen la misma cantidad/)
  })

  it('un .shp que no es shapefile da un aviso claro', () => {
    const { dbf } = archivosShapefile(poligonos)
    expect(() => leerArchivos(comoArchivos('parcelas', { shp: strToU8('no soy un shapefile'), dbf }))).toThrow(
      ErrorDeArchivo,
    )
  })

  it('el GeoJSON corregido escribe los números del shapefile sin agregar ceros', async () => {
    const entrada = shapefileDe(poligonos.slice(0, 1))
    const { archivos } = (await import('../src/motor/trabajo.js')).procesar(entrada, { formato: 'shapefile' })
    const corregido = JSON.parse(await archivos.corregido.text())
    expect(corregido.features[0].geometry.coordinates).toEqual(entrada.parcelas[0].coords)
  })
})

describe('en el worker', () => {
  it('recibe los archivos sueltos de un shapefile y responde el informe', async () => {
    const archivos = archivosShapefile(puntosValidos())
    const lista = Object.entries(archivos).map(([ext, bytes]) => new File([bytes], `puntos.${ext}`))
    const mensajes = []
    await atender({ id: 1, entrada: lista }, (m) => mensajes.push(m))
    const listo = mensajes.find((m) => m.tipo === 'listo')
    expect(listo.resultado.informe.parcelas).toBe(15)
    expect(listo.resultado.informe.resultados).toEqual([])
  })

  it('recibe un KMZ', async () => {
    const kmz = new File([bytesKMZ(datos('valido.kml'))], 'valido.kmz')
    const mensajes = []
    await atender({ id: 2, entrada: kmz }, (m) => mensajes.push(m))
    expect(mensajes.find((m) => m.tipo === 'listo').resultado.informe.parcelas).toBe(25)
  })

  it('un shapefile incompleto vuelve como error del archivo, no como fallo interno', async () => {
    const { shp } = archivosShapefile(puntosValidos())
    const mensajes = []
    await atender({ id: 3, entrada: [new File([shp], 'puntos.shp')] }, (m) => mensajes.push(m))
    const error = mensajes.find((m) => m.tipo === 'error').error
    expect(error.clase).toBe('archivo')
    expect(error.mensaje).toMatch(/\.dbf/)
  })

  it('un .zip de shapefile completo funciona igual que los archivos sueltos', async () => {
    const zip = new File([bytesZipShapefile('puntos', archivosShapefile(puntosValidos()))], 'puntos.zip')
    const mensajes = []
    await atender({ id: 4, entrada: zip }, (m) => mensajes.push(m))
    expect(mensajes.find((m) => m.tipo === 'listo').resultado.informe.parcelas).toBe(15)
  })
})

it('los datos sintéticos de v1 existen y se leen', () => {
  expect(parcelasMezcladas().length).toBeGreaterThan(20)
  for (const nombre of ['valido.kml', 'valido.kmz', 'valido-poligonos-shp.zip', 'valido-puntos-shp.zip', 'errores-mezclados.kml']) {
    expect(readFileSync(join(DIR_DATOS, nombre)).length).toBeGreaterThan(0)
  }
})
