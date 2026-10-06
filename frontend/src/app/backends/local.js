// Device mode: property documents live in this browser (IndexedDB) and every command runs
// through the same reducer the API uses. No account, no network; the owner can move the data to
// an online account later from Settings.
import { applyCommand, createPropertyState, normalizeState, newId, scopeState, propertySchema, DomainError } from '@basera/domain';
import { buildSampleState, SAMPLE_PROPERTY_ID } from '@basera/domain/sample';
import { idb } from '../storage.js';

const INDEX_KEY = 'index';

async function readIndex() {
  const index = await idb.get('meta', INDEX_KEY);
  return Array.isArray(index) ? index : [];
}

async function writeIndex(index) {
  await idb.set('meta', INDEX_KEY, index);
}

function indexEntry(state) {
  return {
    id: state.id,
    name: state.property.name,
    city: state.property.city,
    ownerName: state.property.ownerName,
    ownerPhone: state.property.ownerPhone,
    ownerEmail: state.property.ownerEmail || '',
    sample: Boolean(state.sample),
    updatedAt: state.updatedAt
  };
}

const PINS_KEY = 'pins';
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60 * 1000;
const tenDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);

async function hashPin(salt, pin) {
  const text = `${salt}:${pin}`;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 5381; // very old webviews without WebCrypto
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return `x${h.toString(16)}`;
  }
}

/**
 * Sign-in PINs for device mode, kept per phone number as a salted hash. The owner chooses theirs
 * at setup and sets one for each resident or staff member who should sign in on this device.
 */
const pins = {
  async all() { return (await idb.get('meta', PINS_KEY)) || {}; },
  async has(phone) { return Boolean((await pins.all())[tenDigits(phone)]); },
  async set(phone, pin) {
    if (!/^\d{4,6}$/.test(String(pin || ''))) throw new DomainError('pin_format');
    const all = await pins.all();
    const salt = newId('s');
    all[tenDigits(phone)] = { salt, hash: await hashPin(salt, pin), tries: 0, lockedUntil: 0 };
    await idb.set('meta', PINS_KEY, all);
  },
  async check(phone, pin) {
    const all = await pins.all();
    const rec = all[tenDigits(phone)];
    if (!rec) throw new DomainError('pin_not_set');
    if (rec.lockedUntil > Date.now()) throw new DomainError('pin_locked');
    const ok = rec.hash === (await hashPin(rec.salt, String(pin || '')));
    rec.tries = ok ? 0 : (rec.tries || 0) + 1;
    if (rec.tries >= MAX_TRIES) { rec.tries = 0; rec.lockedUntil = Date.now() + LOCK_MS; }
    await idb.set('meta', PINS_KEY, all);
    if (!ok) throw new DomainError('pin_wrong');
  }
};

export function createLocalBackend() {
  const cache = new Map();

  async function load(propertyId) {
    if (cache.has(propertyId)) return cache.get(propertyId);
    const raw = await idb.get('properties', propertyId);
    if (!raw) return null;
    const state = normalizeState(raw);
    cache.set(propertyId, state);
    return state;
  }

  async function save(state) {
    cache.set(state.id, state);
    await idb.set('properties', state.id, state);
    const index = await readIndex();
    const next = index.filter((e) => e.id !== state.id);
    next.push(indexEntry(state));
    await writeIndex(next);
  }

  return {
    kind: 'local',
    pins,

    async listProperties() {
      return (await readIndex()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },

    load,

    async createProperty(input, now = new Date().toISOString()) {
      const parsed = propertySchema.parse(input);
      const state = createPropertyState(parsed, { id: newId('prop'), now });
      await save(state);
      return state;
    },

    async loadSample({ ownerName, ownerPhone }) {
      const state = buildSampleState({ ownerName, ownerPhone, now: new Date(), newId });
      state.id = SAMPLE_PROPERTY_ID;
      await save(state);
      return state;
    },

    async importState(raw) {
      const state = normalizeState({ ...raw, id: raw.id && !String(raw.id).startsWith('prop_sample') ? raw.id : newId('prop') });
      delete state.sample;
      state.updatedAt = new Date().toISOString();
      await save(state);
      return state;
    },

    async removeProperty(propertyId) {
      const state = await load(propertyId);
      for (const doc of state?.documents || []) await idb.remove('files', doc.fileId).catch(() => {});
      cache.delete(propertyId);
      await idb.remove('properties', propertyId);
      const index = await readIndex();
      await writeIndex(index.filter((e) => e.id !== propertyId));
    },

    /**
     * Apply a command as the given actor. Returns { state (full), scoped, result }.
     * Throws DomainError for business-rule failures.
     */
    async dispatch(propertyId, command, actor) {
      const state = await load(propertyId);
      if (!state) throw new DomainError('property_not_found');
      const outcome = applyCommand(state, command, { now: new Date().toISOString(), actor, newId });
      await save(outcome.state);
      return { state: outcome.state, scoped: scopeState(outcome.state, actor), result: outcome.result };
    },

    /** Who can sign in on this device with a phone number or email: owners, residents and staff of every stored PG. */
    async resolvePerson(identifier) {
      const digits = String(identifier || '').replace(/\D/g, '').slice(-10);
      const email = String(identifier || '').trim().toLowerCase();
      const matches = [];
      for (const entry of await readIndex()) {
        const state = await load(entry.id);
        if (!state) continue;
        if ((digits && state.property.ownerPhone === digits) || (email.includes('@') && state.property.ownerEmail === email)) {
          matches.push({ propertyId: state.id, propertyName: state.property.name, role: 'owner', refId: null, name: state.property.ownerName, sample: Boolean(state.sample) });
        }
        for (const t of state.tenants) {
          if (t.status === 'left') continue;
          if ((digits && t.phone === digits) || (email.includes('@') && t.email === email)) {
            matches.push({ propertyId: state.id, propertyName: state.property.name, role: 'tenant', refId: t.id, name: t.name, sample: Boolean(state.sample) });
          }
        }
        for (const s of state.staff) {
          if (!s.active) continue;
          if (digits && s.phone === digits) matches.push({ propertyId: state.id, propertyName: state.property.name, role: 'staff', refId: s.id, name: s.name, sample: Boolean(state.sample) });
        }
      }
      return matches;
    },

    files: {
      async put(blob, meta = {}) {
        const id = newId('file');
        await idb.set('files', id, { blob, mime: blob.type || meta.mime || 'application/octet-stream', name: meta.name || '', size: blob.size, at: Date.now() });
        return id;
      },
      async get(id) {
        const rec = await idb.get('files', id);
        return rec ? rec.blob : null;
      },
      async remove(id) {
        await idb.remove('files', id);
      }
    },

    async persistent() {
      return idb.isPersistent();
    }
  };
}
