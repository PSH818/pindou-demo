import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // 相对路径：部署在 GitHub Pages 子路径（/仓库名/）下也能加载资源
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
})
