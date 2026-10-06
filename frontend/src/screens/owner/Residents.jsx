import { useMemo, useState } from 'react';
import { UserPlus, Search, ArrowLeft, Phone, Eye, Copy, LogOut, Plus, Trash2, Users } from 'lucide-react';
import { tenantLedger, bedLabels, isLiving, settlementPreview, addDays, ID_TYPES } from '@basera/domain';
import { useApp } from '../../app/store.jsx';
import { useI18n } from '../../app/i18n.jsx';
import { useRouter, Link } from '../../app/router.jsx';
import { useUi, Modal, Input, Select, Seg, Empty, Money, Avatar, StatePill, Stat, useForm, copyText } from '../../ui/kit.jsx';
import { InvoiceModal, ReceiptModal, PaymentModal, DocumentsPanel, PinModal } from '../shared.jsx';

function freeBeds(state, room, exceptTenantId) {
  if (!room) return [];
  const taken = new Set(state.tenants.filter((x) => x.roomId === room.id && isLiving(x) && x.id !== exceptTenantId).map((x) => x.bed));
  return bedLabels(room.beds).filter((b) => !taken.has(b));
}

export function ResidentForm({ tenant }) {
  const app = useApp();
  const { state } = app;
  const { t } = useI18n();
  const ui = useUi();
  const { navigate, back, path } = useRouter();
  const query = new URLSearchParams(path.split('?')[1] || '');
  const firstRoom = state.rooms.find((r) => r.id === query.get('room')) || state.rooms.find((r) => freeBeds(state, r).length);
  const [f, set, setAll] = useForm(tenant ? { ...tenant, emergencyPhone: tenant.emergencyPhone || '', email: tenant.email || '', idType: tenant.idType || '' } : {
    name: '', phone: '', email: '', gender: '', occupation: '', homeTown: '', idType: '', idNumber: '', emergencyName: '', emergencyPhone: '',
    roomId: firstRoom?.id || '', bed: query.get('bed') || freeBeds(state, firstRoom)[0] || '', rent: firstRoom?.rent ?? '', deposit: firstRoom ? Math.round(firstRoom.rent * state.property.rules.depositMonths) : '',
    joinedOn: app.today, depositPaid: '', depositMode: 'upi', notes: '' });
  const room = state.rooms.find((r) => r.id === f.roomId);
  const beds = freeBeds(state, room, tenant?.id);
  const pickRoom = (roomId) => { const r = state.rooms.find((x) => x.id === roomId); const fb = freeBeds(state, r, tenant?.id); setAll((s) => ({ ...s, roomId, bed: fb[0] || '', rent: tenant ? s.rent : r?.rent ?? '', deposit: tenant ? s.deposit : r ? Math.round(r.rent * state.property.rules.depositMonths) : '' })); };
  const save = async (e) => {
    e.preventDefault();
    const base = { name: f.name, phone: f.phone, email: f.email || undefined, gender: f.gender, occupation: f.occupation, homeTown: f.homeTown, idType: f.idType || undefined, idNumber: f.idNumber, emergencyName: f.emergencyName, emergencyPhone: f.emergencyPhone || undefined, roomId: f.roomId, bed: f.bed, rent: Number(f.rent), deposit: Number(f.deposit) || 0, joinedOn: f.joinedOn, notes: f.notes || '' };
    const res = await ui.run(() => app.dispatch(tenant ? { type: 'tenant.update', payload: { tenantId: tenant.id, ...base } } : { type: 'tenant.add', payload: { ...base, depositPaid: Number(f.depositPaid) || undefined, depositMode: f.depositMode } }), t('toast.saved'));
    if (res) navigate(`/residents/${tenant ? tenant.id : res.tenantId}`, { replace: true });
  };
  if (state.rooms.length === 0) return <div className="card"><Empty icon={Users} title={t('res.needRooms')} action={<button className="btn primary" onClick={() => navigate('/rooms')}>{t('rooms.add')}</button>} /></div>;
  return (
    <form className="stack lg" onSubmit={save}>
      <div className="page-head"><div className="row"><button type="button" className="icon-btn" onClick={() => back('/residents')} aria-label={t('common.back')}><ArrowLeft /></button><h1>{tenant ? t('res.edit') : t('res.add')}</h1></div></div>
      <div className="card stack"><h2>{t('res.sectionPerson')}</h2><div className="form-grid">
        <Input id="res-name" label={t('field.fullName')} value={f.name} onChange={set('name')} required />
        <Input id="res-phone" label={t('field.phone')} type="tel" inputMode="numeric" value={f.phone} onChange={set('phone')} required hint={t('res.phoneHint')} />
        <Input id="res-email" label={t('field.emailOptional')} type="email" value={f.email} onChange={set('email')} />
        <Select id="res-gender" label={t('field.gender')} value={f.gender} onChange={set('gender')} options={['', 'male', 'female', 'other'].map((g) => ({ value: g, label: g ? t(`val.gender.${g}`) : '—' }))} />
        <Input id="res-occupation" label={t('field.occupation')} value={f.occupation} onChange={set('occupation')} />
        <Input id="res-hometown" label={t('field.homeTown')} value={f.homeTown} onChange={set('homeTown')} />
        <Select id="res-idtype" label={t('field.idType')} value={f.idType} onChange={set('idType')} options={[{ value: '', label: '—' }, ...ID_TYPES.map((x) => ({ value: x, label: t(`val.id.${x}`) }))]} />
        <Input id="res-idnumber" label={t('field.idNumber')} value={f.idNumber} onChange={set('idNumber')} />
        <Input id="res-emname" label={t('field.emergencyName')} value={f.emergencyName} onChange={set('emergencyName')} />
        <Input id="res-emphone" label={t('field.emergencyPhone')} type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} />
      </div></div>
      <div className="card stack"><h2>{t('res.sectionStay')}</h2><div className="form-grid">
        <Select id="res-room" label={t('field.room')} value={f.roomId} onChange={pickRoom} options={state.rooms.map((r) => ({ value: r.id, label: `${r.number} · ${t('rooms.freeN', { n: freeBeds(state, r, tenant?.id).length })}` }))} />
        <Select id="res-bed" label={t('field.bed')} value={f.bed} onChange={set('bed')} options={beds.length ? beds.map((b) => ({ value: b, label: b })) : [{ value: '', label: t('rooms.full') }]} />
        <Input id="res-rent" label={t('field.monthlyRent')} type="number" min="0" value={f.rent} onChange={set('rent')} required />
        <Input id="res-joined" label={t('field.joinedOn')} type="date" value={f.joinedOn} onChange={set('joinedOn')} required />
        <Input id="res-deposit" label={t('field.deposit')} type="number" min="0" value={f.deposit} onChange={set('deposit')} />
        {!tenant && <Input id="res-deposit-paid" label={t('field.depositPaidNow')} type="number" min="0" value={f.depositPaid} onChange={set('depositPaid')} hint={t('res.depositHint')} />}
      </div></div>
      <div className="row"><button className="btn primary" disabled={!f.bed} data-testid="resident-save">{t('common.save')}</button><button type="button" className="btn ghost" onClick={() => back('/residents')}>{t('common.cancel')}</button></div>
    </form>
  );
}

