import { useEffect, useRef, useState } from 'react';
import { LayoutDashboard, BedDouble, Users, Receipt, Wallet, UserCog, Wrench, Megaphone, BarChart3, Settings as Cog, Menu, LogOut, Repeat, EyeOff } from 'lucide-react';
import { pendingClaims, openRequests } from '@basera/domain';
import { useApp } from './app/store.jsx';
import { useI18n } from './app/i18n.jsx';
import { useRouter, matchRoute } from './app/router.jsx';
import { useTheme, resolvedTheme } from './app/theme.jsx';
import { setupNativeShell, onHardwareBack } from './app/native.js';
import { useUi } from './ui/kit.jsx';
import Welcome, { sessionStash } from './screens/Welcome.jsx';
import Home from './screens/owner/Home.jsx';
import Rooms from './screens/owner/Rooms.jsx';
import Residents, { ResidentDetail, ResidentForm } from './screens/owner/Residents.jsx';
import Billing from './screens/owner/Billing.jsx';
import { Expenses, Staff, Requests, Community } from './screens/owner/Operations.jsx';
import { Reports, Settings } from './screens/owner/ReportsSettings.jsx';
import { TenantPortal, StaffPortal } from './screens/Portals.jsx';

const NAV = [
  { to: '/', key: 'home', icon: LayoutDashboard, tab: true }, { to: '/rooms', key: 'rooms', icon: BedDouble, tab: true }, { to: '/residents', key: 'residents', icon: Users, tab: true },
  { to: '/billing', key: 'billing', icon: Receipt, tab: true }, { to: '/expenses', key: 'expenses', icon: Wallet }, { to: '/staff', key: 'staff', icon: UserCog },
  { to: '/requests', key: 'requests', icon: Wrench }, { to: '/community', key: 'community', icon: Megaphone }, { to: '/reports', key: 'reports', icon: BarChart3 }, { to: '/settings', key: 'settings', icon: Cog }
];
const ROUTES = ['/', '/rooms', '/residents', '/residents/new', '/residents/:id/edit', '/residents/:id', '/billing', '/expenses', '/staff', '/requests', '/community', '/reports', '/settings', '*'];

function OwnerScreen() {
  const { path } = useRouter();
  const { state } = useApp();
  const m = matchRoute(path, ROUTES) || { route: '*', params: {} };
  switch (m.route) {
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
  const seeded = useRef(false);

  useEffect(() => { if (app.booted) setupNativeShell(resolvedTheme(theme)); }, [app.booted, theme]);
  useEffect(() => onHardwareBack(() => { if (drawer) { setDrawer(false); return true; } if (canGoBack) { back('/'); return true; } if (path !== '/') { navigate('/', { replace: true }); return true; } return false; }), [drawer, canGoBack, back, path, navigate]);
  // Rooms chosen in the setup wizard are created as soon as the new PG opens.
  useEffect(() => {
    if (!app.current || app.role !== 'owner' || !sessionStash.rooms || seeded.current) return;
    if (app.state && app.state.rooms.length === 0) { seeded.current = true; const payload = sessionStash.rooms; sessionStash.rooms = null; app.dispatch({ type: 'room.addMany', payload }).catch(ui.fail).finally(() => { seeded.current = false; }); } else sessionStash.rooms = null;
  }, [app.current, app.role, app.state, app, ui.fail]);
  useEffect(() => { if (app.mode === 'server' && app.current) app.refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [path]);

  if (!app.booted) return <div className="empty" style={{ height: '100%' }}><Brand /></div>;
  if (!app.session || !app.current || !app.state) return <Welcome />;

  const role = app.role;
  const counts = role === 'owner' ? { billing: pendingClaims(app.state).length, requests: openRequests(app.state).length } : {};
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
        {role === 'owner' && NAV.map((n) => (<button key={n.to} className={`nav-item ${active(n.to) ? 'on' : ''}`} onClick={() => go(n.to)} data-testid={`nav-${n.key}`}><n.icon />{t(`nav.${n.key}`)}{counts[n.key] > 0 && <span className="count">{counts[n.key]}</span>}</button>))}
        <div className="side-foot stack sm">
          <div style={{ padding: '0 10px' }}><b className="truncate" style={{ display: 'block' }}>{who}</b><span className="small muted">{tv('role', role)} · {app.state.property.name}</span><br /><span className="small faint">{app.mode === 'server' ? t('mode.online') : t('mode.device')}</span></div>
          {app.memberships.length > 1 && <button className="nav-item" onClick={leave}><Repeat />{t('shell.switch')}</button>}
          <button className="nav-item" onClick={out} data-testid="sign-out"><LogOut />{t('common.signOut')}</button>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar"><button className="icon-btn" onClick={() => setDrawer(true)} aria-label={t('shell.menu')}><Menu /></button><b className="grow truncate" style={{ fontFamily: 'var(--display)' }}>{app.state.property.name}</b></header>
        <main className="main">
          {app.preview && <div className="banner info" data-testid="preview-banner"><EyeOff size={16} /><span className="grow">{t('shell.previewing', { name: app.preview.name, role: tv('role', app.preview.role) })}</span><button className="btn sm" onClick={app.stopPreview}>{t('shell.stopPreview')}</button></div>}
          {app.state.sample && role === 'owner' && <div className="banner"><span className="grow">{t('sample.banner')}</span><button className="btn sm" onClick={out}>{t('sample.exit')}</button></div>}
          {role === 'owner' ? <OwnerScreen /> : role === 'tenant' ? <TenantPortal /> : <StaffPortal />}
        </main>
      </div>
      {role === 'owner' && (<nav className="tabbar">{NAV.filter((n) => n.tab).map((n) => (<button key={n.to} className={`tab ${active(n.to) ? 'on' : ''}`} onClick={() => go(n.to)}><n.icon /><span>{t(`nav.${n.key}`)}</span>{counts[n.key] > 0 && <span className="count">{counts[n.key]}</span>}</button>))}
        <button className="tab" onClick={() => setDrawer(true)}><Menu /><span>{t('shell.more')}</span></button></nav>)}
    </div>
  );
}
