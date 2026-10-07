// Accounts and sessions. People sign in with their phone number (OTP) or, optionally, with an
// email and password they set later. Which PGs they can open, and as what, is decided by the
// property documents: owners from properties.owner_id, residents and staff from people_index.
import { newId, randomToken, sha256, hashSecret, verifySecret, normalizePhone, normalizeEmail, otpCode, badRequest, unauthorized, tooMany, notFound } from '../lib/util.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_PER_HOUR = 6;
const OTP_MAX_ATTEMPTS = 5;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginFails = new Map(); // email -> { n, until }

export function createAuthService({ db, config, otp }) {
  async function requestOtp(rawPhone) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw badRequest('invalid_phone');
    const recent = await db.one(`SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '1 hour'`, [phone]);
    if (recent.n >= OTP_MAX_PER_HOUR) throw tooMany('otp_rate_limited');
    const code = otpCode();
    await db.query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
    await db.query(`INSERT INTO otp_codes (id, phone, code_hash, expires_at) VALUES ($1, $2, $3, $4)`, [
      newId('otp'), phone, sha256(`${phone}:${code}`), new Date(Date.now() + OTP_TTL_MS).toISOString()
    ]);
    await otp.send(phone, code);
    return { phone, provider: otp.provider, expiresInSeconds: OTP_TTL_MS / 1000, devCode: config.devOtp && !config.production ? config.devOtp : undefined };
  }

  async function checkOtp(phone, code) {
    if (config.devOtp && String(code) === String(config.devOtp)) return true;
    const row = await db.one(`SELECT * FROM otp_codes WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`, [phone]);
    if (!row) throw unauthorized('otp_expired');
    if (new Date(row.expires_at).getTime() < Date.now()) throw unauthorized('otp_expired');
    if (row.attempts >= OTP_MAX_ATTEMPTS) throw tooMany('otp_too_many_attempts');
    if (row.code_hash !== sha256(`${phone}:${String(code).trim()}`)) {
      await db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      throw unauthorized('otp_wrong');
    }
    await db.query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
    return true;
  }

  async function findOrCreateUserByPhone(phone, name = '') {
    let user = await db.one(`SELECT * FROM users WHERE phone = $1`, [phone]);
    if (!user) {
      // Take the name from the PG that registered this phone, if any.
      const known = await db.one(`SELECT name FROM people_index WHERE phone = $1 AND active ORDER BY name LIMIT 1`, [phone]);
      user = await db.one(`INSERT INTO users (id, phone, name, last_login_at) VALUES ($1, $2, $3, now()) RETURNING *`, [newId('usr'), phone, (name || known?.name || '').trim()]);
    } else {
      if (name && !user.name) await db.query(`UPDATE users SET name = $2 WHERE id = $1`, [user.id, name.trim()]);
      await db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
      user = await db.one(`SELECT * FROM users WHERE id = $1`, [user.id]);
    }
    return user;
  }

  async function createSession(user, userAgent = '') {
    const token = randomToken();
    await db.query(`INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)`, [
      newId('ses'), user.id, sha256(token), String(userAgent).slice(0, 200), new Date(Date.now() + config.sessionDays * 86400000).toISOString()
    ]);
    return token;
  }

  async function userForToken(token) {
    if (!token) return null;
    const row = await db.one(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]
    );
    return row || null;
  }

  async function revokeSession(token) {
    if (token) await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  }

  /** Every (property, role) the user may open. */
  async function membershipsFor(user) {
    const owned = await db.all(`SELECT id, name FROM properties WHERE owner_id = $1 ORDER BY created_at`, [user.id]);
    const people = user.phone
      ? await db.all(
          `SELECT pi.property_id, pi.role, pi.ref_id, pi.name AS person_name, p.name AS property_name
             FROM people_index pi JOIN properties p ON p.id = pi.property_id
            WHERE pi.active AND (pi.phone = $1 OR ($2 <> '' AND pi.email = $2))
            ORDER BY p.name`,
          [user.phone, user.email || '']
        )
      : [];
    return [
      ...owned.map((p) => ({ propertyId: p.id, propertyName: p.name, role: 'owner', refId: null, name: user.name })),
      ...people.map((p) => ({ propertyId: p.property_id, propertyName: p.property_name, role: p.role, refId: p.ref_id, name: p.person_name }))
    ];
  }

  function publicUser(user) {
    return { id: user.id, name: user.name, phone: user.phone, email: user.email, hasPassword: Boolean(user.password_hash), lang: user.lang };
  }

  async function signInResponse(user, userAgent) {
    const token = await createSession(user, userAgent);
    return { token, user: publicUser(user), memberships: await membershipsFor(user) };
  }

  async function loginWithOtp({ phone: rawPhone, code, name, userAgent }) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw badRequest('invalid_phone');
    if (!code) throw badRequest('otp_required');
    await checkOtp(phone, code);
    const user = await findOrCreateUserByPhone(phone, name);
    return signInResponse(user, userAgent);
  }

  async function loginWithPassword({ email: rawEmail, password, userAgent }) {
    const email = normalizeEmail(rawEmail);
    if (!email || !password) throw badRequest('invalid_credentials');
    const lock = loginFails.get(email);
    if (lock && lock.until > Date.now()) throw tooMany('login_locked');
    const user = await db.one(`SELECT * FROM users WHERE email = $1`, [email]);
    if (!user || !verifySecret(password, user.password_hash)) {
      const n = (lock?.n || 0) + 1;
      loginFails.set(email, { n, until: n >= LOGIN_MAX_FAILS ? Date.now() + LOGIN_LOCK_MS : 0 });
      throw unauthorized('invalid_credentials');
    }
    loginFails.delete(email);
    await db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    return signInResponse(user, userAgent);
  }

  async function setPassword(user, password) {
    if (!password || String(password).length < 8) throw badRequest('password_too_short', { min: 8 });
    if (!user.email) throw badRequest('email_required');
    await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [user.id, hashSecret(password)]);
  }

  /** Forgot password: prove the phone with a one-time code, set a new password, sign every other device out. */
  async function resetPasswordWithOtp({ phone: rawPhone, code, password, userAgent }) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw badRequest('invalid_phone');
    if (!password || String(password).length < 8) throw badRequest('password_too_short', { min: 8 });
    await checkOtp(phone, code);
    const user = await db.one(`SELECT * FROM users WHERE phone = $1`, [phone]);
    if (!user) throw notFound('user_not_found');
    await db.query(`UPDATE users SET password_hash = $2, last_login_at = now() WHERE id = $1`, [user.id, hashSecret(password)]);
    await db.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
    loginFails.delete(user.email || '');
    return signInResponse(user, userAgent);
  }

  async function signOutEverywhere(user) {
    await db.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
  }

  async function updateProfile(user, { name, email, lang }) {
    const nextName = name !== undefined ? String(name).trim().slice(0, 80) : user.name;
    let nextEmail = user.email;
    if (email !== undefined) {
      nextEmail = email ? normalizeEmail(email) : null;
      if (email && !nextEmail) throw badRequest('invalid_email');
      if (nextEmail) {
        const clash = await db.one(`SELECT id FROM users WHERE email = $1 AND id <> $2`, [nextEmail, user.id]);
        if (clash) throw badRequest('email_taken');
      }
    }
    const nextLang = lang !== undefined ? String(lang).slice(0, 5) : user.lang;
    const updated = await db.one(`UPDATE users SET name = $2, email = $3, lang = $4 WHERE id = $1 RETURNING *`, [user.id, nextName, nextEmail, nextLang]);
    return publicUser(updated);
  }

  async function getUser(id) {
    const user = await db.one(`SELECT * FROM users WHERE id = $1`, [id]);
    if (!user) throw notFound('user_not_found');
    return user;
  }

  return { requestOtp, loginWithOtp, loginWithPassword, setPassword, resetPasswordWithOtp, signOutEverywhere, updateProfile, userForToken, revokeSession, membershipsFor, publicUser, getUser };
}
