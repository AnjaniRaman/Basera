// Pieces used by more than one portal: bill and receipt views, payment form, documents,
// requests, notices and the weekly menu.
import { useEffect, useState } from 'react';
import { Printer, Copy, Trash2, Upload, FileText, Pin, Check, MessageSquare } from 'lucide-react';
import { invoiceBalance, invoiceStatus, PAYMENT_MODES, DOCUMENT_KINDS, REQUEST_CATEGORIES, WEEKDAYS, MEALS, weekdayKey } from '@basera/domain';
import { useApp } from '../app/store.jsx';
import { useI18n } from '../app/i18n.jsx';
import { useUi, Modal, Input, Select, Money, StatePill, copyText, useForm } from '../ui/kit.jsx';

export function lineLabel(t, line) {
  if (line.type === 'rent') return line.meta?.prorated ? t('line.rentProrated', { days: line.meta.days, of: line.meta.periodDays }) : t('line.rent');
  if (line.type === 'electricity') return line.meta?.mode === 'meter' ? t('line.electricityMeter', { units: line.meta.units, share: line.meta.share }) : t('line.electricity');
  if (line.type === 'late_fee') return t('line.lateFee');
  if (line.type === 'credit' && line.label === 'unused_days') return t('line.unusedDays', { days: line.meta?.unusedDays });
  return line.label || t(`val.line.${line.type}`);
}

export function roleName(t, member) {
  return member.role === 'other' && member.roleLabel ? member.roleLabel : t(`val.staffrole.${member.role}`);
}

