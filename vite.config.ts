import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 8085,
    host: '127.0.0.1',
    // --- 新增配置开始 ---
    // 允许你的 frp 域名访问
    allowedHosts: [
      'pod.lordorange.top'
    ],
    // --- 新增配置结束 ---    
    proxy: {
      '/api': {
        target: 'http://localhost:8086',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
