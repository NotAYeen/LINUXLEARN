import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: el sitio se sirve desde https://<usuario>.github.io/linuxlearn/
  // y una ruta absoluta (/assets/...) apuntaria a la raiz del dominio y daria 404.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      },
      // shell-worker.js se carga con importScripts: no puede ser un modulo ES.
      mangle: { reserved: ['self', 'postMessage'] }
    },
    rollupOptions: {
      // index.html es la entrada: Vite copia el HTML a dist/ y alli se queda
      // tambien bundle.js, que es lo que sube GitHub Pages.
      input: 'index.html',
      output: {
        entryFileNames: 'bundle.js',
        format: 'iife',
        name: 'LxlApp'
      }
    }
  },
  worker: {
    format: 'iife',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/shell-worker.js'
      }
    }
  }
});
