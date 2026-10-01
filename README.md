# Deslinde

Validador de parcelas de café para el EUDR (reglamento europeo contra la deforestación).
Recibe archivos de parcelas, revisa que la geometría cumpla las reglas de geolocalización
y muestra los errores en un mapa. Todo ocurre en el navegador: los archivos no se suben a ningún servidor.

**En línea: [deslinde.pages.dev](https://deslinde.pages.dev/)**. El botón «Probar con un ejemplo» carga 24 parcelas inventadas.

> **Herramienta de apoyo.** Deslinde no certifica el cumplimiento del EUDR ni emite dictámenes
> de deforestación. La responsabilidad legal sigue siendo del operador.

Prototipo de portafolio, camino a la v1. Solo usa **datos sintéticos**: ninguna coordenada corresponde a una finca real.
La investigación, las decisiones y el plan están en la bóveda de Obsidian `Agro y Cumplimiento`.

## Estado

| Fase | Estado |
|------|--------|
| 0. Preparar: stack, datos sintéticos, pruebas escritas | Hecha el 28-09-2026 |
| 1. Motor de validación (R1 a R12) y salidas | Hecha el 28-09-2026: 36 pruebas pasan; 10,000 parcelas en unos 0.5 s |
| 2. Interfaz: carga, mapa, lista de errores | Hecha el 28-09-2026: Web Worker, mapa por severidad, lista enlazada al mapa, ejemplo para probar, veredicto en lenguaje simple y ayuda (80 pruebas pasan) |
| 3. Auditoría y publicación | Publicada el 30-09-2026 en [deslinde.pages.dev](https://deslinde.pages.dev/), con auditoría, rediseño y privacidad revisados (82 pruebas pasan). Falta la prueba con una persona ajena |
| 4. Portafolio | Presentación del caso hecha el 30-09-2026; el post se publica al terminar la v1 |
| 5. Rediseño | Hecho el 30-09-2026: tema oscuro con el mapa al centro, parcelas agrupadas de lejos y con su código de cerca, ficha al costado (92 pruebas pasan) |
| 6a. KML y shapefile | Hecha el 01-10-2026: KML, KMZ y shapefile (en .zip o con sus archivos sueltos), comprobado contra pyshp (120 pruebas pasan) |
| 6b. Juntar archivos de varias fuentes | Hecha el 01-10-2026: varios archivos se revisan juntos, R11 avisa de la misma parcela en dos archivos (por geometría o por código) y sale un solo archivo unido (147 pruebas pasan) |
| 6c y 6d. Resto de la v1 | Siguen: revisión de bosque 2020 con evidencia e informe en PDF |

## Cómo correrlo

Requiere Node 24 o más reciente.

```bash
npm install
npm test            # genera los datos sintéticos y corre las pruebas
npm run test:loop   # pruebas en modo vigilancia, para trabajar regla por regla
npm run datos       # solo regenera los datos sintéticos
npm run dev         # página en desarrollo
npm run build       # build de producción en dist/
npm run preview     # sirve dist/ con las mismas cabeceras que Cloudflare Pages
```

## Formatos de entrada

**GeoJSON**: un `FeatureCollection` en EPSG:4326 (longitud, latitud). Cada parcela es un `Feature` con:

| Propiedad | Obligatoria | Uso |
|-----------|-------------|-----|
| `id` | Sí | Código de la parcela, aparece en el informe |
| `area_ha` | Para R9 y R12 | Área declarada en hectáreas |
| `productor` | No | Código seudónimo; nunca el nombre real en datos de prueba |

Geometrías admitidas: `Point` (parcelas de hasta 4 ha), `Polygon` y `MultiPolygon`.

**KML o KMZ** (como los de Google Earth): una parcela por `Placemark`, dentro de carpetas o no. El código sale
del dato `id` de `ExtendedData` (en `Data/value` o en `SchemaData/SimpleData`); si no está, del nombre del Placemark
y, si tampoco, de su atributo `id`. El área sale del dato `area_ha`. Un `MultiGeometry` de polígonos se lee como
`MultiPolygon`. El KMZ se abre y se lee su `doc.kml` (o el primer KML que traiga).

**Shapefile** en grados: un `.zip` con el `.shp`, el `.dbf` y sus compañeros, o esos archivos elegidos juntos.
El `.dbf` trae las columnas `ID`, `AREA_HA` y, si se quiere, `PRODUCTOR` (se leen sin importar mayúsculas).
Admite puntos y polígonos, también con Z o M. El `.cpg` dice la codificación del `.dbf`; sin él, se usa UTF-8
si todo el archivo lo es y, si no, Windows-1252. Por ahora no se reproyecta: un shapefile en metros (UTM)
sale con R1, como un GeoJSON en metros.

**CSV de puntos**: columnas `id,productor,latitud,longitud,area_ha`. Se leen por nombre, no por posición.

Las coordenadas deben venir **escritas** con al menos 6 decimales. En GeoJSON, KML y CSV el motor cuenta los
decimales en el texto del archivo, porque al leerlo como número se pierden los ceros finales (`14.500000` pasa
a ser `14.5`). El shapefile no tiene texto: guarda números binarios. Ahí R2 marca la parcela si **ninguna**
coordenada necesita más de 5 decimales, es decir, si se exportó redondeada. Contar como en el texto marcaría
casi todo polígono, porque uno de cada diez números medidos con 6 decimales termina en cero.

## Juntar archivos de varias fuentes

Un exportador suele recibir parcelas de varios lados: una cooperativa, un beneficio, sus técnicos de campo, cada
uno en su formato. Deslinde acepta **varios archivos a la vez**, de formatos distintos (elegidos juntos, o sumados
después de la primera revisión), y los trata como un solo conjunto:

- Cada archivo es una **fuente**. Un shapefile son varios archivos (`.shp`, `.dbf`…) que forman una sola; un `.zip`
  puede traer varias. Las partes sueltas de dos shapefiles se emparejan por su nombre.
- Las parcelas de todas se revisan **juntas**: R10 encuentra solapes entre archivos y R11, la misma parcela en dos
  archivos, por tener la misma geometría o el mismo código. Cada aviso nombra el archivo de la otra parcela y, si
  tiene el mismo código, su posición en ese archivo ("la n.º 8 de beneficio-sur.kml").
- Cada hallazgo dice de qué archivo es su parcela: en la lista (que además se filtra por archivo), en la ficha del
  mapa y en la columna `archivo` del informe CSV.
- El **archivo unido** (GeoJSON) trae las parcelas de todos, con las correcciones seguras y la propiedad
  `archivo_origen` de cada una. Si una parcela ya la traía de una unión anterior, se respeta.
- Un archivo que no se puede leer no frena a los demás: aparece en la lista con el motivo. Solo si ninguno se puede
  leer la revisión falla.
- Un archivo se puede quitar de la revisión. Uno que ya está (mismo nombre, tamaño y fecha) no se suma dos veces.

El código se compara sin espacios alrededor y sin distinguir mayúsculas (`hn-0101 ` y `HN-0101` son el mismo).
Las parcelas sin código no cuentan para esta parte de R11.

## Uso del motor

```js
import { validarTexto, informeCSV, geojsonCorregido } from './src/motor/index.js'

const informe = validarTexto(texto, { formato: 'geojson' }) // o 'csv' o 'kml'
// informe.resultados: [{ parcela, archivo, regla, severidad, ubicacion, mensaje, accion }]
const csv = informeCSV(informe)            // una fila por hallazgo, con BOM para Excel
const corregido = geojsonCorregido(texto)  // GeoJSON EPSG:4326 con las correcciones seguras
```

Si el archivo no se puede leer, `validarTexto` lanza `ErrorDeArchivo` con un mensaje en español.

Para archivos binarios o comprimidos (shapefile, KMZ, `.zip`) y para varios archivos, `leerArchivos`
(`src/motor/archivos.js`) recibe los nombres y los bytes, decide el formato de cada uno por la extensión y devuelve
una **fuente** por archivo de parcelas, ya leída. `analizar` revisa las fuentes juntas:

```js
import { leerArchivos } from './src/motor/archivos.js'
import { analizar } from './src/motor/index.js'

const fuentes = leerArchivos([
  { nombre: 'cooperativa.kml', bytes },
  { nombre: 'tecnicos.zip', bytes: otros },
]) // [{ nombre, formato, parcelas, de }, …]; las que no se leen traen `error` en vez de `parcelas`
const { informe } = analizar(fuentes)
// informe.fuentes: [{ nombre, formato, parcelas, error?, de }]; cada resultado trae su `archivo`
```

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
const { informe, limites, archivos } = await validador.validar(elegidos, {
  // elegidos: los File que eligió la persona (uno, los de un shapefile o los de varias fuentes)
  alAvanzar: (avance) => { /* mostrar el avance */ },
})
// archivos.mapa: capa GeoJSON para MapLibre, una parcela por Feature con su peor severidad
// archivos.centros: un punto por parcela, dentro de ella, para verlas de lejos y poner su código
// archivos.hallazgos: un punto por hallazgo con ubicación, con su regla
// archivos.informe y archivos.corregido: las descargas, listas para URL.createObjectURL
// limites: [oeste, sur, este, norte] de las parcelas dibujables, para encuadrar el mapa
```

- Se le pasan los archivos (`File`) y no el texto: la lectura, la descompresión y la elección del formato
  también ocurren fuera de la página.
- Las salidas vuelven como `Blob`, así que pasarlas entre hilos no copia su contenido.
- Un archivo nuevo cancela la revisión anterior (esa promesa se rechaza con `Cancelado`).
- Un archivo ilegible rechaza con `ErrorDeArchivo`. Un fallo interno rechaza con un mensaje que aclara que no es culpa del archivo.

Medido el 28-09-2026 en el navegador, con el build de producción y el archivo de 10,000 parcelas:

| | Tiempo total | Mayor bloqueo de la página |
|---|---|---|
| Con Web Worker | 0.49 a 0.56 s | Ninguna tarea larga; la página responde igual que en reposo (unos 20 ms) |
| Sin Web Worker (el mismo motor en la página) | 0.53 a 0.62 s | La página queda congelada toda la revisión (527 a 622 ms) |

## La página

Pensada para técnicos de cooperativas, exportadores y encargados de cumplimiento, en español simple.

**Identidad**: tema oscuro y minimalista, con el mapa al centro. Fondo casi negro con un verde apenas insinuado,
verde hoja para las acciones y café oro solo en el logo: un grano de café oro (el café verde de exportación) dentro
de las marcas de esquina de un encuadre, porque Deslinde revisa los límites de cada parcela. Una sola familia,
Manrope, para el nombre y el texto; los códigos de parcela, en IBM Plex Mono. Las dos se sirven desde el propio
sitio. Pocas cajas: el aire y las líneas finas separan las partes, y el color queda para las severidades y las
acciones. Sin degradados, sin etiquetas tipo píldora y sin títulos en mayúsculas pequeñas.

- **Pantalla ancha**: el panel a la izquierda (archivo, resultado, lista y ayuda) y el mapa en todo el resto, con el
  interruptor del mapa base, la leyenda y la ficha de la parcela flotando encima.
- **Primera vista**: una zona para soltar el archivo (en pantallas táctiles invita a elegirlo) y el botón **"Probar con un ejemplo"**,
  que carga `datos/sinteticos/errores-mezclados.geojson` (24 parcelas inventadas, un caso por regla). Debajo, sin
  borde, **"Juntar tres archivos de ejemplo"** carga las tres fuentes de `datos/sinteticos/juntar/`. El mapa vacío
  ofrece lo mismo: quien visita el portafolio no tiene un archivo de parcelas a mano. Los ejemplos se sirven siempre
  como archivo, nunca incrustados como `data:` (`vite.config.js`), porque la política de seguridad no deja leerlos así.
- **Arrastrar y soltar** el archivo en cualquier parte de la página. Un formato que Deslinde no lee recibe un mensaje claro.
- **Archivos revisados**: el nombre de cada uno y cuántas parcelas trae, o por qué no se pudo leer. Debajo, "Sumar otro
  archivo" agrega uno a la revisión; con varios, cada uno se puede quitar y se ve el total. Soltar archivos sobre la
  página empieza una revisión nueva (así, el archivo corregido reemplaza al anterior en vez de duplicarlo).
- **Avance** con barra mientras el worker revisa.
- **Veredicto** en una frase, con un ícono de forma distinta por severidad, contando parcelas (lo que hay que ir a corregir):
  "7 parcelas tienen errores. Corríjalas antes de enviar el archivo." Debajo, qué se revisó y qué no: 12 reglas de
  geolocalización, no deforestación. Luego, las cifras de cada grupo y una barra con su proporción.
- **Hallazgos** en filas, con filtro segmentado por severidad (radios, se usa con las flechas del teclado), por regla y,
  al juntar varios archivos, por archivo. Cada hallazgo lleva el ícono de su severidad, el código de la parcela (y su
  archivo, si hay varios) y el nombre de la regla, no solo su número.
- **Ayuda plegable**: qué revisa cada regla, qué corrige el archivo corregido y qué formato acepta, con el archivo de ejemplo para descargar.
- **Celular**: resultado, mapa, lista y ayuda, uno debajo del otro, para que el mapa se vea apenas termina la revisión.
  La ficha de la parcela sube desde abajo y tapa la mitad del mapa como mucho.
- **Accesibilidad**: al terminar la revisión o al fallar, un aviso para lectores de pantalla dice el veredicto
  (`#anuncio`); el avance no se anuncia. Los controles del mapa están en español. La lista es la forma de
  recorrer los hallazgos con teclado; Escape cierra la ficha. Si se pidió menos movimiento, el mapa y la página
  no se animan. Todo el texto pasa el contraste AA (el par más bajo, 5.3:1).

## Peso y seguridad

- **El mapa se carga aparte** (`import()` en `src/main.js`). MapLibre es casi todo el peso: sin él, la página
  se puede usar con unos 17 KB comprimidos (antes, 296 KB). Los 435 KB del mapa y su worker bajan enseguida,
  en segundo plano. Si no llegan, la revisión, la lista y las descargas funcionan igual y el mapa lo avisa.

  | Qué | Comprimido (gzip) | Cuándo baja |
  |-----|-------------------|-------------|
  | Página (HTML, JS y CSS) | 17 KB | Al abrir |
  | Fuentes Manrope y IBM Plex Mono (solo alfabeto latino) | 39 KB | Al abrir, en paralelo; mientras tanto, la fuente del sistema |
  | MapLibre y su CSS | 291 KB | Justo después, en segundo plano |
  | Worker de MapLibre | 144 KB | Cuando arranca el mapa |
  | Motor (worker, con Turf) | 26 KB | Al revisar el primer archivo |
  | Letras de las etiquetas del mapa (`public/glyphs`) | 79 KB | Solo con el mapa base apagado; encendido, las da OpenFreeMap |

- **Fuentes siempre como archivo**: `vite.config.js` no deja que Vite incruste las fuentes chicas como `data:`,
  porque la política de seguridad las bloquearía (`font-src 'self'`).

- **Política de contenido (CSP)** en `public/_headers`, que Cloudflare Pages aplica a todo el sitio:
  el navegador solo deja conectar con Deslinde y con `tiles.openfreemap.org`. Aunque un error del código
  lo intentara, el archivo de parcelas no puede salir del equipo. `vite preview` sirve las mismas cabeceras
  (`vite.config.js`), así que se prueba en local la política que se publica.
- `Referrer-Policy: no-referrer`: OpenFreeMap no recibe la dirección de la página.

Para publicar en Cloudflare Pages: comando de build `npm run build`, carpeta de salida `dist`.
La versión de Node por defecto de Pages (22.16) cumple lo que piden Vite y Vitest.

## Mapa

`src/mapa/` dibuja las parcelas con MapLibre sobre el mapa base de OpenFreeMap: el estilo `dark`, teñido con
un verde apenas insinuado para que se distingan bosques, ríos y caminos y manden las parcelas.

- **Colores por severidad**: rojo (errores), ámbar (solo advertencias) y azul (sin hallazgos). Se distinguen por
  tono y por claridad, también con daltonismo rojo-verde; el borde del error es más grueso. La leyenda queda
  siempre a la vista, en una franja abajo.
- **De lejos**: cada parcela es una marca de color en su centro, y las cercanas se agrupan en un círculo con su
  cantidad, del color de la peor. Un clic en el grupo acerca el mapa hasta separarlas. Así un archivo no se ve
  como manchas diminutas al abrirlo, y 10,000 parcelas se leen como una cuadrícula de cantidades.
- **De cerca**: desde el zoom 12 se ve el borde de cada parcela, y su código aparece en cuanto sale de su grupo.
  El código va sobre el centro de la parcela, un punto que siempre cae dentro de ella.
- **Dónde falla**: un punto blanco con el borde del color de la severidad marca cada problema (el cruce, el vértice
  repetido…), desde el zoom 13, y al lado dice su regla ("R6").
- **Parcelas que se cruzan (R6)**: se dibujan como contorno. Como polígono, un moño tiene área neta cero y
  MapLibre lo descarta al cortar en teselas: la parcela desaparecía del mapa.
- **Clic en una parcela**: se marca con un borde blanco y se abre su ficha (código, archivo si hay varios, estado, hallazgos y qué hacer),
  fija a la derecha del mapa (abajo en el celular), no encima de la parcela. Los textos del archivo se escriben
  como texto, nunca como HTML. Si el clic no cae dentro de una parcela, se busca en un margen de 6 px, para
  acertarle a un contorno o a una marca con el dedo. Al pasar el mouse, un globo dice el código y el estado.
- **Encuadre**: las parcelas dentro de Honduras, fuera de las tarjetas que flotan sobre el mapa (interruptor,
  leyenda y ficha). Una parcela lejana (R4) se dibuja igual, pero no achica el resto.
- **Mapa base apagable**: sin él, el estilo no tiene ninguna dirección de otro sitio y el mapa no pide nada afuera.
  Las letras de las etiquetas (Noto Sans Bold, en `public/glyphs`) se sirven desde el propio sitio, así que los
  códigos se ven igual. La preferencia se recuerda en el navegador. Si OpenFreeMap no responde, las parcelas se
  ven sobre fondo liso.
- **Auditoría de privacidad**: `#mapa[data-peticiones-externas]` cuenta las peticiones del mapa que salen del equipo.
  Con el mapa base apagado no sube al mover ni acercar el mapa.

Las capas de parcelas, centros y hallazgos llegan del worker como URL de un `Blob`: MapLibre las lee y las corta en su propio worker.
Con 10,000 parcelas la página no se congela; MapLibre tiene pausas ocasionales de 50 a 160 ms al cargar teselas nuevas.

La parte que no necesita MapLibre (estilo, teñido del mapa base, capas, ficha) está en `src/mapa/capas.js` y se prueba en Node (`pruebas/mapa.test.js`).

## Lista de hallazgos

`src/lista/` muestra los hallazgos en el panel, enlazados con el mapa:

- **Hallazgo → mapa**: al elegir uno, el mapa va a la ubicación del problema y abre la ficha de su parcela.
  En celular, además, trae el mapa a la vista. Los hallazgos sin ubicación (R1) se muestran como texto.
- **Mapa → lista**: al elegir una parcela en el mapa, la lista marca sus hallazgos y los centra en el panel. Al cerrar la ficha, se desmarcan.
- **Filtros** por severidad y por regla, con la cantidad de cada una: sirve para ver cuál es el problema más común.
  Al juntar varios archivos, también por archivo: para ver qué pedirle a cada fuente.
- **De a 100**: la lista dibuja un tramo de 100 hallazgos, con "Mostrar 100 más" y "Mostrar 100 anteriores".
  Si se elige en el mapa una parcela que cae más abajo, la lista salta a su tramo en vez de dibujar todo lo anterior
  (con 10,000 hallazgos, dibujarlos todos congelaba la página 1.85 s).
- Cada hallazgo sabe la posición de su parcela en la revisión (`indices`, que entrega el worker), no solo su código:
  dos parcelas con el mismo código, del mismo archivo o de dos distintos, no se mezclan.

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
| R10 | Solapes entre parcelas de más de 10 m². El aviso va en las dos parcelas y cada una nombra a la otra | Advertencia |
| R11 | Parcelas duplicadas: la misma geometría, o el mismo código con otra geometría, también entre archivos. Cada copia lleva un aviso que nombra a las demás | Advertencia |
| R12 | Área declarada contra área calculada | Advertencia |

## Datos sintéticos

`npm run datos` los escribe en `datos/sinteticos/` con semilla fija, así que siempre salen iguales:

- `valido.geojson`: 25 parcelas sin errores.
- `valido-puntos.csv`: 15 parcelas como puntos, sin errores.
- `grande-10000.geojson`: 10,000 parcelas sin errores, para medir el rendimiento. No se guarda en Git.
- `casos/`: un archivo por regla, numerado como los casos de prueba.
- `errores-mezclados.geojson`: 10 parcelas válidas y todos los casos juntos, para la demo.
- Las mismas parcelas en KML, KMZ y shapefile (`valido.kml`, `valido.kmz`, `valido-poligonos-shp.zip`,
  `valido-puntos-shp.zip` y `errores-mezclados.kml`).
- `juntar/`: tres fuentes de un mismo exportador, cada una en su formato (`cooperativa-norte.geojson`,
  `beneficio-sur.kml` y `tecnicos-centro-shp.zip`), con un código de registro común. Traen la misma parcela en dos
  archivos, una parcela medida dos veces, un solape entre archivos, dos parcelas distintas con el mismo código y un
  shapefile exportado con 5 decimales.

Las parcelas se dibujan en una cuadrícula dentro de una zona interior de Honduras. Son polígonos en
estrella que no se cruzan ni se solapan entre sí. Los `.zip` y el `.kmz` llevan una fecha fija adentro, para
que también salgan iguales en cada corrida.

## Stack

| Pieza | Paquete | Versión | Licencia |
|-------|---------|---------|----------|
| Geometría | `@turf/turf` | 7.4.0 | MIT |
| Mapa | `maplibre-gl` | 6.11.2 | BSD-3-Clause |
| Lectura del XML del KML (en el worker, donde no hay DOMParser) | `txml` | 6.0.3 | MIT |
| Apertura de KMZ y `.zip` | `fflate` | 0.8.3 | MIT |
| Lectura de shapefile | Propia (`src/motor/shapefile.js`), según la especificación de ESRI de 1998 | — | — |
| Mapa base (servicio, sin paquete) | OpenFreeMap, estilo `dark` | — | Datos © OpenStreetMap (ODbL), OpenMapTiles |
| Letras de las etiquetas del mapa (sin paquete) | Noto Sans Bold, glifos de OpenFreeMap en `public/glyphs` | — | OFL-1.1 (`public/glyphs/LICENSE-OFL.txt`) |
| Tipografía de la marca y el texto | `@fontsource-variable/manrope` | 5.3.0 | OFL-1.1 |
| Tipografía de los códigos | `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 |
| Servidor de desarrollo y compilación | `vite` | 8.3.1 | MIT |
| Pruebas | `vitest` | 5.0.2 | MIT |

Versiones y licencias leídas del `package.json` de cada paquete instalado el 28-09-2026 (las tipografías, el
30-09-2026; `txml` y `fflate`, el 01-10-2026).

## Licencia

Código bajo licencia [MIT](LICENSE).
