import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // App interna de laptop: un bundle de ~600 kB es aceptable.
  build: { chunkSizeWarningLimit: 800 },
})
