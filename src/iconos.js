// Íconos de la página, dibujados a mano en una cuadrícula de 24 px con el mismo
// trazo. Son decorativos (aria-hidden): el texto de al lado dice lo mismo.
// Cada severidad tiene una forma distinta (octágono, triángulo, círculo), para
// que no dependa solo del color.

const icono = (trazos, clase = '') =>
  `<svg class="icono ${clase}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${trazos}</svg>`

export const ICONOS = {
  subir: icono('<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 14.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5"/>'),
  archivo: icono('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>'),
  sumar: icono('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  escudo: icono('<path d="M12 3 5 6v5.2c0 4.3 2.9 8 7 9.8 4.1-1.8 7-5.5 7-9.8V6z"/><path d="m9.2 12.2 2 2 3.8-4"/>'),
  descargar: icono('<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>'),
  error: icono('<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z"/><path d="M12 7.8v5"/><path d="M12 16.3h.01"/>', 'icono-error'),
  advertencia: icono('<path d="M10.3 4.3 2.7 17.4A2 2 0 0 0 4.4 20.4h15.2a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.3v4.2"/><path d="M12 16.8h.01"/>', 'icono-advertencia'),
  ok: icono('<circle cx="12" cy="12" r="9"/><path d="m8.4 12.3 2.5 2.5 4.8-5"/>', 'icono-ok'),
  flecha: icono('<path d="m6 9 6 6 6-6"/>', 'icono-flecha'),
  codigo: icono('<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13.5 5-3 14"/>'),
  cerrar: icono('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', 'icono-cerrar'),
  info: icono('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8h.01"/>', 'icono-info'),
}
