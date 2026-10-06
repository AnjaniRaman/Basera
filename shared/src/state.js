// The property document: one JSON object per PG holding everything the app knows about it.
// It is what the browser keeps in IndexedDB in device mode and what the API stores per property.
import { SCHEMA_VERSION, WEEKDAYS, propertySchema } from './schema.js';

export const EMPTY_MENU = Object.fromEntries(WEEKDAYS.map((d) => [d, { breakfast: '', lunch: '', dinner: '' }]));

export function emptyMenu() {
  return JSON.parse(JSON.stringify(EMPTY_MENU));
}

/**
 * Build a fresh property document from the setup form.
 * @param {object} input  property fields (validated with propertySchema)
 * @param {{ id: string, now: string }} ctx
 */
export function createPropertyState(input, { id, now }) {
  const property = propertySchema.parse(input);
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    createdAt: now,
    updatedAt: now,
    property,
    rooms: [],
    tenants: [],
    invoices: [],
    payments: [],
    meterReadings: [],
    expenses: [],
    staff: [],
    salaryPayments: [],
    attendance: [],
    tasks: [],
    taskLogs: [],
    requests: [],
    notices: [],
    menu: emptyMenu(),
    mealSkips: [],
    settlements: [],
    documents: [],
    activity: [],
    seq: { invoice: 0, receipt: 0, request: 0, settlement: 0, slip: 0 }
  };
}

const LIST_KEYS = [
  'rooms', 'tenants', 'invoices', 'payments', 'meterReadings', 'expenses', 'staff', 'salaryPayments', 'attendance',
  'tasks', 'taskLogs', 'requests', 'notices', 'mealSkips', 'settlements', 'documents', 'activity'
];

/** Fill in anything a stored document from an older build may be missing. */
export function normalizeState(raw) {
  const state = { ...raw };
  for (const key of LIST_KEYS) if (!Array.isArray(state[key])) state[key] = [];
  if (!state.menu) state.menu = emptyMenu();
  for (const day of WEEKDAYS) state.menu[day] = { breakfast: '', lunch: '', dinner: '', ...(state.menu[day] || {}) };
  state.seq = { invoice: 0, receipt: 0, request: 0, settlement: 0, slip: 0, ...(state.seq || {}) };
  state.property = propertySchema.parse({ ...state.property, rules: { ...(state.property?.rules || {}) } });
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

/** Structured clone that also works in older runtimes. */
export function cloneState(state) {
  return typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state));
}
