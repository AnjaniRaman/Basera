// Read-side helpers: everything the screens show is derived here from the property document,
// so the owner dashboard, the tenant portal and the reports always agree with the ledger.
import { periodOf, shiftPeriod, periodBounds, diffDays, weekdayKey, compareISO } from './dates.js';
import { rupees, sum, invoiceBalance, invoiceStatus, tenantLedger, sortInvoices } from './billing.js';
import { bedLabels, isLiving } from './reducer.js';

export const livingTenants = (state) => state.tenants.filter(isLiving);
export const activeStaff = (state) => state.staff.filter((s) => s.active);

export function occupancy(state) {
  const rooms = state.rooms;
  const beds = sum(rooms, (r) => r.beds);
  const living = livingTenants(state);
  const occupied = living.filter((t) => rooms.some((r) => r.id === t.roomId)).length;
  const onNotice = living.filter((t) => t.status === 'notice').length;
  return {
    rooms: rooms.length,
    beds,
    occupied,
    vacant: Math.max(0, beds - occupied),
    onNotice,
    rate: beds ? Math.round((occupied / beds) * 100) : 0
  };
}

/** Rooms grouped by floor, each bed with its occupant, for the room map. */
export function roomMap(state, today) {
  const living = livingTenants(state);
  const byFloor = new Map();
  const sorted = [...state.rooms].sort((a, b) => a.floor - b.floor || a.number.localeCompare(b.number, undefined, { numeric: true }));
  for (const room of sorted) {
    const occupants = living.filter((t) => t.roomId === room.id);
    const beds = bedLabels(room.beds).map((label) => {
      const tenant = occupants.find((t) => t.bed === label) || null;
      return { label, tenant, ledger: tenant ? tenantLedger(state, tenant.id, today) : null };
    });
    const view = { ...room, occupants, beds, vacant: room.beds - occupants.length, full: occupants.length >= room.beds };
    if (!byFloor.has(room.floor)) byFloor.set(room.floor, []);
    byFloor.get(room.floor).push(view);
  }
  return [...byFloor.entries()].map(([floor, rooms]) => ({ floor, rooms }));
}

/** Money figures for one calendar month. */
export function monthSummary(state, period, today) {
  const invoices = state.invoices.filter((i) => i.period === period && i.status !== 'void');
  const billed = rupees(sum(invoices, (i) => i.total));
  const collectedInPeriod = rupees(
    sum(state.payments.filter((p) => p.status === 'confirmed' && p.kind === 'rent' && periodOf(p.date) === period), (p) => p.amount)
  );
  const paidAgainstPeriod = rupees(sum(invoices, (i) => i.paid || 0));
  const outstanding = rupees(sum(invoices, (i) => invoiceBalance(i)));
  const deposits = rupees(sum(state.payments.filter((p) => p.status === 'confirmed' && p.kind === 'deposit' && periodOf(p.date) === period), (p) => p.amount));
  const refunds = rupees(sum(state.settlements.filter((s) => periodOf(s.leftOn) === period && s.refund > 0), (s) => s.refund));
  const expenses = rupees(sum(state.expenses.filter((e) => periodOf(e.date) === period), (e) => e.amount));
  const allOverdue = rupees(sum(state.invoices.filter((i) => invoiceStatus(i, today) === 'overdue'), (i) => invoiceBalance(i)));
  return {
    period,
    billed,
    collected: collectedInPeriod,
    paidAgainstPeriod,
    outstanding,
    collectionRate: billed ? Math.min(100, Math.round((paidAgainstPeriod / billed) * 100)) : 0,
    deposits,
    refunds,
    expenses,
    net: rupees(collectedInPeriod - expenses),
    overdueAll: allOverdue,
    invoiceCount: invoices.length,
    paidCount: invoices.filter((i) => invoiceBalance(i) <= 0).length
  };
}

/** Every tenant who owes money, worst first. */
export function duesList(state, today) {
  const rows = [];
  for (const tenant of state.tenants) {
    const ledger = tenantLedger(state, tenant.id, today);
    if (ledger.net <= 0) continue;
    const open = ledger.invoices.filter((i) => i.balance > 0);
    const oldest = open[0];
    const daysLate = oldest ? Math.max(0, diffDays(oldest.dueOn, today)) : 0;
    const room = state.rooms.find((r) => r.id === tenant.roomId);
    rows.push({ tenant, room, outstanding: ledger.net, overdue: ledger.overdue, oldestDue: oldest?.dueOn || null, daysLate, openInvoices: open.length });
  }
  return rows.sort((a, b) => b.daysLate - a.daysLate || b.outstanding - a.outstanding);
}

export function duesAging(state, today) {
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_plus: 0 };
  for (const inv of state.invoices) {
    const balance = invoiceBalance(inv);
    if (balance <= 0) continue;
    const late = diffDays(inv.dueOn, today);
    if (late <= 0) buckets.current += balance;
    else if (late <= 30) buckets.d1_30 += balance;
    else if (late <= 60) buckets.d31_60 += balance;
    else buckets.d61_plus += balance;
  }
  return buckets;
}

/** Last n months of billed / collected / expenses for the charts. */
export function monthlyTrend(state, today, n = 6) {
  const current = periodOf(today);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const period = shiftPeriod(current, -i);
    const s = monthSummary(state, period, today);
    out.push({ period, billed: s.billed, collected: s.collected, expenses: s.expenses, net: s.net });
  }
  return out;
}

