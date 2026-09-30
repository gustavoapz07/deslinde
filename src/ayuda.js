// Textos de ayuda de la página: qué revisa cada regla y qué formato se acepta.
// El detalle técnico de las reglas está en el README y en la bóveda.

import { NOMBRES_DE_REGLA } from './lista/datos.js'

const REGLAS = [
  ['R1', 'Error', 'Las coordenadas deben estar en grados de longitud y latitud (EPSG:4326), no en metros. Si falla, la parcela no se revisa con las demás reglas.'],
  ['R2', 'Error', 'Cada coordenada debe venir escrita con al menos 6 decimales, como pide el EUDR.'],
  ['R3', 'Advertencia', 'Latitud y longitud no deben venir al revés. El GeoJSON corregido las pone en orden.'],
  ['R4', 'Advertencia', 'La parcela debe caer dentro de Honduras. Se usa una caja aproximada del país: detecta errores gruesos, no fronteras.'],
  ['R5', 'Error', 'El borde debe cerrarse (el último punto repite el primero) y tener al menos 3 puntos distintos. El GeoJSON corregido lo cierra.'],
  ['R6', 'Error', 'El borde no debe cruzarse consigo mismo.'],
  ['R7', 'Error', 'El borde no debe repetir un vértice. El GeoJSON corregido quita los repetidos seguidos.'],
  ['R8', 'Error', 'Un multipolígono no debe juntar partes que no se tocan.'],
  ['R9', 'Error o advertencia', 'Una parcela de más de 4 ha debe venir como polígono, no como punto. Un punto sin área declarada se marca como advertencia.'],
  ['R10', 'Advertencia', 'Dos parcelas no deben solaparse.'],
  ['R11', 'Advertencia', 'La misma parcela no debe venir dos veces.'],
  ['R12', 'Advertencia', 'El área declarada no debe diferir en más de 10 % del área que se calcula con el borde.'],
]

export const AYUDA_REGLAS = `
  <dl class="reglas">
    ${REGLAS.map(
      ([regla, severidad, texto]) => `
        <dt><span class="regla">${regla}</span> ${NOMBRES_DE_REGLA[regla]} <span class="severidad">${severidad}</span></dt>
        <dd>${texto}</dd>`,
    ).join('')}
  </dl>
  <p class="nota">Deslinde no revisa deforestación ni certifica el cumplimiento: solo que la geolocalización esté bien armada.</p>
`

export const AYUDA_FORMATO = `
  <p><strong>GeoJSON</strong> en grados (EPSG:4326), con una parcela por <code>Feature</code> y estas propiedades:</p>
  <ul>
    <li><code>id</code>: código de la parcela. Aparece en el informe.</li>
    <li><code>area_ha</code>: área declarada en hectáreas. Hace falta para R9 y R12.</li>
    <li><code>productor</code> (opcional): un código, no el nombre de la persona.</li>
  </ul>
  <p>Acepta polígonos, multipolígonos y puntos (para parcelas de hasta 4 ha).</p>
  <p><strong>CSV de puntos</strong> con las columnas <code>id</code>, <code>productor</code>, <code>latitud</code>, <code>longitud</code> y <code>area_ha</code>, separadas por coma o punto y coma.</p>
  <p>KML y shapefile llegan en una versión futura.</p>
`
