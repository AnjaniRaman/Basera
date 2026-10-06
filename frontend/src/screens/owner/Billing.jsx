import { useMemo, useState } from 'react';
import { Zap, Check, X, ChevronLeft, ChevronRight, Receipt, Plus } from 'lucide-react';
import { invoicesForPeriod, monthSummary, draftInvoices, pendingClaims, periodOf, shiftPeriod, occupantsIn, lateFeeFor, meterReadingFor } from '@basera/domain';
import { useApp } from '../../app/store.jsx';
import { useI18n } from '../../app/i18n.jsx';
import { useUi, Seg, Empty, Money, StatePill, Stat, Avatar } from '../../ui/kit.jsx';
import { InvoiceModal, ReceiptModal, PaymentModal } from '../shared.jsx';

function Claims({ onReceipt }) {
  const app = useApp();
  const { t, tv, formatRelative } = useI18n();
  const ui = useUi();
  const claims = pendingClaims(app.state);
  if (!claims.length) return null;
  return (
    <div className="card flush" data-testid="claims">
      <div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('claims.title')}</h2><span className="pill warn">{claims.length}</span></div>
      <p className="small muted" style={{ padding: '0 16px 8px' }}>{t('claims.sub')}</p>
      <div className="list">{claims.map((p) => { const tenant = app.state.tenants.find((x) => x.id === p.tenantId); return (
        <div key={p.id} style={{ flexWrap: 'wrap' }}><Avatar name={tenant?.name} /><span className="grow"><b>{tenant?.name}</b> <Money value={p.amount} /><br /><span className="small muted">{tv('val.mode', p.mode)}{p.reference ? ` · ${t('field.reference')} ` : ''}<span className="num">{p.reference}</span> · {formatRelative(p.createdAt)}</span></span>
          <span className="row"><button className="btn sm" onClick={async () => { if (await ui.confirm({ title: t('claims.rejectTitle'), body: t('claims.rejectBody', { name: tenant?.name }), danger: true, action: t('claims.reject') })) ui.run(() => app.dispatch({ type: 'payment.reject', payload: { paymentId: p.id } }), t('toast.saved')); }}><X />{t('claims.reject')}</button>
            <button className="btn sm primary" data-testid="claim-confirm" onClick={async () => { if (await ui.run(() => app.dispatch({ type: 'payment.confirm', payload: { paymentId: p.id } }), t('toast.paymentRecorded'))) onReceipt(p.id); }}><Check />{t('claims.confirm')}</button></span></div>); })}</div>
    </div>
  );
}

function Meters({ period }) {
  const app = useApp();
  const { state } = app;
  const { t, formatMoney } = useI18n();
  const ui = useUi();
  const rate = state.property.rules.electricityRate;
  const [draft, setDraft] = useState({});
  const rooms = [...state.rooms].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  if (state.property.rules.electricityMode !== 'meter') return <div className="card"><Empty icon={Zap} title={t('meter.offTitle')} body={t('meter.offBody')} /></div>;
  const save = (room) => { const d = draft[room.id]; ui.run(async () => { await app.dispatch({ type: 'meter.record', payload: { roomId: room.id, period, previous: Number(d.previous), current: Number(d.current) } }); setDraft((s) => ({ ...s, [room.id]: undefined })); }, t('toast.saved')); };
  return (
    <div className="card flush"><p className="small muted" style={{ padding: '14px 16px 0' }}>{t('meter.sub', { rate: formatMoney(rate) })}</p>
      <div className="table-wrap"><table><thead><tr><th>{t('field.room')}</th><th className="r">{t('meter.previous')}</th><th className="r">{t('meter.current')}</th><th className="r">{t('meter.units')}</th><th className="r">{t('field.amount')}</th><th /></tr></thead>
        <tbody>{rooms.map((room) => {
          const reading = meterReadingFor(state, room.id, period); const last = meterReadingFor(state, room.id, shiftPeriod(period, -1));
          const d = draft[room.id] || { previous: reading?.previous ?? last?.current ?? '', current: reading?.current ?? '' };
          const units = d.current !== '' && d.previous !== '' ? Number(d.current) - Number(d.previous) : null; const n = occupantsIn(state, room.id, period).length;
          const change = (k) => (e) => setDraft((s) => ({ ...s, [room.id]: { ...d, [k]: e.target.value } }));
          return (<tr key={room.id}><td><b className="num">{room.number}</b><br /><span className="small faint">{t('meter.sharedBy', { n })}</span></td>
            <td className="r"><input id={`mp-${room.id}`} className="input num" style={{ width: 96, textAlign: 'right' }} type="number" value={d.previous} onChange={change('previous')} aria-label={t('meter.previous')} /></td>
            <td className="r"><input id={`mc-${room.id}`} className="input num" style={{ width: 96, textAlign: 'right' }} type="number" value={d.current} onChange={change('current')} aria-label={t('meter.current')} /></td>
            <td className="r num">{units !== null && units >= 0 ? units : '—'}</td><td className="r num">{units !== null && units >= 0 ? formatMoney(units * rate) : '—'}</td>
            <td className="r">{draft[room.id] ? <button className="btn sm primary" disabled={units === null || units < 0} onClick={() => save(room)}>{t('common.save')}</button> : reading ? <span className="pill good"><Check size={12} /></span> : null}</td></tr>); })}</tbody></table></div>
    </div>
  );
}

