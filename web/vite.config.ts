import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3789',
        ws: true,
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    minify: 'terser',
    outDir: 'build',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'flow-vendor': ['react-flow-renderer'],
          'editor-vendor': ['codemirror', '@monaco-editor/react'],
        },
      },
    },
  },
});
