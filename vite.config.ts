import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // On while the scroll jump is being chased: the instrumentation logs Error objects so
    // that DevTools can name the caller, and without a source map every frame is minified.
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3433',
    },
  },
})
