import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import {fileURLToPath} from 'node:url'
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),
  plugins:[vue()],
  server:{host:'127.0.0.1',strictPort:false},
  build:{outDir:fileURLToPath(new URL('../preview-dist',import.meta.url)),emptyOutDir:true}
})
