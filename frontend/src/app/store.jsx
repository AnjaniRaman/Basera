// Application state: which backend (device or online account), who is signed in, which PG is
// open in which role, the property document, and dispatch() for commands. Screens read from
// useApp() and never touch storage or the network directly.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { scopeState, toISODate, DomainError, canPerform } from '@basera/domain';
import { createLocalBackend } from './backends/local.js';
import { createServerBackend, defaultApiUrl, savedApiUrl, saveApiUrl, ApiError } from './backends/server.js';
import { prefs } from './storage.js';

const SESSION_KEY = 'basera_session';
const POLL_MS = 20000;

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const localBackend = useMemo(() => createLocalBackend(), []);
  const [serverUrl, setServerUrlState] = useState(() => savedApiUrl() || defaultApiUrl());
  const serverBackend = useMemo(() => (serverUrl ? createServerBackend(serverUrl) : null), [serverUrl]);
  const [serverStatus, setServerStatus] = useState('idle');
  const [serverInfo, setServerInfo] = useState(null);

  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState(null); // { mode, user }
  const [memberships, setMemberships] = useState([]);
  const [current, setCurrent] = useState(null); // { propertyId, role, refId, name }
  const [doc, setDoc] = useState(null); // { full, state, version }
  const [preview, setPreview] = useState(null); // { role, refId, name }
  const [localProperties, setLocalProperties] = useState([]);
  const [persistent, setPersistent] = useState(true);
  const [today, setToday] = useState(() => toISODate(new Date()));
  const [lastError, setLastError] = useState(null);
  const docRef = useRef(null);
  docRef.current = doc;

  // Keep "today" fresh for sessions that stay open past midnight.
  useEffect(() => {
    const id = setInterval(() => setToday(toISODate(new Date())), 60000);
    return () => clearInterval(id);
  }, []);

  const persistSession = useCallback((next) => {
    if (next) prefs.set(SESSION_KEY, next);
    else prefs.remove(SESSION_KEY);
  }, []);

  const refreshLocalIndex = useCallback(async () => {
    setLocalProperties(await localBackend.listProperties());
  }, [localBackend]);

  const checkServer = useCallback(async () => {
    if (!serverBackend) {
      setServerStatus('idle');
      return false;
    }
    setServerStatus('checking');
    try {
      const info = await serverBackend.health();
      setServerInfo(info);
      setServerStatus('online');
      return true;
    } catch {
      setServerStatus('offline');
      return false;
    }
  }, [serverBackend]);

  const setServerUrl = useCallback((url) => {
    const clean = saveApiUrl(url);
    setServerUrlState(clean || defaultApiUrl());
  }, []);

  // ----- opening a property -----

  const actorFor = useCallback((member, previewActor) => {
    if (previewActor) return { role: previewActor.role, refId: previewActor.refId, name: previewActor.name };
    return { role: member.role, refId: member.refId, name: member.name };
  }, []);

  const openMembership = useCallback(
    async (member, sess = session, previewActor = null) => {
      const mode = sess?.mode || 'local';
      if (mode === 'local') {
        const full = await localBackend.load(member.propertyId);
        if (!full) throw new DomainError('property_not_found');
        const actor = actorFor(member, previewActor);
        setDoc({ full, state: scopeState(full, actor), version: 0 });
      } else {
        const snap = await serverBackend.snapshot(member.propertyId, member.role);
        setDoc({ full: member.role === 'owner' ? snap.state : null, state: snap.state, version: snap.version });
      }
      setCurrent({ propertyId: member.propertyId, role: member.role, refId: member.refId, name: member.name, propertyName: member.propertyName });
      persistSession({ ...sess, current: { propertyId: member.propertyId, role: member.role, refId: member.refId, name: member.name, propertyName: member.propertyName } });
    },
    [session, localBackend, serverBackend, actorFor, persistSession]
  );

  const refresh = useCallback(async () => {
    if (!current || !session) return;
    try {
      if (session.mode === 'local') {
        const full = await localBackend.load(current.propertyId);
        if (full) setDoc({ full, state: scopeState(full, actorFor(current, preview)), version: 0 });
      } else {
        const since = docRef.current?.version;
        const snap = await serverBackend.snapshot(current.propertyId, current.role, since);
        if (snap) setDoc({ full: current.role === 'owner' ? snap.state : null, state: preview && snap.state ? scopeState(snap.state, preview) : snap.state, version: snap.version });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        setCurrent(null);
        setDoc(null);
        persistSession(null);
      }
    }
  }, [current, session, localBackend, serverBackend, actorFor, preview, persistSession]);

  // ----- boot: restore the last session -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPersistent(await localBackend.persistent());
      await refreshLocalIndex();
      const saved = prefs.get(SESSION_KEY);
      if (saved?.mode === 'local' && saved.user) {
        const members = await localBackend.resolvePerson(saved.user.phone || saved.user.email);
        if (!cancelled) {
          setSession({ mode: 'local', user: saved.user });
          setMemberships(members);
          const target = saved.current && members.find((m) => m.propertyId === saved.current.propertyId && m.role === saved.current.role && m.refId === saved.current.refId);
          if (target) await openMembership(target, { mode: 'local', user: saved.user });
        }
      } else if (saved?.mode === 'server' && serverBackend?.token) {
        try {
          const me = await serverBackend.me();
          if (!cancelled) {
            const sess = { mode: 'server', user: me.user };
            setSession(sess);
            setMemberships(me.memberships);
            setServerStatus('online');
            const target = saved.current && me.memberships.find((m) => m.propertyId === saved.current.propertyId && m.role === saved.current.role);
            if (target) await openMembership(target, sess);
          }
        } catch {
          if (!cancelled) persistSession(null);
        }
      }
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Probe the server once we know its address (so the welcome screen can offer online accounts).
  useEffect(() => {
    if (serverBackend) checkServer();
    else setServerStatus('idle');
  }, [serverBackend, checkServer]);

  // Poll for changes made elsewhere (a resident's claim shows up on the owner's phone).
  useEffect(() => {
    if (session?.mode !== 'server' || !current) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [session?.mode, current, refresh]);

  // ----- sign in / out -----

  const localSignIn = useCallback(
    async (identifier, pin) => {
      const members = await localBackend.resolvePerson(identifier);
      if (!members.length) throw new DomainError('no_account_on_device');
      // The sample PG is open to anyone; real PGs need the PIN for this number.
      if (members.some((m) => !m.sample)) await localBackend.pins.check(identifier, pin);
      const user = { name: members[0].name, phone: String(identifier).replace(/\D/g, '').slice(-10), email: String(identifier).includes('@') ? identifier : '' };
      const sess = { mode: 'local', user };
      setSession(sess);
      setMemberships(members);
      setPreview(null);
      persistSession(sess);
      if (members.length === 1) await openMembership(members[0], sess);
      return members;
    },
    [localBackend, openMembership, persistSession]
  );

  const localCreateProperty = useCallback(
    async (input, pin) => {
      const state0 = {};
      // A number that already has a PIN must prove it; a new number chooses one.
      const signedInAs = session?.mode === 'local' && session.user.phone === String(input.ownerPhone).replace(/\D/g, '').slice(-10);
      if (!signedInAs) {
        if (await localBackend.pins.has(input.ownerPhone)) await localBackend.pins.check(input.ownerPhone, pin);
        else { await localBackend.pins.set(input.ownerPhone, pin); state0.recovery = await localBackend.pins.setRecovery(input.ownerPhone); }
      }
      const state = await localBackend.createProperty(input);
      state.recoveryCode = state0.recovery;
      await refreshLocalIndex();
      const user = { name: state.property.ownerName, phone: state.property.ownerPhone, email: state.property.ownerEmail || '' };
      const sess = { mode: 'local', user };
      const member = { propertyId: state.id, propertyName: state.property.name, role: 'owner', refId: null, name: user.name };
      setSession(sess);
      setMemberships(await localBackend.resolvePerson(user.phone));
      setPreview(null);
      persistSession(sess);
      await openMembership(member, sess);
      return state;
    },
    [localBackend, openMembership, persistSession, refreshLocalIndex, session]
  );

  const setLocalPin = useCallback((phone, pin) => localBackend.pins.set(phone, pin), [localBackend]);
  const localRecoveryCode = useCallback((phone) => localBackend.pins.setRecovery(phone), [localBackend]);
  const localResetPin = useCallback((phone, code, pin) => localBackend.pins.resetWithRecovery(phone, code, pin), [localBackend]);

  const localLoadSample = useCallback(
    async (owner) => {
      const state = await localBackend.loadSample(owner);
      await refreshLocalIndex();
      const user = { name: state.property.ownerName, phone: state.property.ownerPhone, email: '' };
      const sess = { mode: 'local', user };
      setSession(sess);
      setMemberships(await localBackend.resolvePerson(user.phone));
      setPreview(null);
      persistSession(sess);
      await openMembership({ propertyId: state.id, propertyName: state.property.name, role: 'owner', refId: null, name: user.name, sample: true }, sess);
      return state;
    },
    [localBackend, openMembership, persistSession, refreshLocalIndex]
  );

  const serverSignedIn = useCallback(
    async (response) => {
      serverBackend.setToken(response.token);
      const sess = { mode: 'server', user: response.user };
      setSession(sess);
      setMemberships(response.memberships);
      setPreview(null);
      persistSession(sess);
      if (response.memberships.length === 1) await openMembership(response.memberships[0], sess);
      return response.memberships;
    },
    [serverBackend, openMembership, persistSession]
  );

  const serverRequestOtp = useCallback((phone) => serverBackend.requestOtp(phone), [serverBackend]);
  const serverVerifyOtp = useCallback(async (phone, code, name) => serverSignedIn(await serverBackend.verifyOtp(phone, code, name)), [serverBackend, serverSignedIn]);
  const serverResetPassword = useCallback(async (phone, code, password) => serverSignedIn(await serverBackend.resetPassword(phone, code, password)), [serverBackend, serverSignedIn]);
  const serverPasswordLogin = useCallback(async (email, password) => serverSignedIn(await serverBackend.loginPassword(email, password)), [serverBackend, serverSignedIn]);

  const serverCreateProperty = useCallback(
    async (input) => {
      const created = await serverBackend.createProperty(input);
      setMemberships(created.memberships);
      const member = created.memberships.find((m) => m.propertyId === created.propertyId);
      await openMembership(member, session);
      return created;
    },
    [serverBackend, openMembership, session]
  );

  const reloadMemberships = useCallback(async () => {
    if (session?.mode === 'server') {
      const me = await serverBackend.me();
      setMemberships(me.memberships);
      setSession({ mode: 'server', user: me.user });
      return me.memberships;
    }
    const members = await localBackend.resolvePerson(session?.user?.phone || session?.user?.email);
    setMemberships(members);
    return members;
  }, [session, serverBackend, localBackend]);

  const signOut = useCallback(async () => {
    if (session?.mode === 'server') {
      try {
        await serverBackend.logout();
      } catch {
        /* already gone */
      }
      serverBackend.setToken('');
    }
    setSession(null);
    setMemberships([]);
    setCurrent(null);
    setDoc(null);
    setPreview(null);
    persistSession(null);
    await refreshLocalIndex();
  }, [session, serverBackend, persistSession, refreshLocalIndex]);

  const closeProperty = useCallback(() => {
    setCurrent(null);
    setDoc(null);
    setPreview(null);
    if (session) persistSession({ ...session, current: null });
  }, [session, persistSession]);

  // ----- commands -----

  const dispatch = useCallback(
    async (command) => {
      if (!current || !session) throw new DomainError('not_signed_in');
      setLastError(null);
      try {
        if (session.mode === 'local') {
          const actor = actorFor(current, preview);
          const out = await localBackend.dispatch(current.propertyId, command, actor);
          setDoc({ full: out.state, state: out.scoped, version: 0 });
          if (/^(tenant|staff|property)\./.test(command.type)) refreshLocalIndex();
          return out.result;
        }
        if (preview) throw new DomainError('preview_read_only');
        const out = await serverBackend.command(current.propertyId, current.role, command, docRef.current?.version);
        setDoc({ full: current.role === 'owner' ? out.state : null, state: out.state, version: out.version });
        return out.result;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'stale_version') {
          await refresh();
          const out = await serverBackend.command(current.propertyId, current.role, command, docRef.current?.version);
          setDoc({ full: current.role === 'owner' ? out.state : null, state: out.state, version: out.version });
          return out.result;
        }
        setLastError(err);
        throw err;
      }
    },
    [current, session, preview, actorFor, localBackend, serverBackend, refresh, refreshLocalIndex]
  );

  // ----- view as -----
  const startPreview = useCallback(
    (role, refId, name) => {
      if (!doc?.full) return;
      const actor = { role, refId, name };
      setPreview(actor);
      setDoc((d) => (d ? { ...d, state: scopeState(d.full, actor) } : d));
    },
    [doc?.full]
  );

  const stopPreview = useCallback(() => {
    setPreview(null);
    setDoc((d) => (d?.full ? { ...d, state: { ...d.full, role: 'owner', me: null } } : d));
  }, []);

  // ----- files -----
  const files = useMemo(
    () => ({
      async put(blob, meta) {
        if (session?.mode === 'server') return (await serverBackend.uploadFile(current.propertyId, blob)).fileId;
        return localBackend.files.put(blob, meta);
      },
      async get(fileId) {
        if (session?.mode === 'server') return serverBackend.fileBlob(current.propertyId, fileId);
        return localBackend.files.get(fileId);
      },
      async remove(fileId) {
        if (session?.mode === 'server') return serverBackend.deleteFile(current.propertyId, fileId).catch(() => {});
        return localBackend.files.remove(fileId);
      }
    }),
    [session?.mode, serverBackend, localBackend, current?.propertyId]
  );

  // ----- import / export / delete -----
  const exportProperty = useCallback(async () => {
    if (session?.mode === 'server') return serverBackend.exportProperty(current.propertyId);
    return localBackend.load(current.propertyId);
  }, [session?.mode, serverBackend, localBackend, current?.propertyId]);

  const importProperty = useCallback(
    async (state) => {
      if (session?.mode === 'server') {
        const res = await serverBackend.importProperty(state);
        setMemberships(res.memberships);
        return res.propertyId;
      }
      const saved = await localBackend.importState(state);
      await refreshLocalIndex();
      return saved.id;
    },
    [session?.mode, serverBackend, localBackend, refreshLocalIndex]
  );

  const deleteProperty = useCallback(async () => {
    if (session?.mode === 'server') {
      const res = await serverBackend.deleteProperty(current.propertyId);
      setMemberships(res.memberships);
    } else {
      await localBackend.removeProperty(current.propertyId);
      await refreshLocalIndex();
      setMemberships(await localBackend.resolvePerson(session?.user?.phone));
    }
    closeProperty();
  }, [session, serverBackend, localBackend, current?.propertyId, closeProperty, refreshLocalIndex]);

  const liveRole = preview ? preview.role : current?.role || null;
  const access = liveRole === 'staff' ? doc?.state?.access || 'basic' : 'basic';
  const manages = liveRole === 'owner' || (liveRole === 'staff' && access !== 'basic');
  const can = useCallback((type) => canPerform(type, liveRole, access), [liveRole, access]);

  const value = useMemo(
    () => ({
      booted,
      access,
      manages,
      can,
      setLocalPin,
      localRecoveryCode,
      localResetPin,
      serverResetPassword,
      mode: session?.mode || null,
      session,
      memberships,
      current,
      doc,
      state: doc?.state || null,
      full: doc?.full || null,
      version: doc?.version || 0,
      preview,
      role: preview ? preview.role : current?.role || null,
      refId: preview ? preview.refId : current?.refId || null,
      today,
      persistent,
      localProperties,
      lastError,
      server: { url: serverUrl, status: serverStatus, info: serverInfo, available: Boolean(serverBackend), backend: serverBackend },
      setServerUrl,
      checkServer,
      localSignIn,
      localCreateProperty,
      localLoadSample,
      serverRequestOtp,
      serverVerifyOtp,
      serverPasswordLogin,
      serverCreateProperty,
      reloadMemberships,
      openMembership,
      closeProperty,
      signOut,
      dispatch,
      refresh,
      startPreview,
      stopPreview,
      files,
      exportProperty,
      importProperty,
      deleteProperty
    }),
    [access, manages, can, setLocalPin, localRecoveryCode, localResetPin, serverResetPassword, booted, session, memberships, current, doc, preview, today, persistent, localProperties, lastError, serverUrl, serverStatus, serverInfo, serverBackend, setServerUrl, checkServer, localSignIn, localCreateProperty, localLoadSample, serverRequestOtp, serverVerifyOtp, serverPasswordLogin, serverCreateProperty, reloadMemberships, openMembership, closeProperty, signOut, dispatch, refresh, startPreview, stopPreview, files, exportProperty, importProperty, deleteProperty]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
