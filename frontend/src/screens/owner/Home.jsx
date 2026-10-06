import { useMemo } from 'react';
import { ArrowRight, BedDouble, Receipt, UserPlus, CheckCircle2 } from 'lucide-react';
import { occupancy, monthSummary, duesList, monthlyTrend, pendingClaims, openRequests, periodOf, staffAttendanceOn, headcount, addDays, unbilledTenants, activeStaff } from '@basera/domain';
import { useApp } from '../../app/store.jsx';
import { useI18n } from '../../app/i18n.jsx';
import { Link, useRouter } from '../../app/router.jsx';
import { Stat, Money, BarChart, Avatar, Empty } from '../../ui/kit.jsx';

export function activityText(t, formatMoney, a) {
  const d = { ...a.data };
  for (const k of ['amount', 'total', 'refund']) if (typeof d[k] === 'number') d[k] = formatMoney(d[k]);
  const key = `act.${a.type}`;
  const s = t(key, d);
  return s === key ? a.type : s;
}

function GetStarted({ state }) {
  const { t } = useI18n();
  const steps = [
    { done: state.rooms.length > 0, label: t('start.rooms'), to: '/rooms' },
    { done: state.tenants.length > 0, label: t('start.residents'), to: '/residents' },
    { done: state.invoices.length > 0, label: t('start.bills'), to: '/billing' },
    { done: Boolean(state.property.upiId), label: t('start.upi'), to: '/settings' },
    { done: state.staff.length > 0, label: t('start.staff'), to: '/staff' }
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <div className="card">
      <div className="card-head"><h2>{t('start.title')}</h2><span className="small muted">{steps.filter((s) => s.done).length}/{steps.length}</span></div>
      <div className="list" style={{ margin: '0 -16px -16px' }}>{steps.map((s) => (
        <Link key={s.to} to={s.to} className="item"><CheckCircle2 size={18} color={s.done ? 'var(--good)' : 'var(--line-strong)'} /><span className="grow" style={s.done ? { color: 'var(--ink-3)', textDecoration: 'line-through' } : null}>{s.label}</span>{!s.done && <ArrowRight size={16} />}</Link>))}</div>
    </div>
  );
}

export default function Home() {
  const { state, today, role } = useApp();
  const { t, formatMoney, formatPeriod, formatRelative, formatDate } = useI18n();
  const { navigate } = useRouter();
  const period = periodOf(today);
  const v = useMemo(() => ({
    occ: occupancy(state), month: monthSummary(state, period, today), dues: duesList(state, today), trend: monthlyTrend(state, today, 6),
    claims: pendingClaims(state), requests: openRequests(state), attendance: staffAttendanceOn(state, today), unbilled: unbilledTenants(state, period),
    dinner: headcount(state, today, 'dinner'), tomorrow: headcount(state, addDays(today, 1), 'breakfast')
  }), [state, period, today]);
  const fresh = state.rooms.length === 0 && state.tenants.length === 0;
  return (
    <div className="stack lg">
      <div className="page-head"><div><p className="eyebrow">{formatDate(today, 'weekday')}</p><h1>{state.property.name}</h1></div>
        <div className="row wrap"><button className="btn" onClick={() => navigate('/residents/new')}><UserPlus />{t('res.add')}</button><button className="btn primary" onClick={() => navigate('/billing')}><Receipt />{t('nav.billing')}</button></div></div>
      {role === 'owner' && <GetStarted state={state} />}
      {fresh ? <div className="card"><Empty icon={BedDouble} title={t('home.emptyTitle')} body={t('home.emptyBody')} action={<button className="btn primary" onClick={() => navigate('/rooms')}>{t('rooms.add')}</button>} /></div> : (<>
        <div className="grid c4">
          <Stat label={t('home.collected', { month: formatPeriod(period, true) })} value={formatMoney(v.month.collected)} sub={t('home.ofBilled', { billed: formatMoney(v.month.billed), pct: v.month.collectionRate })} />
          <Stat label={t('home.outstanding')} value={formatMoney(v.dues.reduce((s, r) => s + r.outstanding, 0))} tone={v.dues.length ? 'bad' : 'good'} sub={t('home.owing', { n: v.dues.length })} />
          <Stat label={t('home.occupancy')} value={`${v.occ.occupied}/${v.occ.beds}`} sub={t('home.vacant', { n: v.occ.vacant, notice: v.occ.onNotice })} />
          <Stat label={t('home.expenses', { month: formatPeriod(period, true) })} value={formatMoney(v.month.expenses)} sub={t('home.net', { net: formatMoney(v.month.net) })} />
        </div>
        {(v.claims.length > 0 || v.unbilled.length > 0 || v.requests.length > 0) && (
          <div className="card flush"><div className="list">
            {v.claims.length > 0 && <Link className="item" to="/billing" data-testid="home-claims"><span className="pill warn">{v.claims.length}</span><span className="grow">{t('home.claimsWaiting')}</span><ArrowRight size={16} /></Link>}
            {v.unbilled.length > 0 && <Link className="item" to="/billing"><span className="pill info">{v.unbilled.length}</span><span className="grow">{t('home.unbilled', { month: formatPeriod(period) })}</span><ArrowRight size={16} /></Link>}
            {v.requests.length > 0 && <Link className="item" to="/requests"><span className="pill">{v.requests.length}</span><span className="grow">{t('home.openRequests')}</span><ArrowRight size={16} /></Link>}
          </div></div>)}
        <div className="grid split">
          <div className="card"><div className="card-head"><h2>{t('home.trend')}</h2></div>
            <BarChart format={formatMoney} data={v.trend.map((m) => ({ label: formatPeriod(m.period, true), ...m }))} series={[{ key: 'billed', label: t('rep.billed'), color: 'var(--line-strong)' }, { key: 'collected', label: t('rep.collected'), color: 'var(--accent)' }, { key: 'expenses', label: t('rep.expenses'), color: 'var(--warn)' }]} /></div>
          <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('home.today')}</h2></div>
            <div className="list">
              <div><span className="grow">{t('home.dinnerTonight')}</span><b className="num">{v.dinner.eating}</b></div>
              <div><span className="grow">{t('home.breakfastTomorrow')}</span><b className="num">{v.tomorrow.eating}</b></div>
              <div><span className="grow">{t('home.staffIn')}</span><b className="num">{v.attendance.filter((a) => a.record?.inAt).length}/{activeStaff(state).length}</b></div>
            </div></div>
        </div>
        <div className="grid c2">
          <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('home.duesTitle')}</h2><Link to="/billing" className="small">{t('common.viewAll')}</Link></div>
            {v.dues.length === 0 ? <Empty title={t('home.noDues')} /> : <div className="list">{v.dues.slice(0, 6).map((r) => (
              <Link key={r.tenant.id} className="item" to={`/residents/${r.tenant.id}`}><Avatar name={r.tenant.name} /><span className="grow"><b className="truncate">{r.tenant.name}</b><br /><span className="small muted">{r.room ? t('room.short', { number: r.room.number }) : ''}{r.daysLate > 0 ? ` · ${t('home.daysLate', { n: r.daysLate })}` : ''}</span></span><Money value={r.outstanding} /></Link>))}</div>}</div>
          <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('home.activity')}</h2></div>
            {state.activity.length === 0 ? <Empty title={t('home.noActivity')} /> : <div className="list">{state.activity.slice(0, 7).map((a) => (
              <div key={a.id}><span className="grow small">{activityText(t, formatMoney, a)}</span><span className="small faint nowrap">{formatRelative(a.at)}</span></div>))}</div>}</div>
        </div>
      </>)}
    </div>
  );
}
