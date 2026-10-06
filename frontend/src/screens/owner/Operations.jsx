// Expenses, staff (attendance, salary, checklists), requests, notices and food.
import { useMemo, useState } from 'react';
import { Plus, Trash2, Wallet, Users, Wrench, Megaphone, Eye, UtensilsCrossed, ListChecks } from 'lucide-react';
import { EXPENSE_CATEGORIES, PAYMENT_MODES, STAFF_ROLES, STAFF_ACCESS, WEEKDAYS, periodOf, shiftPeriod, expenseBreakdown, staffAttendanceOn, attendanceSummary, salaryStatus, headcount, addDays, activeNotices, MEALS } from '@basera/domain';
import { useApp } from '../../app/store.jsx';
import { useI18n } from '../../app/i18n.jsx';
import { useUi, Modal, Input, Select, Seg, Empty, Money, Avatar, ShareBars, useForm } from '../../ui/kit.jsx';
import { RequestCard, RequestForm, NoticeCard, MenuWeek, DocumentsPanel, PinModal, roleName } from '../shared.jsx';

const CAT_COLORS = ['var(--accent)', 'var(--warn)', 'var(--info)', 'var(--good)', 'var(--bad)', 'var(--ink-3)'];

export function Expenses() {
  const app = useApp();
  const { state, today } = app;
  const { t, tv, formatDate, formatPeriod, formatMoney } = useI18n();
  const ui = useUi();
  const [period, setPeriod] = useState(periodOf(today));
  const [open, setOpen] = useState(false);
  const [f, set, setAll] = useForm({ date: today, category: 'groceries', amount: '', vendor: '', note: '', mode: 'upi' });
  const rows = state.expenses.filter((e) => periodOf(e.date) === period).sort((a, b) => (a.date < b.date ? 1 : -1));
  const breakdown = expenseBreakdown(state, period);
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const periods = [0, 1, 2, 3, 4, 5].map((i) => shiftPeriod(periodOf(today), -i));
  const save = async () => { if (await ui.run(() => app.dispatch({ type: 'expense.add', payload: { ...f, amount: Number(f.amount) } }), t('toast.saved'))) { setOpen(false); setAll((s) => ({ ...s, amount: '', vendor: '', note: '' })); } };
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>{t('nav.expenses')}</h1><p className="muted">{formatPeriod(period)} · <Money value={total} /></p></div>
        <div className="row wrap"><select id="exp-period" className="input" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t('bill.period')}>{periods.map((p) => (<option key={p} value={p}>{formatPeriod(p)}</option>))}</select>
          <button className="btn primary" onClick={() => setOpen(true)} data-testid="expense-add"><Plus />{t('exp.add')}</button></div></div>
      {rows.length === 0 ? <div className="card"><Empty icon={Wallet} title={t('exp.emptyTitle')} body={t('exp.emptyBody')} /></div> : (
        <div className="grid split">
          <div className="card flush"><div className="list">{rows.map((e) => (
            <div key={e.id}><span className="grow"><b>{tv('val.expcat', e.category)}</b>{e.vendor ? <span className="muted"> · {e.vendor}</span> : null}<br /><span className="small faint">{formatDate(e.date, 'day')} · {tv('val.mode', e.mode)}{e.note ? ` · ${e.salaryId ? formatPeriod(e.note, true) : e.note}` : ''}</span></span><Money value={e.amount} />
              {!e.salaryId && <button className="icon-btn" aria-label={t('common.remove')} onClick={async () => { if (await ui.confirm({ title: t('exp.removeTitle'), body: `${tv('val.expcat', e.category)} · ${formatMoney(e.amount)}`, danger: true, action: t('common.remove') })) ui.run(() => app.dispatch({ type: 'expense.remove', payload: { expenseId: e.id } }), t('toast.removed')); }}><Trash2 /></button>}</div>))}</div></div>
          <div className="card"><div className="card-head"><h2>{t('exp.byCategory')}</h2></div><ShareBars format={formatMoney} rows={breakdown.map((b, i) => ({ label: tv('val.expcat', b.category), value: b.amount, color: CAT_COLORS[i % CAT_COLORS.length] }))} /></div>
        </div>)}
      {open && (<Modal title={t('exp.add')} onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn primary" onClick={save} disabled={!f.amount} data-testid="expense-save">{t('common.save')}</button></>}>
        <div className="form-grid">
          <Select id="exp-category" label={t('field.category')} value={f.category} onChange={set('category')} options={EXPENSE_CATEGORIES.filter((c) => c !== 'salary').map((c) => ({ value: c, label: t(`val.expcat.${c}`) }))} />
          <Input id="exp-amount" label={t('field.amount')} type="number" min="1" value={f.amount} onChange={set('amount')} />
          <Input id="exp-date" label={t('field.date')} type="date" max={today} value={f.date} onChange={set('date')} />
          <Select id="exp-mode" label={t('field.mode')} value={f.mode} onChange={set('mode')} options={PAYMENT_MODES.map((m) => ({ value: m, label: t(`val.mode.${m}`) }))} />
          <Input id="exp-vendor" full label={t('field.paidTo')} value={f.vendor} onChange={set('vendor')} />
          <Input id="exp-note" full label={t('field.note')} value={f.note} onChange={set('note')} />
        </div></Modal>)}
    </div>
  );
}

