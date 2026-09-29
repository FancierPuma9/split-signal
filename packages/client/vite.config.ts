import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER = 'localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://${SERVER}`, ws: true },
      '/healthz': `http://${SERVER}`,
    },
  },
});
