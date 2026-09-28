// Vitest corre esto una vez antes de las pruebas: así los datos sintéticos
// siempre están al día, también con `npm run test:loop`.
import { generarTodo } from '../scripts/generar-datos.js'

export default function () {
  generarTodo()
}
