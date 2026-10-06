// HTTP layer. Thin: parse, authenticate, call a service, answer. Business rules live in shared/.
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { createOtpSender } from './lib/otp.js';
import { createAuthService } from './services/auth.js';
import { createPropertyService } from './services/properties.js';
import { HttpError, unauthorized, badRequest } from './lib/util.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const log = overrides.silent ? () => {} : (...a) => console.log(...a);
  const db = await createDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir, log });
  const otp = createOtpSender(config, log);
  const auth = createAuthService({ db, config, otp });
  const props = createPropertyService({ db, auth, config });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()), credentials: false }));
  app.use(express.json({ limit: '2mb' }));

  const tokenOf = (req) => {
    const header = req.get('authorization') || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  };

  const requireUser = wrap(async (req, _res, next) => {
    const user = await auth.userForToken(tokenOf(req));
    if (!user) throw unauthorized('sign_in_required');
    req.user = user;
    next();
  });

  // ----- health -----
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: config.appName, db: db.kind, otp: otp.provider, time: new Date().toISOString() }));

  // ----- auth -----
  app.post('/api/auth/otp/request', wrap(async (req, res) => res.json(await auth.requestOtp(req.body?.phone))));
  app.post('/api/auth/otp/verify', wrap(async (req, res) => {
    const { phone, code, name } = req.body || {};
    res.json(await auth.loginWithOtp({ phone, code, name, userAgent: req.get('user-agent') }));
  }));
  app.post('/api/auth/password/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    res.json(await auth.loginWithPassword({ email, password, userAgent: req.get('user-agent') }));
  }));
  app.post('/api/auth/password/set', requireUser, wrap(async (req, res) => {
    await auth.setPassword(req.user, req.body?.password);
    res.json({ ok: true });
  }));
  app.post('/api/auth/logout', wrap(async (req, res) => {
    await auth.revokeSession(tokenOf(req));
    res.json({ ok: true });
  }));

  // ----- me -----
  app.get('/api/me', requireUser, wrap(async (req, res) => {
    res.json({ user: auth.publicUser(req.user), memberships: await auth.membershipsFor(req.user) });
  }));
  app.patch('/api/me', requireUser, wrap(async (req, res) => {
    const user = await auth.updateProfile(req.user, req.body || {});
    res.json({ user, memberships: await auth.membershipsFor(await auth.getUser(req.user.id)) });
  }));

  // ----- properties -----
  app.post('/api/properties', requireUser, wrap(async (req, res) => {
    const created = await props.create(req.user, req.body || {});
    res.status(201).json({ propertyId: created.propertyId, version: created.version, memberships: await auth.membershipsFor(req.user) });
  }));
  app.post('/api/properties/import', requireUser, wrap(async (req, res) => {
    const imported = await props.importState(req.user, req.body?.state);
    res.status(201).json({ ...imported, memberships: await auth.membershipsFor(req.user) });
  }));
  app.get('/api/properties/:pid/snapshot', requireUser, wrap(async (req, res) => {
    const role = req.query.role ? String(req.query.role) : undefined;
    const snap = await props.snapshot(req.user, req.params.pid, role);
    if (req.query.since && Number(req.query.since) === snap.version) return res.status(304).end();
    res.json(snap);
  }));
  app.post('/api/properties/:pid/commands', requireUser, wrap(async (req, res) => {
    const { role, command, baseVersion } = req.body || {};
    if (!command || typeof command.type !== 'string') throw badRequest('command_required');
    res.json(await props.command(req.user, req.params.pid, { role, command, baseVersion }));
  }));
  app.get('/api/properties/:pid/export', requireUser, wrap(async (req, res) => {
    res.json(await props.exportState(req.user, req.params.pid));
  }));
  app.delete('/api/properties/:pid', requireUser, wrap(async (req, res) => {
    await props.remove(req.user, req.params.pid);
    res.json({ ok: true, memberships: await auth.membershipsFor(req.user) });
  }));

  // ----- files -----
  app.post('/api/properties/:pid/files', requireUser, express.raw({ type: () => true, limit: config.maxUploadBytes + 1024 }), wrap(async (req, res) => {
    const result = await props.putFile(req.user, req.params.pid, { mime: req.get('content-type'), data: req.body });
    res.status(201).json(result);
  }));
  app.get('/api/properties/:pid/files/:fid', requireUser, wrap(async (req, res) => {
    const file = await props.getFile(req.user, req.params.pid, req.params.fid);
    res.set('content-type', file.mime);
    res.set('content-length', String(file.size));
    res.set('cache-control', 'private, max-age=3600');
    res.send(file.data);
  }));
  app.delete('/api/properties/:pid/files/:fid', requireUser, wrap(async (req, res) => {
    await props.membership(req.user, req.params.pid);
    await props.deleteFile(req.params.pid, req.params.fid);
    res.json({ ok: true });
  }));

  // ----- web app (single deployment: API + static files) -----
  const dist = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
  if (config.serveFrontend && existsSync(dist + 'index.html')) {
    app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(dist + 'index.html'));
    log('serving web app from frontend/dist');
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, details: err.details });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'file_too_large', details: { max: config.maxUploadBytes } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return { app, config, db, auth, props, otp };
}