/** Device mode only: the owner sets the PIN a resident or staff member signs in with on this device. */
export function PinModal({ phone, name, onClose }) {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const [pin, setPin] = useState('');
  const save = async () => { if (await ui.run(() => app.setLocalPin(phone, pin), t('pin.saved'))) onClose(); };
  return (
    <Modal title={t('pin.title', { name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save} disabled={!/^\d{4,6}$/.test(pin)} data-testid="pin-save">{t('common.save')}</button></>}>
      <div className="stack"><p className="small muted">{t('pin.body')}</p><Input id="pin-input" label={t('field.pin')} inputMode="numeric" maxLength={6} value={pin} onChange={setPin} hint={t('setup.pinHint')} /></div>
    </Modal>
  );
}

export function printPage() {
  try { window.print(); } catch { /* blocked in previews */ }
}

export function InvoiceModal({ invoiceId, onClose, onPay }) {
  const app = useApp();
  const { t, formatDate, formatPeriod } = useI18n();
  const ui = useUi();
  const [adding, setAdding] = useState(null);
  const [f, set] = useForm({ label: '', amount: '' });
  const inv = app.state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return null;
  const tenant = app.state.tenants.find((x) => x.id === inv.tenantId);
  const room = app.state.rooms.find((r) => r.id === tenant?.roomId);
  const owner = app.manages;
  const balance = invoiceBalance(inv);
  const addLine = () => ui.run(async () => {
    await app.dispatch({ type: 'billing.addLine', payload: { invoiceId, line: { type: adding, label: f.label, amount: Number(f.amount) } } });
    setAdding(null); set('label')(''); set('amount')('');
  }, t('toast.saved'));
  return (
    <Modal wide title={`${t('bill.title')} ${inv.number}`} onClose={onClose}
      footer={<>
        <button className="btn no-print" onClick={printPage}><Printer />{t('common.print')}</button>
        {app.can('billing.void') && inv.status !== 'void' && inv.paid === 0 && <button className="btn danger" onClick={async () => { if (await ui.confirm({ title: t('bill.voidTitle'), body: t('bill.voidBody'), action: t('bill.void'), danger: true })) { await ui.run(() => app.dispatch({ type: 'billing.void', payload: { invoiceId } }), t('toast.saved')); onClose(); } }}>{t('bill.void')}</button>}
        {balance > 0 && onPay && <button className="btn primary" onClick={() => onPay(inv)} data-testid="invoice-pay">{owner ? t('pay.record') : t('pay.payNow')}</button>}
      </>}>
      <div className="receipt stack">
        <div className="row between wrap">
          <div><h2>{app.state.property.name}</h2><p className="small muted">{[app.state.property.address, app.state.property.city].filter(Boolean).join(', ')}</p></div>
          <StatePill value={invoiceStatus(inv, app.today)} />
        </div>
        <dl className="kv">
          <dt>{t('field.resident')}</dt><dd>{tenant?.name}{room ? ` · ${t('room.short', { number: room.number })}-${tenant.bed}` : ''}</dd>
          <dt>{t('bill.period')}</dt><dd>{formatPeriod(inv.period)}</dd>
          <dt>{t('bill.dueOn')}</dt><dd>{formatDate(inv.dueOn)}</dd>
        </dl>
        <hr />
        {inv.lines.map((l) => (
          <div className="row between" key={l.id}>
            <span>{lineLabel(t, l)}</span>
            <span className="row"><Money value={l.amount} />{owner && inv.status !== 'void' && !['rent', 'electricity'].includes(l.type) && (
              <button className="icon-btn no-print" aria-label={t('common.remove')} onClick={() => ui.run(() => app.dispatch({ type: 'billing.removeLine', payload: { invoiceId, lineId: l.id } }))}><Trash2 /></button>)}</span>
          </div>))}
        <hr />
        <div className="row between"><b>{t('bill.total')}</b><Money value={inv.total} /></div>
        <div className="row between muted"><span>{t('bill.paid')}</span><Money value={inv.paid} /></div>
        <div className="row between"><b>{t('bill.balance')}</b><b><Money value={balance} /></b></div>
        {owner && inv.status !== 'void' && (adding ? (
          <div className="form-grid no-print">
            <Input id="line-label" label={t('field.description')} value={f.label} onChange={set('label')} />
            <Input id="line-amount" label={t('field.amount')} type="number" min="1" value={f.amount} onChange={set('amount')} />
            <div className="row full"><button className="btn primary sm" onClick={addLine} disabled={!f.amount || !f.label}>{t('common.add')}</button><button className="btn sm ghost" onClick={() => setAdding(null)}>{t('common.cancel')}</button></div>
          </div>) : (
          <div className="row wrap no-print"><button className="btn sm" onClick={() => setAdding('charge')}>{t('bill.addCharge')}</button><button className="btn sm" onClick={() => setAdding('discount')}>{t('bill.addDiscount')}</button></div>))}
      </div>
    </Modal>
  );
}

export function ReceiptModal({ paymentId, onClose }) {
  const app = useApp();
  const { t, tv, formatDate, formatPeriod, formatMoney } = useI18n();
  const ui = useUi();
  const p = app.state.payments.find((x) => x.id === paymentId);
  if (!p) return null;
  const tenant = app.state.tenants.find((x) => x.id === p.tenantId);
  const prop = app.state.property;
  const text = t('receipt.share', { name: tenant?.name || '', amount: formatMoney(p.amount), number: p.number || '', date: formatDate(p.date), pg: prop.name });
  return (
    <Modal title={`${t('receipt.title')} ${p.number || ''}`} onClose={onClose}
      footer={<>
        <button className="btn no-print" onClick={async () => ui.toast((await copyText(text)) ? t('toast.copied') : text)}><Copy />{t('receipt.copy')}</button>
        <button className="btn primary no-print" onClick={printPage}><Printer />{t('common.print')}</button>
      </>}>
      <div className="receipt stack">
        <div><h2>{prop.name}</h2><p className="small muted">{[prop.address, prop.city].filter(Boolean).join(', ')}</p></div>
        <div style={{ textAlign: 'center', padding: '10px 0' }}><div className="eyebrow">{t('receipt.received')}</div><div className="num" style={{ fontSize: '2rem', fontWeight: 600 }}>{formatMoney(p.amount)}</div><StatePill value={p.status} /></div>
        <dl className="kv">
          <dt>{t('receipt.from')}</dt><dd>{tenant?.name}</dd>
          <dt>{t('field.date')}</dt><dd>{formatDate(p.date)}</dd>
          <dt>{t('field.mode')}</dt><dd>{tv('val.mode', p.mode)}</dd>
          {p.reference && (<><dt>{t('field.reference')}</dt><dd className="num">{p.reference}</dd></>)}
          <dt>{t('receipt.for')}</dt><dd>{p.kind === 'deposit' ? t('val.kind.deposit') : (p.allocations || []).map((a) => { const inv = app.state.invoices.find((i) => i.id === a.invoiceId); return inv ? `${formatPeriod(inv.period, true)} ${formatMoney(a.amount)}` : ''; }).filter(Boolean).join(' · ') || t('val.kind.rent')}</dd>
          {p.unallocated > 0 && (<><dt>{t('receipt.advance')}</dt><dd><Money value={p.unallocated} /></dd></>)}
          {p.collectedBy && (<><dt>{t('receipt.by')}</dt><dd>{p.collectedBy}</dd></>)}
        </dl>
        <hr /><p className="small faint">{t('receipt.footer')}</p>
      </div>
    </Modal>
  );
}

export function PaymentModal({ tenantId, invoice, onClose, onDone }) {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const living = app.state.tenants;
  const [f, set] = useForm({ tenantId: tenantId || invoice?.tenantId || '', amount: invoice ? invoiceBalance(invoice) : '', date: app.today, mode: 'upi', kind: 'rent', reference: '', note: '' });
  const save = async () => {
    const res = await ui.run(() => app.dispatch({ type: 'payment.record', payload: { ...f, amount: Number(f.amount), invoiceId: invoice?.id } }), t('toast.paymentRecorded'));
    if (res) { onClose(); onDone?.(res.paymentId); }
  };
  return (
    <Modal title={t('pay.record')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save} disabled={!f.tenantId || !f.amount} data-testid="payment-save">{t('pay.saveReceipt')}</button></>}>
      <div className="form-grid">
        <Select id="pay-tenant" full label={t('field.resident')} value={f.tenantId} onChange={set('tenantId')} options={[{ value: '', label: t('common.choose') }, ...living.map((x) => ({ value: x.id, label: `${x.name}${x.status === 'left' ? ` (${t('val.left')})` : ''}` }))]} />
        <Input id="pay-amount" label={t('field.amount')} type="number" min="1" value={f.amount} onChange={set('amount')} />
        <Input id="pay-date" label={t('field.date')} type="date" value={f.date} max={app.today} onChange={set('date')} />
        <Select id="pay-mode" label={t('field.mode')} value={f.mode} onChange={set('mode')} options={PAYMENT_MODES.map((m) => ({ value: m, label: t(`val.mode.${m}`) }))} />
        <Select id="pay-kind" label={t('field.paymentFor')} value={f.kind} onChange={set('kind')} options={['rent', 'deposit'].map((m) => ({ value: m, label: t(`val.kind.${m}`) }))} />
        <Input id="pay-reference" full label={t('field.reference')} value={f.reference} onChange={set('reference')} hint={t('pay.referenceHint')} />
      </div>
    </Modal>
  );
}

