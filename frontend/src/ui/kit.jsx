// Small UI kit: dialogs, confirmation, toasts, fields, charts. No window.alert/confirm anywhere.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import { useI18n } from '../app/i18n.jsx';

const UiContext = createContext(null);
export const useUi = () => useContext(UiContext);

export function errorText(t, err) {
  const code = err?.code || 'unknown';
  const key = `err.${code}`;
  const msg = t(key, err?.details || {});
  return msg === key ? t('err.unknown') : msg;
}

export function UiProvider({ children }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), kind === 'bad' ? 5000 : 2800);
  }, []);
  const fail = useCallback((err) => toast(errorText(t, err), 'bad'), [toast, t]);
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  /** Run an async action, toast on success, show a translated error on failure. Returns true/false. */
  const run = useCallback(async (fn, okText) => {
    try {
      const result = await fn();
      if (okText) toast(okText);
      return result ?? true;
    } catch (err) {
      fail(err);
      return false;
    }
  }, [toast, fail]);

  const value = useMemo(() => ({ toast, fail, confirm, run }), [toast, fail, confirm, run]);
  const close = (answer) => {
    confirmState.resolve(answer);
    setConfirmState(null);
  };
  return (
    <UiContext.Provider value={value}>
      {children}
      {confirmState && (
        <Modal title={confirmState.title} onClose={() => close(false)}
          footer={<>
            <button className="btn" onClick={() => close(false)}>{t('common.cancel')}</button>
            <button className={`btn ${confirmState.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} data-testid="confirm-yes">{confirmState.action || t('common.confirm')}</button>
          </>}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {confirmState.danger && <AlertTriangle size={20} color="var(--bad)" style={{ flex: 'none', marginTop: 2 }} />}
            <p className="muted">{confirmState.body}</p>
          </div>
        </Modal>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (<div key={x.id} className={`toast ${x.kind}`}>{x.kind === 'bad' ? <AlertTriangle size={16} /> : <Check size={16} />}{x.text}</div>))}
      </div>
    </UiContext.Provider>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  const { t } = useI18n();
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea, button.primary')?.focus?.();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label={t('common.close')}><X /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, full, id }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      {label && <label htmlFor={id}>{label}</label>}
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ label, hint, full, id, value, onChange, type = 'text', ...rest }) {
  return (
    <Field label={label} hint={hint} full={full} id={id}>
      <input id={id} className="input" type={type} value={value ?? ''} onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} {...rest} />
    </Field>
  );
}

export function Select({ label, hint, full, id, value, onChange, options, ...rest }) {
  return (
    <Field label={label} hint={hint} full={full} id={id}>
      <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => (<option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
      </select>
    </Field>
  );
}

export function Seg({ value, onChange, options }) {
  return (<div className="seg" role="tablist">{options.map((o) => (
    <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}{o.count ? ` · ${o.count}` : ''}</button>
  ))}</div>);
}

export function Empty({ icon: Icon, title, body, action }) {
  return (<div className="empty">{Icon && <Icon />}<h3>{title}</h3>{body && <p className="small" style={{ maxWidth: 380 }}>{body}</p>}{action}</div>);
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
export function Avatar({ name }) { return <span className="avatar" aria-hidden="true">{initials(name)}</span>; }

export function Money({ value, className = '', sign }) {
  const { formatMoney } = useI18n();
  return <span className={`num ${className}`}>{formatMoney(value, { sign })}</span>;
}

export function Stat({ label, value, tone, sub }) {
  return (<div className="card stat"><span className="eyebrow">{label}</span><span className={`v ${tone || ''}`}>{value}</span>{sub && <span className="small muted">{sub}</span>}</div>);
}

const STATE_TONE = { paid: 'good', partial: 'warn', due: 'warn', overdue: 'bad', void: '', open: 'warn', in_progress: 'info', resolved: 'good', closed: '', pending: 'warn', confirmed: 'good', rejected: 'bad', active: 'good', notice: 'info', left: '', present: 'good', absent: 'bad', leave: 'warn', half_day: 'warn', high: 'bad', normal: '', low: '' };
export function StatePill({ value, prefix = 'val' }) {
  const { tv } = useI18n();
  return <span className={`pill ${STATE_TONE[value] || ''}`}>{tv(prefix, value)}</span>;
}

/** Grouped bars: billed vs collected vs expenses per month. One scale for marks and ticks. */
export function BarChart({ data, series, height = 190, format }) {
  const W = 560, padL = 46, padB = 24, padT = 8;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const innerH = height - padB - padT, innerW = W - padL - 8;
  const band = innerW / data.length, bw = Math.min(22, (band - 14) / series.length);
  const y = (v) => padT + innerH - (v / top) * innerH;
  const ticks = [];
  for (let v = 0; v <= top + 1; v += step) ticks.push(v);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} width="100%" role="img">
        {ticks.map((v) => (<g key={v}><line className="grid-line" x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} /><text x={padL - 6} y={y(v) + 4} textAnchor="end">{short(v)}</text></g>))}
        {data.map((d, i) => (<g key={d.label}>
          {series.map((s, j) => { const v = d[s.key] || 0; const x = padL + i * band + (band - bw * series.length) / 2 + j * bw; return (<rect key={s.key} x={x} y={y(v)} width={bw - 3} height={Math.max(0, padT + innerH - y(v))} rx="2" fill={s.color}><title>{`${s.label}: ${format ? format(v) : v}`}</title></rect>); })}
          <text x={padL + i * band + band / 2} y={height - 6} textAnchor="middle">{d.label}</text>
        </g>))}
      </svg>
      <div className="legend">{series.map((s) => (<span key={s.key}><i style={{ background: s.color }} />{s.label}</span>))}</div>
    </div>
  );
}
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function short(v) { return v >= 100000 ? `${+(v / 100000).toFixed(1)}L` : v >= 1000 ? `${+(v / 1000).toFixed(0)}k` : String(v); }

export function ShareBars({ rows, format }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (<div className="stack sm">{rows.map((r) => (
    <div key={r.label}><div className="row between small"><span>{r.label}</span><span className="num">{format(r.value)}</span></div><div className="bar"><i style={{ width: `${(r.value / max) * 100}%`, background: r.color }} /></div></div>
  ))}</div>);
}

export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const set = (key) => (v) => setValues((s) => ({ ...s, [key]: v }));
  return [values, set, setValues];
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Save a text file: works in browsers; in embedded previews where downloads are blocked the caller shows the text instead. */
export function downloadText(name, text, mime = 'text/plain') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch { return false; }
}

export function toCsv(rows) {
  return rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
}
