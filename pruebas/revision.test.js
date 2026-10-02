// Pruebas de la revisión con evidencia (segunda parte de la 6c). Para cada
// parcela que cae en bosque de 2020 (R15), una persona registra su decisión,
// el motivo, quién revisó y adjuntos. Se guarda en este navegador, nunca se
// sube. El formulario y el guardado de verdad (IndexedDB) se prueban en el
// navegador; aquí, los datos y el guardado en memoria.

import { describe, expect, it } from 'vitest'
import { textoGeoJSON } from '../scripts/generar-datos.js'
import { leerArchivos } from '../src/motor/archivos.js'
import { procesarConBosque } from '../src/motor/trabajo.js'
import { crearAlmacen } from '../src/revision/almacen.js'
import {
  claveDeParcela,
  DECISIONES,
  estadoDeRevision,
  huellaDeGeometria,
  MB_POR_ADJUNTO,
  nuevaRevision,
  resumenDeRevisiones,
  validarRevision,
} from '../src/revision/datos.js'

const cuadrado = (lon, lat = 14.41, lado = 0.001) => [
  [lon, lat],
  [lon + lado, lat],
  [lon + lado, lat + lado],
  [lon, lat + lado],
  [lon, lat],
]
const parcela = (id, lon) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates: [cuadrado(lon)] } })
const archivo = (nombre, features) => ({ nombre, bytes: new TextEncoder().encode(textoGeoJSON(features)) })
const todoBosque = async () => new Uint8Array(600 * 600).fill(1)
const adjunto = (nombre, tipo, bytes = 10) => new File([new Uint8Array(bytes)], nombre, { type: tipo })

describe('identidad de una parcela', () => {
  it('la huella depende de la geometría y no cambia de una vez a otra', () => {
    const a = huellaDeGeometria('Polygon', [[['-88.190000', '14.410000'], ['-88.189000', '14.410000']]])
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(huellaDeGeometria('Polygon', [[['-88.190000', '14.410000'], ['-88.189000', '14.410000']]])).toBe(a)
    expect(huellaDeGeometria('Polygon', [[['-88.190000', '14.410000'], ['-88.189001', '14.410000']]])).not.toBe(a)
  })

  it('la clave junta archivo, código y huella', () => {
    expect(claveDeParcela({ archivo: 'norte.kml', etiqueta: 'HN-0101', huella: '0a1b2c3d' })).toBe('norte.kml|HN-0101|0a1b2c3d')
    expect(claveDeParcela({ etiqueta: 'P-1', huella: '0a1b2c3d' })).toBe('|P-1|0a1b2c3d')
  })

  it('el worker da la clave de cada parcela con bosque, la misma aunque cambie su posición en la revisión', async () => {
    const norte = archivo('norte.geojson', [parcela('A-1', -88.19), parcela('A-2', -88.18)])
    const otro = archivo('otro.geojson', [parcela('B-1', -88.17)])
    const sola = await procesarConBosque(leerArchivos([norte]), { consultarCelda: todoBosque })
    const sumada = await procesarConBosque(leerArchivos([otro, norte]), { consultarCelda: todoBosque })
    expect(sola.revisables.map((r) => [r.indice, r.etiqueta])).toEqual([
      [0, 'A-1'],
      [1, 'A-2'],
    ])
    const claveDe = (resultado, etiqueta) => resultado.revisables.find((r) => r.etiqueta === etiqueta).clave
    expect(claveDe(sumada, 'A-1')).toBe(claveDe(sola, 'A-1'))
    expect(sumada.revisables.find((r) => r.etiqueta === 'A-1').indice).toBe(1)
    expect(claveDe(sola, 'A-1')).not.toBe(claveDe(sola, 'A-2'))
  })

  it('sin bosque no hay nada que revisar', async () => {
    const { revisables } = await procesarConBosque(leerArchivos([archivo('n.geojson', [parcela('A-1', -88.19)])]), {
      consultarCelda: async () => new Uint8Array(600 * 600),
    })
    expect(revisables).toEqual([])
  })
})

