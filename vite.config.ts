import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
export default defineConfig({
  plugins: [uni()],
  // The frozen DCloud peer still requires Vite 5.2.8, which has open
  // dev-server advisories. Never bind the local dev or preview server to LAN.
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true }
})
