// Builds the whole web app into one self-contained HTML fragment (JS, CSS and fonts inlined)
// for hosts that serve a single file. Output: preview/basera.html
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../frontend/', import.meta.url));
process.env.VITE_STATIC_ONLY = '1';
const result = await build({ root, configFile: false, base: './', logLevel: 'warn', plugins: [react()],
  build: { write: false, target: 'es2020', assetsInlineLimit: 100000000, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } } });
const out = (Array.isArray(result) ? result[0] : result).output;
const js = out.find((f) => f.type === 'chunk' && f.isEntry).code;
const css = out.filter((f) => f.fileName.endsWith('.css')).map((f) => f.source).join('\n');
const html = `<title>Basera</title>\n<style>${css}</style>\n<div id="root"></div>\n<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>\n`;
const dir = fileURLToPath(new URL('../preview/', import.meta.url)); mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'basera.html', html);
console.log(`preview/basera.html ${(html.length / 1024).toFixed(0)} KB`);
