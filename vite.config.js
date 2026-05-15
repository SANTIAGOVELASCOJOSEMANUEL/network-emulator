import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: '.',

  plugins: [
    viteSingleFile(),   // inlinea JS y CSS en el HTML → un solo archivo standalone
  ],

  build: {
    outDir: 'dist',
    sourcemap: false,
    // Necesario para que singlefile pueda inlinear todo
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'index.html',
      output: {
        inlineDynamicImports: true,
      },
    },
  },

  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
