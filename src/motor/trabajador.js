// Punto de entrada del Web Worker. Toda la lógica está en trabajo.js.
import { atender } from './trabajo.js'

self.onmessage = (evento) => atender(evento.data, (mensaje) => self.postMessage(mensaje))
