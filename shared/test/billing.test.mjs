import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPropertyState, applyCommand, sequentialIds, tenantLedger, invoiceStatus, settlementPreview,
  scopeState, DomainError, occupancy, monthSummary, duesList, headcount
} from '../src/index.js';
import { buildSampleState } from '../src/sample.js';

const NOW = '2026-10-06T09:00:00.000Z';
const OWNER = { role: 'owner', name: 'Asha Owner', refId: null };

function setup(rules = {}) {
  const newId = sequentialIds();
  let state = createPropertyState(
    { name: 'Test PG', ownerName: 'Asha Owner', ownerPhone: '9876543210', upiId: 'asha@upi', rules: { billingStart: '2026-08', ...rules } },
    { id: 'prop_1', now: '2026-07-20T00:00:00.000Z' }
  );
  const run = (type, payload, actor = OWNER, now = NOW) => {
    const out = applyCommand(state, { type, payload }, { now, actor, newId });
    state = out.state;
    return out.result;
  };
  const get = () => state;
  return { run, get };
}

test('rooms, beds and duplicate rules', () => {
  const { run, get } = setup();
  const { roomId } = run('room.add', { number: '101', floor: 1, beds: 2, rent: 8000 });
  assert.throws(() => run('room.add', { number: '101', floor: 1, beds: 2, rent: 8000 }), (e) => e.code === 'room_exists');
  run('tenant.add', { name: 'Ravi', phone: '9000000001', roomId, bed: 'A', rent: 8000, deposit: 8000, joinedOn: '2026-08-01' });
  assert.throws(() => run('tenant.add', { name: 'Dup', phone: '9000000001', roomId, bed: 'B', rent: 8000, joinedOn: '2026-08-01' }), (e) => e.code === 'duplicate_phone');
  assert.throws(() => run('tenant.add', { name: 'Same bed', phone: '9000000002', roomId, bed: 'A', rent: 8000, joinedOn: '2026-08-01' }), (e) => e.code === 'bed_occupied');
  assert.throws(() => run('tenant.add', { name: 'No bed', phone: '9000000003', roomId, bed: 'C', rent: 8000, joinedOn: '2026-08-01' }), (e) => e.code === 'invalid_bed');
  assert.throws(() => run('room.remove', { roomId }), (e) => e.code === 'room_occupied');
  assert.equal(occupancy(get()).occupied, 1);
  assert.equal(occupancy(get()).vacant, 1);
});

test('monthly bills: full month, prorated first month, electricity split and due dates', () => {
  const { run, get } = setup({ dueDay: 5, electricityRate: 10 });
  const { roomId } = run('room.add', { number: '201', floor: 2, beds: 2, rent: 9000 });
  const a = run('tenant.add', { name: 'A', phone: '9000000011', roomId, bed: 'A', rent: 9000, joinedOn: '2026-06-10' }).tenantId;
  const b = run('tenant.add', { name: 'B', phone: '9000000012', roomId, bed: 'B', rent: 9000, joinedOn: '2026-09-16' }).tenantId;
  // 300 units at ₹10 = ₹3000 shared by two residents in September.
  run('meter.record', { roomId, period: '2026-09', previous: 1000, current: 1300 });
  const result = run('billing.generate', { period: '2026-09' });
  assert.equal(result.count, 2);
  const invA = get().invoices.find((i) => i.tenantId === a);
  const invB = get().invoices.find((i) => i.tenantId === b);
  assert.equal(invA.number, 'INV-2609-001');
  assert.equal(invA.dueOn, '2026-09-05');
  assert.equal(invA.lines.find((l) => l.type === 'rent').amount, 9000);
  assert.equal(invA.lines.find((l) => l.type === 'electricity').amount, 1500);
  assert.equal(invA.total, 10500);
  // B joined on the 16th: 15 of 30 days → half rent, plus the electricity share.
  assert.equal(invB.lines.find((l) => l.type === 'rent').amount, 4500);
  assert.equal(invB.lines.find((l) => l.type === 'rent').meta.prorated, true);
  assert.equal(invB.total, 6000);
  // Generating the same month again creates nothing.
  assert.equal(run('billing.generate', { period: '2026-09' }).count, 0);
  // A reading recorded after the bills exist updates them in place.
  run('meter.record', { roomId, period: '2026-09', previous: 1000, current: 1400 });
  assert.equal(get().invoices.find((i) => i.tenantId === a).lines.find((l) => l.type === 'electricity').amount, 2000);
  // Nothing is billed before the billing start.
  assert.equal(run('billing.generate', { period: '2026-07' }).count, 0);
});