export default function Billing() {
  const app = useApp();
  const { state, today } = app;
  const { t, formatPeriod, formatMoney, formatDate } = useI18n();
  const ui = useUi();
  const [period, setPeriod] = useState(periodOf(today));
  const [tab, setTab] = useState('bills');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const v = useMemo(() => ({ invoices: invoicesForPeriod(state, period, today), summary: monthSummary(state, period, today), drafts: draftInvoices(state, period, new Date().toISOString()),
    lateable: state.invoices.filter((i) => i.period === period && lateFeeFor(i, state.property.rules, today) > 0) }), [state, period, today]);
  const live = v.invoices.filter((i) => i.status !== 'void');
  const shown = live.filter((i) => filter === 'all' || (filter === 'unpaid' ? i.balance > 0 : i.balance <= 0));
  const generate = async () => {
    const total = v.drafts.reduce((s, d) => s + d.total, 0);
    if (!(await ui.confirm({ title: t('bill.generateTitle', { month: formatPeriod(period) }), body: t('bill.generateBody', { n: v.drafts.length, total: formatMoney(total) }), action: t('bill.generate') }))) return;
    const res = await ui.run(() => app.dispatch({ type: 'billing.generate', payload: { period } }));
    if (res) ui.toast(t('bill.generated', { n: res.count }));
  };
  const lateFees = async () => { if (await ui.confirm({ title: t('bill.lateTitle'), body: t('bill.lateBody', { n: v.lateable.length }), action: t('bill.lateApply') })) ui.run(() => app.dispatch({ type: 'billing.applyLateFees', payload: { period } }), t('toast.saved')); };
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>{t('nav.billing')}</h1>
        <div className="row" style={{ marginTop: 6 }}><button className="icon-btn" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label={t('common.previous')}><ChevronLeft /></button><b style={{ minWidth: 130, textAlign: 'center' }} data-testid="billing-period">{formatPeriod(period)}</b><button className="icon-btn" onClick={() => setPeriod(shiftPeriod(period, 1))} disabled={period >= shiftPeriod(periodOf(today), 1)} aria-label={t('common.next')}><ChevronRight /></button></div></div>
        <div className="row wrap"><button className="btn" onClick={() => setModal({ pay: true })}><Plus />{t('pay.record')}</button>
          {v.drafts.length > 0 && <button className="btn primary" onClick={generate} data-testid="generate-bills"><Receipt />{t('bill.generateN', { n: v.drafts.length })}</button>}</div></div>
      <Claims onReceipt={(id) => setModal({ receipt: id })} />
      <div className="grid c4">
        <Stat label={t('rep.billed')} value={formatMoney(v.summary.billed)} sub={t('bill.count', { n: v.summary.invoiceCount })} />
        <Stat label={t('bill.paid')} value={formatMoney(v.summary.paidAgainstPeriod)} tone="good" sub={`${v.summary.collectionRate}%`} />
        <Stat label={t('bill.balance')} value={formatMoney(v.summary.outstanding)} tone={v.summary.outstanding > 0 ? 'bad' : ''} sub={t('bill.unpaidCount', { n: v.summary.invoiceCount - v.summary.paidCount })} />
        <div className="card stat"><span className="eyebrow">{t('bill.progress')}</span><span className="v">{v.summary.paidCount}/{v.summary.invoiceCount}</span><div className="bar"><i style={{ width: `${v.summary.collectionRate}%` }} /></div></div>
      </div>
      <div className="row between wrap"><Seg value={tab} onChange={setTab} options={[{ value: 'bills', label: t('bill.tabBills') }, { value: 'meters', label: t('bill.tabMeters') }]} />
        {tab === 'bills' && <div className="row wrap"><Seg value={filter} onChange={setFilter} options={[{ value: 'all', label: t('common.all') }, { value: 'unpaid', label: t('bill.unpaid') }, { value: 'paid', label: t('val.paid') }]} />{v.lateable.length > 0 && <button className="btn sm" onClick={lateFees}>{t('bill.lateN', { n: v.lateable.length })}</button>}</div>}</div>
      {tab === 'meters' ? <Meters period={period} /> : (
        <div className="card flush">{live.length === 0 ? <Empty icon={Receipt} title={t('bill.emptyTitle', { month: formatPeriod(period) })} body={v.drafts.length ? t('bill.emptyBody', { n: v.drafts.length }) : t('bill.emptyNoOne')} action={v.drafts.length > 0 && <button className="btn primary" onClick={generate}>{t('bill.generate')}</button>} />
          : shown.length === 0 ? <Empty title={t('bill.noneInFilter')} /> : <div className="list">{shown.map((inv) => (
            <button className="item" key={inv.id} onClick={() => setModal({ invoice: inv.id })} data-testid="invoice-row"><Avatar name={inv.tenant?.name} /><span className="grow"><b className="truncate">{inv.tenant?.name}</b><br /><span className="small muted">{inv.room ? t('room.short', { number: inv.room.number }) : ''} · <span className="num">{inv.number}</span> · {t('bill.dueShort', { date: formatDate(inv.dueOn, 'day') })}</span></span>
              <span className="right"><Money value={inv.balance > 0 ? inv.balance : inv.total} /><br /><StatePill value={inv.state} /></span></button>))}</div>}</div>)}
      {modal?.invoice && <InvoiceModal invoiceId={modal.invoice} onClose={() => setModal(null)} onPay={(inv) => setModal({ pay: true, inv })} />}
      {modal?.pay && <PaymentModal invoice={modal.inv} onClose={() => setModal(null)} onDone={(id) => setModal({ receipt: id })} />}
      {modal?.receipt && <ReceiptModal paymentId={modal.receipt} onClose={() => setModal(null)} />}
    </div>
  );
}
