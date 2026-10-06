// What residents and staff see when they sign in to the same app.
import { useMemo, useState } from 'react';
import { Copy, Plus, Wrench, Megaphone, LogIn, LogOut, Check, IndianRupee } from 'lucide-react';
import { tenantOverview, activeNotices, menuFor, addDays, MEALS, tasksFor, attendanceSummary, periodOf, headcount, invoiceBalance, weekdayKey } from '@basera/domain';
import { useApp } from '../app/store.jsx';
import { useI18n } from '../app/i18n.jsx';
import { useUi, Modal, Input, Empty, Money, StatePill, Stat, Seg, copyText, useForm } from '../ui/kit.jsx';
import { InvoiceModal, ReceiptModal, RequestCard, RequestForm, NoticeCard, MenuWeek, DocumentsPanel, roleName } from './shared.jsx';

function PayModal({ amount, invoice, onClose }) {
  const app = useApp();
  const { t, formatMoney } = useI18n();
  const ui = useUi();
  const p = app.state.property;
  const [f, set] = useForm({ amount, reference: '' });
  const link = p.upiId ? `upi://pay?pa=${encodeURIComponent(p.upiId)}&pn=${encodeURIComponent(p.name)}&am=${Number(f.amount) || 0}&cu=INR&tn=${encodeURIComponent(`Rent ${app.state.me.name}`)}` : '';
  const claim = async () => { if (await ui.run(() => app.dispatch({ type: 'payment.claim', payload: { amount: Number(f.amount), mode: 'upi', reference: f.reference, invoiceId: invoice?.id } }), t('toast.claimSent'))) onClose(); };
  return (
    <Modal title={t('pay.payNow')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={claim} disabled={!Number(f.amount)} data-testid="claim-submit">{t('pay.iHavePaid')}</button></>}>
      <div className="stack">
        <Input id="claim-amount" label={t('field.amount')} type="number" min="1" value={f.amount} onChange={set('amount')} />
        {p.upiId ? (<div className="card stack sm" style={{ background: 'var(--sunken)' }}><span className="eyebrow">{t('pay.step1')}</span>
          <div className="row between wrap"><b className="num" style={{ userSelect: 'all' }}>{p.upiId}</b><button className="btn sm" onClick={async () => ui.toast((await copyText(p.upiId)) ? t('toast.copied') : p.upiId)}><Copy />{t('common.copy')}</button></div>
          <a className="btn primary" href={link}><IndianRupee />{t('pay.openUpi', { amount: formatMoney(f.amount) })}</a><span className="hint">{t('pay.upiHint')}</span></div>)
          : <p className="small muted">{t('pay.noUpi', { name: p.ownerName, phone: p.ownerPhone })}</p>}
        <div className="stack sm"><span className="eyebrow">{t('pay.step2')}</span><Input id="claim-ref" label={t('field.reference')} value={f.reference} onChange={set('reference')} hint={t('pay.claimHint')} /></div>
      </div></Modal>
  );
}

