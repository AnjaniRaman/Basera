// First screen: sign in (owner, resident or staff with the same phone box), set up a new PG, or
// open the sample PG. Also the place where a signed-in person with several PGs picks one.
import { useState } from 'react';
import { Building2, LogIn, FlaskConical, ArrowLeft, Smartphone, Cloud, Home, User, Wrench } from 'lucide-react';
import { periodOf } from '@basera/domain';
import { useApp } from '../app/store.jsx';
import { useI18n, LANGUAGES } from '../app/i18n.jsx';
import { useUi, Input, Select, Seg, errorText, copyText } from '../ui/kit.jsx';

function Art() {
  const { t } = useI18n();
  const cells = 'a..b.a.ab..a.b.aa.b..ab.a.b.a.'.split('');
  return (
    <div className="welcome-art">
      <div className="brand" style={{ padding: 0 }}><span className="brand-mark"><i /><i /><i /><i /></span>Basera</div>
      <div className="stack lg">
        <h1>{t('welcome.headline')}</h1>
        <p style={{ opacity: .85, maxWidth: 460 }}>{t('welcome.sub')}</p>
      </div>
      <div className="building" aria-hidden="true">{cells.map((c, i) => (<i key={i} className={c === '.' ? '' : c} />))}</div>
    </div>
  );
}

function LangPicker() {
  const { lang, setLang } = useI18n();
  return (
    <select className="input" style={{ width: 'auto', minHeight: 34 }} value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" id="lang-select">
      {LANGUAGES.map((l) => (<option key={l.code} value={l.code}>{l.native}</option>))}
    </select>
  );
}

const ROLE_ICON = { owner: Building2, tenant: Home, staff: Wrench };

export function MembershipChooser() {
  const app = useApp();
  const { t, tv } = useI18n();
  const ui = useUi();
  const [adding, setAdding] = useState(false);
  if (adding) return <SetupWizard onBack={() => setAdding(false)} signedIn />;
  return (
    <div className="welcome-box">
      <div><h1>{t('choose.title')}</h1><p className="muted">{t('choose.sub', { name: app.session.user.name || app.session.user.phone })}</p></div>
      <div className="stack sm">
        {app.memberships.map((m) => { const Icon = ROLE_ICON[m.role] || User; return (
          <button key={`${m.propertyId}-${m.role}-${m.refId}`} className="choice" onClick={() => ui.run(() => app.openMembership(m))} data-testid={`open-${m.role}`}>
            <Icon /><span className="grow"><b>{m.propertyName}</b><br /><span className="small muted">{tv('role', m.role)}{m.sample ? ` · ${t('sample.badge')}` : ''}</span></span>
          </button>); })}
        {!app.memberships.length && <p className="muted">{t('choose.none')}</p>}
      </div>
      <div className="row wrap">
        <button className="btn primary" onClick={() => setAdding(true)} data-testid="add-pg"><Building2 />{t('choose.addPg')}</button>
        <button className="btn ghost" onClick={app.signOut}>{t('common.signOut')}</button>
      </div>
    </div>
  );
}

function Forgot({ onBack, where }) {
  const app = useApp();
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newCode, setNewCode] = useState('');
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch (err) { setError(errorText(t, err)); } finally { setBusy(false); } };
  const submit = (e) => {
    e.preventDefault();
    if (where === 'local') return act(async () => { const c = await app.localResetPin(phone, code, secret); setNewCode(c); });
    if (!sent) return act(async () => { const r = await app.serverRequestOtp(phone); setSent(true); if (r.devCode) setCode(r.devCode); });
    return act(() => app.serverResetPassword(phone, code, secret));
  };
  if (newCode) return <RecoveryCard code={newCode} onDone={onBack} />;
  return (
    <form className="welcome-box" onSubmit={submit}>
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}><ArrowLeft />{t('common.back')}</button>
      <div><h1>{where === 'local' ? t('forgot.pinTitle') : t('forgot.title')}</h1><p className="muted">{where === 'local' ? t('forgot.pinSub') : t('forgot.sub')}</p></div>
      <Input id="forgot-phone" label={t('field.phone')} type="tel" inputMode="numeric" value={phone} onChange={(v) => { setPhone(v); setSent(false); }} required autoComplete="tel" />
      {where === 'local' ? (<>
        <Input id="forgot-recovery" label={t('forgot.recoveryCode')} value={code} onChange={setCode} required placeholder="ABCD-EFGH" autoComplete="off" />
        <Input id="forgot-newpin" label={t('forgot.newPin')} type="password" inputMode="numeric" maxLength={6} value={secret} onChange={setSecret} required hint={t('setup.pinHint')} />
      </>) : sent && (<>
        <Input id="forgot-code" label={t('signin.code')} inputMode="numeric" value={code} onChange={setCode} required autoComplete="one-time-code" hint={t('signin.codeSent', { phone })} />
        <Input id="forgot-password" label={t('forgot.newPassword')} type="password" value={secret} onChange={setSecret} required minLength={8} autoComplete="new-password" hint={t('forgot.passwordHint')} />
      </>)}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy} data-testid="forgot-submit">{where === 'server' && !sent ? t('signin.sendCode') : t('forgot.reset')}</button>
    </form>
  );
}

