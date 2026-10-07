import { useEffect, useRef, useState } from 'react';
import { LayoutDashboard, BedDouble, Users, Receipt, Wallet, UserCog, Wrench, Megaphone, BarChart3, Settings as Cog, Menu, LogOut, Repeat, EyeOff, ListChecks } from 'lucide-react';
import { pendingClaims, openRequests } from '@basera/domain';
import { useApp } from './app/store.jsx';
import { useI18n } from './app/i18n.jsx';
import { useRouter, matchRoute } from './app/router.jsx';
import { useTheme, resolvedTheme } from './app/theme.jsx';
import { setupNativeShell, onHardwareBack } from './app/native.js';
import { useUi } from './ui/kit.jsx';
import Welcome, { sessionStash, RecoveryCard } from './screens/Welcome.jsx';
import Home from './screens/owner/Home.jsx';
import Rooms from './screens/owner/Rooms.jsx';
import Residents, { ResidentDetail, ResidentForm } from './screens/owner/Residents.jsx';
import Billing from './screens/owner/Billing.jsx';
import { Expenses, Staff, Requests, Community } from './screens/owner/Operations.jsx';
import { Reports, Settings } from './screens/owner/ReportsSettings.jsx';
import { TenantPortal, StaffPortal } from './screens/Portals.jsx';

const NAV = [
  // `need` is a command the person must be allowed to issue to see the screen (owner, or staff given access).
  { to: '/', key: 'home', icon: LayoutDashboard, tab: true }, { to: '/mywork', key: 'mywork', icon: ListChecks, staffOnly: true, tab: true },
  { to: '/rooms', key: 'rooms', icon: BedDouble, tab: true, need: 'room.add' }, { to: '/residents', key: 'residents', icon: Users, tab: true, need: 'tenant.add' },
  { to: '/billing', key: 'billing', icon: Receipt, tab: true, need: 'payment.record' }, { to: '/expenses', key: 'expenses', icon: Wallet, need: 'expense.add' }, { to: '/staff', key: 'staff', icon: UserCog, need: 'staff.add' },
  { to: '/requests', key: 'requests', icon: Wrench, need: 'tenant.add' }, { to: '/community', key: 'community', icon: Megaphone, need: 'notice.post' }, { to: '/reports', key: 'reports', icon: BarChart3, need: 'property.update' }, { to: '/settings', key: 'settings', icon: Cog, need: 'property.update' }
];
const allowedNav = (app) => NAV.filter((n) => (n.staffOnly ? app.role === 'staff' : !n.need || app.can(n.need)));
const ROUTES = ['/', '/mywork', '/rooms', '/residents', '/residents/new', '/residents/:id/edit', '/residents/:id', '/billing', '/expenses', '/staff', '/requests', '/community', '/reports', '/settings', '*'];

function OwnerScreen() {
  const { path } = useRouter();
  const app = useApp();
  const { state } = app;
  let m = matchRoute(path, ROUTES) || { route: '*', params: {} };
  const entry = NAV.find((n) => n.to !== '/' && m.route.startsWith(n.to));
  if (entry && !allowedNav(app).includes(entry)) m = { route: '*', params: {} };
  switch (m.route) {
    case '/mywork': return <StaffPortal />;
    case '/rooms': return <Rooms />;
    case '/residents': return <Residents />;
    case '/residents/new': return <ResidentForm key="new" />;
    case '/residents/:id/edit': return <ResidentForm key={m.params.id} tenant={state.tenants.find((x) => x.id === m.params.id)} />;
    case '/residents/:id': return <ResidentDetail key={m.params.id} id={m.params.id} />;
    case '/billing': return <Billing />;
    case '/expenses': return <Expenses />;
    case '/staff': return <Staff />;
    case '/requests': return <Requests />;
    case '/community': return <Community />;
    case '/reports': return <Reports />;
    case '/settings': return <Settings />;
    default: return <Home />;
  }
}

function Brand() { return <div className="brand"><span className="brand-mark"><i /><i /><i /><i /></span>Basera</div>; }

