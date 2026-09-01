import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/LabelPrintStation/',
  build: {
    emptyOutDir: false
  },
  server: {
    watch: {
      ignored: ['**/print-agent/**', '**/*.exe', '**/*.zpl', '**/*.ps1']
    }
  }
})
