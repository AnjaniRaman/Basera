// Database access: PostgreSQL when DATABASE_URL is set, otherwise an embedded PGlite database
// stored in DATA_DIR (or in memory for tests). Both speak the same SQL, so the services above
// never know which one they are talking to.
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Serialises async work per key, so two commands for the same property never interleave. */
export function createLocks() {
  const chains = new Map();
  return async function withLock(key, fn) {
    const previous = chains.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => (release = resolve));
    chains.set(key, previous.then(() => current));
    try {
      await previous;
      return await fn();
    } finally {
      release();
      if (chains.get(key) === current) chains.delete(key);
    }
  };
}

export async function createDb({ databaseUrl, dataDir, log = () => {} }) {
  let query;
  let close;
  let kind;

  if (databaseUrl) {
    const { default: pg } = await import('pg');
    // DATE columns come back as plain 'YYYY-MM-DD' strings, never JS Dates.
    pg.types.setTypeParser(1082, (v) => v);
    const needsSsl = /supabase|neon|render|amazonaws|azure|sslmode=require/i.test(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: needsSsl ? { rejectUnauthorized: false } : undefined, max: 10 });
    query = (text, params = []) => pool.query(text, params);
    close = () => pool.end();
    kind = 'postgres';
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (dataDir && dataDir !== ':memory:') mkdirSync(dirname(dataDir + '/x'), { recursive: true });
    const pglite = dataDir === ':memory:' ? new PGlite() : new PGlite(dataDir);
    await pglite.waitReady;
    query = (text, params = []) => pglite.query(text, params);
    close = () => pglite.close();
    kind = 'pglite';
  }

  const schema = readFileSync(schemaPath, 'utf8');
  for (const statement of splitStatements(schema)) await query(statement);
  log(`database ready (${kind})`);

  const withLock = createLocks();

  return {
    kind,
    query,
    close,
    withLock,
    async one(text, params) {
      const { rows } = await query(text, params);
      return rows[0] || null;
    },
    async all(text, params) {
      const { rows } = await query(text, params);
      return rows;
    }
  };
}