/** Shown once: the code that resets a forgotten device PIN. */
export function RecoveryCard({ code, onDone }) {
  const { t } = useI18n();
  const ui = useUi();
  return (
    <div className="welcome-box">
      <div><h1>{t('recovery.title')}</h1><p className="muted">{t('recovery.body')}</p></div>
      <div className="card" style={{ textAlign: 'center' }}><div className="eyebrow">{t('forgot.recoveryCode')}</div><div className="num" style={{ fontSize: '2rem', fontWeight: 600, letterSpacing: '.08em', userSelect: 'all' }} data-testid="recovery-code">{code}</div></div>
      <div className="row wrap"><button className="btn" onClick={async () => ui.toast((await copyText(code)) ? t('toast.copied') : code)}>{t('common.copy')}</button><button className="btn primary grow" onClick={onDone} data-testid="recovery-done">{t('recovery.saved')}</button></div>
    </div>
  );
}

function SignIn({ onBack }) {
  const app = useApp();
  const { t } = useI18n();
  const online = app.server.status === 'online';
  const [forgot, setForgot] = useState(false);
  const [where, setWhere] = useState(online ? 'server' : 'local');
  const [method, setMethod] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch (err) { setError(errorText(t, err)); } finally { setBusy(false); } };
  const submit = (e) => {
    e.preventDefault();
    if (where === 'local') return act(() => app.localSignIn(phone, pin));
    if (method === 'email') return act(() => app.serverPasswordLogin(email, password));
    if (!sent) return act(async () => { const r = await app.serverRequestOtp(phone); setSent(true); if (r.devCode) setCode(r.devCode); });
    return act(() => app.serverVerifyOtp(phone, code));
  };
  if (forgot) return <Forgot where={where} onBack={() => setForgot(false)} />;
  return (
    <form className="welcome-box" onSubmit={submit}>
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}><ArrowLeft />{t('common.back')}</button>
      <div><h1>{t('signin.title')}</h1><p className="muted">{t('signin.sub')}</p></div>
      {online && <Seg value={where} onChange={(v) => { setWhere(v); setSent(false); setError(''); }} options={[{ value: 'server', label: t('mode.online') }, { value: 'local', label: t('mode.device') }]} />}
      {where === 'server' && <Seg value={method} onChange={setMethod} options={[{ value: 'phone', label: t('signin.phone') }, { value: 'email', label: t('signin.email') }]} />}
      {where === 'server' && method === 'email' ? (<>
        <Input id="signin-email" label={t('field.email')} type="email" value={email} onChange={setEmail} required autoComplete="email" />
        <Input id="signin-password" label={t('field.password')} type="password" value={password} onChange={setPassword} required autoComplete="current-password" />
      </>) : (<>
        <Input id="signin-phone" label={t('field.phone')} type="tel" inputMode="numeric" value={phone} onChange={(v) => { setPhone(v); setSent(false); }} placeholder="98765 43210" required autoComplete="tel"
          hint={where === 'local' ? t('signin.localHint') : t('signin.otpHint')} />
        {where === 'local' && <Input id="signin-pin" label={t('field.pin')} type="password" inputMode="numeric" maxLength={6} value={pin} onChange={setPin} autoComplete="current-password" hint={t('signin.pinHint')} />}
        {where === 'server' && sent && <Input id="signin-code" label={t('signin.code')} inputMode="numeric" value={code} onChange={setCode} required autoComplete="one-time-code" hint={t('signin.codeSent', { phone })} />}
      </>)}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy} data-testid="signin-submit">{where === 'server' && method === 'phone' && !sent ? t('signin.sendCode') : t('signin.submit')}</button>
      {(where === 'local' || method === 'email') && <button type="button" className="btn ghost sm" onClick={() => setForgot(true)} data-testid="forgot-link">{where === 'local' ? t('forgot.pinLink') : t('forgot.link')}</button>}
    </form>
  );
}