async function shrinkImage(file, maxBytes = 900 * 1024) {
  if (!file.type.startsWith('image/') || file.size <= maxBytes) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  return blob || file;
}

export function DocumentsPanel({ ownerType, ownerId }) {
  const app = useApp();
  const { t, formatDate } = useI18n();
  const ui = useUi();
  const [kind, setKind] = useState('id_proof');
  const [viewing, setViewing] = useState(null);
  const docs = app.state.documents.filter((d) => d.ownerType === ownerType && d.ownerId === ownerId);
  const upload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    ui.run(async () => {
      const blob = await shrinkImage(file);
      const fileId = await app.files.put(blob, { name: file.name });
      await app.dispatch({ type: 'document.add', payload: { ownerType, ownerId, kind, name: file.name.slice(0, 110), mime: blob.type || file.type || 'application/octet-stream', size: blob.size, fileId } });
    }, t('toast.uploaded'));
  };
  const open = (d) => ui.run(async () => { const blob = await app.files.get(d.fileId); if (!blob) throw { code: 'file_not_found' }; setViewing({ url: URL.createObjectURL(blob), doc: d }); });
  useEffect(() => () => { if (viewing) URL.revokeObjectURL(viewing.url); }, [viewing]);
  return (
    <div className="stack">
      <div className="row wrap">
        <select className="input" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('field.docKind')} id={`doc-kind-${ownerId}`}>
          {DOCUMENT_KINDS.map((k) => (<option key={k} value={k}>{t(`val.doc.${k}`)}</option>))}
        </select>
        <label className="btn"><Upload />{t('docs.upload')}<input type="file" accept="image/*,application/pdf" hidden onChange={upload} /></label>
      </div>
      {docs.length === 0 ? <p className="small muted">{t('docs.none')}</p> : (
        <div className="card flush list">{docs.map((d) => (
          <div key={d.id}><FileText size={18} /><button className="grow truncate btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => open(d)}>{d.name}</button>
            <span className="small faint nowrap">{t(`val.doc.${d.kind}`)} · {formatDate(d.uploadedAt.slice(0, 10), 'day')}</span>
            <button className="icon-btn" aria-label={t('common.remove')} onClick={async () => { if (await ui.confirm({ title: t('docs.removeTitle'), body: d.name, danger: true, action: t('common.remove') })) ui.run(async () => { const r = await app.dispatch({ type: 'document.remove', payload: { documentId: d.id } }); if (r?.fileId) await app.files.remove(r.fileId); }); }}><Trash2 /></button>
          </div>))}</div>)}
      {viewing && (<Modal wide title={viewing.doc.name} onClose={() => setViewing(null)}>
        {viewing.doc.mime.startsWith('image/') ? <img src={viewing.url} alt={viewing.doc.name} style={{ maxWidth: '100%', borderRadius: 8 }} /> : <a className="btn" href={viewing.url} target="_blank" rel="noreferrer">{t('docs.open')}</a>}
      </Modal>)}
    </div>
  );
}

