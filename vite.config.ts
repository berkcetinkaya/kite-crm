import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The research API runs in a separate Node process (server/) so secrets never reach the browser.
// In dev and preview, /api is proxied to it.
const api = { '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 8787}`, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
});
