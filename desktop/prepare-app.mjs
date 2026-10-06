// Copies the built web app (frontend/dist) into desktop/app so the installer bundles it.
import { cpSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
const src = new URL('../frontend/dist/', import.meta.url).pathname;
const dst = new URL('./app/', import.meta.url).pathname;
if (!existsSync(src + 'index.html')) {
  console.error('frontend/dist is missing. Run "npm run build" in frontend first.');
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });

// Add a Content-Security-Policy for the desktop shell: only the bundled files, plus HTTPS calls to your own Basera server.
// Inline styles stay allowed because the app sets a few sizes inline.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "frame-src 'none'",
  "object-src 'none'"
].join('; ');
const indexPath = dst + 'index.html';
const html = readFileSync(indexPath, 'utf8').replace(
  '<meta charset="UTF-8" />',
  `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
);
writeFileSync(indexPath, html);
console.log('copied web build into desktop/app (with CSP)');
