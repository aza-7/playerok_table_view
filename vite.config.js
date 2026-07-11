import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Content-script build: single self-contained IIFE bundle (content scripts
// can't be ES modules). CSS is imported with ?inline and injected into the
// overlay's Shadow DOM, so no separate stylesheet is emitted.
export default defineConfig({
  plugins: [react()],
  // content scripts have no `process`; pin NODE_ENV so React uses its
  // production build and dev-only code is tree-shaken out
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    lib: {
      entry: 'src/content/main.jsx',
      formats: ['iife'],
      name: 'PlayerokOrders',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'content.[ext]' },
    },
  },
})
