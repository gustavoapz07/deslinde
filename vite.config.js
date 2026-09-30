import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// Las cabeceras que Cloudflare Pages lee de public/_headers, para que
// `vite preview` sirva el build con la misma política de seguridad.
function cabecerasDePages() {
  const cabeceras = {}
  for (const linea of readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split(/\r?\n/)) {
    const encontrada = linea.match(/^\s+([\w-]+):\s*(.+)$/)
    if (encontrada) cabeceras[encontrada[1]] = encontrada[2]
  }
  return cabeceras
}

export default defineConfig({
  preview: { headers: cabecerasDePages() },
  // MapLibre pesa unos 1,000 KB sin comprimir y se carga aparte (src/main.js):
  // el aviso de Vite sobre partes grandes no aplica.
  build: { chunkSizeWarningLimit: 1100 },
})
