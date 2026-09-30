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
| 2. Interfaz: carga, mapa, lista de errores | Hecha el 28-09-2026: Web Worker, mapa por severidad, lista enlazada al mapa, ejemplo para probar, veredicto en lenguaje simple y ayuda (80 pruebas pasan) |
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
`alAvanzar(avance)` recibe el avance: `leyendo`, `revisando` (cada 500 parcelas, con `hechas` y `total`) y `comparando`.

## En la página: Web Worker

La página no llama al motor directamente: lo corre en un Web Worker (`src/motor/trabajador.js`)
para que un archivo grande no congele la pantalla.

```js
import { crearValidador, Cancelado, ErrorDeArchivo } from './src/validador.js'

const validador = crearValidador()
const { informe, limites, archivos } = await validador.validar(archivo, {
  formato: 'geojson',                  // o 'csv'
  alAvanzar: (avance) => { /* mostrar el avance */ },
})
// archivos.mapa: capa GeoJSON para MapLibre, una parcela por Feature con su peor severidad
// archivos.informe y archivos.corregido: las descargas, listas para URL.createObjectURL
// limites: [oeste, sur, este, norte] de las parcelas dibujables, para encuadrar el mapa
```

- Se le pasa el archivo (`File`) y no el texto: la lectura también ocurre fuera de la página.
- Las salidas vuelven como `Blob`, así que pasarlas entre hilos no copia su contenido.
- Un archivo nuevo cancela la revisión anterior (esa promesa se rechaza con `Cancelado`).
- Un archivo ilegible rechaza con `ErrorDeArchivo`. Un fallo interno rechaza con un mensaje que aclara que no es culpa del archivo.

Medido el 28-09-2026 en el navegador, con el build de producción y el archivo de 10,000 parcelas:

| | Tiempo total | Mayor bloqueo de la página |
|---|---|---|
| Con Web Worker | 0.49 a 0.56 s | Ninguna tarea larga; la página responde igual que en reposo (unos 20 ms) |
| Sin Web Worker (el mismo motor en la página) | 0.53 a 0.62 s | La página queda congelada toda la revisión (527 a 622 ms) |

## La página

Pensada para técnicos de cooperativas y encargados de cumplimiento, en español simple:

- **Primera vista**: qué hace Deslinde en tres pasos, el botón para elegir un archivo y **"Probar con un ejemplo"**,
  que carga `datos/sinteticos/errores-mezclados.geojson` (24 parcelas inventadas, un caso por regla).
  Quien visita el portafolio no tiene un archivo de parcelas a mano.
- **Arrastrar y soltar** el archivo en cualquier parte de la página. Un formato que no es GeoJSON ni CSV recibe un mensaje claro.
- **Avance** con barra mientras el worker revisa.
- **Veredicto** en una frase, contando parcelas (lo que hay que ir a corregir): "7 parcelas tienen errores. Corríjalas antes de enviar el archivo."
  Debajo, qué se revisó y qué no: 12 reglas de geolocalización, no deforestación.
- **Ayuda plegable**: qué revisa cada regla y qué formato acepta, con el archivo de ejemplo para descargar.
- **Privacidad**: la casilla del mapa base con lo que recibe OpenFreeMap, y el aviso de herramienta de apoyo.
- **Celular**: resultado, mapa, lista y ayuda, uno debajo del otro, para que el mapa se vea apenas termina la revisión.

## Mapa

`src/mapa/` dibuja las parcelas con MapLibre sobre el mapa base de OpenFreeMap (estilo `positron`).

- **Colores por severidad**: rojo oscuro (errores), ámbar (solo advertencias) y azul (sin hallazgos).
  Se distinguen por tono y por claridad, también con daltonismo rojo-verde; el borde del error es más grueso.
- **Puntos negros**: dónde está cada problema (el cruce, el vértice repetido…), desde zoom 12.
- **Parcelas que se cruzan (R6)**: se dibujan como contorno. Como polígono, un moño tiene área neta cero y
  MapLibre lo descarta al cortar en teselas: la parcela desaparecía del mapa.
- **Clic en una parcela**: ficha con su código, estado, hallazgos y qué hacer. Los textos del archivo se escriben como texto, nunca como HTML.
  Si el clic no cae dentro de una parcela, se busca en un margen de 6 px, para acertarle a un contorno o a un punto con el dedo.
- **Encuadre**: las parcelas dentro de Honduras. Una parcela lejana (R4) se dibuja igual, pero no achica el resto.
- **Mapa base apagable**: sin él, el estilo no tiene ninguna dirección de internet y el mapa no pide nada.
  La preferencia se recuerda en el navegador. Si OpenFreeMap no responde, las parcelas se ven sobre fondo liso.
- **Auditoría de privacidad**: `#mapa[data-peticiones-externas]` cuenta las peticiones del mapa que salen del equipo.
  Con el mapa base apagado no sube al mover ni acercar el mapa.

Las capas de parcelas y de hallazgos llegan del worker como URL de un `Blob`: MapLibre las lee y las corta en su propio worker.
Con 10,000 parcelas la página no se congela; MapLibre tiene pausas ocasionales de 50 a 160 ms al cargar teselas nuevas.

La parte que no necesita MapLibre (estilo, capas, ficha) está en `src/mapa/capas.js` y se prueba en Node (`pruebas/mapa.test.js`).

## Lista de hallazgos

`src/lista/` muestra los hallazgos en el panel, enlazados con el mapa:

- **Hallazgo → mapa**: al elegir uno, el mapa va a la ubicación del problema y abre la ficha de su parcela.
  En celular, además, trae el mapa a la vista. Los hallazgos sin ubicación (R1) se muestran como texto.
- **Mapa → lista**: al elegir una parcela en el mapa, la lista marca sus hallazgos y los centra en el panel. Al cerrar la ficha, se desmarcan.
- **Filtros** por severidad y por regla, con la cantidad de cada una: sirve para ver cuál es el problema más común.
- **De a 100**: la lista dibuja un tramo de 100 hallazgos, con "Mostrar 100 más" y "Mostrar 100 anteriores".
  Si se elige en el mapa una parcela que cae más abajo, la lista salta a su tramo en vez de dibujar todo lo anterior
  (con 10,000 hallazgos, dibujarlos todos congelaba la página 1.85 s).
- Cada hallazgo sabe la posición de su parcela en el archivo (`indices`, que entrega el worker), no solo su código:
  dos parcelas con el mismo código no se mezclan.

La parte sin DOM (filtros, conteo por regla, tramo) está en `src/lista/datos.js` y se prueba en Node (`pruebas/lista.test.js`).

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
| Mapa | `maplibre-gl` | 6.11.2 | BSD-3-Clause |
| Mapa base (servicio, sin paquete) | OpenFreeMap, estilo `positron` | — | Datos © OpenStreetMap (ODbL), OpenMapTiles |
| Servidor de desarrollo y compilación | `vite` | 8.3.1 | MIT |
| Pruebas | `vitest` | 5.0.2 | MIT |

Versiones y licencias leídas del `package.json` de cada paquete instalado el 28-09-2026.

## Licencia

Código bajo licencia [MIT](LICENSE).
