import { useMemo, useState } from 'react';
import { Download, Upload, Trash2, Cloud, Smartphone } from 'lucide-react';
import { profitAndLoss, duesAging, collectionsByMode, expenseBreakdown, churn, periodOf, shiftPeriod, duesList, tenantLedger, isLiving } from '@basera/domain';
import { useApp } from '../../app/store.jsx';
import { useI18n, LANGUAGES } from '../../app/i18n.jsx';
import { useTheme } from '../../app/theme.jsx';
import { useUi, Modal, Input, Select, Seg, BarChart, ShareBars, Stat, useForm, downloadText, toCsv, copyText } from '../../ui/kit.jsx';

function ExportBox({ name, text, onClose }) {
  const { t } = useI18n();
  const ui = useUi();
  return (<Modal wide title={name} onClose={onClose} footer={<><button className="btn" onClick={async () => ui.toast((await copyText(text)) ? t('toast.copied') : t('err.unknown'))}>{t('common.copy')}</button><button className="btn primary" onClick={() => downloadText(name, text, name.endsWith('.json') ? 'application/json' : 'text/csv')}><Download />{t('common.download')}</button></>}>
    <p className="small muted" style={{ marginBottom: 8 }}>{t('export.hint')}</p><textarea id="export-text" className="input num" readOnly style={{ minHeight: 240, fontSize: '.75rem' }} value={text.length > 60000 ? `${text.slice(0, 60000)}\n…` : text} /></Modal>);
}