export default function App() {
  const app = useApp();
  const { t, tv } = useI18n();
  const { path, navigate, back, canGoBack } = useRouter();
  const { theme } = useTheme();
  const ui = useUi();
  const [drawer, setDrawer] = useState(false);
  const [recovery, setRecovery] = useState(null);
  useEffect(() => { if (sessionStash.recovery) { setRecovery(sessionStash.recovery); sessionStash.recovery = null; } }, [app.current]);
  const seeded = useRef(false);

  useEffect(() => { if (app.booted) setupNativeShell(resolvedTheme(theme)); }, [app.booted, theme]);
  useEffect(() => onHardwareBack(() => { if (drawer) { setDrawer(false); return true; } if (canGoBack) { back('/'); return true; } if (path !== '/') { navigate('/', { replace: true }); return true; } return false; }), [drawer, canGoBack, back, path, navigate]);
  // Rooms chosen in the setup wizard are created as soon as the new PG opens.
  useEffect(() => {
    if (!app.current || app.role !== 'owner' || app.preview || !sessionStash.rooms || seeded.current) return;
    if (app.state && app.state.rooms.length === 0) { seeded.current = true; const payload = sessionStash.rooms; sessionStash.rooms = null; app.dispatch({ type: 'room.addMany', payload }).catch(ui.fail).finally(() => { seeded.current = false; }); } else sessionStash.rooms = null;
  }, [app.current, app.role, app.state, app, ui.fail]);
  useEffect(() => { if (app.mode === 'server' && app.current) app.refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [path]);

  if (!app.booted) return <div className="empty" style={{ height: '100%' }}><Brand /></div>;
  if (!app.session || !app.current || !app.state) return <Welcome />;
  if (recovery) return <div className="welcome"><div className="welcome-pane" style={{ gridColumn: '1 / -1' }}><RecoveryCard code={recovery} onDone={() => setRecovery(null)} /></div></div>;

  const role = app.role;
  const nav = allowedNav(app);
  const counts = app.manages ? { billing: pendingClaims(app.state).length, requests: openRequests(app.state).length } : {};
  const active = (to) => (to === '/' ? path === '/' : path.startsWith(to));
  const go = (to) => { setDrawer(false); navigate(to); };
  const leave = () => { setDrawer(false); navigate('/', { replace: true }); app.closeProperty(); };
  const out = () => { setDrawer(false); navigate('/', { replace: true }); app.signOut(); };
  const who = app.preview ? app.preview.name : app.session.user.name || app.current.name;

  return (
    <div className="shell">
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <aside className={`side ${drawer ? 'open' : ''}`}>
        <Brand />
        {app.manages && nav.map((n) => (<button key={n.to} className={`nav-item ${active(n.to) ? 'on' : ''}`} onClick={() => go(n.to)} data-testid={`nav-${n.key}`}><n.icon />{t(`nav.${n.key}`)}{counts[n.key] > 0 && <span className="count">{counts[n.key]}</span>}</button>))}
        <div className="side-foot stack sm">
          <div style={{ padding: '0 10px' }}><b className="truncate" style={{ display: 'block' }}>{who}</b><span className="small muted">{role === 'staff' && app.access !== 'basic' ? t(`access.${app.access}`) : tv('role', role)} · {app.state.property.name}</span><br /><span className="small faint">{app.mode === 'server' ? t('mode.online') : t('mode.device')}</span></div>
          {(app.memberships.length > 1 || app.current.role === 'owner') && <button className="nav-item" onClick={leave} data-testid="switch-pg"><Repeat />{t('shell.switch')}</button>}
          <button className="nav-item" onClick={out} data-testid="sign-out"><LogOut />{t('common.signOut')}</button>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar"><button className="icon-btn" onClick={() => setDrawer(true)} aria-label={t('shell.menu')}><Menu /></button><b className="grow truncate" style={{ fontFamily: 'var(--display)' }}>{app.state.property.name}</b></header>
        <main className="main">
          {app.preview && <div className="banner info" data-testid="preview-banner"><EyeOff size={16} /><span className="grow">{t('shell.previewing', { name: app.preview.name, role: tv('role', app.preview.role) })}</span><button className="btn sm" onClick={app.stopPreview}>{t('shell.stopPreview')}</button></div>}
          {app.state.sample && role === 'owner' && <div className="banner"><span className="grow">{t('sample.banner')}</span><button className="btn sm" onClick={out}>{t('sample.exit')}</button></div>}
          {app.manages ? <OwnerScreen /> : role === 'tenant' ? <TenantPortal /> : <StaffPortal />}
        </main>
      </div>
      {app.manages && (<nav className="tabbar">{nav.filter((n) => n.tab).slice(0, 4).map((n) => (<button key={n.to} className={`tab ${active(n.to) ? 'on' : ''}`} onClick={() => go(n.to)}><n.icon /><span>{t(`nav.${n.key}`)}</span>{counts[n.key] > 0 && <span className="count">{counts[n.key]}</span>}</button>))}
        <button className="tab" onClick={() => setDrawer(true)}><Menu /><span>{t('shell.more')}</span></button></nav>)}
    </div>
  );
}
