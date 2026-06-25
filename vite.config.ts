import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load every env var (no prefix filter) so a plain GOOGLE_MAPS_API_KEY works too —
  // not just the VITE_-prefixed name. Either one bakes the key into the dev/build bundle.
  const env = loadEnv(mode, process.cwd(), '');
  const mapsKey = env.GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY || '';
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(mapsKey),
    },
    server: {
      port: 5173,
      host: true,
    },
    build: {
      target: 'es2021',
      chunkSizeWarningLimit: 2000,
    },
  };
});