export function Reports() {
  const { state, today } = useApp();
  const { t, tv, formatPeriod, formatMoney } = useI18n();
  const [span, setSpan] = useState(6);
  const [exp, setExp] = useState(null);
  const to = periodOf(today); const from = shiftPeriod(to, -(span - 1));
  const v = useMemo(() => ({ pl: profitAndLoss(state, from, to, today), aging: duesAging(state, today), modes: collectionsByMode(state), cats: expenseBreakdown(state), churn: churn(state, today, span), dues: duesList(state, today) }), [state, from, to, today, span]);
  const exportDues = () => setExp({ name: 'dues.csv', text: toCsv([['Resident', 'Phone', 'Room', 'Outstanding', 'Days late'], ...v.dues.map((r) => [r.tenant.name, r.tenant.phone, r.room?.number || '', r.outstanding, r.daysLate])]) });
  const exportPl = () => setExp({ name: 'profit-and-loss.csv', text: toCsv([['Month', 'Billed', 'Collected', 'Expenses', 'Net'], ...v.pl.rows.map((r) => [r.period, r.billed, r.collected, r.expenses, r.net])]) });
  const exportResidents = () => setExp({ name: 'residents.csv', text: toCsv([['Name', 'Phone', 'Room', 'Bed', 'Rent', 'Joined', 'Status', 'Outstanding', 'Deposit held'], ...state.tenants.map((x) => { const l = tenantLedger(state, x.id, today); return [x.name, x.phone, state.rooms.find((r) => r.id === x.roomId)?.number || '', x.bed, x.rent, x.joinedOn, x.status, l.net, l.depositHeld]; })]) });
  const colors = ['var(--accent)', 'var(--info)', 'var(--warn)', 'var(--good)', 'var(--ink-3)', 'var(--bad)'];
  return (
    <div className="stack lg">
      <div className="page-head"><h1>{t('nav.reports')}</h1><Seg value={span} onChange={setSpan} options={[3, 6, 12].map((n) => ({ value: n, label: t('rep.months', { n }) }))} /></div>
      <div className="grid c4">
        <Stat label={t('rep.collected')} value={formatMoney(v.pl.totals.collected)} /><Stat label={t('rep.expenses')} value={formatMoney(v.pl.totals.expenses)} />
        <Stat label={t('rep.net')} value={formatMoney(v.pl.totals.net)} tone={v.pl.totals.net >= 0 ? 'good' : 'bad'} /><Stat label={t('rep.depositsHeld')} value={formatMoney(state.tenants.filter(isLiving).reduce((s, x) => s + tenantLedger(state, x.id, today).depositHeld, 0))} sub={t('rep.depositsSub')} />
      </div>
      <div className="card"><div className="card-head"><h2>{t('rep.pl')}</h2><button className="btn sm" onClick={exportPl}><Download />CSV</button></div>
        <BarChart format={formatMoney} data={v.pl.rows.map((r) => ({ label: formatPeriod(r.period, true), ...r }))} series={[{ key: 'collected', label: t('rep.collected'), color: 'var(--accent)' }, { key: 'expenses', label: t('rep.expenses'), color: 'var(--warn)' }]} />
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>{t('bill.period')}</th><th className="r">{t('rep.billed')}</th><th className="r">{t('rep.collected')}</th><th className="r">{t('rep.expenses')}</th><th className="r">{t('rep.net')}</th></tr></thead>
          <tbody>{v.pl.rows.map((r) => (<tr key={r.period}><td>{formatPeriod(r.period)}</td><td className="r num">{formatMoney(r.billed)}</td><td className="r num">{formatMoney(r.collected)}</td><td className="r num">{formatMoney(r.expenses)}</td><td className="r num" style={{ color: r.net < 0 ? 'var(--bad)' : undefined }}>{formatMoney(r.net)}</td></tr>))}</tbody></table></div></div>
      <div className="grid c3">
        <div className="card"><div className="card-head"><h2>{t('rep.aging')}</h2><button className="btn sm" onClick={exportDues}><Download />CSV</button></div><ShareBars format={formatMoney} rows={[['current', 'var(--good)'], ['d1_30', 'var(--warn)'], ['d31_60', 'var(--bad)'], ['d61_plus', 'var(--bad)']].map(([k, c]) => ({ label: t(`rep.age.${k}`), value: v.aging[k], color: c }))} /></div>
        <div className="card"><div className="card-head"><h2>{t('rep.byMode')}</h2></div><ShareBars format={formatMoney} rows={v.modes.map((m, i) => ({ label: tv('val.mode', m.mode), value: m.amount, color: colors[i % 6] }))} /></div>
        <div className="card"><div className="card-head"><h2>{t('exp.byCategory')}</h2></div><ShareBars format={formatMoney} rows={v.cats.slice(0, 6).map((m, i) => ({ label: tv('val.expcat', m.category), value: m.amount, color: colors[i % 6] }))} /></div>
      </div>
      <div className="card"><div className="card-head"><h2>{t('rep.churn')}</h2><button className="btn sm" onClick={exportResidents}><Download />{t('rep.residentsCsv')}</button></div>
        <BarChart data={v.churn.map((c) => ({ label: formatPeriod(c.period, true), ...c }))} series={[{ key: 'joined', label: t('rep.joined'), color: 'var(--accent)' }, { key: 'left', label: t('rep.left'), color: 'var(--bad)' }]} height={150} /></div>
      {exp && <ExportBox {...exp} onClose={() => setExp(null)} />}
    </div>
  );
}