test('payments allocate oldest-first, leave credit, and statuses follow the calendar', () => {
  const { run, get } = setup({ dueDay: 5, graceDays: 2, lateFeeType: 'flat', lateFeeValue: 250, electricityMode: 'none' });
  const { roomId } = run('room.add', { number: '301', floor: 3, beds: 1, rent: 10000 });
  const t = run('tenant.add', { name: 'C', phone: '9000000021', roomId, bed: 'A', rent: 10000, joinedOn: '2026-08-01', depositPaid: 10000, depositMode: 'upi' }).tenantId;
  run('billing.generate', { period: '2026-08' });
  run('billing.generate', { period: '2026-09' });
  run('billing.generate', { period: '2026-10' });
  let ledger = tenantLedger(get(), t, '2026-10-06');
  assert.equal(ledger.outstanding, 30000);
  assert.equal(ledger.depositHeld, 10000);
  assert.deepEqual(ledger.invoices.map((i) => i.state), ['overdue', 'overdue', 'overdue']);

  // ₹25,000 covers August and September fully and half of October.
  run('payment.record', { tenantId: t, amount: 25000, date: '2026-10-06', mode: 'upi', reference: 'UTR1' });
  ledger = tenantLedger(get(), t, '2026-10-06');
  assert.deepEqual(ledger.invoices.map((i) => [i.period, i.paid, i.state]), [['2026-08', 10000, 'paid'], ['2026-09', 10000, 'paid'], ['2026-10', 5000, 'overdue']]);
  assert.equal(ledger.outstanding, 5000);
  const receipt = get().payments.find((p) => p.reference === 'UTR1');
  assert.equal(receipt.number, 'RCP-0002'); // the deposit was RCP-0001
  assert.equal(receipt.allocations.length, 3);

  // Before the due date the October bill is only "partial".
  assert.equal(invoiceStatus(get().invoices[2], '2026-10-03'), 'partial');

  // Overpayment becomes credit that the next bill absorbs.
  run('payment.record', { tenantId: t, amount: 8000, date: '2026-10-07', mode: 'cash' });
  ledger = tenantLedger(get(), t, '2026-10-07');
  assert.equal(ledger.outstanding, 0);
  assert.equal(ledger.credit, 3000);
  run('billing.generate', { period: '2026-11' });
  ledger = tenantLedger(get(), t, '2026-10-07');
  assert.equal(ledger.credit, 0);
  assert.equal(ledger.invoices.at(-1).paid, 3000);

  // Late fees apply once, only past the grace period, only on balances.
  const fees = run('billing.applyLateFees', {}, OWNER, '2026-11-20T00:00:00.000Z');
  assert.equal(fees.count, 1);
  assert.equal(fees.total, 250);
  assert.equal(run('billing.applyLateFees', {}, OWNER, '2026-11-21T00:00:00.000Z').count, 0);
});

