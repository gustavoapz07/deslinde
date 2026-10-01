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
  build: {
    // MapLibre pesa unos 1,000 KB sin comprimir y se carga aparte (src/main.js):
    // el aviso de Vite sobre partes grandes no aplica.
    chunkSizeWarningLimit: 1100,
    // Las fuentes van siempre como archivo, nunca incrustadas como data: (Vite
    // incrusta lo que pesa menos de 4 KB): la política de seguridad solo deja
    // cargar fuentes del propio sitio (font-src 'self').
    assetsInlineLimit: (archivo) => (/\.woff2?$/.test(archivo) ? false : undefined),
  },
})
