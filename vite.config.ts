import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: [] },
  preview: { allowedHosts: 'all' },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: 'all',
  },
})
