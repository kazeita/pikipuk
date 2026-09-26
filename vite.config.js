import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, open: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
