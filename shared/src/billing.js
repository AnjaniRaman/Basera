// Billing engine: monthly invoices, electricity sharing, FIFO payment allocation, late fees and
// move-out settlement. Pure functions over the property document; the reducer calls these.
import { addDays, overlapDays, periodBounds, dateInPeriod, periodOf, compareISO } from './dates.js';

/** Rupee rounding: PG bills are settled in whole rupees. */
export const rupees = (n) => Math.round(Number(n) || 0);

export function sum(list, pick = (x) => x) {
  return list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);
}

/** Last day the tenant is charged for: leave date while on notice, exit date once left, else open-ended. */
export function tenantStayEnd(tenant) {
  if (tenant.status === 'left') return tenant.leftOn || tenant.leaveOn || null;
  if (tenant.status === 'notice') return tenant.leaveOn || null;
  return null;
}

/** Tenants whose stay overlaps the period and who live in the given room. */
export function occupantsIn(state, roomId, period) {
  return state.tenants.filter(
    (t) => t.roomId === roomId && overlapDays(period, t.joinedOn, tenantStayEnd(t)) > 0
  );
}

/** Tenants who should receive a bill for the period. */
export function eligibleTenants(state, period) {
  return state.tenants.filter((t) => overlapDays(period, t.joinedOn, tenantStayEnd(t)) > 0);
}

export function rentLineFor(tenant, period, rules) {
  const { days } = periodBounds(period);
  const stayDays = overlapDays(period, tenant.joinedOn, tenantStayEnd(tenant));
  const rent = Number(tenant.rent) || 0;
  if (rules.prorate && stayDays > 0 && stayDays < days) {
    return {
      type: 'rent',
      label: '',
      amount: rupees((rent * stayDays) / days),
      meta: { prorated: true, days: stayDays, periodDays: days, rent }
    };
  }
  return { type: 'rent', label: '', amount: rupees(rent), meta: { days, periodDays: days, rent } };
}

export function meterReadingFor(state, roomId, period) {
  return state.meterReadings.find((r) => r.roomId === roomId && r.period === period) || null;
}

/** The tenant's share of the room's electricity for the period, or null when there is nothing to bill yet. */
export function electricityLineFor(state, tenant, period, rules) {
  if (rules.electricityMode === 'none') return null;
  if (rules.electricityMode === 'flat') {
    if (!rules.electricityFlat) return null;
    return { type: 'electricity', label: '', amount: rupees(rules.electricityFlat), meta: { mode: 'flat' } };
  }
  const reading = meterReadingFor(state, tenant.roomId, period);
  if (!reading || !reading.amount) return null;
  const occupants = occupantsIn(state, tenant.roomId, period);
  const share = Math.max(1, occupants.length);
  return {
    type: 'electricity',
    label: '',
    amount: rupees(reading.amount / share),
    meta: { mode: 'meter', units: reading.units, rate: reading.rate, share, readingId: reading.id, roomAmount: reading.amount }
  };
}

export function dueDateFor(tenant, period, rules) {
  const due = dateInPeriod(period, tenant.dueDay || rules.dueDay || 5);
  // Someone who joins after the due day gets five days from joining for their first bill.
  return tenant.joinedOn > due ? addDays(tenant.joinedOn, 5) : due;
}

export function lineTotal(lines) {
  return rupees(sum(lines, (l) => l.amount));
}

export function existingInvoice(state, tenantId, period) {
  return state.invoices.find((i) => i.tenantId === tenantId && i.period === period && i.status !== 'void') || null;
}

/** Build (but do not store) the invoice a tenant would get for a period. */
export function draftInvoice(state, tenant, period, now) {
  const rules = state.property.rules;
  const lines = [rentLineFor(tenant, period, rules)];
  const electricity = electricityLineFor(state, tenant, period, rules);
  if (electricity) lines.push(electricity);
  return {
    tenantId: tenant.id,
    period,
    issuedOn: now.slice(0, 10),
    dueOn: dueDateFor(tenant, period, rules),
    lines,
    total: lineTotal(lines)
  };
}

/** Drafts for every eligible tenant who has no invoice yet for the period. */
export function draftInvoices(state, period, now, tenantIds) {
  const start = state.property.rules.billingStart;
  if (start && period < start) return [];
  const wanted = tenantIds ? new Set(tenantIds) : null;
  return eligibleTenants(state, period)
    .filter((t) => !wanted || wanted.has(t.id))
    .filter((t) => !existingInvoice(state, t.id, period))
    .map((t) => draftInvoice(state, t, period, now));
}

export function invoiceBalance(invoice) {
  if (invoice.status === 'void') return 0;
  return Math.max(0, rupees(invoice.total - (invoice.paid || 0)));
}

/** 'void' | 'paid' | 'overdue' | 'partial' | 'due' */
export function invoiceStatus(invoice, today) {
  if (invoice.status === 'void') return 'void';
  const balance = invoiceBalance(invoice);
  if (balance <= 0) return 'paid';
  if (today && compareISO(today, invoice.dueOn) > 0) return 'overdue';
  return invoice.paid > 0 ? 'partial' : 'due';
}

/** Oldest first: by due date, then issue date, then number. */
export function sortInvoices(invoices) {
  return [...invoices].sort(
    (a, b) => compareISO(a.dueOn, b.dueOn) || compareISO(a.issuedOn, b.issuedOn) || String(a.number).localeCompare(String(b.number))
  );
}