function SettleModal({ tenant, onClose }) {
  const app = useApp();
  const { t, formatMoney } = useI18n();
  const ui = useUi();
  const [leftOn, setLeftOn] = useState(tenant.leaveOn && tenant.leaveOn <= app.today ? tenant.leaveOn : app.today);
  const [deductions, setDeductions] = useState([]);
  const [mode, setMode] = useState('upi');
  const clean = deductions.filter((d) => d.label.trim() && Number(d.amount) > 0).map((d) => ({ label: d.label.trim(), amount: Number(d.amount) }));
  const p = useMemo(() => settlementPreview(app.full || app.state, tenant, { leftOn, deductions: clean }, app.today), [app.full, app.state, tenant, leftOn, JSON.stringify(clean), app.today]);
  const save = async () => { if (await ui.run(() => app.dispatch({ type: 'tenant.settle', payload: { tenantId: tenant.id, leftOn, deductions: clean, refundMode: mode } }), t('toast.settled'))) onClose(); };
  return (
    <Modal wide title={t('settle.title', { name: tenant.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save} disabled={p.pendingClaims > 0} data-testid="settle-save">{t('settle.confirm')}</button></>}>
      <div className="stack">
        <div className="form-grid"><Input id="settle-date" label={t('settle.leftOn')} type="date" value={leftOn} onChange={setLeftOn} />
          <Select id="settle-mode" label={t('settle.refundMode')} value={mode} onChange={setMode} options={['upi', 'bank', 'cash', 'cheque'].map((m) => ({ value: m, label: t(`val.mode.${m}`) }))} /></div>
        {p.pendingClaims > 0 && <p className="error-text">{t('err.claims_pending')}</p>}
        <div className="stack sm"><span className="label">{t('settle.deductions')}</span>
          {deductions.map((d, i) => (<div className="row" key={i}>
            <input id={`ded-label-${i}`} className="input" placeholder={t('settle.deductionPh')} value={d.label} onChange={(e) => setDeductions((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input id={`ded-amount-${i}`} className="input" style={{ width: 110 }} type="number" min="0" placeholder="₹" value={d.amount} onChange={(e) => setDeductions((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <button className="icon-btn" onClick={() => setDeductions((l) => l.filter((_, j) => j !== i))} aria-label={t('common.remove')}><Trash2 /></button></div>))}
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDeductions((l) => [...l, { label: '', amount: '' }])}><Plus />{t('settle.addDeduction')}</button></div>
        <div className="card" style={{ background: 'var(--sunken)' }}><dl className="kv">
          <dt>{t('settle.depositHeld')}</dt><dd><Money value={p.depositHeld} /></dd>
          <dt>{t('settle.unpaid')}</dt><dd><Money value={-p.outstanding} /></dd>
          {p.unusedRentCredit && (<><dt>{t('settle.unusedCredit', { days: p.unusedRentCredit.unusedDays })}</dt><dd><Money value={p.unusedRentCredit.amount} sign /></dd></>)}
          {p.deductionsTotal > 0 && (<><dt>{t('settle.deductions')}</dt><dd><Money value={-p.deductionsTotal} /></dd></>)}
          <dt><b>{p.refund >= 0 ? t('settle.refund') : t('settle.stillOwes')}</b></dt><dd><b className="num" style={{ fontSize: '1.2rem', color: p.refund >= 0 ? 'var(--good)' : 'var(--bad)' }}>{formatMoney(Math.abs(p.refund))}</b></dd>
        </dl></div>
        <p className="hint">{t('settle.note')}</p>
      </div>
    </Modal>
  );
}

function MoveModal({ tenant, onClose }) {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const rooms = app.state.rooms.filter((r) => freeBeds(app.state, r, tenant.id).length);
  const [roomId, setRoomId] = useState(tenant.roomId);
  const room = app.state.rooms.find((r) => r.id === roomId);
  const beds = freeBeds(app.state, room, tenant.id);
  const [bed, setBed] = useState(tenant.bed);
  const [rent, setRent] = useState(tenant.rent);
  return (
    <Modal title={t('res.move')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!beds.includes(bed)} onClick={async () => { if (await ui.run(() => app.dispatch({ type: 'tenant.move', payload: { tenantId: tenant.id, roomId, bed, rent: Number(rent) } }), t('toast.saved'))) onClose(); }}>{t('res.move')}</button></>}>
      <div className="form-grid">
        <Select id="move-room" label={t('field.room')} value={roomId} onChange={(v) => { setRoomId(v); const r = app.state.rooms.find((x) => x.id === v); setBed(freeBeds(app.state, r, tenant.id)[0] || ''); setRent(r.rent); }} options={rooms.map((r) => ({ value: r.id, label: r.number }))} />
        <Select id="move-bed" label={t('field.bed')} value={bed} onChange={setBed} options={beds.map((b) => ({ value: b, label: b }))} />
        <Input id="move-rent" full label={t('field.monthlyRent')} type="number" value={rent} onChange={setRent} />
      </div>
    </Modal>
  );
}

export function ResidentDetail({ id }) {
  const app = useApp();
  const { state, today } = app;
  const { t, formatDate, formatPeriod, formatMoney, tv } = useI18n();
  const ui = useUi();
  const { navigate, back } = useRouter();
  const [modal, setModal] = useState(null);
  const tenant = state.tenants.find((x) => x.id === id);
  const ledger = useMemo(() => (tenant ? tenantLedger(state, tenant.id, today) : null), [state, tenant, today]);
  if (!tenant) return <Empty title={t('err.not_found')} action={<Link to="/residents" className="btn">{t('common.back')}</Link>} />;
  const room = state.rooms.find((r) => r.id === tenant.roomId);
  const settlement = state.settlements.find((s) => s.tenantId === tenant.id);
  const reminder = t('res.reminderText', { name: tenant.name.split(' ')[0], amount: formatMoney(ledger.net), pg: state.property.name, upi: state.property.upiId || '—' });
  const notice = async () => {
    const leaveOn = addDays(today, state.property.rules.noticeDays);
    if (await ui.confirm({ title: t('res.noticeTitle'), body: t('res.noticeBody', { date: formatDate(leaveOn) }), action: t('res.giveNotice') })) ui.run(() => app.dispatch({ type: 'tenant.giveNotice', payload: { tenantId: tenant.id, leaveOn } }), t('toast.saved'));
  };
  return (
    <div className="stack lg">
      <div className="page-head">
        <div className="row"><button className="icon-btn" onClick={() => back('/residents')} aria-label={t('common.back')}><ArrowLeft /></button><Avatar name={tenant.name} /><div><h1>{tenant.name}</h1>
          <p className="muted small">{room ? `${t('room.short', { number: room.number })}-${tenant.bed}` : ''} · {t('res.since', { date: formatDate(tenant.joinedOn) })} <StatePill value={tenant.status} /></p></div></div>
        <div className="row wrap">
          {isLiving(tenant) && <button className="btn primary" onClick={() => setModal({ pay: true })} data-testid="resident-pay">{t('pay.record')}</button>}
          <button className="btn" onClick={() => navigate(`/residents/${tenant.id}/edit`)}>{t('common.edit')}</button>
          {isLiving(tenant) && app.full && app.role === 'owner' && <button className="btn" onClick={() => app.startPreview('tenant', tenant.id, tenant.name)} data-testid="view-as"><Eye />{t('res.viewAs')}</button>}
        </div>
      </div>
      {tenant.status === 'notice' && <div className="banner info">{t('res.onNotice', { date: formatDate(tenant.leaveOn) })}<button className="btn sm" onClick={() => ui.run(() => app.dispatch({ type: 'tenant.cancelNotice', payload: { tenantId: tenant.id } }), t('toast.saved'))}>{t('res.cancelNotice')}</button></div>}
      <div className="grid c4">
        <Stat label={t('res.owes')} value={formatMoney(ledger.net)} tone={ledger.net > 0 ? 'bad' : 'good'} sub={ledger.overdue > 0 ? t('res.overdueOf', { amount: formatMoney(ledger.overdue) }) : ledger.credit > 0 ? t('res.advance', { amount: formatMoney(ledger.credit) }) : ''} />
        <Stat label={t('field.monthlyRent')} value={formatMoney(tenant.rent)} />
        <Stat label={t('settle.depositHeld')} value={formatMoney(ledger.depositHeld)} sub={tenant.deposit > ledger.depositHeld ? t('res.depositShort', { amount: formatMoney(tenant.deposit - ledger.depositHeld) }) : ''} />
        <Stat label={t('res.lastPaid')} value={ledger.lastPayment ? formatDate(ledger.lastPayment.date, 'day') : '—'} sub={ledger.lastPayment ? formatMoney(ledger.lastPayment.amount) : ''} />
      </div>
      {settlement && (<div className="card"><div className="card-head"><h2>{t('settle.statement')} <span className="num small faint">{settlement.number}</span></h2></div><dl className="kv">
        <dt>{t('settle.leftOn')}</dt><dd>{formatDate(settlement.leftOn)}</dd><dt>{t('settle.depositHeld')}</dt><dd><Money value={settlement.depositHeld} /></dd>
        <dt>{t('settle.adjusted')}</dt><dd><Money value={settlement.depositAdjusted} /></dd>
        {settlement.deductions.map((d, i) => (<span key={i} style={{ display: 'contents' }}><dt>{d.label}</dt><dd><Money value={d.amount} /></dd></span>))}
        <dt><b>{settlement.refund >= 0 ? t('settle.refund') : t('settle.stillOwes')}</b></dt><dd><b><Money value={Math.abs(settlement.refund)} /></b></dd></dl></div>)}
      <div className="grid split">
        <div className="stack">
          <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('res.bills')}</h2></div>
            {ledger.invoices.length === 0 ? <Empty title={t('res.noBills')} body={t('res.noBillsBody')} /> : <div className="list">{[...ledger.invoices].reverse().map((inv) => (
              <button className="item" key={inv.id} onClick={() => setModal({ invoice: inv.id })}><span className="grow"><b>{formatPeriod(inv.period)}</b><br /><span className="small muted num">{inv.number} · {t('bill.dueShort', { date: formatDate(inv.dueOn, 'day') })}</span></span><span className="right"><Money value={inv.total} /><br /><StatePill value={inv.state} /></span></button>))}</div>}</div>
          <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2>{t('res.payments')}</h2></div>
            {ledger.payments.length === 0 ? <Empty title={t('res.noPayments')} /> : <div className="list">{ledger.payments.map((p) => (
              <button className="item" key={p.id} onClick={() => setModal({ receipt: p.id })}><span className="grow"><b>{formatDate(p.date)}</b> <span className="small muted">{tv('val.mode', p.mode)} · {tv('val.kind', p.kind)}</span><br /><span className="small faint num">{p.number || p.reference}</span></span><span className="right"><Money value={p.amount} /><br /><StatePill value={p.status} /></span></button>))}</div>}</div>
        </div>
        <div className="stack">
          <div className="card stack"><h2>{t('res.details')}</h2><dl className="kv">
            <dt>{t('field.phone')}</dt><dd><a href={`tel:+91${tenant.phone}`} className="num"><Phone size={13} /> {tenant.phone}</a></dd>
            {tenant.email && (<><dt>{t('field.email')}</dt><dd>{tenant.email}</dd></>)}
            {tenant.occupation && (<><dt>{t('field.occupation')}</dt><dd>{tenant.occupation}</dd></>)}
            {tenant.homeTown && (<><dt>{t('field.homeTown')}</dt><dd>{tenant.homeTown}</dd></>)}
            {tenant.idType && (<><dt>{tv('val.id', tenant.idType)}</dt><dd className="num">{tenant.idNumber}</dd></>)}
            {tenant.emergencyPhone && (<><dt>{t('field.emergencyName')}</dt><dd>{tenant.emergencyName} · <span className="num">{tenant.emergencyPhone}</span></dd></>)}
          </dl>
            {ledger.net > 0 && <button className="btn sm" onClick={async () => ui.toast((await copyText(reminder)) ? t('toast.reminderCopied') : reminder)}><Copy />{t('res.copyReminder')}</button>}</div>
          <div className="card stack"><h2>{t('docs.title')}</h2><DocumentsPanel ownerType="tenant" ownerId={tenant.id} /></div>
          {isLiving(tenant) && (<div className="card stack"><h2>{t('res.stay')}</h2><div className="row wrap">
            <button className="btn sm" onClick={() => setModal({ move: true })}>{t('res.move')}</button>
            {tenant.status === 'active' && <button className="btn sm" onClick={notice}>{t('res.giveNotice')}</button>}
            {app.mode === 'local' && app.role === 'owner' && <button className="btn sm" onClick={() => setModal({ pin: true })}>{t('pin.set')}</button>}
            {app.can('tenant.settle') && <button className="btn sm danger" onClick={() => setModal({ settle: true })} data-testid="resident-moveout"><LogOut />{t('res.moveOut')}</button>}</div></div>)}
        </div>
      </div>
      {modal?.invoice && <InvoiceModal invoiceId={modal.invoice} onClose={() => setModal(null)} onPay={(inv) => setModal({ pay: true, invoice: inv })} />}
      {modal?.pay && <PaymentModal tenantId={tenant.id} invoice={typeof modal.invoice === 'object' ? modal.invoice : null} onClose={() => setModal(null)} onDone={(pid) => setModal({ receipt: pid })} />}
      {modal?.receipt && <ReceiptModal paymentId={modal.receipt} onClose={() => setModal(null)} />}
      {modal?.settle && <SettleModal tenant={tenant} onClose={() => setModal(null)} />}
      {modal?.pin && <PinModal phone={tenant.phone} name={tenant.name} onClose={() => setModal(null)} />}
      {modal?.move && <MoveModal tenant={tenant} onClose={() => setModal(null)} />}
    </div>
  );
}

export default function Residents() {
  const { state, today } = useApp();
  const { t } = useI18n();
  const { navigate } = useRouter();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('living');
  const rows = useMemo(() => state.tenants.map((x) => ({ x, room: state.rooms.find((r) => r.id === x.roomId), ledger: tenantLedger(state, x.id, today) })), [state, today]);
  const counts = { living: rows.filter((r) => isLiving(r.x)).length, owing: rows.filter((r) => r.ledger.net > 0).length, left: rows.filter((r) => r.x.status === 'left').length };
  const shown = rows.filter((r) => (filter === 'living' ? isLiving(r.x) : filter === 'owing' ? r.ledger.net > 0 : r.x.status === 'left'))
    .filter((r) => !q || `${r.x.name} ${r.x.phone} ${r.room?.number || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.room?.number || '').localeCompare(b.room?.number || '', undefined, { numeric: true }) || a.x.bed.localeCompare(b.x.bed));
  return (
    <div className="stack lg">
      <div className="page-head"><h1>{t('nav.residents')}</h1><button className="btn primary" onClick={() => navigate('/residents/new')} data-testid="resident-add"><UserPlus />{t('res.add')}</button></div>
      <div className="row wrap"><Seg value={filter} onChange={setFilter} options={[{ value: 'living', label: t('res.filterLiving'), count: counts.living }, { value: 'owing', label: t('res.filterOwing'), count: counts.owing }, { value: 'left', label: t('res.filterLeft'), count: counts.left }]} />
        <div className="row grow" style={{ maxWidth: 320 }}><Search size={16} color="var(--ink-3)" /><input id="res-search" className="input" placeholder={t('res.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="card flush">{shown.length === 0 ? <Empty icon={Users} title={state.tenants.length ? t('res.noMatch') : t('res.emptyTitle')} body={state.tenants.length ? '' : t('res.emptyBody')} /> : <div className="list">{shown.map(({ x, room, ledger }) => (
        <Link className="item" key={x.id} to={`/residents/${x.id}`}><Avatar name={x.name} /><span className="grow"><b className="truncate">{x.name}</b> {x.status !== 'active' && <StatePill value={x.status} />}<br /><span className="small muted">{room ? `${t('room.short', { number: room.number })}-${x.bed}` : ''} · <span className="num">{x.phone}</span></span></span>
          <span className="right">{ledger.net > 0 ? <Money value={ledger.net} /> : <span className="pill good">{t('val.paid')}</span>}{ledger.pending.length > 0 && (<><br /><span className="pill warn">{t('pay.claimShort')}</span></>)}</span></Link>))}</div>}</div>
    </div>
  );
}
