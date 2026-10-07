import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let base;
let ctx;

before(async () => {
  ctx = await createApp({ DATABASE_URL: '', DATA_DIR: ':memory:', AUTH_DEV_OTP: '246810', OTP_PROVIDER: 'console', SERVE_FRONTEND: '0', NODE_ENV: 'test', silent: true });
  await new Promise((resolve) => {
    server = ctx.app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await ctx?.db.close();
});

async function call(method, path, { body, token, raw, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body)
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : type.startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, data };
}

async function signIn(phone, name) {
  const requested = await call('POST', '/api/auth/otp/request', { body: { phone } });
  assert.equal(requested.status, 200);
  const verified = await call('POST', '/api/auth/otp/verify', { body: { phone, code: '246810', name } });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  return verified.data;
}

const ownerPhone = '9876501234';
const tenantPhone = '9876505678';
let ownerToken;
let propertyId;
let tenantId;
let roomId;

test('health answers without authentication', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.db, 'pglite');
});

test('an owner signs in with OTP, creates a PG and gets an owner membership', async () => {
  const session = await signIn(ownerPhone, 'Asha Owner');
  ownerToken = session.token;
  assert.equal(session.user.phone, ownerPhone);
  assert.deepEqual(session.memberships, []);
  const created = await call('POST', '/api/properties', { token: ownerToken, body: { name: 'Asha Residency', city: 'Pune', upiId: 'asha@upi', rules: { dueDay: 5 } } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  propertyId = created.data.propertyId;
  assert.equal(created.data.memberships[0].role, 'owner');
  const snap = await call('GET', `/api/properties/${propertyId}/snapshot`, { token: ownerToken });
  assert.equal(snap.status, 200);
  assert.equal(snap.data.role, 'owner');
  assert.equal(snap.data.state.property.name, 'Asha Residency');
  assert.equal(snap.data.version, 1);
});

test('commands run through the shared reducer and bump the version', async () => {
  const room = await call('POST', `/api/properties/${propertyId}/commands`, { token: ownerToken, body: { command: { type: 'room.add', payload: { number: '101', floor: 1, beds: 2, rent: 8000 } } } });
  assert.equal(room.status, 200, JSON.stringify(room.data));
  assert.equal(room.data.version, 2);
  roomId = room.data.result.roomId;
  const tenant = await call('POST', `/api/properties/${propertyId}/commands`, {
    token: ownerToken,
    body: { baseVersion: 2, command: { type: 'tenant.add', payload: { name: 'Riya Tenant', phone: tenantPhone, roomId, bed: 'A', rent: 8000, deposit: 8000, joinedOn: '2026-09-01', depositPaid: 8000 } } }
  });
  assert.equal(tenant.status, 200, JSON.stringify(tenant.data));
  tenantId = tenant.data.result.tenantId;
  const stale = await call('POST', `/api/properties/${propertyId}/commands`, { token: ownerToken, body: { baseVersion: 1, command: { type: 'room.add', payload: { number: '102', floor: 1, beds: 2, rent: 8000 } } } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, 'stale_version');
  const bad = await call('POST', `/api/properties/${propertyId}/commands`, { token: ownerToken, body: { command: { type: 'room.add', payload: { number: '101', floor: 1, beds: 2, rent: 8000 } } } });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.error, 'room_exists');
  const bills = await call('POST', `/api/properties/${propertyId}/commands`, { token: ownerToken, body: { command: { type: 'billing.generate', payload: { period: '2026-10' } } } });
  assert.equal(bills.data.result.count, 1);
});

test('a resident signs in with the phone the owner registered and only sees their own data', async () => {
  const session = await signIn(tenantPhone);
  assert.equal(session.user.name, 'Riya Tenant', 'name comes from the PG record');
  assert.equal(session.memberships.length, 1);
  assert.equal(session.memberships[0].role, 'tenant');
  assert.equal(session.memberships[0].refId, tenantId);
  const snap = await call('GET', `/api/properties/${propertyId}/snapshot?role=tenant`, { token: session.token });
  assert.equal(snap.status, 200);
  assert.equal(snap.data.state.role, 'tenant');
  assert.equal(snap.data.state.invoices.length, 1);
  assert.equal(snap.data.state.expenses.length, 0);
  assert.equal(snap.data.state.property.upiId, 'asha@upi');
  // The resident claims a UPI payment; an owner-only command is refused.
  const claim = await call('POST', `/api/properties/${propertyId}/commands`, { token: session.token, body: { role: 'tenant', command: { type: 'payment.claim', payload: { amount: 8000, mode: 'upi', reference: 'UTR777' } } } });
  assert.equal(claim.status, 200, JSON.stringify(claim.data));
  const refused = await call('POST', `/api/properties/${propertyId}/commands`, { token: session.token, body: { role: 'tenant', command: { type: 'payment.record', payload: { tenantId, amount: 1, date: '2026-10-06', mode: 'cash' } } } });
  assert.equal(refused.status, 403);
  // The owner sees the pending claim and confirms it.
  const ownerSnap = await call('GET', `/api/properties/${propertyId}/snapshot`, { token: ownerToken });
  const pending = ownerSnap.data.state.payments.find((p) => p.status === 'pending');
  assert.ok(pending);
  const confirm = await call('POST', `/api/properties/${propertyId}/commands`, { token: ownerToken, body: { command: { type: 'payment.confirm', payload: { paymentId: pending.id } } } });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.data.result.number, 'RCP-0002');
  const after = await call('GET', `/api/properties/${propertyId}/snapshot?role=tenant`, { token: session.token });
  assert.equal(after.data.state.invoices[0].paid, 8000);
  // 304 when nothing changed since the version the client has.
  const unchanged = await call('GET', `/api/properties/${propertyId}/snapshot?role=tenant&since=${after.data.version}`, { token: session.token });
  assert.equal(unchanged.status, 304);
});

test('files are stored per property and residents can only open their own', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const upload = await call('POST', `/api/properties/${propertyId}/files`, { token: ownerToken, raw: true, body: png, headers: { 'content-type': 'image/png' } });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  const fileId = upload.data.fileId;
  await call('POST', `/api/properties/${propertyId}/commands`, { token: ownerToken, body: { command: { type: 'document.add', payload: { ownerType: 'tenant', ownerId: tenantId, kind: 'id_proof', name: 'aadhaar.png', mime: 'image/png', size: png.length, fileId } } } });
  const fetched = await call('GET', `/api/properties/${propertyId}/files/${fileId}`, { token: ownerToken });
  assert.equal(fetched.status, 200);
  assert.equal(Buffer.compare(fetched.data, png), 0);
  const stranger = await signIn('9000000009');
  const denied = await call('GET', `/api/properties/${propertyId}/files/${fileId}`, { token: stranger.token });
  assert.equal(denied.status, 403);
});

