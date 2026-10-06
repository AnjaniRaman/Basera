// The reducer: every change to a property document goes through `applyCommand`, in the browser
// (device mode) and on the API (online accounts) alike. It validates the payload, checks the
// actor's role, applies the business rules and appends to the activity log.
import { COMMANDS, validatePayload } from './schema.js';
import { DomainError, fail, assert } from './errors.js';
import { cloneState } from './state.js';
import { periodOf, periodBounds, overlapDays, compareISO, addDays } from './dates.js';
import { invoiceNumber, receiptNumber, requestNumber, settlementNumber, slipNumber } from './ids.js';
import {
  rupees, sum, draftInvoices, existingInvoice, lineTotal, rebuildLedger, tenantLedger, lateFeeFor,
  electricityLineFor, occupantsIn, unusedRentCredit, tenantStayEnd
} from './billing.js';

const OWNER = ['owner'];
const OWNER_STAFF = ['owner', 'staff'];
const OWNER_TENANT = ['owner', 'tenant'];
const EVERYONE = ['owner', 'tenant', 'staff'];

/** Which roles may issue each command. Handlers add finer "only about yourself" checks. */
export const PERMISSIONS = {
  'property.update': OWNER,
  'room.add': OWNER, 'room.addMany': OWNER, 'room.update': OWNER, 'room.remove': OWNER,
  'tenant.add': OWNER, 'tenant.update': OWNER, 'tenant.move': OWNER, 'tenant.giveNotice': OWNER_TENANT,
  'tenant.cancelNotice': OWNER_TENANT, 'tenant.settle': OWNER, 'tenant.reactivate': OWNER,
  'billing.generate': OWNER, 'billing.addLine': OWNER, 'billing.removeLine': OWNER, 'billing.updateDue': OWNER,
  'billing.void': OWNER, 'billing.applyLateFees': OWNER,
  'meter.record': OWNER_STAFF, 'meter.remove': OWNER,
  'payment.record': OWNER, 'payment.claim': ['tenant'], 'payment.confirm': OWNER, 'payment.reject': OWNER, 'payment.delete': OWNER,
  'expense.add': OWNER, 'expense.update': OWNER, 'expense.remove': OWNER,
  'staff.add': OWNER, 'staff.update': OWNER, 'staff.remove': OWNER, 'staff.paySalary': OWNER,
  'attendance.mark': OWNER, 'attendance.checkIn': ['staff'], 'attendance.checkOut': ['staff'],
  'task.add': OWNER, 'task.update': OWNER, 'task.remove': OWNER, 'task.toggle': OWNER_STAFF,
  'request.create': OWNER_TENANT, 'request.update': EVERYONE, 'request.comment': EVERYONE,
  'notice.post': OWNER, 'notice.update': OWNER, 'notice.remove': OWNER, 'notice.ack': ['tenant', 'staff'],
  'menu.update': OWNER_STAFF, 'menu.replace': OWNER_STAFF, 'meal.skip': OWNER_TENANT,
  'document.add': EVERYONE, 'document.remove': EVERYONE,
  'activity.clear': OWNER
};

export function canPerform(type, role) {
  return (PERMISSIONS[type] || []).includes(role);
}

export const BED_LABELS = 'ABCDEFGHIJKL'.split('');

export function bedLabels(count) {
  return BED_LABELS.slice(0, Math.max(0, Math.min(12, count)));
}

export function isLiving(tenant) {
  return tenant.status === 'active' || tenant.status === 'notice';
}

const ACTIVITY_LIMIT = 300;

