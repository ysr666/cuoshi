import {defineConfig} from 'vite'
import {loopbackRequestGuard} from './viteLoopbackGuard'
import vue from '@vitejs/plugin-vue'
import {fileURLToPath} from 'node:url'
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),
  plugins:[loopbackRequestGuard(),vue()],
  server:{host:'127.0.0.1',strictPort:true,cors:false,hmr:false},
  preview:{host:'127.0.0.1',strictPort:true,cors:false},
  build:{outDir:fileURLToPath(new URL('../preview-dist',import.meta.url)),emptyOutDir:true}
})
