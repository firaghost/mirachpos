import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiTarget = (env.API_TARGET && String(env.API_TARGET).trim()) ? String(env.API_TARGET).trim() : 'http://127.0.0.1:3001';
    return {
      base: String(env.VITE_RELATIVE_BASE || '') === '1' ? './' : '/',
      server: {
        port: 5173,
        strictPort: true,
        host: '0.0.0.0',
        proxy: {
          '^/api(/|$)': {
            target: apiTarget,
            changeOrigin: true,
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
