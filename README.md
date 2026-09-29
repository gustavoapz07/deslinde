# Deslinde

Validador de parcelas de café para el EUDR (reglamento europeo contra la deforestación).
Recibe archivos de parcelas, revisa que la geometría cumpla las reglas de geolocalización
y muestra los errores en un mapa. Todo ocurre en el navegador: los archivos no se suben a ningún servidor.

> **Herramienta de apoyo.** Deslinde no certifica el cumplimiento del EUDR ni emite dictámenes
> de deforestación. La responsabilidad legal sigue siendo del operador.

Prototipo v0 de portafolio. Solo usa **datos sintéticos**: ninguna coordenada corresponde a una finca real.
La investigación, las decisiones y el plan están en la bóveda de Obsidian `Agro y Cumplimiento`.

## Estado

| Fase | Estado |
|------|--------|
| 0. Preparar: stack, datos sintéticos, pruebas escritas | Hecha el 28-09-2026 |
| 1. Motor de validación (R1 a R12) y salidas | Hecha el 28-09-2026: 36 pruebas pasan; 10,000 parcelas en unos 0.5 s |
| 2. Interfaz: carga, mapa, lista de errores | Pendiente |
| 3. Auditoría y publicación | Pendiente |

## Cómo correrlo

Requiere Node 24 o más reciente.

```bash
npm install
npm test            # genera los datos sintéticos y corre las pruebas
npm run test:loop   # pruebas en modo vigilancia, para trabajar regla por regla
npm run datos       # solo regenera los datos sintéticos
npm run dev         # página en desarrollo
```

## Formato de entrada (v0)

**GeoJSON**: un `FeatureCollection` en EPSG:4326 (longitud, latitud). Cada parcela es un `Feature` con:

| Propiedad | Obligatoria | Uso |
|-----------|-------------|-----|
| `id` | Sí | Código de la parcela, aparece en el informe |
| `area_ha` | Para R9 y R12 | Área declarada en hectáreas |
| `productor` | No | Código seudónimo; nunca el nombre real en datos de prueba |

Geometrías admitidas: `Point` (parcelas de hasta 4 ha), `Polygon` y `MultiPolygon`.

**CSV de puntos**: columnas `id,productor,latitud,longitud,area_ha`. Se leen por nombre, no por posición.

Las coordenadas deben venir **escritas** con al menos 6 decimales. El motor cuenta los decimales
en el texto del archivo, porque al leerlo como número se pierden los ceros finales (`14.500000` pasa a ser `14.5`).

## Uso del motor

```js
import { validarTexto, informeCSV, geojsonCorregido } from './src/motor/index.js'

const informe = validarTexto(texto, { formato: 'geojson' }) // o 'csv'
// informe.resultados: [{ parcela, regla, severidad, ubicacion, mensaje, accion }]
const csv = informeCSV(informe)            // una fila por hallazgo, con BOM para Excel
const corregido = geojsonCorregido(texto)  // GeoJSON EPSG:4326 con las correcciones seguras
```

Si el archivo no se puede leer, `validarTexto` lanza `ErrorDeArchivo` con un mensaje en español.

**Correcciones seguras** que aplica el GeoJSON corregido: invierte pares latitud/longitud (R3), cierra
anillos (R5) y quita vértices repetidos seguidos (R7). Lo demás queda como venía y sigue en el informe.
Cada número se escribe con su texto original: no se pierden ceros finales ni se agregan decimales.

**Opciones** (valores iniciales, por probar): `umbralAreaPct: 10` para R12 y `solapeMinimoM2: 10` para R10.

## Reglas

| Regla | Qué revisa | Severidad |
|-------|------------|-----------|
| R1 | Coordenadas en grados EPSG:4326 y geometría legible (Point, Polygon o MultiPolygon). Si falla, la parcela no se revisa con las demás reglas | Error |
| R2 | Al menos 6 decimales, contados sobre el texto del archivo | Error |
| R3 | Latitud y longitud invertidas (leídas al revés caen en Honduras) | Advertencia |
| R4 | Dentro de la caja aproximada de Honduras | Advertencia |
| R5 | Anillo cerrado y con al menos 3 puntos distintos | Error |
| R6 | Sin autointersecciones | Error |
| R7 | Sin vértices repetidos | Error |
| R8 | Un multipolígono no junta partes separadas | Error |
| R9 | Más de 4 ha como polígono, no como punto; punto sin área declarada | Error / advertencia |
| R10 | Solapes entre parcelas | Advertencia |
| R11 | Geometrías duplicadas | Advertencia |
| R12 | Área declarada contra área calculada | Advertencia |

## Datos sintéticos

`npm run datos` los escribe en `datos/sinteticos/` con semilla fija, así que siempre salen iguales:

- `valido.geojson`: 25 parcelas sin errores.
- `valido-puntos.csv`: 15 parcelas como puntos, sin errores.
- `grande-10000.geojson`: 10,000 parcelas sin errores, para medir el rendimiento. No se guarda en Git.
- `casos/`: un archivo por regla, numerado como los casos de prueba.
- `errores-mezclados.geojson`: 10 parcelas válidas y todos los casos juntos, para la demo.

Las parcelas se dibujan en una cuadrícula dentro de una zona interior de Honduras. Son polígonos en
estrella que no se cruzan ni se solapan entre sí.

## Stack

| Pieza | Paquete | Versión | Licencia |
|-------|---------|---------|----------|
| Geometría | `@turf/turf` | 7.4.0 | MIT |
| Mapa (Fase 2) | `maplibre-gl` | 6.11.2 | BSD-3-Clause |
| Servidor de desarrollo y compilación | `vite` | 8.3.1 | MIT |
| Pruebas | `vitest` | 5.0.2 | MIT |

Versiones y licencias leídas del `package.json` de cada paquete instalado el 28-09-2026.

## Licencia

Código bajo licencia [MIT](LICENSE).
