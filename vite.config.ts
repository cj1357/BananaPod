import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import os from 'node:os'; // 1. 引入 os 模块
// 2. Android/Termux 网络接口权限修复补丁
try {
  os.networkInterfaces();
} catch (e) {
  os.networkInterfaces = () => ({});
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 8085,
      host: '127.0.0.1',
      // --- 新增配置开始 ---
      // 允许你的 frp 域名访问
      allowedHosts: [
        'pod.lordorange.top'
      ],
      // --- 新增配置结束 ---            
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.BASE_URL': JSON.stringify(env.BASE_URL)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