function StaffForm({ member, onClose }) {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const [f, set] = useForm(member ? { name: member.name, phone: member.phone, role: member.role, roleLabel: member.roleLabel || '', access: member.access || 'basic', salary: member.salary, joinedOn: member.joinedOn, shift: member.shift } : { name: '', phone: '', role: 'cook', roleLabel: '', access: 'basic', salary: '', joinedOn: app.today, shift: '' });
  const save = async () => { const payload = { ...f, roleLabel: f.role === 'other' ? f.roleLabel : '', salary: Number(f.salary) }; if (await ui.run(() => app.dispatch(member ? { type: 'staff.update', payload: { staffId: member.id, ...payload } } : { type: 'staff.add', payload }), t('toast.saved'))) onClose(); };
  return (
    <Modal title={member ? t('staff.edit') : t('staff.add')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save} disabled={!f.name || !f.phone || f.salary === '' || (f.role === 'other' && !f.roleLabel.trim())} data-testid="staff-save">{t('common.save')}</button></>}>
      <div className="form-grid">
        <Input id="staff-name" label={t('field.fullName')} value={f.name} onChange={set('name')} />
        <Input id="staff-phone" label={t('field.phone')} type="tel" value={f.phone} onChange={set('phone')} hint={t('staff.phoneHint')} />
        <Select id="staff-role" label={t('field.staffRole')} value={f.role} onChange={set('role')} options={STAFF_ROLES.map((r) => ({ value: r, label: t(`val.staffrole.${r}`) }))} />
        {f.role === 'other' && <Input id="staff-role-custom" label={t('field.customRole')} value={f.roleLabel} onChange={set('roleLabel')} placeholder={t('staff.customRolePh')} maxLength={40} />}
        <Select id="staff-access" full label={t('field.access')} value={f.access} onChange={set('access')} options={STAFF_ACCESS.map((a) => ({ value: a, label: t(`access.${a}`) }))} hint={t(`access.hint.${f.access}`)} />
        <Input id="staff-salary" label={t('field.monthlySalary')} type="number" min="0" value={f.salary} onChange={set('salary')} />
        <Input id="staff-joined" label={t('field.joinedOn')} type="date" value={f.joinedOn} onChange={set('joinedOn')} />
        <Input id="staff-shift" label={t('field.shift')} value={f.shift} onChange={set('shift')} />
      </div></Modal>
  );
}

