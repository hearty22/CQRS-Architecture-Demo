import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `backend` es el nombre del servicio en docker-compose, resoluble solo
// dentro de la red de compose.
const BACKEND_ORIGIN = 'http://backend:3000'

export default defineConfig({
  plugins: [react()],

  server: {
    // OBLIGATORIO dentro de Docker. Sin 0.0.0.0, Vite escucha en el
    // loopback del contenedor y el host no puede alcanzarlo.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,

    proxy: {
      // El browser llama a /api en su propio origen, asi que no hay CORS en
      // dev. Ademas replica lo que hara nginx en produccion.
      '/api': {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
      },
    },

    // Si el HMR por websocket no conecta desde el host, descomentar:
    // hmr: { host: 'localhost', clientPort: 5173 },
  },
})
