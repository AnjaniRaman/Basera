// Property documents on the server: create, load, apply commands through the shared reducer,
// keep the sign-in index in step, scope snapshots by role and store uploaded files.
import {
  createPropertyState, normalizeState, applyCommand, scopeState, DomainError, propertySchema, SCHEMA_VERSION, staffAccess
} from '@basera/domain';
import { newId, nowIso, badRequest, forbidden, notFound, conflict, HttpError } from '../lib/util.js';

export function createPropertyService({ db, auth, config }) {
  async function loadRow(propertyId) {
    const row = await db.one(`SELECT * FROM properties WHERE id = $1`, [propertyId]);
    if (!row) throw notFound('property_not_found');
    const state = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
    return { ...row, state: normalizeState(state) };
  }

  /** The (role, refId) pair a user holds on a property, or null. Owners may ask for any role they hold. */
  async function membership(user, propertyId, wantedRole) {
    const memberships = await auth.membershipsFor(user);
    const mine = memberships.filter((m) => m.propertyId === propertyId);
    if (!mine.length) return null;
    if (wantedRole) return mine.find((m) => m.role === wantedRole) || null;
    return mine.find((m) => m.role === 'owner') || mine[0];
  }

  async function requireMembership(user, propertyId, wantedRole) {
    const m = await membership(user, propertyId, wantedRole);
    if (!m) throw forbidden('not_a_member');
    return m;
  }

  async function rebuildPeopleIndex(propertyId, state) {
    await db.query(`DELETE FROM people_index WHERE property_id = $1`, [propertyId]);
    const rows = [
      ...state.tenants.map((t) => ['tenant', t.id, t.phone || null, t.email || null, t.name, t.status !== 'left']),
      ...state.staff.map((s) => ['staff', s.id, s.phone || null, null, s.name, Boolean(s.active)])
    ];
    for (const [role, refId, phone, email, name, active] of rows) {
      await db.query(
        `INSERT INTO people_index (property_id, role, ref_id, phone, email, name, active) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (property_id, role, ref_id) DO UPDATE SET phone = EXCLUDED.phone, email = EXCLUDED.email, name = EXCLUDED.name, active = EXCLUDED.active`,
        [propertyId, role, refId, phone, email, name, active]
      );
    }
  }

  async function saveState(propertyId, state, version) {
    await db.query(`UPDATE properties SET state = $2, version = $3, name = $4, updated_at = now() WHERE id = $1`, [
      propertyId, JSON.stringify(state), version, state.property.name
    ]);
  }

  async function create(user, input) {
    const parsed = propertySchema.safeParse({ ...input, ownerName: input.ownerName || user.name || '', ownerPhone: input.ownerPhone || user.phone || '' });
    if (!parsed.success) throw badRequest('invalid_input', { field: parsed.error.issues[0]?.path?.join('.') });
    const id = newId('prop');
    const state = createPropertyState(parsed.data, { id, now: nowIso() });
    await db.query(`INSERT INTO properties (id, owner_id, name, version, state) VALUES ($1, $2, $3, 1, $4)`, [id, user.id, state.property.name, JSON.stringify(state)]);
    if (!user.name && parsed.data.ownerName) await db.query(`UPDATE users SET name = $2 WHERE id = $1 AND name = ''`, [user.id, parsed.data.ownerName]);
    return { propertyId: id, version: 1, state };
  }

  /** Bring a document kept on a device into an online account (the owner keeps working from there). */
  async function importState(user, raw) {
    if (!raw || typeof raw !== 'object' || !raw.property) throw badRequest('invalid_document');
    if (raw.schemaVersion && raw.schemaVersion > SCHEMA_VERSION) throw badRequest('document_too_new');
    let state;
    try {
      state = normalizeState({ ...raw, id: newId('prop') });
    } catch {
      throw badRequest('invalid_document');
    }
    delete state.sample;
    state.property.ownerPhone = state.property.ownerPhone || user.phone || '';
    const now = nowIso();
    state.importedAt = now;
    state.updatedAt = now;
    await db.query(`INSERT INTO properties (id, owner_id, name, version, state) VALUES ($1, $2, $3, 1, $4)`, [state.id, user.id, state.property.name, JSON.stringify(state)]);
    await rebuildPeopleIndex(state.id, state);
    return { propertyId: state.id, version: 1 };
  }

  async function snapshot(user, propertyId, wantedRole) {
    const m = await requireMembership(user, propertyId, wantedRole);
    const row = await loadRow(propertyId);
    const scoped = scopeState(row.state, { role: m.role, refId: m.refId });
    if (!scoped) throw notFound('member_record_missing');
    return { version: row.version, role: m.role, refId: m.refId, state: scoped };
  }

  async function command(user, propertyId, { role, command: cmd, baseVersion }) {
    const m = await requireMembership(user, propertyId, role);
    return db.withLock(propertyId, async () => {
      const row = await loadRow(propertyId);
      if (baseVersion !== undefined && baseVersion !== null && Number(baseVersion) !== row.version) {
        // The caller is behind; let it refresh and retry rather than apply on stale data.
        throw conflict('stale_version', { current: row.version });
      }
      const actor = { role: m.role, refId: m.refId, name: m.role === 'owner' ? user.name || row.state.property.ownerName : m.name, userId: user.id };
      let outcome;
      try {
        outcome = applyCommand(row.state, cmd, { now: nowIso(), actor, newId });
      } catch (err) {
        if (err instanceof DomainError) throw new HttpError(err.code === 'forbidden' ? 403 : 422, err.code, err.details);
        throw err;
      }
      const version = row.version + 1;
      await saveState(propertyId, outcome.state, version);
      await db.query(`INSERT INTO events (property_id, version, type, payload, actor) VALUES ($1, $2, $3, $4, $5)`, [
        propertyId, version, cmd.type, JSON.stringify(cmd.payload ?? {}), JSON.stringify({ role: actor.role, refId: actor.refId, userId: user.id })
      ]);
      if (/^(tenant|staff)\./.test(cmd.type)) await rebuildPeopleIndex(propertyId, outcome.state);
      return { version, result: outcome.result, state: scopeState(outcome.state, { role: m.role, refId: m.refId }) };
    });
  }

  async function exportState(user, propertyId) {
    await requireMembership(user, propertyId, 'owner');
    const row = await loadRow(propertyId);
    return row.state;
  }

  async function remove(user, propertyId) {
    await requireMembership(user, propertyId, 'owner');
    await db.query(`DELETE FROM properties WHERE id = $1`, [propertyId]);
  }

  // ----- files (ID proofs, agreements) -----

  async function putFile(user, propertyId, { mime, data }) {
    const m = await requireMembership(user, propertyId);
    if (!data || !data.length) throw badRequest('empty_file');
    if (data.length > config.maxUploadBytes) throw badRequest('file_too_large', { max: config.maxUploadBytes });
    const id = newId('file');
    await db.query(`INSERT INTO files (id, property_id, mime, size, data, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6)`, [
      id, propertyId, String(mime || 'application/octet-stream').slice(0, 80), data.length, data, `${m.role}:${m.refId || user.id}`
    ]);
    return { fileId: id, size: data.length };
  }

  async function getFile(user, propertyId, fileId) {
    const m = await requireMembership(user, propertyId);
    const row = await loadRow(propertyId);
    const doc = row.state.documents.find((d) => d.fileId === fileId);
    if (m.role !== 'owner') {
      // Residents and staff may only open their own documents.
      const desk = m.role === 'staff' && staffAccess(row.state, m) !== 'basic' && doc?.ownerType === 'tenant';
      if (!desk && (!doc || doc.ownerType !== m.role || doc.ownerId !== m.refId)) throw forbidden('not_your_document');
    }
    const file = await db.one(`SELECT id, mime, size, data FROM files WHERE id = $1 AND property_id = $2`, [fileId, propertyId]);
    if (!file) throw notFound('file_not_found');
    return { ...file, data: Buffer.from(file.data) };
  }

  async function deleteFile(propertyId, fileId) {
    await db.query(`DELETE FROM files WHERE id = $1 AND property_id = $2`, [fileId, propertyId]);
  }

  return { create, importState, snapshot, command, exportState, remove, putFile, getFile, deleteFile, membership };
}