function SetupWizard({ onBack, signedIn }) {
  const app = useApp();
  const { t } = useI18n();
  const online = app.server.status === 'online';
  const [where, setWhere] = useState(signedIn ? app.mode : online ? 'server' : 'local');
  const [step, setStep] = useState(signedIn ? 1 : 0);
  const [f, setF] = useState({ ownerName: app.session?.user?.name || '', ownerPhone: app.session?.user?.phone || '', pin: '', code: '', name: '', city: '', address: '', upiId: '', floors: 2, roomsPerFloor: 4, beds: 2, rent: 7000, dueDay: 5, electricityMode: 'meter' });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState('');
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch (err) { setError(errorText(t, err)); } finally { setBusy(false); } };

  const next = (e) => {
    e.preventDefault();
    if (step === 0) {
      if (String(f.ownerPhone).replace(/\D/g, '').length < 10) return setError(t('err.invalid_phone'));
      if (where === 'server') {
        if (!sent) return act(async () => { const r = await app.serverRequestOtp(f.ownerPhone); setSent(true); if (r.devCode) set('code')(r.devCode); });
        return act(async () => { await app.serverVerifyOtp(f.ownerPhone, f.code, f.ownerName); setStep(1); });
      }
      if (!/^\d{4,6}$/.test(f.pin)) return setError(t('err.pin_format'));
      setError(''); return setStep(1);
    }
    if (step === 1) { setError(''); return setStep(2); }
    return act(async () => {
      const input = { name: f.name, city: f.city, address: f.address, upiId: f.upiId, ownerName: f.ownerName, ownerPhone: f.ownerPhone,
        rules: { dueDay: Number(f.dueDay) || 5, electricityMode: f.electricityMode, billingStart: periodOf(app.today) } };
      if (where === 'server') await app.serverCreateProperty(input); else { const st = await app.localCreateProperty(input, f.pin); if (st.recoveryCode) { sessionStash.recovery = st.recoveryCode; setRecovery(st.recoveryCode); } }
    });
  };
  // Rooms are added right after the property opens (see OwnerApp first-run), driven by this stash.
  if (step === 2) sessionStash.rooms = { floors: Number(f.floors) || 1, roomsPerFloor: Number(f.roomsPerFloor) || 1, beds: Number(f.beds) || 1, rent: Number(f.rent) || 0, startFloor: 1 };

  if (recovery) return <RecoveryCard code={recovery} onDone={() => setRecovery('')} />;
  return (
    <form className="welcome-box" onSubmit={next}>
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => (step > (signedIn ? 1 : 0) ? setStep(step - 1) : onBack())}><ArrowLeft />{t('common.back')}</button>
      <div className="steps" aria-hidden="true">{[0, 1, 2].map((i) => (<i key={i} className={i <= step ? 'on' : ''} />))}</div>
      {step === 0 && (<>
        <div><h1>{t('setup.youTitle')}</h1><p className="muted">{t('setup.youSub')}</p></div>
        {online && (<div className="stack sm">
          <button type="button" className="choice" style={where === 'server' ? { borderColor: 'var(--accent)' } : null} onClick={() => setWhere('server')}><Cloud /><span><b>{t('mode.online')}</b><br /><span className="small muted">{t('mode.onlineSub')}</span></span></button>
          <button type="button" className="choice" style={where === 'local' ? { borderColor: 'var(--accent)' } : null} onClick={() => setWhere('local')}><Smartphone /><span><b>{t('mode.device')}</b><br /><span className="small muted">{t('mode.deviceSub')}</span></span></button>
        </div>)}
        <Input id="setup-owner-name" label={t('field.yourName')} value={f.ownerName} onChange={set('ownerName')} required autoComplete="name" />
        <Input id="setup-owner-phone" label={t('field.phone')} type="tel" inputMode="numeric" value={f.ownerPhone} onChange={(v) => { set('ownerPhone')(v); setSent(false); }} required hint={t('setup.phoneHint')} />
        {where === 'local' && <Input id="setup-pin" label={t('field.pin')} type="password" inputMode="numeric" maxLength={6} value={f.pin} onChange={set('pin')} required autoComplete="new-password" hint={t('setup.pinHint')} />}
        {where === 'server' && sent && <Input id="setup-code" label={t('signin.code')} inputMode="numeric" value={f.code} onChange={set('code')} required />}
      </>)}
      {step === 1 && (<>
        <div><h1>{t('setup.pgTitle')}</h1><p className="muted">{t('setup.pgSub')}</p></div>
        <Input id="setup-pg-name" label={t('field.pgName')} value={f.name} onChange={set('name')} required placeholder={t('setup.pgNamePh')} />
        <div className="form-grid">
          <Input id="setup-city" label={t('field.city')} value={f.city} onChange={set('city')} />
          <Input id="setup-upi" label={t('field.upiId')} value={f.upiId} onChange={set('upiId')} placeholder="name@bank" hint={t('setup.upiHint')} />
          <Input id="setup-address" full label={t('field.address')} value={f.address} onChange={set('address')} />
        </div>
      </>)}
      {step === 2 && (<>
        <div><h1>{t('setup.roomsTitle')}</h1><p className="muted">{t('setup.roomsSub')}</p></div>
        <div className="form-grid">
          <Input id="setup-floors" label={t('field.floors')} type="number" min="1" max="30" value={f.floors} onChange={set('floors')} required />
          <Input id="setup-rooms-per-floor" label={t('field.roomsPerFloor')} type="number" min="1" max="40" value={f.roomsPerFloor} onChange={set('roomsPerFloor')} required />
          <Input id="setup-beds" label={t('field.bedsPerRoom')} type="number" min="1" max="12" value={f.beds} onChange={set('beds')} required />
          <Input id="setup-rent" label={t('field.rentPerBed')} type="number" min="0" value={f.rent} onChange={set('rent')} required />
          <Input id="setup-due-day" label={t('field.dueDay')} type="number" min="1" max="28" value={f.dueDay} onChange={set('dueDay')} hint={t('setup.dueHint')} />
          <Select id="setup-electricity" label={t('field.electricity')} value={f.electricityMode} onChange={set('electricityMode')} options={['meter', 'flat', 'none'].map((v) => ({ value: v, label: t(`val.elec.${v}`) }))} />
        </div>
        <p className="hint">{t('setup.roomsSummary', { rooms: (Number(f.floors) || 0) * (Number(f.roomsPerFloor) || 0), beds: (Number(f.floors) || 0) * (Number(f.roomsPerFloor) || 0) * (Number(f.beds) || 0) })}</p>
      </>)}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy} data-testid="setup-next">{step === 2 ? t('setup.finish') : step === 0 && where === 'server' && !sent ? t('signin.sendCode') : t('common.continue')}</button>
    </form>
  );
}

