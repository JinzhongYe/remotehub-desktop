import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const mobileHost = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [vue()],
  base: './',
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    host: mobileHost || '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: mobileHost ? { protocol: 'ws', host: mobileHost, port: 5174 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
