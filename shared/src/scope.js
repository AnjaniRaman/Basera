// Role scoping: what a tenant or a staff member is allowed to see of the property document.
// The API runs this before answering a snapshot request; the app runs it for "view as" previews,
// so both show exactly the same thing.
import { isLiving } from './reducer.js';

const PUBLIC_PROPERTY_FIELDS = ['name', 'type', 'address', 'city', 'pincode', 'ownerName', 'ownerPhone', 'upiId'];

function publicProperty(property) {
  const out = {};
  for (const key of PUBLIC_PROPERTY_FIELDS) out[key] = property[key];
  out.rules = {
    dueDay: property.rules.dueDay,
    graceDays: property.rules.graceDays,
    noticeDays: property.rules.noticeDays,
    mealsIncluded: property.rules.mealsIncluded,
    skipCutoffHour: property.rules.skipCutoffHour,
    electricityMode: property.rules.electricityMode,
    electricityRate: property.rules.electricityRate,
    lateFeeType: property.rules.lateFeeType,
    lateFeeValue: property.rules.lateFeeValue
  };
  return out;
}

const tenantCard = (t) => ({ id: t.id, name: t.name, roomId: t.roomId, bed: t.bed, status: t.status, occupation: t.occupation, homeTown: t.homeTown });
const staffCard = (s) => ({ id: s.id, name: s.name, role: s.role, phone: s.phone, active: s.active, shift: s.shift });

export function scopeForTenant(state, tenantId) {
  const me = state.tenants.find((t) => t.id === tenantId);
  if (!me) return null;
  const room = state.rooms.find((r) => r.id === me.roomId) || null;
  return {
    schemaVersion: state.schemaVersion,
    id: state.id,
    updatedAt: state.updatedAt,
    role: 'tenant',
    me: { ...me },
    property: publicProperty(state.property),
    rooms: room ? [room] : [],
    tenants: state.tenants.filter((t) => t.id === me.id || (t.roomId === me.roomId && isLiving(t))).map((t) => (t.id === me.id ? { ...t } : tenantCard(t))),
    staff: state.staff.filter((s) => s.active && ['warden', 'manager', 'security'].includes(s.role)).map(staffCard),
    invoices: state.invoices.filter((i) => i.tenantId === me.id),
    payments: state.payments.filter((p) => p.tenantId === me.id),
    meterReadings: state.meterReadings.filter((m) => m.roomId === me.roomId),
    requests: state.requests.filter((r) => r.tenantId === me.id),
    notices: state.notices.filter((n) => n.audience === 'all' || n.audience === 'tenants').map((n) => ({ ...n, acks: n.acks.filter((a) => a.refId === me.id) , ackCount: n.acks.length })),
    menu: state.menu,
    mealSkips: state.mealSkips.filter((s) => s.tenantId === me.id),
    settlements: state.settlements.filter((s) => s.tenantId === me.id),
    documents: state.documents.filter((d) => d.ownerType === 'tenant' && d.ownerId === me.id),
    expenses: [], salaryPayments: [], attendance: [], tasks: [], taskLogs: [], activity: [],
    seq: {}
  };
}

export function scopeForStaff(state, staffId) {
  const me = state.staff.find((s) => s.id === staffId);
  if (!me) return null;
  return {
    schemaVersion: state.schemaVersion,
    id: state.id,
    updatedAt: state.updatedAt,
    role: 'staff',
    me: { ...me },
    property: publicProperty(state.property),
    rooms: state.rooms.map((r) => ({ id: r.id, number: r.number, floor: r.floor, beds: r.beds, meterNumber: r.meterNumber })),
    tenants: state.tenants.filter(isLiving).map(tenantCard),
    staff: state.staff.filter((s) => s.id === me.id || s.active).map((s) => (s.id === me.id ? { ...s } : staffCard(s))),
    invoices: [], payments: [],
    meterReadings: state.meterReadings,
    requests: state.requests,
    notices: state.notices.filter((n) => n.audience === 'all' || n.audience === 'staff').map((n) => ({ ...n, acks: n.acks.filter((a) => a.refId === me.id), ackCount: n.acks.length })),
    menu: state.menu,
    mealSkips: state.mealSkips.map((s) => ({ date: s.date, meal: s.meal, tenantId: s.tenantId })),
    settlements: [],
    documents: state.documents.filter((d) => d.ownerType === 'staff' && d.ownerId === me.id),
    expenses: [],
    salaryPayments: state.salaryPayments.filter((s) => s.staffId === me.id),
    attendance: state.attendance.filter((a) => a.staffId === me.id),
    tasks: state.tasks.filter((t) => (t.staffId ? t.staffId === me.id : t.role === 'all' || t.role === me.role)),
    taskLogs: state.taskLogs,
    activity: [],
    seq: {}
  };
}

/** The document as a given actor may see it. Owners get everything. */
export function scopeState(state, actor) {
  if (!actor || actor.role === 'owner') return { ...state, role: 'owner', me: null };
  if (actor.role === 'tenant') return scopeForTenant(state, actor.refId);
  if (actor.role === 'staff') return scopeForStaff(state, actor.refId);
  return null;
}
