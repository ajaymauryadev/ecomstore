import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { offlineShellPlugin } from './offlineShellPlugin';

const localApi = { target: 'http://localhost:5000', changeOrigin: true, secure: false };

export default defineConfig({
  plugins: [react(), offlineShellPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': localApi,
      '/uploads': localApi,
      '/socket.io': { ...localApi, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: './src/test/setup.js',
    css: true,
    restoreMocks: true,
  },
});