export function Settings() {
  const app = useApp();
  const { state } = app;
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const ui = useUi();
  const p = state.property;
  const [f, set] = useForm({ name: p.name, address: p.address, city: p.city, ownerName: p.ownerName, upiId: p.upiId, gstin: p.gstin });
  const [r, setR] = useForm({ ...p.rules });
  const [exp, setExp] = useState(null);
  const [importing, setImporting] = useState(false);
  const [raw, setRaw] = useState('');
  const [serverUrl, setServerUrl] = useState(app.server.url || '');
  const save = () => ui.run(() => app.dispatch({ type: 'property.update', payload: { ...f, rules: { dueDay: Number(r.dueDay), graceDays: Number(r.graceDays), lateFeeType: r.lateFeeType, lateFeeValue: Number(r.lateFeeValue) || 0, prorate: r.prorate, electricityMode: r.electricityMode, electricityRate: Number(r.electricityRate) || 0, electricityFlat: Number(r.electricityFlat) || 0, depositMonths: Number(r.depositMonths) || 0, noticeDays: Number(r.noticeDays) || 0 } } }), t('toast.saved'));
  const doExport = () => ui.run(async () => { const data = await app.exportProperty(); setExp({ name: `${p.name.replace(/\W+/g, '-').toLowerCase()}-backup.json`, text: JSON.stringify(data) }); });
  const doImport = () => ui.run(async () => { let parsed; try { parsed = JSON.parse(raw); } catch { throw { code: 'invalid_document' }; } if (!parsed?.property) throw { code: 'invalid_document' }; await app.importProperty(parsed); await app.reloadMemberships(); setImporting(false); setRaw(''); }, t('settings.imported'));
  const moveOnline = () => ui.run(async () => { if (!app.server.backend?.token) throw { code: 'sign_in_required' }; const data = await app.exportProperty(); await app.server.backend.importProperty(data); }, t('settings.movedOnline'));
  const [newRecovery, setNewRecovery] = useState('');
  const regenRecovery = async () => { if (await ui.confirm({ title: t('recovery.regenTitle'), body: t('recovery.regenBody'), action: t('recovery.regen') })) ui.run(async () => setNewRecovery(await app.localRecoveryCode(app.session.user.phone))); };
  const signOutAll = async () => { if (await ui.confirm({ title: t('security.signOutAllTitle'), body: t('security.signOutAllBody'), action: t('security.signOutAll'), danger: true })) ui.run(async () => { await app.server.backend.logoutAll(); await app.signOut(); }); };
  const remove = async () => { if (await ui.confirm({ title: t('settings.deleteTitle', { name: p.name }), body: t('settings.deleteBody'), danger: true, action: t('settings.delete') })) ui.run(() => app.deleteProperty(), t('toast.removed')); };
  return (
    <div className="stack lg">
      <div className="page-head"><h1>{t('nav.settings')}</h1><button className="btn primary" onClick={save} data-testid="settings-save">{t('common.save')}</button></div>
      <div className="card stack"><h2>{t('settings.pg')}</h2><div className="form-grid">
        <Input id="set-name" label={t('field.pgName')} value={f.name} onChange={set('name')} /><Input id="set-owner" label={t('field.yourName')} value={f.ownerName} onChange={set('ownerName')} />
        <Input id="set-city" label={t('field.city')} value={f.city} onChange={set('city')} /><Input id="set-upi" label={t('field.upiId')} value={f.upiId} onChange={set('upiId')} hint={t('setup.upiHint')} />
        <Input id="set-address" full label={t('field.address')} value={f.address} onChange={set('address')} /><Input id="set-gstin" label={t('field.gstin')} value={f.gstin} onChange={set('gstin')} />
      </div></div>
      <div className="card stack"><h2>{t('settings.rules')}</h2><div className="form-grid">
        <Input id="rule-due" label={t('field.dueDay')} type="number" min="1" max="28" value={r.dueDay} onChange={setR('dueDay')} hint={t('setup.dueHint')} />
        <Input id="rule-grace" label={t('rule.graceDays')} type="number" min="0" value={r.graceDays} onChange={setR('graceDays')} />
        <Select id="rule-late" label={t('rule.lateFee')} value={r.lateFeeType} onChange={setR('lateFeeType')} options={['none', 'flat', 'percent'].map((x) => ({ value: x, label: t(`val.latefee.${x}`) }))} />
        {r.lateFeeType !== 'none' && <Input id="rule-late-value" label={r.lateFeeType === 'flat' ? t('rule.lateFlat') : t('rule.latePercent')} type="number" min="0" value={r.lateFeeValue} onChange={setR('lateFeeValue')} />}
        <Select id="rule-elec" label={t('field.electricity')} value={r.electricityMode} onChange={setR('electricityMode')} options={['meter', 'flat', 'none'].map((x) => ({ value: x, label: t(`val.elec.${x}`) }))} />
        {r.electricityMode === 'meter' && <Input id="rule-rate" label={t('rule.unitRate')} type="number" min="0" step="0.5" value={r.electricityRate} onChange={setR('electricityRate')} />}
        {r.electricityMode === 'flat' && <Input id="rule-flat" label={t('rule.elecFlat')} type="number" min="0" value={r.electricityFlat} onChange={setR('electricityFlat')} />}
        <Input id="rule-deposit" label={t('rule.depositMonths')} type="number" min="0" step="0.5" value={r.depositMonths} onChange={setR('depositMonths')} />
        <Input id="rule-notice" label={t('rule.noticeDays')} type="number" min="0" value={r.noticeDays} onChange={setR('noticeDays')} />
        <label className="check full"><input type="checkbox" checked={r.prorate} onChange={(e) => setR('prorate')(e.target.checked)} />{t('rule.prorate')}</label>
      </div></div>
      <div className="card stack"><h2>{t('settings.app')}</h2><div className="form-grid">
        <Select id="set-lang" label={t('settings.language')} value={lang} onChange={setLang} options={LANGUAGES.map((l) => ({ value: l.code, label: `${l.native} · ${l.name}` }))} />
        <div className="field"><span className="label">{t('settings.theme')}</span><Seg value={theme} onChange={setTheme} options={['system', 'light', 'dark'].map((x) => ({ value: x, label: t(`val.theme.${x}`) }))} /></div>
      </div></div>
      <div className="card stack"><h2>{t('security.title')}</h2>
        {app.mode === 'local' ? (<><p className="small muted">{t('security.deviceBody')}</p><div className="row wrap"><button className="btn" onClick={regenRecovery}>{t('recovery.regen')}</button></div>
          {newRecovery && <div className="card" style={{ textAlign: 'center' }}><div className="eyebrow">{t('forgot.recoveryCode')}</div><div className="num" style={{ fontSize: '1.6rem', fontWeight: 600, letterSpacing: '.08em', userSelect: 'all' }}>{newRecovery}</div><p className="small muted">{t('recovery.body')}</p></div>}</>)
          : (<><p className="small muted">{t('security.onlineBody')}</p><div className="row wrap"><button className="btn danger" onClick={signOutAll}>{t('security.signOutAll')}</button></div></>)}
      </div>
      <div className="card stack"><h2>{t('settings.data')}</h2>
        <p className="small muted row">{app.mode === 'server' ? <Cloud size={16} /> : <Smartphone size={16} />}{app.mode === 'server' ? t('settings.dataOnline', { url: app.server.url }) : t('settings.dataDevice')}</p>
        <div className="row wrap"><button className="btn" onClick={doExport} data-testid="export-backup"><Download />{t('settings.backup')}</button><button className="btn" onClick={() => setImporting(true)}><Upload />{t('settings.restore')}</button>
          {app.mode === 'local' && app.server.status === 'online' && <button className="btn" onClick={moveOnline}><Cloud />{t('settings.moveOnline')}</button>}</div>
        {app.mode === 'local' && (<div className="row wrap"><input id="set-server" className="input grow" style={{ minWidth: 200 }} placeholder="https://your-server.example/api" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} aria-label={t('settings.serverUrl')} /><button className="btn" onClick={() => { app.setServerUrl(serverUrl); ui.toast(t('toast.saved')); }}>{t('settings.connect')}</button><span className={`pill ${app.server.status === 'online' ? 'good' : ''}`}>{t(`val.server.${app.server.status}`)}</span></div>)}
        {state.sample && <p className="small muted">{t('sample.note')}</p>}
        <div><button className="btn danger" onClick={remove}><Trash2 />{t('settings.delete')}</button></div></div>
      {exp && <ExportBox {...exp} onClose={() => setExp(null)} />}
      {importing && (<Modal wide title={t('settings.restore')} onClose={() => setImporting(false)} footer={<><button className="btn" onClick={() => setImporting(false)}>{t('common.cancel')}</button><button className="btn primary" disabled={!raw.trim()} onClick={doImport}>{t('settings.restore')}</button></>}>
        <div className="stack"><p className="small muted">{t('settings.restoreHint')}</p><label className="btn" style={{ alignSelf: 'flex-start' }}><Upload />{t('settings.chooseFile')}<input type="file" accept="application/json,.json" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) setRaw(await file.text()); }} /></label>
          <textarea id="import-text" className="input num" style={{ minHeight: 160, fontSize: '.75rem' }} value={raw.length > 20000 ? `${raw.slice(0, 20000)}…` : raw} onChange={(e) => setRaw(e.target.value)} placeholder="{ … }" /></div></Modal>)}
    </div>
  );
}