export function RequestForm({ onClose, tenantId }) {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const [f, set] = useForm({ category: 'plumbing', title: '', description: '', priority: 'normal', tenantId: tenantId || '' });
  const save = async () => { if (await ui.run(() => app.dispatch({ type: 'request.create', payload: { ...f, tenantId: f.tenantId || undefined } }), t('toast.requestSent'))) onClose(); };
  return (
    <Modal title={t('req.new')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save} disabled={!f.title.trim()} data-testid="request-save">{t('req.send')}</button></>}>
      <div className="form-grid">
        <Select id="req-category" label={t('field.category')} value={f.category} onChange={set('category')} options={REQUEST_CATEGORIES.map((c) => ({ value: c, label: t(`val.reqcat.${c}`) }))} />
        <Select id="req-priority" label={t('field.priority')} value={f.priority} onChange={set('priority')} options={['low', 'normal', 'high'].map((c) => ({ value: c, label: t(`val.${c}`) }))} />
        {app.manages && <Select id="req-tenant" full label={t('field.resident')} value={f.tenantId} onChange={set('tenantId')} options={[{ value: '', label: t('req.common') }, ...app.state.tenants.filter((x) => x.status !== 'left').map((x) => ({ value: x.id, label: x.name }))]} />}
        <Input id="req-title" full label={t('req.what')} value={f.title} onChange={set('title')} placeholder={t('req.whatPh')} />
        <div className="field full"><label htmlFor="req-desc">{t('field.details')}</label><textarea id="req-desc" className="input" value={f.description} onChange={(e) => set('description')(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export function RequestCard({ request }) {
  const app = useApp();
  const { t, formatRelative } = useI18n();
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const tenant = app.state.tenants.find((x) => x.id === request.tenantId);
  const room = app.state.rooms.find((r) => r.id === request.roomId);
  const assignee = app.state.staff.find((s) => s.id === request.assignedTo);
  const role = app.manages ? 'owner' : app.role;
  const update = (payload, ok = t('toast.saved')) => ui.run(() => app.dispatch({ type: 'request.update', payload: { requestId: request.id, ...payload } }), ok);
  const live = request.status === 'open' || request.status === 'in_progress';
  return (
    <div className="card stack" data-testid="request-card">
      <div className="row between wrap"><span className="row wrap"><span className="num small faint">{request.number}</span><StatePill value={request.status} />{request.priority === 'high' && <StatePill value="high" />}</span><span className="small faint">{formatRelative(request.createdAt)}</span></div>
      <div><h3>{request.title}</h3><p className="small muted">{[t(`val.reqcat.${request.category}`), tenant?.name, room && t('room.short', { number: room.number })].filter(Boolean).join(' · ')}</p></div>
      {request.description && <p className="small">{request.description}</p>}
      {assignee && <p className="small muted">{t('req.assignedTo', { name: assignee.name })}</p>}
      <div className="row wrap">
        {role === 'owner' && live && (
          <select className="input" style={{ width: 'auto', minHeight: 32 }} value={request.assignedTo || ''} onChange={(e) => update({ assignedTo: e.target.value || null })} aria-label={t('req.assign')} id={`assign-${request.id}`}>
            <option value="">{t('req.unassigned')}</option>{app.state.staff.filter((s) => s.active).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>)}
        {role !== 'tenant' && request.status === 'open' && <button className="btn sm" onClick={() => update({ status: 'in_progress' })}>{t('req.start')}</button>}
        {role !== 'tenant' && live && <button className="btn sm primary" onClick={() => update({ status: 'resolved' })} data-testid="request-resolve"><Check />{t('req.resolve')}</button>}
        {role === 'tenant' && request.status === 'resolved' && (<><button className="btn sm primary" onClick={() => update({ status: 'closed' })}>{t('req.confirmFixed')}</button><button className="btn sm" onClick={() => update({ status: 'open' })}>{t('req.reopen')}</button></>)}
        <button className="btn sm ghost" onClick={() => setOpen(!open)}><MessageSquare />{request.updates.filter((u) => u.text).length || ''}</button>
      </div>
      {open && (<div className="stack sm">
        {request.updates.filter((u) => u.text || u.status).map((u) => (<p key={u.id} className="small"><b>{u.by.name || t(`role.${u.by.role}`)}</b> <span className="faint">{formatRelative(u.at)}</span><br />{u.status ? `${t(`val.${u.status}`)}${u.text ? ' — ' : ''}` : ''}{u.text}</p>))}
        <div className="row"><input id={`comment-${request.id}`} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('req.addNote')} /><button className="btn sm" disabled={!text.trim()} onClick={async () => { if (await ui.run(() => app.dispatch({ type: 'request.comment', payload: { requestId: request.id, text } }))) setText(''); }}>{t('common.send')}</button></div>
      </div>)}
    </div>
  );
}

export function NoticeCard({ notice }) {
  const app = useApp();
  const { t, formatRelative } = useI18n();
  const ui = useUi();
  const owner = app.can('notice.remove');
  const acked = !owner && notice.acks.some((a) => a.refId === app.refId);
  return (
    <div className="card stack sm">
      <div className="row between wrap"><span className="row">{notice.pinned && <Pin size={15} color="var(--accent)" />}<h3>{notice.title}</h3></span><span className="small faint">{formatRelative(notice.postedAt)}</span></div>
      {notice.body && <p className="small muted">{notice.body}</p>}
      <div className="row between wrap">
        <span className="small faint">{owner ? `${t(`val.audience.${notice.audience}`)} · ${t('notice.seenBy', { n: notice.acks.length })}` : ''}</span>
        {owner ? <button className="btn sm ghost" onClick={async () => { if (await ui.confirm({ title: t('notice.removeTitle'), body: notice.title, danger: true, action: t('common.remove') })) ui.run(() => app.dispatch({ type: 'notice.remove', payload: { noticeId: notice.id } })); }}><Trash2 />{t('common.remove')}</button>
          : acked ? <span className="pill good"><Check size={13} />{t('notice.acked')}</span> : <button className="btn sm" onClick={() => ui.run(() => app.dispatch({ type: 'notice.ack', payload: { noticeId: notice.id } }))} data-testid="notice-ack">{t('notice.ack')}</button>}
      </div>
    </div>
  );
}

export function MenuWeek({ editable }) {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const [editing, setEditing] = useState(null);
  const [f, set, setAll] = useForm({ breakfast: '', lunch: '', dinner: '' });
  const todayKey = weekdayKey(app.today);
  return (
    <div className="card flush">
      <div className="table-wrap"><table>
        <thead><tr><th>{t('menu.day')}</th>{MEALS.map((m) => (<th key={m}>{t(`val.meal.${m}`)}</th>))}{editable && <th />}</tr></thead>
        <tbody>{WEEKDAYS.map((d) => (<tr key={d} style={d === todayKey ? { background: 'var(--accent-soft)' } : null}>
          <td><b>{t(`weekday.${d}`)}</b></td>{MEALS.map((m) => (<td key={m} className="small">{app.state.menu[d]?.[m] || <span className="faint">—</span>}</td>))}
          {editable && <td className="r"><button className="btn sm ghost" onClick={() => { setAll({ ...app.state.menu[d] }); setEditing(d); }}>{t('common.edit')}</button></td>}
        </tr>))}</tbody>
      </table></div>
      {editing && (<Modal title={`${t('menu.title')} · ${t(`weekday.${editing}`)}`} onClose={() => setEditing(null)} footer={<><button className="btn" onClick={() => setEditing(null)}>{t('common.cancel')}</button><button className="btn primary" onClick={async () => { if (await ui.run(() => app.dispatch({ type: 'menu.update', payload: { day: editing, meals: f } }), t('toast.saved'))) setEditing(null); }}>{t('common.save')}</button></>}>
        <div className="stack">{MEALS.map((m) => (<Input key={m} id={`menu-${m}`} label={t(`val.meal.${m}`)} value={f[m]} onChange={set(m)} />))}</div>
      </Modal>)}
    </div>
  );
}