describe('el formulario', () => {
  const completa = { decision: 'agricola', motivo: 'Café con sombra sembrado en 2012.', revisor: 'Ana López', adjuntos: [] }

  it('hay tres decisiones, con su nombre en español', () => {
    expect(Object.keys(DECISIONES)).toEqual(['agricola', 'campo', 'excluir'])
    expect(DECISIONES.agricola).toMatch(/antes de 2021/)
  })

  it('una revisión completa no tiene errores', () => {
    expect(validarRevision(completa)).toEqual([])
  })

  it('pide la decisión, el motivo y quién revisó', () => {
    expect(validarRevision({ ...completa, decision: '' })).toEqual(['Elija una decisión.'])
    expect(validarRevision({ ...completa, motivo: '   ' })).toEqual(['Escriba el motivo y la evidencia.'])
    expect(validarRevision({ ...completa, revisor: '' })).toEqual(['Escriba quién revisó.'])
  })

  it('acepta fotos y PDF de hasta 10 MB', () => {
    expect(MB_POR_ADJUNTO).toBe(10)
    const bien = [adjunto('finca.jpg', 'image/jpeg'), adjunto('registro.pdf', 'application/pdf')]
    expect(validarRevision({ ...completa, adjuntos: bien })).toEqual([])
    expect(validarRevision({ ...completa, adjuntos: [adjunto('datos.xlsx', 'application/vnd.ms-excel')] })).toEqual([
      '"datos.xlsx" no es una foto ni un PDF.',
    ])
    const grande = adjunto('grande.png', 'image/png', 10 * 1024 * 1024 + 1)
    expect(validarRevision({ ...completa, adjuntos: [grande] })).toEqual(['"grande.png" pesa más de 10 MB.'])
  })

  it('al guardarla lleva la fecha y los adjuntos con su nombre y tipo', () => {
    const foto = adjunto('finca.jpg', 'image/jpeg')
    const r = nuevaRevision({ ...completa, motivo: '  Café con sombra.  ', adjuntos: [foto] }, new Date('2026-10-02T12:30:00Z'))
    expect(r).toMatchObject({ decision: 'agricola', motivo: 'Café con sombra.', revisor: 'Ana López', fecha: '2026-10-02T12:30:00.000Z' })
    expect(r.adjuntos).toHaveLength(1)
    expect(r.adjuntos[0]).toMatchObject({ nombre: 'finca.jpg', tipo: 'image/jpeg', tamano: 10 })
    expect(r.adjuntos[0].datos).toBeInstanceOf(Blob)
  })

  it('el estado que se muestra en la lista', () => {
    expect(estadoDeRevision(undefined)).toBe('Sin revisar')
    expect(estadoDeRevision({ decision: 'campo' })).toBe('Revisada: pendiente de visita de campo')
    expect(estadoDeRevision({ decision: 'excluir' })).toBe('Revisada: se excluye del lote')
  })

  it('cuántas faltan', () => {
    const revisiones = new Map([
      ['a', { decision: 'agricola' }],
      ['b', { decision: 'excluir' }],
      ['z', { decision: 'campo' }], // de otra revisión: no cuenta
    ])
    expect(resumenDeRevisiones(['a', 'b', 'c'], revisiones)).toEqual({
      total: 3,
      revisadas: 2,
      porDecision: { agricola: 1, campo: 0, excluir: 1 },
    })
  })
})

describe('el guardado', () => {
  it('sin IndexedDB (como en Node) guarda en memoria y lo dice', async () => {
    const almacen = await crearAlmacen()
    expect(almacen.persistente).toBe(false)
    const r = { decision: 'campo', motivo: 'Hay que ir.', revisor: 'Ana', fecha: '2026-10-02T12:30:00.000Z', adjuntos: [] }
    await almacen.guardar('k1', r)
    expect(await almacen.leer('k1')).toEqual(r)
    expect((await almacen.leerVarias(['k1', 'k2'])).get('k1')).toEqual(r)
    await almacen.borrar('k1')
    expect(await almacen.leer('k1')).toBeUndefined()
    await almacen.guardar('k2', r)
    await almacen.borrarTodo()
    expect((await almacen.leerVarias(['k2'])).size).toBe(0)
  })
})
