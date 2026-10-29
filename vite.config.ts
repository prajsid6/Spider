import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const githubPagesBase = repositoryName && !repositoryName.endsWith('.github.io')
  ? `/${repositoryName}/`
  : '/';

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || (process.env.GITHUB_ACTIONS === 'true' ? githubPagesBase : '/'),
  plugins: [react()],
  server: {
    host: true, // Listens on all addresses (0.0.0.0 and ::) so localhost resolves on IPv4 and IPv6
    port: 5173,
    cors: true
  },
  preview: {
    host: true,
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) {
              return 'icons';
            }
            if (id.includes('/node_modules/firebase/auth/')) return 'firebase-auth-api';
            if (id.includes('/node_modules/firebase/firestore/')) return 'firebase-firestore-api';
            if (id.includes('/node_modules/firebase/database/')) return 'firebase-database-api';
            if (id.includes('/node_modules/firebase/functions/')) return 'firebase-functions-api';
            if (id.includes('/node_modules/@firebase/auth/')) return 'firebase-auth';
            if (id.includes('/node_modules/@firebase/firestore/')) return 'firebase-firestore';
            if (id.includes('/node_modules/@firebase/database/')) return 'firebase-database';
            if (id.includes('/node_modules/@firebase/functions/')) return 'firebase-functions';
            if (id.includes('/node_modules/@firebase/')) return 'firebase-core';
            if (id.includes('/node_modules/firebase/')) return 'firebase-api';
            return 'vendor';
          }
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
});
