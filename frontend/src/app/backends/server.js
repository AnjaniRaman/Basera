// Online mode: a thin client for the Basera API. The server applies commands with the same
// reducer and returns the snapshot scoped to the caller's role.
import { prefs } from '../storage.js';

export class ApiError extends Error {
  constructor(status, code, details = {}) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const URL_KEY = 'basera_api_url';
const TOKEN_KEY = 'basera_token';

export const builtInApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Same-origin /api when served by the API itself; nothing on static hosts and native shells. */
export function defaultApiUrl() {
  if (import.meta.env.VITE_STATIC_ONLY) return ''; // single-file preview build: device mode only
  if (builtInApiUrl) return builtInApiUrl;
  try {
    const { protocol, origin } = globalThis.location;
    if (protocol === 'http:' || protocol === 'https:') {
      if (/claude\.ai|localhost:5173|127\.0\.0\.1:5173/.test(origin)) return '';
      return `${origin}/api`;
    }
  } catch {
    /* no location */
  }
  return '';
}

export function savedApiUrl() {
  return prefs.get(URL_KEY, '') || '';
}

export function saveApiUrl(url) {
  const clean = String(url || '').trim().replace(/\/$/, '');
  if (clean) prefs.set(URL_KEY, clean);
  else prefs.remove(URL_KEY);
  return clean;
}

export function createServerBackend(baseUrl) {
  let token = prefs.get(TOKEN_KEY, '') || '';
  const base = String(baseUrl || '').replace(/\/$/, '');

  async function request(method, path, { body, raw, headers = {}, timeout = 20000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      const init = { method, signal: controller.signal, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } };
      if (raw) init.body = body;
      else if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      res = await fetch(base + path, init);
    } catch (err) {
      throw new ApiError(0, err.name === 'AbortError' ? 'timeout' : 'network', { message: err.message });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 304) return null;
    const type = res.headers.get('content-type') || '';
    if (!res.ok) {
      let data = {};
      try {
        data = type.includes('json') ? await res.json() : {};
      } catch {
        /* no body */
      }
      if (res.status === 401 && token) setToken('');
      throw new ApiError(res.status, data.error || `http_${res.status}`, data.details || {});
    }
    if (type.includes('json')) return res.json();
    return res.blob();
  }

  function setToken(next) {
    token = next || '';
    if (token) prefs.set(TOKEN_KEY, token);
    else prefs.remove(TOKEN_KEY);
  }

  return {
    kind: 'server',
    base,
    get token() {
      return token;
    },
    setToken,
    health: () => request('GET', '/health', { timeout: 6000 }),
    requestOtp: (phone) => request('POST', '/auth/otp/request', { body: { phone } }),
    verifyOtp: (phone, code, name) => request('POST', '/auth/otp/verify', { body: { phone, code, name } }),
    loginPassword: (email, password) => request('POST', '/auth/password/login', { body: { email, password } }),
    setPassword: (password) => request('POST', '/auth/password/set', { body: { password } }),
    resetPassword: (phone, code, password) => request('POST', '/auth/password/reset', { body: { phone, code, password } }),
    logoutAll: () => request('POST', '/auth/logout-all'),
    logout: () => request('POST', '/auth/logout'),
    me: () => request('GET', '/me'),
    updateMe: (fields) => request('PATCH', '/me', { body: fields }),
    createProperty: (fields) => request('POST', '/properties', { body: fields }),
    importProperty: (state) => request('POST', '/properties/import', { body: { state } }),
    snapshot: (propertyId, role, since) => request('GET', `/properties/${propertyId}/snapshot?role=${role}${since ? `&since=${since}` : ''}`),
    command: (propertyId, role, command, baseVersion) => request('POST', `/properties/${propertyId}/commands`, { body: { role, command, baseVersion } }),
    exportProperty: (propertyId) => request('GET', `/properties/${propertyId}/export`),
    deleteProperty: (propertyId) => request('DELETE', `/properties/${propertyId}`),
    uploadFile: (propertyId, blob) => request('POST', `/properties/${propertyId}/files`, { raw: true, body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' }, timeout: 60000 }),
    fileBlob: (propertyId, fileId) => request('GET', `/properties/${propertyId}/files/${fileId}`, { timeout: 60000 }),
    deleteFile: (propertyId, fileId) => request('DELETE', `/properties/${propertyId}/files/${fileId}`)
  };
}
