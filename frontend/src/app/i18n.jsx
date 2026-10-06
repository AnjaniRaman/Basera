// Translations and locale-aware formatting. English ships in the main bundle; the other nine
// languages load on demand. Every string in the app goes through t(), including stored values
// (t('val.' + value)) and activity entries, so changing the language changes every screen.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, Fragment, isValidElement } from 'react';
import en from '../locales/en.js';
import { prefs } from './storage.js';

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' }
];

const loaders = {
  hi: () => import('../locales/hi.js'),
  te: () => import('../locales/te.js'),
  ta: () => import('../locales/ta.js'),
  kn: () => import('../locales/kn.js'),
  ml: () => import('../locales/ml.js'),
  mr: () => import('../locales/mr.js'),
  bn: () => import('../locales/bn.js'),
  or: () => import('../locales/or.js'),
  pa: () => import('../locales/pa.js')
};

const cache = { en };
const LANG_KEY = 'basera_lang';

export function detectLanguage() {
  const saved = prefs.get(LANG_KEY);
  if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  const nav = (globalThis.navigator?.language || 'en').slice(0, 2).toLowerCase();
  return LANGUAGES.some((l) => l.code === nav) ? nav : 'en';
}

export async function loadLanguage(code) {
  if (cache[code]) return cache[code];
  const loader = loaders[code];
  if (!loader) return en;
  const mod = await loader();
  cache[code] = mod.default;
  return cache[code];
}

/** Replace {name} placeholders. Values may be React elements, in which case a fragment is returned. */
export function interpolate(template, params) {
  if (!params) return template;
  const parts = String(template).split(/(\{[a-zA-Z0-9_]+\})/g);
  let hasElement = false;
  const out = parts.map((part) => {
    const m = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
    if (!m) return part;
    const value = params[m[1]];
    if (value === undefined || value === null) return '';
    if (isValidElement(value)) hasElement = true;
    return value;
  });
  if (!hasElement) return out.join('');
  return <Fragment>{out.map((p, i) => (isValidElement(p) ? <Fragment key={i}>{p}</Fragment> : p))}</Fragment>;
}

const I18nContext = createContext(null);

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const INR2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(amount, { sign = false, decimals = false } = {}) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const body = decimals ? INR2.format(abs) : INR.format(Math.round(abs));
  const prefix = n < 0 ? '−₹' : sign && n > 0 ? '+₹' : '₹';
  return `${prefix}${body}`;
}

export function formatNumber(n) {
  return INR.format(Number(n) || 0);
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLanguage);
  const [strings, setStrings] = useState(() => cache[lang] || en);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (cache[lang]) {
      setStrings(cache[lang]);
      return undefined;
    }
    setLoading(true);
    loadLanguage(lang)
      .then((s) => {
        if (!cancelled) setStrings(s);
      })
      .catch(() => {
        if (!cancelled) setStrings(en);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  useEffect(() => {
    try {
      document.documentElement.lang = lang;
    } catch {
      /* no document */
    }
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!LANGUAGES.some((l) => l.code === code)) return;
    prefs.set(LANG_KEY, code);
    setLangState(code);
  }, []);

  const value = useMemo(() => {
    const t = (key, params) => {
      const template = strings[key] ?? en[key];
      if (template === undefined) return key;
      return interpolate(template, params);
    };
    /** Translate a stored value (payment mode, category, status…) with a safe fallback. */
    const tv = (prefix, value) => {
      if (value === undefined || value === null || value === '') return '';
      const key = `${prefix}.${value}`;
      return strings[key] ?? en[key] ?? String(value);
    };
    const monthName = (m, short = false) => t(`${short ? 'monthShort' : 'month'}.${m}`);
    const weekdayName = (d, short = false) => t(`${short ? 'weekdayShort' : 'weekday'}.${d}`);
    const formatDate = (iso, style = 'short') => {
      if (!iso) return '';
      const s = String(iso);
      const y = Number(s.slice(0, 4));
      const m = Number(s.slice(5, 7));
      const d = Number(s.slice(8, 10));
      if (!y || !m) return s;
      if (style === 'month') return `${monthName(m)} ${y}`;
      if (style === 'monthShort') return `${monthName(m, true)} ${String(y).slice(2)}`;
      if (style === 'day') return `${d} ${monthName(m, true)}`;
      if (style === 'long') return `${d} ${monthName(m)} ${y}`;
      if (style === 'weekday') {
        const date = new Date(y, m - 1, d);
        return `${weekdayName(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()])}, ${d} ${monthName(m, true)}`;
      }
      return `${d} ${monthName(m, true)} ${y}`;
    };
    const formatPeriod = (period, short = false) => {
      if (!period) return '';
      const [y, m] = String(period).split('-').map(Number);
      return short ? `${monthName(m, true)} ${String(y).slice(2)}` : `${monthName(m)} ${y}`;
    };
    const formatTime = (hhmm) => {
      if (!hhmm) return '';
      const [h, min] = hhmm.split(':').map(Number);
      const suffix = h >= 12 ? t('time.pm') : t('time.am');
      const hour = h % 12 === 0 ? 12 : h % 12;
      return `${hour}:${String(min).padStart(2, '0')} ${suffix}`;
    };
    const formatDateTime = (isoDateTime) => {
      if (!isoDateTime) return '';
      const date = new Date(isoDateTime);
      if (Number.isNaN(date.getTime())) return String(isoDateTime);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return `${formatDate(iso, 'day')}, ${formatTime(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)}`;
    };
    const formatRelative = (isoDateTime, now = Date.now()) => {
      const then = new Date(isoDateTime).getTime();
      if (Number.isNaN(then)) return '';
      const mins = Math.round((now - then) / 60000);
      if (mins < 1) return t('time.justNow');
      if (mins < 60) return t('time.minutesAgo', { n: mins });
      const hours = Math.round(mins / 60);
      if (hours < 24) return t('time.hoursAgo', { n: hours });
      const days = Math.round(hours / 24);
      if (days < 7) return t('time.daysAgo', { n: days });
      return formatDate(isoDateTime.slice(0, 10));
    };
    const plural = (key, n, params) => t(n === 1 ? `${key}.one` : `${key}.other`, { n, ...params });
    return { lang, setLang, loading, t, tv, formatDate, formatPeriod, formatTime, formatDateTime, formatRelative, formatMoney, formatNumber, plural, monthName, weekdayName };
  }, [lang, strings, loading, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
