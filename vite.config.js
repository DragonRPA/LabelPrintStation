import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function safeCopyPublicPlugin() {
  return {
    name: 'safe-copy-public',
    writeBundle() {
      const copyRecursive = (srcDir, destDir) => {
        if (!fs.existsSync(srcDir)) return
        fs.mkdirSync(destDir, { recursive: true })
        for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
          const srcPath = path.join(srcDir, entry.name)
          const destPath = path.join(destDir, entry.name)
          if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath)
          } else {
            try {
              fs.copyFileSync(srcPath, destPath)
            } catch (err) {
              if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
                // Skip locked executable already present in dist
              } else {
                throw err
              }
            }
          }
        }
      }
      copyRecursive(path.resolve('public'), path.resolve('dist'))
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), safeCopyPublicPlugin()],
  base: '/LabelPrintStation/',
  build: {
    emptyOutDir: false,
    copyPublicDir: false
  },
  server: {
    watch: {
      ignored: ['**/print-agent/**', '**/*.exe', '**/*.zpl', '**/*.ps1']
    }
  }
})