function StaffDetail({ member, onClose, onEdit }) {
  const app = useApp();
  const { state, today } = app;
  const { t, formatPeriod, formatMoney, formatDate } = useI18n();
  const ui = useUi();
  const [pin, setPin] = useState(false);
  const due = shiftPeriod(periodOf(today), -1);
  const unpaid = [due, periodOf(today)].filter((p) => p >= periodOf(member.joinedOn) && !salaryStatus(state, member, p));
  const sum = attendanceSummary(state, member.id, periodOf(today));
  const pay = async (period) => { if (await ui.confirm({ title: t('staff.payTitle', { name: member.name }), body: t('staff.payBody', { amount: formatMoney(member.salary), month: formatPeriod(period) }), action: t('staff.pay') })) ui.run(() => app.dispatch({ type: 'staff.paySalary', payload: { staffId: member.id, period, amount: member.salary, date: today, mode: 'bank' } }), t('toast.salaryPaid')); };
  return (
    <Modal wide title={member.name} onClose={onClose} footer={<>
      <button className="btn danger" onClick={async () => { if (await ui.confirm({ title: t('staff.removeTitle', { name: member.name }), body: t('staff.removeBody'), danger: true, action: t('common.remove') })) { await ui.run(() => app.dispatch({ type: 'staff.remove', payload: { staffId: member.id } }), t('toast.removed')); onClose(); } }}>{t('staff.remove')}</button>
      {app.mode === 'local' && <button className="btn" onClick={() => setPin(true)} data-testid="set-pin">{t('pin.set')}</button>}
      {app.full && <button className="btn" onClick={() => { app.startPreview('staff', member.id, member.name); onClose(); }}><Eye />{t('res.viewAs')}</button>}
      <button className="btn primary" onClick={onEdit} data-testid="staff-edit">{t('common.edit')}</button></>}>
      {pin && <PinModal phone={member.phone} name={member.name} onClose={() => setPin(false)} />}
      <div className="stack">
        <dl className="kv"><dt>{t('field.staffRole')}</dt><dd>{roleName(t, member)}</dd><dt>{t('field.access')}</dt><dd>{t(`access.${member.access || 'basic'}`)}</dd><dt>{t('field.phone')}</dt><dd className="num">{member.phone}</dd><dt>{t('field.monthlySalary')}</dt><dd><Money value={member.salary} /></dd>
          <dt>{t('staff.thisMonth')}</dt><dd>{t('staff.attSummary', { present: sum.present, absent: sum.absent, leave: sum.leave })}</dd></dl>
        {unpaid.map((p) => (<div className="banner" key={p}>{t('staff.salaryDue', { month: formatPeriod(p) })}<button className="btn sm primary" onClick={() => pay(p)} data-testid="pay-salary">{t('staff.pay')}</button></div>))}
        <h3>{t('staff.slips')}</h3>
        {state.salaryPayments.filter((s) => s.staffId === member.id).length === 0 ? <p className="small muted">{t('staff.noSlips')}</p> : <div className="card flush list">{state.salaryPayments.filter((s) => s.staffId === member.id).reverse().map((s) => (<div key={s.id}><span className="grow"><b>{formatPeriod(s.period)}</b><br /><span className="small faint num">{s.number} · {formatDate(s.date, 'day')}</span></span><Money value={s.amount} /></div>))}</div>}
        <h3>{t('docs.title')}</h3><DocumentsPanel ownerType="staff" ownerId={member.id} />
      </div></Modal>
  );
}

