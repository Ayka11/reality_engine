import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'three',
              test: /node_modules[\\/]three[\\/]/,
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
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