export function TenantPortal() {
  const app = useApp();
  const { state, today } = app;
  const { t, tv, formatMoney, formatDate, formatPeriod } = useI18n();
  const ui = useUi();
  const [tab, setTab] = useState('home');
  const [modal, setModal] = useState(null);
  const o = useMemo(() => tenantOverview(state, state.me.id, today), [state, today]);
  const notices = activeNotices(state, today, 'tenants');
  const tomorrow = addDays(today, 1);
  const cutoff = state.property.rules.skipCutoffHour;
  const canSkipTomorrow = new Date().getHours() < cutoff;
  const skipped = (date, meal) => state.mealSkips.some((s) => s.date === date && s.meal === meal);
  const toggleSkip = (date, meal) => ui.run(() => app.dispatch({ type: 'meal.skip', payload: { date, meal, skip: !skipped(date, meal) } }));
  const pending = o.ledger.pending[0];
  const notice = async () => { const leaveOn = addDays(today, state.property.rules.noticeDays); if (await ui.confirm({ title: t('res.noticeTitle'), body: t('me.noticeBody', { date: formatDate(leaveOn), days: state.property.rules.noticeDays }), action: t('res.giveNotice') })) ui.run(() => app.dispatch({ type: 'tenant.giveNotice', payload: { tenantId: o.tenant.id, leaveOn } }), t('toast.saved')); };
  const menuToday = menuFor(state, today);
  return (
    <div className="stack lg">
      <div className="page-head"><div><p className="eyebrow">{state.property.name}{o.room ? ` · ${t('room.short', { number: o.room.number })}-${o.tenant.bed}` : ''}</p><h1>{t('me.hello', { name: o.tenant.name.split(' ')[0] })}</h1></div></div>
      <Seg value={tab} onChange={setTab} options={[{ value: 'home', label: t('me.tabHome') }, { value: 'bills', label: t('res.bills') }, { value: 'help', label: t('nav.requests'), count: state.requests.filter((r) => r.status === 'resolved').length }, { value: 'food', label: t('menu.title') }, { value: 'me', label: t('me.tabMe') }]} />
      {tab === 'home' && (<>
        <div className="card stack" data-testid="tenant-due">
          <span className="eyebrow">{o.ledger.net > 0 ? t('me.youOwe') : t('me.allPaid')}</span>
          <div className="row between wrap"><span className="num" style={{ fontSize: '2.2rem', fontWeight: 600, letterSpacing: '-.04em', color: o.ledger.overdue > 0 ? 'var(--bad)' : undefined }}>{formatMoney(o.ledger.net)}</span>
            {o.ledger.net > 0 && !pending && <button className="btn primary" onClick={() => setModal({ pay: true })} data-testid="tenant-pay">{t('pay.payNow')}</button>}</div>
          {o.nextDue && <p className="small muted">{o.ledger.overdue > 0 ? t('me.overdueSince', { date: formatDate(o.nextDue.dueOn) }) : t('me.dueBy', { date: formatDate(o.nextDue.dueOn) })}</p>}
          {o.ledger.credit > 0 && <p className="small muted">{t('res.advance', { amount: formatMoney(o.ledger.credit) })}</p>}
          {pending && <div className="banner">{t('me.claimWaiting', { amount: formatMoney(pending.amount), name: state.property.ownerName })}</div>}
        </div>
        <div className="grid c2">
          <div className="card stack"><div className="card-head"><h2>{t('me.todayMenu')}</h2><span className="small faint">{t(`weekday.${weekdayKey(today)}`)}</span></div>
            <dl className="kv">{MEALS.map((m) => (<span key={m} style={{ display: 'contents' }}><dt>{t(`val.meal.${m}`)}</dt><dd className="small">{menuToday[m] || '—'}</dd></span>))}</dl>
            {state.property.rules.mealsIncluded && (<div className="stack sm"><span className="label">{t('me.skipTomorrow')}</span><div className="row wrap">{MEALS.map((m) => (<button key={m} className={`btn sm ${skipped(tomorrow, m) ? 'danger' : ''}`} disabled={!canSkipTomorrow} onClick={() => toggleSkip(tomorrow, m)} data-testid={`skip-${m}`}>{skipped(tomorrow, m) ? `✕ ${t(`val.meal.${m}`)}` : t(`val.meal.${m}`)}</button>))}</div><span className="hint">{t('me.skipHint', { hour: cutoff })}</span></div>)}</div>
          <div className="stack">{notices.length === 0 ? <div className="card"><Empty icon={Megaphone} title={t('me.noNotices')} /></div> : notices.slice(0, 3).map((n) => (<NoticeCard key={n.id} notice={n} />))}</div>
        </div></>)}
      {tab === 'bills' && (<div className="grid c2">
        <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('res.bills')}</h2></div>{o.ledger.invoices.length === 0 ? <Empty title={t('res.noBills')} /> : <div className="list">{[...o.ledger.invoices].reverse().map((inv) => (
          <button className="item" key={inv.id} onClick={() => setModal({ invoice: inv.id })}><span className="grow"><b>{formatPeriod(inv.period)}</b><br /><span className="small muted">{t('bill.dueShort', { date: formatDate(inv.dueOn, 'day') })}</span></span><span className="right"><Money value={inv.total} /><br /><StatePill value={inv.state} /></span></button>))}</div>}</div>
        <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('res.payments')}</h2></div>{o.ledger.payments.length === 0 ? <Empty title={t('res.noPayments')} /> : <div className="list">{o.ledger.payments.map((p) => (
          <button className="item" key={p.id} onClick={() => p.status === 'confirmed' && setModal({ receipt: p.id })}><span className="grow"><b>{formatDate(p.date)}</b><br /><span className="small muted">{tv('val.mode', p.mode)} · {tv('val.kind', p.kind)}</span></span><span className="right"><Money value={p.amount} /><br /><StatePill value={p.status} /></span></button>))}</div>}</div></div>)}
      {tab === 'help' && (<><div><button className="btn primary" onClick={() => setModal({ request: true })} data-testid="tenant-request"><Plus />{t('req.new')}</button></div>
        {state.requests.length === 0 ? <div className="card"><Empty icon={Wrench} title={t('me.noRequests')} body={t('me.noRequestsBody')} /></div> : <div className="grid c2">{[...state.requests].reverse().map((r) => (<RequestCard key={r.id} request={r} />))}</div>}</>)}
      {tab === 'food' && <MenuWeek />}
      {tab === 'me' && (<div className="grid c2">
        <div className="card stack"><h2>{t('me.stay')}</h2><dl className="kv"><dt>{t('field.monthlyRent')}</dt><dd><Money value={o.tenant.rent} /></dd><dt>{t('settle.depositHeld')}</dt><dd><Money value={o.ledger.depositHeld} /></dd><dt>{t('field.joinedOn')}</dt><dd>{formatDate(o.tenant.joinedOn)}</dd>
          {o.roommates.length > 0 && (<><dt>{t('me.roommates')}</dt><dd>{o.roommates.map((r) => r.name).join(', ')}</dd></>)}<dt>{t('me.owner')}</dt><dd>{state.property.ownerName} · <span className="num">{state.property.ownerPhone}</span></dd></dl>
          {o.tenant.status === 'notice' ? <div className="banner info">{t('res.onNotice', { date: formatDate(o.tenant.leaveOn) })}<button className="btn sm" onClick={() => ui.run(() => app.dispatch({ type: 'tenant.cancelNotice', payload: { tenantId: o.tenant.id } }), t('toast.saved'))}>{t('res.cancelNotice')}</button></div> : <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={notice}>{t('me.giveNotice')}</button>}</div>
        <div className="card stack"><h2>{t('docs.title')}</h2><p className="small muted">{t('me.docsHint')}</p><DocumentsPanel ownerType="tenant" ownerId={o.tenant.id} /></div></div>)}
      {modal?.pay && <PayModal amount={modal.invoice ? invoiceBalance(modal.invoice) : o.ledger.net} invoice={modal.invoice} onClose={() => setModal(null)} />}
      {modal?.invoice && typeof modal.invoice === 'string' && <InvoiceModal invoiceId={modal.invoice} onClose={() => setModal(null)} onPay={pending ? null : (inv) => setModal({ pay: true, invoice: inv })} />}
      {modal?.receipt && <ReceiptModal paymentId={modal.receipt} onClose={() => setModal(null)} />}
      {modal?.request && <RequestForm onClose={() => setModal(null)} />}
    </div>
  );
}

