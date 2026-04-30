import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiTarget = (env.API_TARGET && String(env.API_TARGET).trim()) ? String(env.API_TARGET).trim() : 'http://127.0.0.1:3001';
    const analyze = String(process.env.ANALYZE || '').trim() === '1';
    return {
      base: mode === 'desktop' || String(env.VITE_RELATIVE_BASE || '') === '1' ? './' : '/',
      plugins: [
        react(),
        ...(analyze
          ? [
              visualizer({
                filename: 'dist/bundle-report.html',
                open: true,
                gzipSize: true,
                brotliSize: true,
              }),
            ]
          : []),
      ],
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
        watch: {
          ignored: [
            '**/api/**',
            '**/docs/**',
            '**/functions/**',
            '**/mobile/**',
            '**/electron/**',
            '**/*.md',
            '**/node_modules/**',
            '**/.git/**',
          ],
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        },
      },
      optimizeDeps: {
        force: true,
        include: [
          'react',
          'react-dom',
          'firebase/app',
          'firebase/auth',
          'firebase/firestore',
          'firebase/messaging',
          'recharts',
          'jspdf',
          'jspdf-autotable',
          'html2canvas',
          'lucide-react',
          '@grafana/faro-web-sdk',
          '@grafana/faro-web-tracing',
        ],
        esbuildOptions: {
          target: 'es2020',
        },
      },
      esbuild: {
        target: 'es2020',
        logOverride: { 'this-is-undefined-in-esm': 'silent' },
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              charts: ['recharts'],
              pdf: ['jspdf', 'jspdf-autotable', 'html2canvas'],
              icons: ['lucide-react'],
            },
          },
        },
      },
    };
});