test('tenant claims a UPI payment; the owner confirms or rejects it', () => {
  const { run, get } = setup({ electricityMode: 'none' });
  const { roomId } = run('room.add', { number: '102', floor: 1, beds: 1, rent: 7000 });
  const t = run('tenant.add', { name: 'D', phone: '9000000031', roomId, bed: 'A', rent: 7000, joinedOn: '2026-09-01' }).tenantId;
  run('billing.generate', { period: '2026-10' });
  const tenantActor = { role: 'tenant', refId: t, name: 'D' };
  const { paymentId } = run('payment.claim', { amount: 7000, mode: 'upi', reference: '428731' }, tenantActor);
  assert.throws(() => run('payment.claim', { amount: 10, mode: 'upi' }, tenantActor), (e) => e.code === 'claim_pending');
  assert.equal(tenantLedger(get(), t, '2026-10-06').outstanding, 7000, 'a pending claim does not reduce dues');
  // A tenant cannot confirm their own claim, nor record payments.
  assert.throws(() => run('payment.confirm', { paymentId }, tenantActor), (e) => e.code === 'forbidden');
  assert.throws(() => run('payment.record', { tenantId: t, amount: 1, date: '2026-10-06', mode: 'cash' }, tenantActor), (e) => e.code === 'forbidden');
  run('payment.confirm', { paymentId });
  const ledger = tenantLedger(get(), t, '2026-10-06');
  assert.equal(ledger.outstanding, 0);
  assert.equal(get().payments[0].number, 'RCP-0001');
  // A second claim can be rejected.
  const second = run('payment.claim', { amount: 500, mode: 'upi' }, tenantActor).paymentId;
  run('payment.reject', { paymentId: second, reason: 'No such UTR' });
  assert.equal(get().payments.find((p) => p.id === second).status, 'rejected');
  assert.equal(tenantLedger(get(), t, '2026-10-06').outstanding, 0);
});

test('move-out settlement credits unused days, adjusts the deposit and computes the refund', () => {
  const { run, get } = setup({ electricityMode: 'none', dueDay: 1 });
  const { roomId } = run('room.add', { number: '103', floor: 1, beds: 2, rent: 6000 });
  const t = run('tenant.add', { name: 'E', phone: '9000000041', roomId, bed: 'A', rent: 6000, deposit: 12000, joinedOn: '2026-05-01', depositPaid: 12000 }).tenantId;
  run('billing.generate', { period: '2026-08' });
  run('billing.generate', { period: '2026-09' });
  run('billing.generate', { period: '2026-10' });
  run('payment.record', { tenantId: t, amount: 12000, date: '2026-09-02', mode: 'upi' });
  // Leaving on 15 October: October (31 days) was billed in full, so 16 unused days are credited.
  const tenant = get().tenants[0];
  const preview = settlementPreview(get(), tenant, { leftOn: '2026-10-15', deductions: [{ label: 'Paint', amount: 1000 }] }, '2026-10-06');
  assert.equal(preview.unusedRentCredit.amount, 3097);
  assert.equal(preview.dues, 6000 - 3097);
  assert.equal(preview.refund, 12000 - (6000 - 3097) - 1000);
  const result = run('tenant.settle', { tenantId: t, leftOn: '2026-10-15', deductions: [{ label: 'Paint', amount: 1000 }], refundMode: 'upi' });
  assert.equal(result.refund, preview.refund);
  const after = get();
  assert.equal(after.tenants[0].status, 'left');
  assert.equal(tenantLedger(after, t, '2026-10-16').outstanding, 0);
  assert.equal(after.settlements[0].depositAdjusted, 2903);
  assert.equal(occupancy(after).occupied, 0);
  // The freed bed can be let again.
  run('tenant.add', { name: 'F', phone: '9000000042', roomId, bed: 'A', rent: 6000, joinedOn: '2026-10-20' });
});