export function StaffPortal() {
  const app = useApp();
  const { state, today } = app;
  const { t, formatTime, formatPeriod, formatDate } = useI18n();
  const ui = useUi();
  const [tab, setTab] = useState('today');
  const me = state.me;
  const tasks = useMemo(() => tasksFor(state, me, today), [state, me, today]);
  const record = state.attendance.find((a) => a.date === today && a.staffId === me.id);
  const now = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const sum = attendanceSummary(state, me.id, periodOf(today));
  const mine = state.requests.filter((r) => (r.status === 'open' || r.status === 'in_progress') && (!r.assignedTo || r.assignedTo === me.id));
  const notices = activeNotices(state, today, 'staff');
  const kitchen = ['cook', 'manager', 'warden'].includes(me.role);
  const done = tasks.filter((x) => x.log).length;
  return (
    <div className="stack lg">
      <div className="page-head"><div><p className="eyebrow">{state.property.name} · {roleName(t, me)}</p><h1>{t('me.hello', { name: me.name.split(' ')[0] })}</h1></div></div>
      <Seg value={tab} onChange={setTab} options={[{ value: 'today', label: t('staffp.today') }, { value: 'requests', label: t('nav.requests'), count: mine.length }, ...(kitchen ? [{ value: 'food', label: t('menu.title') }] : []), { value: 'me', label: t('me.tabMe') }]} />
      {tab === 'today' && (<>
        <div className="card row between wrap" data-testid="staff-attendance"><div><span className="eyebrow">{formatDate(today, 'weekday')}</span><h2>{record?.inAt ? t('staffp.checkedIn', { time: formatTime(record.inAt) }) : t('staffp.notIn')}</h2>{record?.outAt && <p className="small muted">{t('staffp.checkedOut', { time: formatTime(record.outAt) })}</p>}</div>
          {!record?.inAt ? <button className="btn primary" onClick={() => ui.run(() => app.dispatch({ type: 'attendance.checkIn', payload: { date: today, time: now() } }), t('toast.checkedIn'))} data-testid="check-in"><LogIn />{t('staffp.checkIn')}</button>
            : !record.outAt ? <button className="btn" onClick={() => ui.run(() => app.dispatch({ type: 'attendance.checkOut', payload: { date: today, time: now() } }), t('toast.saved'))}><LogOut />{t('staffp.checkOut')}</button> : <span className="pill good"><Check size={13} />{t('val.present')}</span>}</div>
        <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('tasks.title')}</h2><span className="small muted num">{done}/{tasks.length}</span></div>
          {tasks.length === 0 ? <Empty title={t('staffp.noTasks')} /> : <div>{tasks.map((x) => (<label key={x.id} className={`check-row ${x.log ? 'done' : ''}`}><input type="checkbox" checked={Boolean(x.log)} onChange={(e) => ui.run(() => app.dispatch({ type: 'task.toggle', payload: { taskId: x.id, date: today, done: e.target.checked } }))} /><span className="grow">{x.title}</span>{x.time && <span className="small faint num">{formatTime(x.time)}</span>}</label>))}</div>}</div>
        {kitchen && (<div className="grid c3">{MEALS.map((m) => { const h = headcount(state, today, m); return <Stat key={m} label={t('staffp.plates', { meal: t(`val.meal.${m}`) })} value={h.eating} sub={h.skipped ? t('staffp.skipping', { n: h.skipped }) : menuFor(state, today)[m]} />; })}</div>)}
        {notices.slice(0, 2).map((n) => (<NoticeCard key={n.id} notice={n} />))}</>)}
      {tab === 'requests' && (mine.length === 0 ? <div className="card"><Empty icon={Wrench} title={t('req.emptyLive')} /></div> : <div className="grid c2">{mine.map((r) => (<RequestCard key={r.id} request={r} />))}</div>)}
      {tab === 'food' && <MenuWeek editable />}
      {tab === 'me' && (<div className="grid c2">
        <div className="card stack"><h2>{t('staff.thisMonth')}</h2><div className="grid c3"><Stat label={t('val.present')} value={sum.present} /><Stat label={t('val.absent')} value={sum.absent} /><Stat label={t('val.leave')} value={sum.leave} /></div>
          <h3>{t('staff.slips')}</h3>{state.salaryPayments.length === 0 ? <p className="small muted">{t('staff.noSlips')}</p> : <div className="list">{[...state.salaryPayments].reverse().map((s) => (<div key={s.id} style={{ paddingInline: 0 }}><span className="grow">{formatPeriod(s.period)}<br /><span className="small faint num">{s.number}</span></span><Money value={s.amount} /></div>))}</div>}</div>
        <div className="card stack"><h2>{t('docs.title')}</h2><DocumentsPanel ownerType="staff" ownerId={me.id} /></div></div>)}
    </div>
  );
}
