// Generates app icons and splash sources from the Basera mark (four bed tiles on green).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const out = new URL('../assets/', import.meta.url).pathname; const web = new URL('../public/icons/', import.meta.url).pathname;
mkdirSync(out, { recursive: true }); mkdirSync(web, { recursive: true });
const G = '#0E6B55';
const tiles = (s, inset) => { const a = s * inset, g = s * 0.07, w = (s - 2 * a - g) / 2, r = w * 0.2; const sq = (x, y, o = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${r}" fill="#fff" opacity="${o}"/>`; return sq(a, a) + sq(a + w + g, a) + sq(a, a + w + g, 0.45) + sq(a + w + g, a + w + g); };
const svg = (s, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${body}</svg>`);
const S = 1024;
await sharp(svg(S, `<rect width="${S}" height="${S}" rx="${S * 0.22}" fill="${G}"/>${tiles(S, 0.22)}`)).png().toFile(out + 'icon.png');
await sharp(svg(S, `<rect width="${S}" height="${S}" fill="${G}"/>`)).png().toFile(out + 'icon-background.png');
await sharp(svg(S, tiles(S, 0.3))).png().toFile(out + 'icon-foreground.png');
const P = 2732, T = 420; const icon = await sharp(svg(T, `<rect width="${T}" height="${T}" rx="${T * 0.22}" fill="${G}"/>${tiles(T, 0.22)}`)).png().toBuffer();
for (const [n, bg] of [['splash.png', '#F5F6F4'], ['splash-dark.png', '#0F1519']]) await sharp({ create: { width: P, height: P, channels: 4, background: bg } }).composite([{ input: icon, left: (P - T) / 2, top: (P - T) / 2 }]).png().toFile(out + n);
for (const s of [192, 512]) await sharp(out + 'icon.png').resize(s, s).png().toFile(`${web}icon-${s}.png`);
await sharp(svg(512, `<rect width="512" height="512" fill="${G}"/>${tiles(512, 0.28)}`)).png().toFile(web + 'maskable-512.png');
await sharp(out + 'icon.png').resize(512, 512).png().toFile(new URL('../../desktop/build/icon.png', import.meta.url).pathname).catch(() => {});
console.log('brand assets written');
