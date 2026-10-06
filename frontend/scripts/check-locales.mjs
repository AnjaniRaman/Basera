// Every locale must have exactly the keys of en.js and the same {placeholders}.
const langs = ['hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn', 'or', 'pa'];
const en = (await import('../src/locales/en.js')).default; const keys = Object.keys(en); let bad = 0;
const ph = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');
for (const l of langs) { const loc = (await import(`../src/locales/${l}.js`)).default; const missing = keys.filter((k) => !(k in loc)); const extra = Object.keys(loc).filter((k) => !(k in en)); const wrong = keys.filter((k) => k in loc && ph(loc[k]) !== ph(en[k]));
  if (missing.length || extra.length || wrong.length) { bad++; console.log(`${l}: missing ${missing.length} ${missing.slice(0, 5)} extra ${extra.length} ${extra.slice(0, 5)} placeholders ${wrong.length} ${wrong.slice(0, 5)}`); } else console.log(`${l}: ok (${keys.length} keys)`); }
process.exit(bad ? 1 : 0);
