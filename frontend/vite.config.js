import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths so the same build runs from a web server, inside the Capacitor
// shells (file:// / capacitor://) and in the Electron app.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } }
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/lucide-react')) return 'icons';
          if (id.includes('node_modules/zod')) return 'zod';
        }
      }
    }
  }
});