test('export and import move a document between accounts intact', async () => {
  const exported = await call('GET', `/api/properties/${propertyId}/export`, { token: ownerToken });
  assert.equal(exported.status, 200);
  assert.equal(exported.data.tenants.length, 1);
  const other = await signIn('9111111111', 'Second Owner');
  const imported = await call('POST', '/api/properties/import', { token: other.token, body: { state: exported.data } });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  assert.notEqual(imported.data.propertyId, propertyId);
  const snap = await call('GET', `/api/properties/${imported.data.propertyId}/snapshot`, { token: other.token });
  assert.equal(snap.data.state.tenants[0].name, 'Riya Tenant');
  // The resident now belongs to both PGs.
  const me = await call('GET', '/api/me', { token: (await signIn(tenantPhone)).token });
  assert.equal(me.data.memberships.length, 2);
});

test('sessions end on logout and unknown tokens are rejected', async () => {
  const session = await signIn('9222222222');
  assert.equal((await call('GET', '/api/me', { token: session.token })).status, 200);
  await call('POST', '/api/auth/logout', { token: session.token });
  assert.equal((await call('GET', '/api/me', { token: session.token })).status, 401);
  assert.equal((await call('GET', '/api/me', { token: 'nope' })).status, 401);
});

test('password sign-in works once an email and password are set', async () => {
  const session = await signIn('9333333333', 'Pass User');
  const profile = await call('PATCH', '/api/me', { token: session.token, body: { email: 'pass@example.com' } });
  assert.equal(profile.status, 200);
  const short = await call('POST', '/api/auth/password/set', { token: session.token, body: { password: 'short' } });
  assert.equal(short.status, 400);
  const ok = await call('POST', '/api/auth/password/set', { token: session.token, body: { password: 'correct horse battery' } });
  assert.equal(ok.status, 200);
  const login = await call('POST', '/api/auth/password/login', { body: { email: 'PASS@example.com', password: 'correct horse battery' } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.hasPassword, true);
  const wrong = await call('POST', '/api/auth/password/login', { body: { email: 'pass@example.com', password: 'nope nope nope' } });
  assert.equal(wrong.status, 401);
});

test('forgot password: an OTP on the phone resets it and signs other devices out', async () => {
  const session = await signIn('9444444444', 'Reset User');
  await call('PATCH', '/api/me', { token: session.token, body: { email: 'reset@example.com' } });
  await call('POST', '/api/auth/password/set', { token: session.token, body: { password: 'old password 123' } });
  await call('POST', '/api/auth/otp/request', { body: { phone: '9444444444' } });
  const reset = await call('POST', '/api/auth/password/reset', { body: { phone: '9444444444', code: '246810', password: 'new password 456' } });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.equal((await call('GET', '/api/me', { token: session.token })).status, 401, 'old session is gone');
  assert.equal((await call('POST', '/api/auth/password/login', { body: { email: 'reset@example.com', password: 'old password 123' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/password/login', { body: { email: 'reset@example.com', password: 'new password 456' } })).status, 200);
  const bad = await call('POST', '/api/auth/password/reset', { body: { phone: '9444444444', code: '000000', password: 'whatever 12345' } });
  assert.equal(bad.status, 401);
});

test('security headers and rate limits are on', async () => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'self'"));
  let last;
  for (let i = 0; i < 16; i++) last = await call('POST', '/api/auth/password/login', { body: { email: `x${i}@example.com`, password: 'nope nope nope' } });
  assert.equal(last.status, 429);
  assert.ok(['login_locked', 'too_many_requests'].includes(last.data.error));
});
