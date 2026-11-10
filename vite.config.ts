import { defineConfig } from 'vite';

export default defineConfig({
  base: '/virazh/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true },
  optimizeDeps: { exclude: ['maplibre-gl'] },
});
