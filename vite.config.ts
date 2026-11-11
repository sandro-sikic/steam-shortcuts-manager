import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** The packaged UI loads local files only, so lock the page down; the dev server needs inline scripts. */
const contentSecurityPolicy: Plugin = {
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '</head>',
      `  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />\n  </head>`,
    ),
};

export default defineConfig({
  root: 'src/UI',
  base: './',
  plugins: [react(), contentSecurityPolicy],
  build: { outDir: '../../dist-ui', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
