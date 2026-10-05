import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: '/issuegauge/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
