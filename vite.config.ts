import { defineConfig } from 'vite'
export default defineConfig({
  build: {
    target: 'esnext'
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: [] },
  preview: { allowedHosts: 'all' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