test('settling a resident who was never billed bills every month of the stay first', () => {
  const { run, get } = setup({ electricityMode: 'none', prorate: true });
  const { roomId } = run('room.add', { number: '104', floor: 1, beds: 1, rent: 5000 });
  const t = run('tenant.add', { name: 'G', phone: '9000000051', roomId, bed: 'A', rent: 5000, joinedOn: '2026-08-11', depositPaid: 5000 }).tenantId;
  const result = run('tenant.settle', { tenantId: t, leftOn: '2026-10-10', deductions: [] });
  const invoices = get().invoices.filter((i) => i.tenantId === t);
  assert.deepEqual(invoices.map((i) => [i.period, i.total]), [['2026-08', 3387], ['2026-09', 5000], ['2026-10', 1613]]);
  // Dues 10000 vs deposit 5000: the tenant still owes 5000.
  assert.equal(result.refund, -5000);
  assert.equal(tenantLedger(get(), t, '2026-10-10').outstanding, 5000);
});

test('staff: salary once per month becomes an expense; attendance and tasks are self-service', () => {
  const { run, get } = setup();
  const { staffId } = run('staff.add', { name: 'Cook', phone: '9000000061', role: 'cook', salary: 12000, joinedOn: '2026-01-01' });
  run('staff.paySalary', { staffId, period: '2026-09', amount: 12000, date: '2026-10-01', mode: 'bank' });
  assert.throws(() => run('staff.paySalary', { staffId, period: '2026-09', amount: 12000, date: '2026-10-02' }), (e) => e.code === 'salary_paid');
  assert.equal(get().expenses[0].category, 'salary');
  assert.equal(get().salaryPayments[0].number, 'SAL-0001');
  const staffActor = { role: 'staff', refId: staffId, name: 'Cook' };
  run('attendance.checkIn', { date: '2026-10-06', time: '06:30' }, staffActor);
  assert.throws(() => run('attendance.checkIn', { date: '2026-10-06', time: '06:40' }, staffActor), (e) => e.code === 'already_checked_in');
  run('attendance.checkOut', { date: '2026-10-06', time: '14:00' }, staffActor);
  assert.equal(get().attendance[0].outAt, '14:00');
  const { taskId } = run('task.add', { title: 'Breakfast', role: 'cook', time: '07:00' });
  run('task.toggle', { taskId, date: '2026-10-06', done: true }, staffActor);
  assert.equal(get().taskLogs.length, 1);
  assert.throws(() => run('staff.add', { name: 'X', phone: '9000000099', role: 'cook', salary: 1, joinedOn: '2026-01-01' }, staffActor), (e) => e.code === 'forbidden');
});

test('requests flow between resident, owner and staff with role limits', () => {
  const { run, get } = setup();
  const { roomId } = run('room.add', { number: '105', floor: 1, beds: 1, rent: 5000 });
  const t = run('tenant.add', { name: 'H', phone: '9000000071', roomId, bed: 'A', rent: 5000, joinedOn: '2026-09-01' }).tenantId;
  const other = run('room.add', { number: '106', floor: 1, beds: 1, rent: 5000 }).roomId;
  const t2 = run('tenant.add', { name: 'I', phone: '9000000072', roomId: other, bed: 'A', rent: 5000, joinedOn: '2026-09-01' }).tenantId;
  const { staffId } = run('staff.add', { name: 'Warden', phone: '9000000073', role: 'warden', salary: 10000, joinedOn: '2026-01-01' });
  const tenantActor = { role: 'tenant', refId: t, name: 'H' };
  const { requestId } = run('request.create', { category: 'plumbing', title: 'Tap leaking', description: 'Bathroom tap' }, tenantActor);
  assert.equal(get().requests[0].number, 'REQ-001');
  assert.equal(get().requests[0].roomId, roomId);
  assert.throws(() => run('request.update', { requestId, status: 'resolved' }, { role: 'tenant', refId: t2, name: 'I' }), (e) => e.code === 'forbidden');
  run('request.update', { requestId, assignedTo: staffId, status: 'in_progress', note: 'Plumber called' });
  run('request.update', { requestId, status: 'resolved', note: 'Fixed' }, { role: 'staff', refId: staffId, name: 'Warden' });
  run('request.update', { requestId, status: 'closed' }, tenantActor);
  assert.equal(get().requests[0].status, 'closed');
  assert.equal(get().requests[0].updates.length, 3);
});