/**
 * Recompute how a tenant's confirmed rent payments cover their invoices (oldest due first).
 * Mutates invoices (`paid`) and payments (`allocations`, `unallocated`) in place.
 */
export function rebuildLedger(state, tenantId) {
  const invoices = sortInvoices(state.invoices.filter((i) => i.tenantId === tenantId && i.status !== 'void'));
  for (const inv of invoices) inv.paid = 0;
  const payments = state.payments
    .filter((p) => p.tenantId === tenantId && p.status === 'confirmed' && p.kind === 'rent')
    .sort((a, b) => compareISO(a.date, b.date) || compareISO(a.createdAt || '', b.createdAt || ''));
  for (const pay of payments) {
    let remaining = rupees(pay.amount);
    const allocations = [];
    // A payment made against a specific invoice goes there first, then spills over oldest-first.
    const ordered = pay.invoiceId
      ? [...invoices.filter((i) => i.id === pay.invoiceId), ...invoices.filter((i) => i.id !== pay.invoiceId)]
      : invoices;
    for (const inv of ordered) {
      if (remaining <= 0) break;
      const open = rupees(inv.total - inv.paid);
      if (open <= 0) continue;
      const take = Math.min(open, remaining);
      inv.paid = rupees(inv.paid + take);
      remaining = rupees(remaining - take);
      allocations.push({ invoiceId: inv.id, amount: take });
    }
    pay.allocations = allocations;
    pay.unallocated = remaining;
  }
  return invoices;
}

/** Everything the app shows about one tenant's money. */
export function tenantLedger(state, tenantId, today) {
  const invoices = sortInvoices(state.invoices.filter((i) => i.tenantId === tenantId && i.status !== 'void')).map((inv) => ({
    ...inv,
    balance: invoiceBalance(inv),
    state: invoiceStatus(inv, today)
  }));
  const payments = state.payments
    .filter((p) => p.tenantId === tenantId)
    .sort((a, b) => compareISO(b.date, a.date) || compareISO(b.createdAt || '', a.createdAt || ''));
  const confirmed = payments.filter((p) => p.status === 'confirmed');
  const credit = rupees(sum(confirmed.filter((p) => p.kind === 'rent'), (p) => p.unallocated || 0));
  const depositHeld = rupees(sum(confirmed.filter((p) => p.kind === 'deposit'), (p) => p.amount));
  const outstanding = rupees(sum(invoices, (i) => i.balance));
  const overdue = rupees(sum(invoices.filter((i) => i.state === 'overdue'), (i) => i.balance));
  const pending = payments.filter((p) => p.status === 'pending');
  const lastPayment = confirmed.find((p) => p.kind === 'rent') || null;
  return {
    invoices,
    payments,
    outstanding,
    overdue,
    credit,
    net: rupees(outstanding - credit),
    depositHeld,
    pending,
    lastPayment
  };
}

/** Late fee an invoice would attract today, or 0. */
export function lateFeeFor(invoice, rules, today) {
  if (!rules || rules.lateFeeType === 'none' || !rules.lateFeeValue) return 0;
  if (invoice.status === 'void') return 0;
  if (invoice.lines.some((l) => l.type === 'late_fee')) return 0;
  const balance = invoiceBalance(invoice);
  if (balance <= 0) return 0;
  const lastGraceDay = addDays(invoice.dueOn, rules.graceDays || 0);
  if (compareISO(today, lastGraceDay) <= 0) return 0;
  if (rules.lateFeeType === 'flat') return rupees(rules.lateFeeValue);
  return rupees((balance * rules.lateFeeValue) / 100);
}

/** Credit for unused days when a tenant leaves inside a period already billed in full. */
export function unusedRentCredit(state, tenant, leftOn) {
  const rules = state.property.rules;
  if (!rules.prorate) return null;
  const period = periodOf(leftOn);
  const invoice = existingInvoice(state, tenant.id, period);
  if (!invoice) return null;
  const rentLine = invoice.lines.find((l) => l.type === 'rent');
  if (!rentLine || invoice.lines.some((l) => l.type === 'credit' && l.label === 'unused_days')) return null;
  const { days } = periodBounds(period);
  const billedDays = rentLine.meta?.days || days; // a prorated first month was billed for fewer days
  const stayDays = overlapDays(period, tenant.joinedOn, leftOn);
  if (stayDays >= billedDays) return null;
  const credit = rupees((rentLine.amount * (billedDays - stayDays)) / billedDays);
  if (credit <= 0) return null;
  return { invoiceId: invoice.id, amount: credit, unusedDays: billedDays - stayDays, periodDays: days };
}

/** What a move-out would look like: dues after proration, deposit held, deductions and the refund. */
export function settlementPreview(state, tenant, { leftOn, deductions = [] }, today) {
  const ledger = tenantLedger(state, tenant.id, today);
  const credit = unusedRentCredit(state, tenant, leftOn);
  const dues = Math.max(0, rupees(ledger.net - (credit?.amount || 0)));
  const deductionsTotal = rupees(sum(deductions, (d) => d.amount));
  const refund = rupees(ledger.depositHeld - dues - deductionsTotal);
  return {
    leftOn,
    depositHeld: ledger.depositHeld,
    outstanding: ledger.net,
    unusedRentCredit: credit,
    dues,
    deductions,
    deductionsTotal,
    refund, // negative: the tenant still owes this much
    pendingClaims: ledger.pending.length
  };
}