function find(list, id, code = 'not_found') {
  const item = list.find((x) => x.id === id);
  if (!item) fail(code, { id });
  return item;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function newLine(api, line) {
  return { id: api.id('ln'), type: line.type, label: line.label || '', amount: rupees(line.amount), meta: line.meta || {} };
}

function recomputeInvoice(invoice) {
  invoice.total = lineTotal(invoice.lines);
  assert(invoice.total >= 0, 'invalid_input', { field: 'total' });
}

function occupantOfBed(state, roomId, bed, exceptId) {
  return state.tenants.find((t) => t.roomId === roomId && t.bed === bed && isLiving(t) && t.id !== exceptId) || null;
}

function assertBedFree(state, room, bed, exceptId) {
  assert(bedLabels(room.beds).includes(bed), 'invalid_bed', { bed, beds: room.beds });
  const taken = occupantOfBed(state, room.id, bed, exceptId);
  if (taken) fail('bed_occupied', { bed, room: room.number, tenant: taken.name });
}

function assertUniquePhone(state, phone, exceptId) {
  const clash = state.tenants.find((t) => t.phone === phone && isLiving(t) && t.id !== exceptId);
  if (clash) fail('duplicate_phone', { name: clash.name });
}

function pushInvoice(api, draft, kind = 'monthly') {
  const { state } = api;
  state.seq.invoice += 1;
  const invoice = {
    id: api.id('inv'),
    number: invoiceNumber(draft.period, state.seq.invoice),
    kind,
    tenantId: draft.tenantId,
    period: draft.period,
    issuedOn: draft.issuedOn,
    dueOn: draft.dueOn,
    lines: draft.lines.map((l) => newLine(api, l)),
    total: 0,
    paid: 0,
    status: 'open',
    createdAt: api.ctx.now
  };
  recomputeInvoice(invoice);
  state.invoices.push(invoice);
  return invoice;
}

function pushPayment(api, fields) {
  const { state } = api;
  const confirmed = fields.status === 'confirmed';
  if (confirmed) state.seq.receipt += 1;
  const payment = {
    id: api.id('pay'),
    number: confirmed ? receiptNumber(state.seq.receipt) : null,
    kind: 'rent',
    source: 'owner',
    reference: '',
    note: '',
    invoiceId: null,
    allocations: [],
    unallocated: 0,
    createdAt: api.ctx.now,
    confirmedAt: confirmed ? api.ctx.now : null,
    ...fields
  };
  payment.amount = rupees(payment.amount);
  state.payments.push(payment);
  if (payment.kind === 'rent' && payment.status === 'confirmed') rebuildLedger(state, payment.tenantId);
  return payment;
}

/** Refresh the electricity line on every open invoice of a room for a period (after a meter reading changes). */
function refreshElectricity(api, roomId, period) {
  const { state } = api;
  const rules = state.property.rules;
  for (const tenant of occupantsIn(state, roomId, period)) {
    const invoice = existingInvoice(state, tenant.id, period);
    if (!invoice || invoice.kind !== 'monthly') continue;
    const line = electricityLineFor(state, tenant, period, rules);
    const idx = invoice.lines.findIndex((l) => l.type === 'electricity');
    if (line && idx >= 0) invoice.lines[idx] = { ...invoice.lines[idx], amount: line.amount, meta: line.meta };
    else if (line) invoice.lines.push(newLine(api, line));
    else if (idx >= 0) invoice.lines.splice(idx, 1);
    recomputeInvoice(invoice);
    rebuildLedger(state, tenant.id);
  }
}

function selfTenant(api) {
  const { actor } = api.ctx;
  if (actor.role !== 'tenant') return null;
  const tenant = api.state.tenants.find((t) => t.id === actor.refId);
  if (!tenant) fail('forbidden');
  return tenant;
}

function selfStaff(api) {
  const { actor } = api.ctx;
  if (actor.role !== 'staff') return null;
  const member = api.state.staff.find((s) => s.id === actor.refId);
  if (!member) fail('forbidden');
  return member;
}

const HANDLERS = {
  'property.update'(api, p) {
    const { state } = api;
    const { rules, ...rest } = p;
    state.property = { ...state.property, ...rest, rules: { ...state.property.rules, ...(rules || {}) } };
    api.log('property.updated', {});
  },

  'room.add'(api, p) {
    const { state } = api;
    if (state.rooms.some((r) => r.number.toLowerCase() === p.number.toLowerCase())) fail('room_exists', { number: p.number });
    const room = { id: api.id('room'), ...p, createdAt: api.ctx.now };
    state.rooms.push(room);
    api.log('room.added', { room: room.number });
    return { roomId: room.id };
  },

  'room.addMany'(api, p) {
    const { state } = api;
    const existing = new Set(state.rooms.map((r) => r.number.toLowerCase()));
    const created = [];
    for (let f = 0; f < p.floors; f++) {
      const floor = p.startFloor + f;
      for (let i = 1; i <= p.roomsPerFloor; i++) {
        const number = `${floor === 0 ? 'G' : floor}${pad2(i)}`;
        if (existing.has(number.toLowerCase())) {
          if (p.skipExisting) continue;
          fail('room_exists', { number });
        }
        const room = {
          id: api.id('room'), number, floor, beds: p.beds, rent: p.rent, ac: false, attachedBath: false,
          meterNumber: '', notes: '', createdAt: api.ctx.now
        };
        state.rooms.push(room);
        created.push(room.id);
      }
    }
    api.log('room.addedMany', { count: created.length });
    return { roomIds: created };
  },

  'room.update'(api, p) {
    const { state } = api;
    const { roomId, ...changes } = p;
    const room = find(state.rooms, roomId);
    if (changes.number && changes.number.toLowerCase() !== room.number.toLowerCase()) {
      if (state.rooms.some((r) => r.number.toLowerCase() === changes.number.toLowerCase())) fail('room_exists', { number: changes.number });
    }
    if (changes.beds !== undefined) {
      const living = state.tenants.filter((t) => t.roomId === roomId && isLiving(t));
      const outside = living.filter((t) => !bedLabels(changes.beds).includes(t.bed));
      if (outside.length) fail('room_has_more_tenants', { count: living.length, beds: changes.beds });
    }
    Object.assign(room, changes);
    api.log('room.updated', { room: room.number });
  },

  'room.remove'(api, p) {
    const { state } = api;
    const room = find(state.rooms, p.roomId);
    if (state.tenants.some((t) => t.roomId === room.id && isLiving(t))) fail('room_occupied', { room: room.number });
    state.rooms = state.rooms.filter((r) => r.id !== room.id);
    state.meterReadings = state.meterReadings.filter((m) => m.roomId !== room.id);
    api.log('room.removed', { room: room.number });
  },

  'tenant.add'(api, p) {
    const { state } = api;
    const { depositPaid, depositMode, ...fields } = p;
    const room = find(state.rooms, fields.roomId, 'room_not_found');
    assertBedFree(state, room, fields.bed);
    assertUniquePhone(state, fields.phone);
    const tenant = {
      id: api.id('ten'), ...fields, status: 'active', leaveOn: null, leftOn: null, noticeOn: null,
      createdAt: api.ctx.now
    };
    state.tenants.push(tenant);
    if (depositPaid > 0) {
      pushPayment(api, {
        tenantId: tenant.id, amount: depositPaid, date: fields.joinedOn <= api.today ? fields.joinedOn : api.today,
        mode: depositMode || 'cash', kind: 'deposit', status: 'confirmed', collectedBy: api.ctx.actor.name || ''
      });
    }
    api.log('tenant.joined', { tenant: tenant.name, room: room.number, bed: tenant.bed });
    return { tenantId: tenant.id };
  },

  'tenant.update'(api, p) {
    const { state } = api;
    const { tenantId, ...changes } = p;
    const tenant = find(state.tenants, tenantId);
    if (changes.phone && changes.phone !== tenant.phone) assertUniquePhone(state, changes.phone, tenant.id);
    const roomId = changes.roomId || tenant.roomId;
    const bed = changes.bed || tenant.bed;
    if ((roomId !== tenant.roomId || bed !== tenant.bed) && isLiving(tenant)) {
      const room = find(state.rooms, roomId, 'room_not_found');
      assertBedFree(state, room, bed, tenant.id);
    }
    Object.assign(tenant, changes);
    api.log('tenant.updated', { tenant: tenant.name });
  },

  'tenant.move'(api, p) {
    const { state } = api;
    const tenant = find(state.tenants, p.tenantId);
    assert(isLiving(tenant), 'tenant_not_active');
    const room = find(state.rooms, p.roomId, 'room_not_found');
    assertBedFree(state, room, p.bed, tenant.id);
    const from = state.rooms.find((r) => r.id === tenant.roomId);
    tenant.roomId = room.id;
    tenant.bed = p.bed;
    if (p.rent !== undefined) tenant.rent = p.rent;
    api.log('tenant.moved', { tenant: tenant.name, from: from?.number || '', to: room.number, bed: p.bed });
  },

  'tenant.giveNotice'(api, p) {
    const { state } = api;
    const self = selfTenant(api);
    const tenant = self ? self : find(state.tenants, p.tenantId);
    if (self && self.id !== p.tenantId) fail('forbidden');
    assert(tenant.status === 'active', 'tenant_not_active');
    assert(compareISO(p.leaveOn, tenant.joinedOn) >= 0, 'invalid_input', { field: 'leaveOn' });
    tenant.status = 'notice';
    tenant.leaveOn = p.leaveOn;
    tenant.noticeOn = api.today;
    tenant.noticeReason = p.reason || '';
    tenant.noticeBy = api.ctx.actor.role;
    api.log('tenant.notice', { tenant: tenant.name, leaveOn: p.leaveOn });
  },

  'tenant.cancelNotice'(api, p) {
    const { state } = api;
    const self = selfTenant(api);
    const tenant = self ? self : find(state.tenants, p.tenantId);
    if (self && self.id !== p.tenantId) fail('forbidden');
    assert(tenant.status === 'notice', 'tenant_not_on_notice');
    tenant.status = 'active';
    tenant.leaveOn = null;
    tenant.noticeOn = null;
    tenant.noticeReason = '';
    api.log('tenant.noticeCancelled', { tenant: tenant.name });
  },

  'tenant.settle'(api, p) {
    const { state } = api;
    const tenant = find(state.tenants, p.tenantId);
    assert(isLiving(tenant), 'tenant_not_active');
    assert(compareISO(p.leftOn, tenant.joinedOn) >= 0, 'invalid_input', { field: 'leftOn' });
    const ledgerBefore = tenantLedger(state, tenant.id, api.today);
    if (ledgerBefore.pending.length) fail('claims_pending', { count: ledgerBefore.pending.length });

    // 1. Credit the unused days of a month that was already billed in full.
    const credit = unusedRentCredit(state, tenant, p.leftOn);
    if (credit) {
      const invoice = find(state.invoices, credit.invoiceId);
      invoice.lines.push(newLine(api, { type: 'credit', label: 'unused_days', amount: -credit.amount, meta: { unusedDays: credit.unusedDays, periodDays: credit.periodDays } }));
      recomputeInvoice(invoice);
    }

    // 2. Close the stay, then bill any period of the stay that was never invoiced (prorated to the exit date).
    tenant.status = 'left';
    tenant.leftOn = p.leftOn;
    if (!tenant.leaveOn) tenant.leaveOn = p.leftOn;
    const billingStart = state.property.rules.billingStart || periodOf(state.createdAt);
    const firstPeriod = periodOf(tenant.joinedOn) > billingStart ? periodOf(tenant.joinedOn) : billingStart;
    const lastPeriod = periodOf(p.leftOn);
    let period = firstPeriod;
    while (period <= lastPeriod) {
      if (!existingInvoice(state, tenant.id, period) && overlapDays(period, tenant.joinedOn, p.leftOn) > 0) {
        for (const draft of draftInvoices(state, period, api.ctx.now, [tenant.id])) pushInvoice(api, draft);
      }
      const { year, month } = periodBounds(period);
      period = `${month === 12 ? year + 1 : year}-${pad2(month === 12 ? 1 : month + 1)}`;
    }
    rebuildLedger(state, tenant.id);

    // 3. Settle dues from the deposit, record deductions and the refund.
    const ledger = tenantLedger(state, tenant.id, api.today);
    const depositAdjusted = Math.min(ledger.net, ledger.depositHeld);
    if (depositAdjusted > 0) {
      pushPayment(api, {
        tenantId: tenant.id, amount: depositAdjusted, date: p.leftOn, mode: 'deposit', kind: 'rent',
        status: 'confirmed', note: 'deposit_adjusted', collectedBy: api.ctx.actor.name || ''
      });
    }
    const deductionsTotal = rupees(sum(p.deductions, (d) => d.amount));
    // Positive: pay this back to the resident. Negative: the resident still owes this much.
    const refund = rupees(ledger.depositHeld - ledger.net - deductionsTotal);
    state.seq.settlement += 1;
    const settlement = {
      id: api.id('stl'),
      number: settlementNumber(state.seq.settlement),
      tenantId: tenant.id,
      leftOn: p.leftOn,
      depositHeld: ledger.depositHeld,
      duesBefore: ledger.net,
      unusedRentCredit: credit ? credit.amount : 0,
      depositAdjusted,
      deductions: p.deductions,
      deductionsTotal,
      refund,
      refundMode: refund > 0 ? p.refundMode : null,
      refundReference: p.refundReference || '',
      note: p.note || '',
      createdAt: api.ctx.now
    };
    state.settlements.push(settlement);
    tenant.settlementId = settlement.id;
    api.log('tenant.left', { tenant: tenant.name, refund });
    return { settlementId: settlement.id, refund };
  },

  'tenant.reactivate'(api, p) {
    const { state } = api;
    const tenant = find(state.tenants, p.tenantId);
    assert(tenant.status === 'left', 'tenant_not_left');
    const room = find(state.rooms, tenant.roomId, 'room_not_found');
    assertBedFree(state, room, tenant.bed, tenant.id);
    assertUniquePhone(state, tenant.phone, tenant.id);
    tenant.status = 'active';
    tenant.leftOn = null;
    tenant.leaveOn = null;
    tenant.settlementId = null;
    api.log('tenant.reactivated', { tenant: tenant.name });
  },

  'billing.generate'(api, p) {
    const { state } = api;
    const drafts = draftInvoices(state, p.period, api.ctx.now, p.tenantIds);
    const created = drafts.map((d) => pushInvoice(api, d));
    for (const inv of created) rebuildLedger(state, inv.tenantId);
    const total = rupees(sum(created, (i) => i.total));
    if (created.length) api.log('billing.generated', { period: p.period, count: created.length, total });
    return { invoiceIds: created.map((i) => i.id), count: created.length, total };
  },

  'billing.addLine'(api, p) {
    const { state } = api;
    const invoice = find(state.invoices, p.invoiceId);
    assert(invoice.status !== 'void', 'invoice_void');
    const amount = p.line.type === 'discount' || p.line.type === 'credit' ? -Math.abs(p.line.amount) : Math.abs(p.line.amount);
    invoice.lines.push(newLine(api, { ...p.line, amount }));
    recomputeInvoice(invoice);
    rebuildLedger(state, invoice.tenantId);
    api.log('billing.lineAdded', { invoice: invoice.number, amount });
  },

  'billing.removeLine'(api, p) {
    const { state } = api;
    const invoice = find(state.invoices, p.invoiceId);
    assert(invoice.status !== 'void', 'invoice_void');
    const before = invoice.lines.length;
    invoice.lines = invoice.lines.filter((l) => l.id !== p.lineId);
    assert(invoice.lines.length < before, 'not_found', { id: p.lineId });
    recomputeInvoice(invoice);
    rebuildLedger(state, invoice.tenantId);
  },

  'billing.updateDue'(api, p) {
    const invoice = find(api.state.invoices, p.invoiceId);
    invoice.dueOn = p.dueOn;
  },

  'billing.void'(api, p) {
    const { state } = api;
    const invoice = find(state.invoices, p.invoiceId);
    invoice.status = 'void';
    invoice.voidReason = p.reason || '';
    invoice.voidedAt = api.ctx.now;
    rebuildLedger(state, invoice.tenantId);
    api.log('billing.voided', { invoice: invoice.number });
  },

  'billing.applyLateFees'(api, p) {
    const { state } = api;
    const rules = state.property.rules;
    const wanted = p.invoiceIds ? new Set(p.invoiceIds) : null;
    let count = 0;
    let total = 0;
    for (const invoice of state.invoices) {
      if (wanted && !wanted.has(invoice.id)) continue;
      if (p.period && invoice.period !== p.period) continue;
      const fee = lateFeeFor(invoice, rules, api.today);
      if (!fee) continue;
      invoice.lines.push(newLine(api, { type: 'late_fee', label: '', amount: fee, meta: { appliedOn: api.today } }));
      recomputeInvoice(invoice);
      rebuildLedger(state, invoice.tenantId);
      count += 1;
      total += fee;
    }
    if (count) api.log('billing.lateFees', { count, total });
    return { count, total };
  },

  'meter.record'(api, p) {
    const { state } = api;
    const room = find(state.rooms, p.roomId, 'room_not_found');
    assert(p.current >= p.previous, 'reading_backwards', { previous: p.previous, current: p.current });
    const rate = p.rate ?? state.property.rules.electricityRate;
    const units = Math.round((p.current - p.previous) * 100) / 100;
    const existing = state.meterReadings.find((r) => r.roomId === room.id && r.period === p.period);
    const reading = existing || { id: api.id('mtr'), roomId: room.id, period: p.period, createdAt: api.ctx.now };
    Object.assign(reading, { previous: p.previous, current: p.current, units, rate, amount: rupees(units * rate), readOn: p.readOn || api.today, by: api.ctx.actor.name || '' });
    if (!existing) state.meterReadings.push(reading);
    refreshElectricity(api, room.id, p.period);
    api.log('meter.recorded', { room: room.number, units, amount: reading.amount });
    return { readingId: reading.id, units, amount: reading.amount };
  },

  'meter.remove'(api, p) {
    const { state } = api;
    state.meterReadings = state.meterReadings.filter((r) => !(r.roomId === p.roomId && r.period === p.period));
    refreshElectricity(api, p.roomId, p.period);
  },

  'payment.record'(api, p) {
    const { state } = api;
    const tenant = find(state.tenants, p.tenantId, 'tenant_not_found');
    if (p.invoiceId) find(state.invoices, p.invoiceId);
    const payment = pushPayment(api, { ...p, status: 'confirmed', source: 'owner', collectedBy: api.ctx.actor.name || '' });
    api.log(p.kind === 'deposit' ? 'payment.deposit' : 'payment.received', { tenant: tenant.name, amount: payment.amount, mode: p.mode, receipt: payment.number });
    return { paymentId: payment.id, number: payment.number };
  },

  'payment.claim'(api, p) {
    const { state } = api;
    const tenant = selfTenant(api);
    if (state.payments.some((x) => x.tenantId === tenant.id && x.status === 'pending')) fail('claim_pending');
    const payment = pushPayment(api, {
      tenantId: tenant.id, amount: p.amount, date: api.today, mode: p.mode, reference: p.reference, note: p.note,
      invoiceId: p.invoiceId || null, status: 'pending', source: 'tenant'
    });
    api.log('payment.claimed', { tenant: tenant.name, amount: payment.amount, reference: p.reference });
    return { paymentId: payment.id };
  },

  'payment.confirm'(api, p) {
    const { state } = api;
    const payment = find(state.payments, p.paymentId);
    assert(payment.status === 'pending', 'payment_not_pending');
    const tenant = find(state.tenants, payment.tenantId, 'tenant_not_found');
    if (p.amount !== undefined) payment.amount = rupees(p.amount);
    if (p.reference !== undefined) payment.reference = p.reference;
    state.seq.receipt += 1;
    payment.number = receiptNumber(state.seq.receipt);
    payment.status = 'confirmed';
    payment.confirmedAt = api.ctx.now;
    payment.collectedBy = api.ctx.actor.name || '';
    rebuildLedger(state, tenant.id);
    api.log('payment.confirmed', { tenant: tenant.name, amount: payment.amount, receipt: payment.number });
    return { number: payment.number };
  },

  'payment.reject'(api, p) {
    const { state } = api;
    const payment = find(state.payments, p.paymentId);
    assert(payment.status === 'pending', 'payment_not_pending');
    payment.status = 'rejected';
    payment.rejectedAt = api.ctx.now;
    payment.rejectReason = p.reason || '';
    const tenant = state.tenants.find((t) => t.id === payment.tenantId);
    api.log('payment.rejected', { tenant: tenant?.name || '', amount: payment.amount });
  },

  'payment.delete'(api, p) {
    const { state } = api;
    const payment = find(state.payments, p.paymentId);
    assert(payment.mode !== 'deposit', 'payment_locked');
    state.payments = state.payments.filter((x) => x.id !== payment.id);
    rebuildLedger(state, payment.tenantId);
    const tenant = state.tenants.find((t) => t.id === payment.tenantId);
    api.log('payment.deleted', { tenant: tenant?.name || '', amount: payment.amount });
  },

  'expense.add'(api, p) {
    const { state } = api;
    const expense = { id: api.id('exp'), ...p, createdAt: api.ctx.now };
    state.expenses.push(expense);
    api.log('expense.added', { category: p.category, amount: p.amount });
    return { expenseId: expense.id };
  },

  'expense.update'(api, p) {
    const { expenseId, ...changes } = p;
    const expense = find(api.state.expenses, expenseId);
    assert(!expense.salaryId, 'expense_locked');
    Object.assign(expense, changes);
  },

  'expense.remove'(api, p) {
    const { state } = api;
    const expense = find(state.expenses, p.expenseId);
    assert(!expense.salaryId, 'expense_locked');
    state.expenses = state.expenses.filter((e) => e.id !== expense.id);
    api.log('expense.removed', { category: expense.category, amount: expense.amount });
  },

  'staff.add'(api, p) {
    const { state } = api;
    if (state.staff.some((s) => s.phone === p.phone && s.active)) fail('duplicate_phone', { name: state.staff.find((s) => s.phone === p.phone).name });
    const member = { id: api.id('stf'), ...p, active: true, leftOn: null, createdAt: api.ctx.now };
    state.staff.push(member);
    api.log('staff.added', { staff: member.name, role: member.role });
    return { staffId: member.id };
  },

  'staff.update'(api, p) {
    const { staffId, ...changes } = p;
    const member = find(api.state.staff, staffId);
    if (changes.phone && changes.phone !== member.phone && api.state.staff.some((s) => s.phone === changes.phone && s.active)) fail('duplicate_phone', {});
    Object.assign(member, changes);
    api.log('staff.updated', { staff: member.name });
  },

  'staff.remove'(api, p) {
    const member = find(api.state.staff, p.staffId);
    member.active = false;
    member.leftOn = api.today;
    for (const r of api.state.requests) if (r.assignedTo === member.id && r.status !== 'resolved' && r.status !== 'closed') r.assignedTo = null;
    api.log('staff.removed', { staff: member.name });
  },

  'staff.paySalary'(api, p) {
    const { state } = api;
    const member = find(state.staff, p.staffId);
    if (state.salaryPayments.some((s) => s.staffId === member.id && s.period === p.period)) fail('salary_paid', { period: p.period });
    state.seq.slip += 1;
    const slip = { id: api.id('sal'), number: slipNumber(state.seq.slip), ...p, createdAt: api.ctx.now };
    state.salaryPayments.push(slip);
    state.expenses.push({
      id: api.id('exp'), date: p.date, category: 'salary', amount: p.amount, vendor: member.name, note: p.period,
      mode: p.mode, staffId: member.id, salaryId: slip.id, createdAt: api.ctx.now
    });
    api.log('staff.salaryPaid', { staff: member.name, amount: p.amount, period: p.period });
    return { slipId: slip.id, number: slip.number };
  },

  'attendance.mark'(api, p) {
    const { state } = api;
    find(state.staff, p.staffId);
    const existing = state.attendance.find((a) => a.staffId === p.staffId && a.date === p.date);
    if (existing) Object.assign(existing, { status: p.status, inAt: p.inAt ?? existing.inAt, outAt: p.outAt ?? existing.outAt, by: 'owner' });
    else state.attendance.push({ id: api.id('att'), staffId: p.staffId, date: p.date, status: p.status, inAt: p.inAt || null, outAt: p.outAt || null, by: 'owner' });
  },

  'attendance.checkIn'(api, p) {
    const { state } = api;
    const member = selfStaff(api);
    const existing = state.attendance.find((a) => a.staffId === member.id && a.date === p.date);
    if (existing?.inAt) fail('already_checked_in');
    if (existing) Object.assign(existing, { status: 'present', inAt: p.time, by: 'staff' });
    else state.attendance.push({ id: api.id('att'), staffId: member.id, date: p.date, status: 'present', inAt: p.time, outAt: null, by: 'staff' });
    api.log('attendance.checkedIn', { staff: member.name, time: p.time });
  },

  'attendance.checkOut'(api, p) {
    const { state } = api;
    const member = selfStaff(api);
    const existing = state.attendance.find((a) => a.staffId === member.id && a.date === p.date);
    if (!existing?.inAt) fail('not_checked_in');
    existing.outAt = p.time;
  },

  'task.add'(api, p) {
    const task = { id: api.id('task'), ...p, createdAt: api.ctx.now };
    api.state.tasks.push(task);
    return { taskId: task.id };
  },

  'task.update'(api, p) {
    const { taskId, ...changes } = p;
    Object.assign(find(api.state.tasks, taskId), changes);
  },

  'task.remove'(api, p) {
    api.state.tasks = api.state.tasks.filter((t) => t.id !== p.taskId);
    api.state.taskLogs = api.state.taskLogs.filter((l) => l.taskId !== p.taskId);
  },

  'task.toggle'(api, p) {
    const { state } = api;
    const task = find(state.tasks, p.taskId);
    const self = selfStaff(api);
    const staffId = self ? self.id : p.staffId || null;
    const idx = state.taskLogs.findIndex((l) => l.taskId === task.id && l.date === p.date);
    if (p.done) {
      const entry = { id: api.id('tl'), taskId: task.id, date: p.date, staffId, doneAt: api.ctx.now };
      if (idx >= 0) state.taskLogs[idx] = entry;
      else state.taskLogs.push(entry);
    } else if (idx >= 0) {
      state.taskLogs.splice(idx, 1);
    }
  },

  'request.create'(api, p) {
    const { state } = api;
    const self = selfTenant(api);
    const tenantId = self ? self.id : p.tenantId || null;
    const tenant = tenantId ? find(state.tenants, tenantId, 'tenant_not_found') : null;
    const roomId = tenant ? tenant.roomId : p.roomId || null;
    state.seq.request += 1;
    const request = {
      id: api.id('req'), number: requestNumber(state.seq.request), tenantId, roomId, category: p.category, title: p.title,
      description: p.description, priority: p.priority, status: 'open', assignedTo: null, updates: [],
      createdBy: { role: api.ctx.actor.role, name: api.ctx.actor.name || '' }, createdAt: api.ctx.now, updatedAt: api.ctx.now, resolvedAt: null
    };
    state.requests.push(request);
    api.log('request.created', { number: request.number, title: request.title, by: tenant?.name || '' });
    return { requestId: request.id };
  },

  'request.update'(api, p) {
    const { state } = api;
    const request = find(state.requests, p.requestId);
    const { actor } = api.ctx;
    if (actor.role === 'tenant') {
      const self = selfTenant(api);
      assert(request.tenantId === self.id, 'forbidden');
      // A resident may only close their own resolved request (or reopen it).
      assert(p.assignedTo === undefined && p.priority === undefined, 'forbidden');
      assert(!p.status || p.status === 'closed' || p.status === 'open', 'forbidden');
    } else if (actor.role === 'staff') {
      const self = selfStaff(api);
      assert(!request.assignedTo || request.assignedTo === self.id, 'forbidden');
      assert(p.assignedTo === undefined && p.priority === undefined, 'forbidden');
      if (!request.assignedTo && p.status) request.assignedTo = self.id;
    }
    if (p.assignedTo !== undefined) {
      if (p.assignedTo) find(state.staff, p.assignedTo);
      request.assignedTo = p.assignedTo || null;
    }
    if (p.priority) request.priority = p.priority;
    if (p.status && p.status !== request.status) {
      request.status = p.status;
      request.resolvedAt = p.status === 'resolved' || p.status === 'closed' ? api.ctx.now : null;
    }
    request.updates.push({ id: api.id('upd'), at: api.ctx.now, by: { role: actor.role, name: actor.name || '' }, status: p.status || null, assignedTo: p.assignedTo, text: p.note || '' });
    request.updatedAt = api.ctx.now;
    api.log('request.updated', { number: request.number, status: request.status });
  },

  'request.comment'(api, p) {
    const request = find(api.state.requests, p.requestId);
    const { actor } = api.ctx;
    if (actor.role === 'tenant') assert(request.tenantId === selfTenant(api).id, 'forbidden');
    request.updates.push({ id: api.id('upd'), at: api.ctx.now, by: { role: actor.role, name: actor.name || '' }, status: null, text: p.text });
    request.updatedAt = api.ctx.now;
  },

  'notice.post'(api, p) {
    const notice = { id: api.id('ntc'), ...p, postedAt: api.ctx.now, postedBy: api.ctx.actor.name || '', acks: [] };
    api.state.notices.push(notice);
    api.log('notice.posted', { title: notice.title });
    return { noticeId: notice.id };
  },

  'notice.update'(api, p) {
    const { noticeId, ...changes } = p;
    Object.assign(find(api.state.notices, noticeId), changes, { updatedAt: api.ctx.now });
  },

  'notice.remove'(api, p) {
    api.state.notices = api.state.notices.filter((n) => n.id !== p.noticeId);
  },

  'notice.ack'(api, p) {
    const notice = find(api.state.notices, p.noticeId);
    const { actor } = api.ctx;
    if (!notice.acks.some((a) => a.role === actor.role && a.refId === actor.refId)) {
      notice.acks.push({ role: actor.role, refId: actor.refId, name: actor.name || '', at: api.ctx.now });
    }
  },

  'menu.update'(api, p) {
    const self = selfStaff(api);
    if (self) assert(['cook', 'manager', 'warden'].includes(self.role), 'forbidden');
    api.state.menu[p.day] = { ...api.state.menu[p.day], ...p.meals };
    api.log('menu.updated', { day: p.day });
  },

  'menu.replace'(api, p) {
    const self = selfStaff(api);
    if (self) assert(['cook', 'manager', 'warden'].includes(self.role), 'forbidden');
    for (const [day, meals] of Object.entries(p)) api.state.menu[day] = { ...api.state.menu[day], ...meals };
    api.log('menu.updated', { day: 'week' });
  },

  'meal.skip'(api, p) {
    const { state } = api;
    const self = selfTenant(api);
    const tenantId = self ? self.id : p.tenantId;
    assert(tenantId, 'invalid_input', { field: 'tenantId' });
    const tenant = find(state.tenants, tenantId, 'tenant_not_found');
    state.mealSkips = state.mealSkips.filter((s) => !(s.tenantId === tenant.id && s.date === p.date && s.meal === p.meal));
    if (p.skip) state.mealSkips.push({ id: api.id('skip'), tenantId: tenant.id, date: p.date, meal: p.meal, at: api.ctx.now });
    // keep the list small: drop skips older than 60 days
    const cutoff = addDays(api.today, -60);
    state.mealSkips = state.mealSkips.filter((s) => s.date >= cutoff);
  },

  'document.add'(api, p) {
    const { state } = api;
    const { actor } = api.ctx;
    if (actor.role !== 'owner') assert(p.ownerType === actor.role && p.ownerId === actor.refId, 'forbidden');
    const list = p.ownerType === 'tenant' ? state.tenants : state.staff;
    find(list, p.ownerId);
    const count = state.documents.filter((d) => d.ownerType === p.ownerType && d.ownerId === p.ownerId).length;
    assert(count < 10, 'too_many_documents', { max: 10 });
    const doc = { id: api.id('doc'), ...p, uploadedAt: api.ctx.now, uploadedBy: actor.role };
    state.documents.push(doc);
    api.log('document.added', { kind: p.kind, name: p.name });
    return { documentId: doc.id };
  },

  'document.remove'(api, p) {
    const { state } = api;
    const doc = find(state.documents, p.documentId);
    const { actor } = api.ctx;
    if (actor.role !== 'owner') assert(doc.ownerType === actor.role && doc.ownerId === actor.refId, 'forbidden');
    state.documents = state.documents.filter((d) => d.id !== doc.id);
    return { fileId: doc.fileId };
  },

  'activity.clear'(api) {
    api.state.activity = [];
  }
};

/**
 * Apply one command to a property document.
 * @param {object} state   current document (not mutated)
 * @param {{type: string, payload?: object}} command
 * @param {{now: string, actor: {role: string, refId?: string|null, name?: string}, newId: (prefix: string) => string}} ctx
 * @returns {{state: object, activity: object[], result: any}}
 */
export function applyCommand(state, command, ctx) {
  const type = command?.type;
  if (!COMMANDS[type]) throw new DomainError('unknown_command', { type });
  const role = ctx?.actor?.role;
  if (!canPerform(type, role)) throw new DomainError('forbidden', { type, role });
  const parsed = validatePayload(type, command.payload);
  if (!parsed.ok) throw new DomainError(parsed.error.code, parsed.error.details);
  if (!ctx.newId) throw new Error('ctx.newId is required');

  // Updates change only the fields that were sent: schema defaults must not overwrite stored values.
  if (type.endsWith('.update')) {
    const raw = command.payload || {};
    for (const key of Object.keys(parsed.value)) if (!(key in raw)) delete parsed.value[key];
    if (type === 'property.update' && parsed.value.rules) for (const key of Object.keys(parsed.value.rules)) if (!(key in (raw.rules || {}))) delete parsed.value.rules[key];
  }

  const next = cloneState(state);
  const activity = [];
  const api = {
    state: next,
    ctx,
    today: ctx.now.slice(0, 10),
    id: ctx.newId,
    log(kind, data) {
      const entry = {
        id: ctx.newId('act'), at: ctx.now, type: kind, data,
        actor: { role: ctx.actor.role, name: ctx.actor.name || '', refId: ctx.actor.refId || null }
      };
      next.activity.unshift(entry);
      activity.push(entry);
    }
  };
  const result = HANDLERS[type](api, parsed.value) ?? null;
  if (next.activity.length > ACTIVITY_LIMIT) next.activity.length = ACTIVITY_LIMIT;
  next.updatedAt = ctx.now;
  return { state: next, activity, result };
}

export { DomainError };
