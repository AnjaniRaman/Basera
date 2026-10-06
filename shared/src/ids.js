// Identifier helpers. Entity ids are opaque strings; human-facing numbers (INV-2610-004, RCP-0031)
// come from per-property sequences so they stay stable and gap-free.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChunk(length) {
  let out = '';
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Sortable-ish opaque id such as `ten_m2k9x1a7f3q`. */
export function newId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${randomChunk(6)}`;
}

/** Deterministic id factory for tests: ten_1, ten_2, … */
export function sequentialIds() {
  const counters = {};
  return (prefix = 'id') => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}_${counters[prefix]}`;
  };
}

export function invoiceNumber(period, seq) {
  const [y, m] = period.split('-');
  return `INV-${y.slice(2)}${m}-${String(seq).padStart(3, '0')}`;
}

export function receiptNumber(seq) {
  return `RCP-${String(seq).padStart(4, '0')}`;
}

export function requestNumber(seq) {
  return `REQ-${String(seq).padStart(3, '0')}`;
}

export function settlementNumber(seq) {
  return `STL-${String(seq).padStart(3, '0')}`;
}

export function slipNumber(seq) {
  return `SAL-${String(seq).padStart(4, '0')}`;
}
