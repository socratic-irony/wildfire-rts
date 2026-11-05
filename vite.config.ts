import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      // The model lab ships alongside the game so `npm run preview` serves it too.
      input: {
        main: 'index.html',
        models: 'models.html',
      },
    },
  },
});