function Tasks() {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const [f, set] = useForm({ title: '', role: 'all', time: '' });
  const add = async () => { if (await ui.run(() => app.dispatch({ type: 'task.add', payload: { title: f.title, role: f.role, time: f.time || undefined, days: [...WEEKDAYS] } }), t('toast.saved'))) set('title')(''); };
  return (
    <div className="card stack"><div className="card-head"><h2>{t('tasks.title')}</h2></div><p className="small muted">{t('tasks.sub')}</p>
      <div className="row wrap"><input id="task-title" className="input grow" style={{ minWidth: 160 }} placeholder={t('tasks.ph')} value={f.title} onChange={(e) => set('title')(e.target.value)} />
        <select id="task-role" className="input" style={{ width: 'auto' }} value={f.role} onChange={(e) => set('role')(e.target.value)} aria-label={t('field.staffRole')}><option value="all">{t('tasks.everyone')}</option>{STAFF_ROLES.map((r) => (<option key={r} value={r}>{t(`val.staffrole.${r}`)}</option>))}</select>
        <input id="task-time" className="input" style={{ width: 120 }} type="time" value={f.time} onChange={(e) => set('time')(e.target.value)} aria-label={t('field.time')} /><button className="btn primary" disabled={!f.title.trim()} onClick={add}><Plus />{t('common.add')}</button></div>
      {app.state.tasks.length === 0 ? <Empty icon={ListChecks} title={t('tasks.empty')} /> : <div className="list" style={{ margin: '0 -16px -16px' }}>{app.state.tasks.map((x) => { const done = app.state.taskLogs.some((l) => l.taskId === x.id && l.date === app.today); return (
        <div key={x.id}><span className="grow">{x.title}<br /><span className="small faint">{x.role === 'all' ? t('tasks.everyone') : t(`val.staffrole.${x.role}`)}{x.time ? ` · ${x.time}` : ''}</span></span>{done && <span className="pill good">{t('tasks.doneToday')}</span>}<button className="icon-btn" aria-label={t('common.remove')} onClick={() => ui.run(() => app.dispatch({ type: 'task.remove', payload: { taskId: x.id } }))}><Trash2 /></button></div>); })}</div>}
    </div>
  );
}

export function Staff() {
  const app = useApp();
  const { state, today } = app;
  const { t, formatTime } = useI18n();
  const ui = useUi();
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('team');
  const rows = staffAttendanceOn(state, today);
  const mark = (staffId, status) => ui.run(() => app.dispatch({ type: 'attendance.mark', payload: { staffId, date: today, status } }));
  const detail = modal?.detail && state.staff.find((s) => s.id === modal.detail);
  return (
    <div className="stack lg">
      <div className="page-head"><h1>{t('nav.staff')}</h1><button className="btn primary" onClick={() => setModal({ form: true })} data-testid="staff-add"><Plus />{t('staff.add')}</button></div>
      <Seg value={tab} onChange={setTab} options={[{ value: 'team', label: t('staff.tabTeam') }, { value: 'tasks', label: t('tasks.title') }]} />
      {tab === 'tasks' ? <Tasks /> : rows.length === 0 ? <div className="card"><Empty icon={Users} title={t('staff.emptyTitle')} body={t('staff.emptyBody')} /></div> : (
        <div className="card flush"><div className="list">{rows.map(({ member, record }) => (
          <div key={member.id} style={{ flexWrap: 'wrap' }}><Avatar name={member.name} /><button className="grow btn ghost" style={{ justifyContent: 'flex-start', height: 'auto', padding: '4px 6px', textAlign: 'left' }} onClick={() => setModal({ detail: member.id })} data-testid="staff-row"><span><b>{member.name}</b><br /><span className="small muted">{roleName(t, member)}{member.access && member.access !== 'basic' ? ` · ${t(`access.${member.access}`)}` : ''}{record?.inAt ? ` · ${t('staff.inAt', { time: formatTime(record.inAt) })}` : ''}</span></span></button>
            <div className="seg">{['present', 'absent', 'leave'].map((s) => (<button key={s} className={record?.status === s ? 'on' : ''} onClick={() => mark(member.id, s)}>{t(`val.${s}`)}</button>))}</div></div>))}</div></div>)}
      {modal?.form && <StaffForm member={modal.member} onClose={() => setModal(null)} />}
      {detail && <StaffDetail member={detail} onClose={() => setModal(null)} onEdit={() => setModal({ form: true, member: detail })} />}
    </div>
  );
}

