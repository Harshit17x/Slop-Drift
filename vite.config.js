import { defineConfig } from 'vite';

const isCrazyGames = Boolean(process.env.CRAZYGAMES);

function crazygamesHtmlPlugin() {
  return {
    name: 'crazygames-strip-importmap',
    transformIndexHtml(html) {
      if (!isCrazyGames) return html;
      return html
        .replace(/\s*<!--\s*Lets the game run from any static file server[\s\S]*?-->\s*/i, '\n    ')
        .replace(/\s*<script\s+type="importmap">[\s\S]*?<\/script>/i, '');
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __CRAZYGAMES_BUILD__: JSON.stringify(isCrazyGames),
  },
  plugins: [crazygamesHtmlPlugin()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: !isCrazyGames,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'vendor-three';
        },
      },
    },
  },
});