test('role scoping hides other residents\' money and the owner\'s books', () => {
  const state = buildSampleState({ now: NOW, ownerName: 'Sample owner', ownerPhone: '9000000000' });
  const tenant = state.tenants.find((t) => t.status === 'active');
  const scoped = scopeState(state, { role: 'tenant', refId: tenant.id });
  assert.ok(scoped.invoices.every((i) => i.tenantId === tenant.id));
  assert.ok(scoped.payments.every((p) => p.tenantId === tenant.id));
  assert.equal(scoped.expenses.length, 0);
  assert.ok(scoped.tenants.every((t) => t.id === tenant.id || t.roomId === tenant.roomId));
  assert.equal(scoped.tenants.find((t) => t.id !== tenant.id)?.phone, undefined, 'roommates\' phone numbers are not exposed');
  assert.equal(scoped.property.gstin, undefined);
  const staff = state.staff[0];
  const staffView = scopeState(state, { role: 'staff', refId: staff.id });
  assert.equal(staffView.invoices.length, 0);
  assert.ok(staffView.attendance.every((a) => a.staffId === staff.id));
  assert.ok(staffView.salaryPayments.every((s) => s.staffId === staff.id));
});

test('the sample PG is internally consistent', () => {
  const state = buildSampleState({ now: NOW });
  const today = NOW.slice(0, 10);
  const occ = occupancy(state);
  assert.ok(occ.occupied > 20 && occ.vacant >= 3, `occupied ${occ.occupied}, vacant ${occ.vacant}`);
  const summary = monthSummary(state, today.slice(0, 7), today);
  assert.ok(summary.billed > 150000, `billed ${summary.billed}`);
  assert.ok(summary.collected > 0 && summary.collected <= summary.billed + 50000);
  assert.ok(duesList(state, today).length >= 5);
  assert.equal(state.payments.filter((p) => p.status === 'pending').length, 2);
  assert.equal(state.settlements.length, 1);
  assert.equal(state.tenants.filter((t) => t.status === 'notice').length, 1);
  assert.ok(headcount(state, '2026-10-07', 'dinner').skipped === 4);
  // Every invoice's paid amount equals what the payments say was allocated to it.
  for (const inv of state.invoices) {
    const allocated = state.payments.filter((p) => p.status === 'confirmed').flatMap((p) => p.allocations || []).filter((a) => a.invoiceId === inv.id).reduce((s, a) => s + a.amount, 0);
    assert.equal(inv.paid, allocated, `invoice ${inv.number}`);
  }
});

test('invalid payloads and unknown commands are rejected with stable codes', () => {
  const { run } = setup();
  assert.throws(() => run('room.add', { number: '', beds: 2, rent: 100 }), (e) => e instanceof DomainError && e.code === 'invalid_input');
  assert.throws(() => run('nope.command', {}), (e) => e.code === 'unknown_command');
  assert.throws(() => run('tenant.add', { name: 'X', phone: '12', roomId: 'r', bed: 'A', rent: 1, joinedOn: '2026-01-01' }), (e) => e.code === 'invalid_input' && e.details.field === 'phone');
});

test('updates only touch the fields that were sent', () => {
  const { run, get } = setup();
  const { roomId } = run('room.add', { number: '501', floor: 5, beds: 4, rent: 6000, ac: true });
  run('room.update', { roomId, meterNumber: 'M-1' });
  const room = get().rooms[0];
  assert.deepEqual([room.floor, room.beds, room.ac, room.meterNumber], [5, 4, true, 'M-1']);
  run('property.update', { rules: { dueDay: 10 } });
  assert.equal(get().property.rules.billingStart, '2026-08');
  assert.equal(get().property.name, 'Test PG');
});