export function Requests() {
  const app = useApp();
  const { t } = useI18n();
  const [filter, setFilter] = useState('live');
  const [open, setOpen] = useState(false);
  const all = [...app.state.requests].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const live = all.filter((r) => r.status === 'open' || r.status === 'in_progress');
  const shown = filter === 'live' ? live : all.filter((r) => !live.includes(r));
  return (
    <div className="stack lg">
      <div className="page-head"><h1>{t('nav.requests')}</h1><button className="btn primary" onClick={() => setOpen(true)}><Plus />{t('req.new')}</button></div>
      <Seg value={filter} onChange={setFilter} options={[{ value: 'live', label: t('req.live'), count: live.length }, { value: 'done', label: t('req.done') }]} />
      {shown.length === 0 ? <div className="card"><Empty icon={Wrench} title={filter === 'live' ? t('req.emptyLive') : t('req.emptyDone')} body={filter === 'live' ? t('req.emptyBody') : ''} /></div> : <div className="grid c2">{shown.map((r) => (<RequestCard key={r.id} request={r} />))}</div>}
      {open && <RequestForm onClose={() => setOpen(false)} />}
    </div>
  );
}

export function Community() {
  const app = useApp();
  const { state, today } = app;
  const { t, formatDate } = useI18n();
  const ui = useUi();
  const [tab, setTab] = useState('notices');
  const [open, setOpen] = useState(false);
  const [f, set, setAll] = useForm({ title: '', body: '', audience: 'all', pinned: false });
  const notices = useMemo(() => activeNotices(state, today), [state, today]);
  const post = async () => { if (await ui.run(() => app.dispatch({ type: 'notice.post', payload: f }), t('toast.posted'))) { setOpen(false); setAll({ title: '', body: '', audience: 'all', pinned: false }); } };
  const days = [today, addDays(today, 1)];
  return (
    <div className="stack lg">
      <div className="page-head"><h1>{t('nav.community')}</h1>{tab === 'notices' && <button className="btn primary" onClick={() => setOpen(true)} data-testid="notice-add"><Megaphone />{t('notice.post')}</button>}</div>
      <Seg value={tab} onChange={setTab} options={[{ value: 'notices', label: t('notice.title') }, { value: 'food', label: t('menu.title') }]} />
      {tab === 'notices' ? (notices.length === 0 ? <div className="card"><Empty icon={Megaphone} title={t('notice.emptyTitle')} body={t('notice.emptyBody')} /></div> : <div className="grid c2">{notices.map((n) => (<NoticeCard key={n.id} notice={n} />))}</div>) : (<>
        <div className="card flush"><div className="card-head" style={{ padding: '16px 16px 0' }}><h2><UtensilsCrossed size={16} /> {t('menu.headcount')}</h2></div><div className="table-wrap"><table><thead><tr><th>{t('menu.day')}</th>{MEALS.map((m) => (<th key={m} className="r">{t(`val.meal.${m}`)}</th>))}</tr></thead>
          <tbody>{days.map((d) => (<tr key={d}><td>{formatDate(d, 'weekday')}</td>{MEALS.map((m) => { const h = headcount(state, d, m); return (<td key={m} className="r"><b className="num">{h.eating}</b>{h.skipped > 0 && <span className="small faint"> (−{h.skipped})</span>}</td>); })}</tr>))}</tbody></table></div></div>
        <MenuWeek editable /></>)}
      {open && (<Modal title={t('notice.post')} onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn primary" onClick={post} disabled={!f.title.trim()} data-testid="notice-save">{t('notice.post')}</button></>}>
        <div className="stack"><Input id="notice-title" label={t('notice.heading')} value={f.title} onChange={set('title')} />
          <div className="field"><label htmlFor="notice-body">{t('field.details')}</label><textarea id="notice-body" className="input" value={f.body} onChange={(e) => set('body')(e.target.value)} /></div>
          <Select id="notice-audience" label={t('notice.audience')} value={f.audience} onChange={set('audience')} options={['all', 'tenants', 'staff'].map((a) => ({ value: a, label: t(`val.audience.${a}`) }))} />
          <label className="check"><input type="checkbox" checked={f.pinned} onChange={(e) => set('pinned')(e.target.checked)} />{t('notice.pin')}</label></div></Modal>)}
    </div>
  );
}
