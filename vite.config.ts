import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { downApi } from './server/api.ts'

export default defineConfig({
  plugins: [react(), downApi()],
  server: { port: 4322, strictPort: true },
  preview: { port: 4322 },
})