export function expenseBreakdown(state, period) {
  const totals = new Map();
  for (const e of state.expenses) {
    if (period && periodOf(e.date) !== period) continue;
    totals.set(e.category, rupees((totals.get(e.category) || 0) + e.amount));
  }
  return [...totals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

export function collectionsByMode(state, period) {
  const totals = new Map();
  for (const p of state.payments) {
    if (p.status !== 'confirmed' || p.kind !== 'rent') continue;
    if (period && periodOf(p.date) !== period) continue;
    totals.set(p.mode, rupees((totals.get(p.mode) || 0) + p.amount));
  }
  return [...totals.entries()].map(([mode, amount]) => ({ mode, amount })).sort((a, b) => b.amount - a.amount);
}

export const pendingClaims = (state) => state.payments.filter((p) => p.status === 'pending');
export const openRequests = (state) => state.requests.filter((r) => r.status === 'open' || r.status === 'in_progress');

export function activeNotices(state, today, audience) {
  return state.notices
    .filter((n) => !n.expiresOn || compareISO(n.expiresOn, today) >= 0)
    .filter((n) => !audience || n.audience === 'all' || n.audience === audience)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || compareISO(b.postedAt, a.postedAt));
}

/** Who is eating: residents on that date minus those who opted out. */
export function headcount(state, date, meal) {
  const residents = state.tenants.filter((t) => isLiving(t) || (t.leftOn && t.leftOn >= date));
  const skipped = state.mealSkips.filter((s) => s.date === date && s.meal === meal && residents.some((t) => t.id === s.tenantId));
  return { total: residents.length, skipped: skipped.length, eating: residents.length - skipped.length };
}

export function menuFor(state, date) {
  const key = weekdayKey(date);
  return { day: key, ...(state.menu[key] || { breakfast: '', lunch: '', dinner: '' }) };
}

export function staffAttendanceOn(state, date) {
  return activeStaff(state).map((member) => ({
    member,
    record: state.attendance.find((a) => a.staffId === member.id && a.date === date) || null
  }));
}

export function attendanceSummary(state, staffId, period) {
  const records = state.attendance.filter((a) => a.staffId === staffId && periodOf(a.date) === period);
  const count = (status) => records.filter((a) => a.status === status).length;
  return { present: count('present'), absent: count('absent'), leave: count('leave'), halfDay: count('half_day'), records };
}

/** Tasks a staff member should see for a date, with completion. */
export function tasksFor(state, member, date) {
  const day = weekdayKey(date);
  return state.tasks
    .filter((t) => (t.staffId ? t.staffId === member.id : t.role === 'all' || t.role === member.role))
    .filter((t) => !t.days || t.days.includes(day))
    .map((t) => ({ ...t, log: state.taskLogs.find((l) => l.taskId === t.id && l.date === date) || null }))
    .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}

export function salaryStatus(state, member, period) {
  return state.salaryPayments.find((s) => s.staffId === member.id && s.period === period) || null;
}

/** Everything the tenant's home screen needs. */
export function tenantOverview(state, tenantId, today) {
  const tenant = state.tenants.find((t) => t.id === tenantId);
  if (!tenant) return null;
  const room = state.rooms.find((r) => r.id === tenant.roomId) || null;
  const roommates = livingTenants(state).filter((t) => t.roomId === tenant.roomId && t.id !== tenant.id);
  const ledger = tenantLedger(state, tenant.id, today);
  const openInvoices = ledger.invoices.filter((i) => i.balance > 0);
  const nextDue = openInvoices[0] || null;
  const currentPeriod = periodOf(today);
  const currentInvoice = ledger.invoices.find((i) => i.period === currentPeriod) || null;
  return { tenant, room, roommates, ledger, nextDue, currentInvoice, openInvoices };
}

/** Invoices of one period with their tenant and status, for the billing screen. */
export function invoicesForPeriod(state, period, today) {
  return sortInvoices(state.invoices.filter((i) => i.period === period)).map((inv) => ({
    ...inv,
    tenant: state.tenants.find((t) => t.id === inv.tenantId) || null,
    room: state.rooms.find((r) => r.id === (state.tenants.find((t) => t.id === inv.tenantId) || {}).roomId) || null,
    balance: invoiceBalance(inv),
    state: invoiceStatus(inv, today)
  }));
}

/** Periods that have at least one invoice, newest first, always including the current one. */
export function billingPeriods(state, today) {
  const set = new Set(state.invoices.map((i) => i.period));
  set.add(periodOf(today));
  return [...set].sort((a, b) => (a < b ? 1 : -1));
}

/** Tenants without an invoice for the period (eligible or not), so the owner sees who is missing. */
export function unbilledTenants(state, period) {
  return livingTenants(state).filter((t) => !state.invoices.some((i) => i.tenantId === t.id && i.period === period && i.status !== 'void'));
}

export function profitAndLoss(state, from, to, today) {
  const rows = [];
  let period = from;
  while (period <= to) {
    rows.push(monthSummary(state, period, today));
    period = shiftPeriod(period, 1);
  }
  return {
    rows,
    totals: {
      billed: rupees(sum(rows, (r) => r.billed)),
      collected: rupees(sum(rows, (r) => r.collected)),
      expenses: rupees(sum(rows, (r) => r.expenses)),
      net: rupees(sum(rows, (r) => r.net)),
      deposits: rupees(sum(rows, (r) => r.deposits)),
      refunds: rupees(sum(rows, (r) => r.refunds))
    }
  };
}

/** Residents arriving (joined) and leaving per month over the last n months. */
export function churn(state, today, n = 6) {
  const current = periodOf(today);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const period = shiftPeriod(current, -i);
    out.push({
      period,
      joined: state.tenants.filter((t) => periodOf(t.joinedOn) === period).length,
      left: state.tenants.filter((t) => t.leftOn && periodOf(t.leftOn) === period).length
    });
  }
  return out;
}

export function daysLeftInPeriod(today) {
  const { end } = periodBounds(periodOf(today));
  return diffDays(today, end);
}
