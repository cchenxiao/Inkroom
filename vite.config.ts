import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/go-api': {
        target: 'http://127.0.0.1:8080',
        rewrite: (path) => path.replace(/^\/go-api/, '/api'),
      },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    // Bound concurrent DOM environments so interactive tests keep their 5s budget.
    maxWorkers: 2,
    minWorkers: 1,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules/**', 'e2e/**'],
    restoreMocks: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
          flow: ['@xyflow/react'],
          editor: ['@tiptap/react', '@tiptap/starter-kit'],
        },
      },
    },
  },
});
