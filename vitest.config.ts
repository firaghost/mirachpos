import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      include: [
        'components/Modal.tsx',
        'hooks/**/*.{ts,tsx}',
        'utils/exportUtils.ts',
        'usePersistedState.ts',
      ],
      exclude: [
        'api/**',
        'dist/**',
        'electron/**',
        'mobile/**',
        'node_modules/**',
        'screens/**',
        'App*.tsx',
        'PosContext.tsx',
        'ThemeContext.tsx',
        'index.tsx',
        '**/*.d.ts',
        '**/*.config.*',
        '**/vite.config.*',
        '**/vitest.config.*',
      ],
      thresholds: {
        statements: 99,
        branches: 90,
        functions: 80,
        lines: 99,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
    },
  },
});
