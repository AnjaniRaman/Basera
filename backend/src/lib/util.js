import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, details = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code = 'bad_request', details) => new HttpError(400, code, details);
export const unauthorized = (code = 'unauthorized', details) => new HttpError(401, code, details);
export const forbidden = (code = 'forbidden', details) => new HttpError(403, code, details);
export const notFound = (code = 'not_found', details) => new HttpError(404, code, details);
export const conflict = (code = 'conflict', details) => new HttpError(409, code, details);
export const tooMany = (code = 'too_many_requests', details) => new HttpError(429, code, details);

export function newId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

export function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(secret), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifySecret(secret, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(String(secret), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Indian mobile numbers: keep the last 10 digits. */
export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const ten = digits.slice(-10);
  return ten.length === 10 ? ten : '';
}

export function normalizeEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : '';
}

export function nowIso() {
  return new Date().toISOString();
}

/** Six-digit code; never starts with 0 so it survives being typed as a number. */
export function otpCode() {
  return String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
}
