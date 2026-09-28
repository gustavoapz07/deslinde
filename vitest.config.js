import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['pruebas/**/*.test.js'],
    globalSetup: './pruebas/preparar-datos.js',
  },
})
