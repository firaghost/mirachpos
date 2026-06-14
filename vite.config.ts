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
          '**/server/**',
          '**/scripts/**',
          '**/*.md',
          '**/*.log',
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/release/**',
        ],
      },
      fs: {
        strict: false,
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
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
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('recharts')) return 'charts';
            if (id.includes('jspdf') || id.includes('html2canvas')) return 'pdf';
            if (id.includes('lucide-react')) return 'icons';
          },
        },
      },
    },
  };
});
