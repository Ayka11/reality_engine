import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'three',
              test: /[\\/]node_modules[\\/]three[\\/]/,
            },
          ],
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
