// Writes release/SHA256SUMS.txt for every installer/executable in release/ (works on Windows, macOS, Linux).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('./release/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => /\.(exe|dmg|AppImage|zip)$/i.test(f));
const lines = files.map((f) => `${createHash('sha256').update(readFileSync(dir + f)).digest('hex')}  ${f}`);
writeFileSync(dir + 'SHA256SUMS.txt', lines.join('\n') + '\n');
console.log(lines.join('\n') || 'no release files found');
