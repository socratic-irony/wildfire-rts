import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Increase chunk size warning limit since Three.js is inherently large
    chunkSizeWarningLimit: 800,
    // Enable source maps for better debugging in development
    sourcemap: process.env.NODE_ENV === 'development',
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate Three.js into its own chunk for better caching
          'three': ['three'],
          // Separate utility libraries
          'utils': ['simplex-noise'],
        }
      }
    }
  },
  // Optimize development server performance
  server: {
    hmr: {
      overlay: false, // Disable error overlay in favor of our custom error handling
    }
  }
});