/** Handed from the wizard to the owner console, which creates the rooms once the PG is open. */
export const sessionStash = { rooms: null, recovery: null };

export default function Welcome() {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const [view, setView] = useState('start');
  let pane;
  if (view === 'setup') pane = <SetupWizard onBack={() => setView('start')} />;
  else if (app.session && !app.current) pane = <MembershipChooser />;
  else if (view === 'signin') pane = <SignIn onBack={() => setView('start')} />;
  else pane = (
    <div className="welcome-box">
      <div><h1>{t('welcome.title')}</h1><p className="muted">{t('welcome.lead')}</p></div>
      <div className="stack sm">
        <button className="choice" onClick={() => setView('setup')} data-testid="start-setup"><Building2 /><span><b>{t('welcome.setup')}</b><br /><span className="small muted">{t('welcome.setupSub')}</span></span></button>
        <button className="choice" onClick={() => setView('signin')} data-testid="start-signin"><LogIn /><span><b>{t('welcome.signin')}</b><br /><span className="small muted">{t('welcome.signinSub')}</span></span></button>
        <button className="choice" onClick={() => ui.run(() => app.localLoadSample({ ownerName: t('sample.ownerName'), ownerPhone: '9000000000' }))} data-testid="start-sample"><FlaskConical /><span><b>{t('welcome.sample')}</b><br /><span className="small muted">{t('welcome.sampleSub')}</span></span></button>
      </div>
      {app.localProperties.filter((p) => !p.sample).length > 0 && (
        <p className="small muted">{t('welcome.onDevice', { names: app.localProperties.filter((p) => !p.sample).map((p) => p.name).join(', ') })}</p>
      )}
      {!app.persistent && <p className="small" style={{ color: 'var(--warn)' }}>{t('welcome.notPersistent')}</p>}
    </div>
  );
  return (
    <div className="welcome">
      <Art />
      <div className="welcome-pane">
        <div style={{ alignSelf: 'flex-end', marginBottom: 12 }}><LangPicker /></div>
        {pane}
      </div>
    </div>
  );
}
