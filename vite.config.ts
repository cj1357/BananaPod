import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import os from 'node:os'; // 1. 引入 os 模块
// 2. Android/Termux 网络接口权限修复补丁
try {
  os.networkInterfaces();
} catch (e) {
  os.networkInterfaces = () => ({});
}

export default defineConfig({
  server: {
    port: 8085,
    host: '127.0.0.1',
    // 允许自定义域名访问
    allowedHosts: [
      'pod.lordorange.top'
    ],
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
