// Calendar helpers. Everything works on plain 'YYYY-MM-DD' strings and 'YYYY-MM' periods so the
// same code runs identically in the browser, in Node and inside tests (no timezone surprises).

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for a Date (local calendar day). */
export function toISODate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse 'YYYY-MM-DD' into a local Date at midnight. */
export function fromISODate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 'YYYY-MM' period that contains a date. */
export function periodOf(iso) {
  return String(iso).slice(0, 7);
}

export function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

/** First day, last day and length of a 'YYYY-MM' period. */
export function periodBounds(period) {
  const [y, m] = period.split('-').map(Number);
  const days = daysInMonth(y, m);
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(days)}`, days, year: y, month: m };
}

/** Period n months after (or before, when negative) the given one. */
export function shiftPeriod(period, n) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Inclusive list of periods from `from` to `to`. */
export function periodRange(from, to) {
  const out = [];
  let p = from;
  while (p <= to) {
    out.push(p);
    p = shiftPeriod(p, 1);
  }
  return out;
}

/** A 'YYYY-MM-DD' for the given day of a period, clamped to the month length (31st → 30th in April). */
export function dateInPeriod(period, day) {
  const { year, month, days } = periodBounds(period);
  return `${year}-${pad(month)}-${pad(Math.min(Math.max(1, day), days))}`;
}

export function addDays(iso, n) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a, b) {
  const ms = fromISODate(b).getTime() - fromISODate(a).getTime();
  return Math.round(ms / 86400000);
}

export function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxISO(a, b) {
  return a > b ? a : b;
}

export function minISO(a, b) {
  return a < b ? a : b;
}

/** Days of a period during which a stay [joinedOn, leftOn] overlaps; 0 when none. */
export function overlapDays(period, joinedOn, leftOn) {
  const { start, end } = periodBounds(period);
  const from = joinedOn && joinedOn > start ? joinedOn : start;
  const to = leftOn && leftOn < end ? leftOn : end;
  if (from > to) return 0;
  return diffDays(from, to) + 1;
}

/** 0 = Sunday … 6 = Saturday for a 'YYYY-MM-DD'. */
export function weekdayOf(iso) {
  return fromISODate(iso).getDay();
}

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function weekdayKey(iso) {
  return WEEKDAY_KEYS[weekdayOf(iso)];
}