test('leaving inside a prorated first month credits the days not stayed', () => {
  const { run, get } = setup({ electricityMode: 'none' });
  const { roomId } = run('room.add', { number: '601', floor: 6, beds: 1, rent: 6200 });
  const t = run('tenant.add', { name: 'J', phone: '9000000081', roomId, bed: 'A', rent: 6200, joinedOn: '2026-10-06', depositPaid: 6200 }).tenantId;
  run('billing.generate', { period: '2026-10' }); // 26 of 31 days = 5200
  const res = run('tenant.settle', { tenantId: t, leftOn: '2026-10-15', deductions: [] }); // stayed 10 days = 2000
  assert.equal(get().invoices[0].total, 2000);
  assert.equal(res.refund, 4200);
});

test('delegated access: accounts desk and manager can do the daily work, never settings, staff or salaries', () => {
  const { run, get } = setup({ electricityMode: 'none' });
  const { roomId } = run('room.add', { number: '701', floor: 7, beds: 2, rent: 5000 });
  const desk = run('staff.add', { name: 'Desk', phone: '9000000091', role: 'other', roleLabel: 'Front desk', access: 'accounts', salary: 12000, joinedOn: '2026-01-01' }).staffId;
  const plain = run('staff.add', { name: 'Cook', phone: '9000000092', role: 'cook', salary: 9000, joinedOn: '2026-01-01' }).staffId;
  const mgr = run('staff.add', { name: 'Mgr', phone: '9000000093', role: 'manager', access: 'manager', salary: 20000, joinedOn: '2026-01-01' }).staffId;
  assert.equal(get().staff[0].roleLabel, 'Front desk');
  const D = { role: 'staff', refId: desk, name: 'Desk' }; const P = { role: 'staff', refId: plain, name: 'Cook' }; const M = { role: 'staff', refId: mgr, name: 'Mgr' };
  const t = run('tenant.add', { name: 'K', phone: '9000000094', roomId, bed: 'A', rent: 5000, joinedOn: '2026-10-01' }, D).tenantId;
  run('billing.generate', { period: '2026-10' }, D);
  run('payment.record', { tenantId: t, amount: 5000, date: '2026-10-06', mode: 'cash' }, D);
  assert.equal(get().payments[0].collectedBy, 'Desk');
  for (const [type, payload] of [['property.update', { name: 'X' }], ['staff.update', { staffId: desk, access: 'manager' }], ['staff.paySalary', { staffId: desk, period: '2026-09', amount: 1, date: '2026-10-01' }], ['payment.delete', { paymentId: get().payments[0].id }], ['room.add', { number: '702', beds: 1, rent: 1 }], ['tenant.settle', { tenantId: t, leftOn: '2026-10-06' }]]) {
    assert.throws(() => run(type, payload, D), (e) => e.code === 'forbidden', type);
  }
  assert.throws(() => run('payment.record', { tenantId: t, amount: 1, date: '2026-10-06', mode: 'cash' }, P), (e) => e.code === 'forbidden');
  run('room.add', { number: '702', beds: 1, rent: 4000 }, M);
  run('tenant.settle', { tenantId: t, leftOn: '2026-10-06', deductions: [] }, M);
  assert.throws(() => run('staff.remove', { staffId: plain }, M), (e) => e.code === 'forbidden');
  // The desk sees the books but not salaries; a claimed access level in the actor is ignored.
  const view = scopeState(get(), D);
  assert.equal(view.access, 'accounts'); assert.ok(view.invoices.length > 0); assert.equal(view.staff.find((s) => s.id === mgr).salary, undefined); assert.equal(view.salaryPayments.length, 0);
  assert.throws(() => run('room.add', { number: '703', beds: 1, rent: 1 }, { ...P, access: 'manager' }), (e) => e.code === 'forbidden');
  // Removing access takes effect at once.
  run('staff.update', { staffId: desk, access: 'basic' });
  assert.throws(() => run('billing.generate', { period: '2026-11' }, D), (e) => e.code === 'forbidden');
});
