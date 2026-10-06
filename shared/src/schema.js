// Validation for everything that enters the domain: property settings, entities and command
// payloads. The same schemas run in the browser (before a command is applied locally) and on the
// API (before it is applied to the stored state), so neither side can drift.
import { z } from 'zod';

export const SCHEMA_VERSION = 2;

export const ROLES = ['owner', 'tenant', 'staff'];
export const STAFF_ROLES = ['cook', 'cleaner', 'warden', 'security', 'maintenance', 'manager', 'other'];
export const PAYMENT_MODES = ['upi', 'cash', 'bank', 'cheque', 'other'];
export const PAYMENT_KINDS = ['rent', 'deposit', 'other'];
export const EXPENSE_CATEGORIES = [
  'groceries', 'electricity', 'water', 'gas', 'internet', 'salary', 'maintenance', 'cleaning', 'rent', 'tax', 'other'
];
export const REQUEST_CATEGORIES = ['plumbing', 'electrical', 'cleaning', 'wifi', 'food', 'furniture', 'security', 'noise', 'other'];
export const REQUEST_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
export const REQUEST_PRIORITIES = ['low', 'normal', 'high'];
export const ID_TYPES = ['aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id', 'other'];
export const DOCUMENT_KINDS = ['id_proof', 'photo', 'agreement', 'police_verification', 'other'];
export const NOTICE_AUDIENCES = ['all', 'tenants', 'staff'];
export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'half_day'];
export const LINE_TYPES = ['rent', 'electricity', 'charge', 'late_fee', 'discount', 'credit'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date');
const period = z.string().regex(/^\d{4}-\d{2}$/, 'period');
const money = z.number().finite().min(0).max(1e9);
const signedMoney = z.number().finite().min(-1e9).max(1e9);
const shortText = z.string().trim().min(1).max(120);
const longText = z.string().trim().max(2000);
const optionalText = z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined));
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, '').slice(-10))
  .refine((v) => v.length === 10, { message: 'phone' });
const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/\D/g, '').slice(-10) : undefined))
  .refine((v) => v === undefined || v.length === 10, { message: 'phone' });
const email = z.string().trim().toLowerCase().email().max(120);
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: 'email' });

export const rulesSchema = z.object({
  billingStart: period.optional(),
  dueDay: z.number().int().min(1).max(28).default(5),
  graceDays: z.number().int().min(0).max(28).default(3),
  lateFeeType: z.enum(['none', 'flat', 'percent']).default('none'),
  lateFeeValue: z.number().min(0).max(100000).default(0),
  prorate: z.boolean().default(true),
  electricityMode: z.enum(['none', 'meter', 'flat']).default('meter'),
  electricityRate: z.number().min(0).max(100).default(8),
  electricityFlat: money.default(0),
  depositMonths: z.number().min(0).max(12).default(1),
  noticeDays: z.number().int().min(0).max(90).default(30),
  mealsIncluded: z.boolean().default(true),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  skipCutoffHour: z.number().int().min(0).max(23).default(20)
});

export const propertySchema = z.object({
  name: shortText,
  type: z.enum(['pg', 'hostel', 'coliving']).default('pg'),
  address: longText.max(300).default(''),
  city: z.string().trim().max(60).default(''),
  pincode: z.string().trim().max(10).default(''),
  ownerName: shortText,
  ownerPhone: phone,
  ownerEmail: optionalEmail,
  upiId: z.string().trim().max(80).default(''),
  gstin: z.string().trim().max(20).default(''),
  rules: rulesSchema.default({})
});

export const propertyUpdateSchema = propertySchema.partial().extend({ rules: rulesSchema.partial().optional() });

export const roomSchema = z.object({
  number: z.string().trim().min(1).max(12),
  floor: z.number().int().min(0).max(60).default(0),
  beds: z.number().int().min(1).max(12).default(2),
  rent: money,
  ac: z.boolean().default(false),
  attachedBath: z.boolean().default(false),
  meterNumber: z.string().trim().max(30).default(''),
  notes: z.string().trim().max(300).default('')
});

export const bulkRoomsSchema = z.object({
  floors: z.number().int().min(1).max(30),
  roomsPerFloor: z.number().int().min(1).max(40),
  beds: z.number().int().min(1).max(12),
  rent: money,
  startFloor: z.number().int().min(0).max(60).default(1),
  skipExisting: z.boolean().default(true)
});

export const tenantSchema = z.object({
  name: shortText,
  phone,
  email: optionalEmail,
  gender: z.enum(['male', 'female', 'other', '']).default(''),
  occupation: z.string().trim().max(80).default(''),
  organisation: z.string().trim().max(120).default(''),
  homeTown: z.string().trim().max(80).default(''),
  idType: z.enum(ID_TYPES).optional(),
  idNumber: z.string().trim().max(40).default(''),
  emergencyName: z.string().trim().max(80).default(''),
  emergencyPhone: optionalPhone,
  roomId: z.string().min(1),
  bed: z.string().trim().min(1).max(4),
  rent: money,
  deposit: money.default(0),
  joinedOn: isoDate,
  dueDay: z.number().int().min(1).max(28).optional(),
  notes: z.string().trim().max(500).default('')
});

export const tenantUpdateSchema = tenantSchema.partial();

export const invoiceLineSchema = z.object({
  type: z.enum(LINE_TYPES),
  label: z.string().trim().max(120).default(''),
  amount: signedMoney,
  meta: z.record(z.string(), z.any()).optional()
});

export const paymentSchema = z.object({
  tenantId: z.string().min(1),
  amount: money.min(1),
  date: isoDate,
  mode: z.enum(PAYMENT_MODES),
  kind: z.enum(PAYMENT_KINDS).default('rent'),
  reference: z.string().trim().max(60).default(''),
  note: z.string().trim().max(300).default(''),
  invoiceId: z.string().optional()
});

export const claimSchema = z.object({
  amount: money.min(1),
  mode: z.enum(['upi', 'bank', 'cash']).default('upi'),
  reference: z.string().trim().max(60).default(''),
  note: z.string().trim().max(300).default(''),
  invoiceId: z.string().optional()
});

export const expenseSchema = z.object({
  date: isoDate,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: money.min(0.01),
  vendor: z.string().trim().max(120).default(''),
  note: z.string().trim().max(300).default(''),
  mode: z.enum(PAYMENT_MODES).default('cash')
});

export const staffSchema = z.object({
  name: shortText,
  phone,
  role: z.enum(STAFF_ROLES),
  salary: money,
  payDay: z.number().int().min(1).max(28).default(1),
  joinedOn: isoDate,
  shift: z.string().trim().max(60).default(''),
  idType: z.enum(ID_TYPES).optional(),
  idNumber: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(300).default('')
});

export const taskSchema = z.object({
  title: shortText,
  role: z.enum([...STAFF_ROLES, 'all']).default('all'),
  staffId: z.string().optional(),
  days: z.array(z.enum(WEEKDAYS)).min(1).default([...WEEKDAYS]),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional()
});

export const requestSchema = z.object({
  category: z.enum(REQUEST_CATEGORIES),
  title: shortText,
  description: longText.default(''),
  priority: z.enum(REQUEST_PRIORITIES).default('normal'),
  tenantId: z.string().optional(),
  roomId: z.string().optional()
});

export const noticeSchema = z.object({
  title: shortText,
  body: longText.default(''),
  audience: z.enum(NOTICE_AUDIENCES).default('all'),
  pinned: z.boolean().default(false),
  expiresOn: isoDate.optional()
});

export const menuDaySchema = z.object({
  breakfast: z.string().trim().max(160).default(''),
  lunch: z.string().trim().max(160).default(''),
  dinner: z.string().trim().max(160).default('')
});

export const documentSchema = z.object({
  ownerType: z.enum(['tenant', 'staff']),
  ownerId: z.string().min(1),
  kind: z.enum(DOCUMENT_KINDS),
  name: z.string().trim().min(1).max(120),
  mime: z.string().trim().max(80),
  size: z.number().int().min(0).max(25 * 1024 * 1024),
  fileId: z.string().min(1)
});

/** Payload schema for every command the reducer accepts. */
export const COMMANDS = {
  'property.update': propertyUpdateSchema,
  'room.add': roomSchema,
  'room.addMany': bulkRoomsSchema,
  'room.update': roomSchema.partial().extend({ roomId: z.string().min(1) }),
  'room.remove': z.object({ roomId: z.string().min(1) }),
  'tenant.add': tenantSchema.extend({ depositPaid: money.optional(), depositMode: z.enum(PAYMENT_MODES).optional() }),
  'tenant.update': tenantUpdateSchema.extend({ tenantId: z.string().min(1) }),
  'tenant.move': z.object({ tenantId: z.string().min(1), roomId: z.string().min(1), bed: z.string().min(1).max(4), rent: money.optional(), effectiveOn: isoDate.optional() }),
  'tenant.giveNotice': z.object({ tenantId: z.string().min(1), leaveOn: isoDate, reason: z.string().trim().max(300).default('') }),
  'tenant.cancelNotice': z.object({ tenantId: z.string().min(1) }),
  'tenant.settle': z.object({
    tenantId: z.string().min(1),
    leftOn: isoDate,
    deductions: z.array(z.object({ label: shortText, amount: money })).default([]),
    refundMode: z.enum(PAYMENT_MODES).default('upi'),
    refundReference: z.string().trim().max(60).default(''),
    note: z.string().trim().max(300).default('')
  }),
  'tenant.reactivate': z.object({ tenantId: z.string().min(1) }),
  'billing.generate': z.object({ period, tenantIds: z.array(z.string()).optional() }),
  'billing.addLine': z.object({ invoiceId: z.string().min(1), line: invoiceLineSchema }),
  'billing.removeLine': z.object({ invoiceId: z.string().min(1), lineId: z.string().min(1) }),
  'billing.updateDue': z.object({ invoiceId: z.string().min(1), dueOn: isoDate }),
  'billing.void': z.object({ invoiceId: z.string().min(1), reason: z.string().trim().max(200).default('') }),
  'billing.applyLateFees': z.object({ period: period.optional(), invoiceIds: z.array(z.string()).optional() }),
  'meter.record': z.object({
    roomId: z.string().min(1),
    period,
    previous: z.number().min(0).max(1e8),
    current: z.number().min(0).max(1e8),
    rate: z.number().min(0).max(100).optional(),
    readOn: isoDate.optional()
  }),
  'meter.remove': z.object({ roomId: z.string().min(1), period }),
  'payment.record': paymentSchema,
  'payment.claim': claimSchema,
  'payment.confirm': z.object({ paymentId: z.string().min(1), amount: money.optional(), reference: z.string().trim().max(60).optional() }),
  'payment.reject': z.object({ paymentId: z.string().min(1), reason: z.string().trim().max(200).default('') }),
  'payment.delete': z.object({ paymentId: z.string().min(1) }),
  'expense.add': expenseSchema,
  'expense.update': expenseSchema.partial().extend({ expenseId: z.string().min(1) }),
  'expense.remove': z.object({ expenseId: z.string().min(1) }),
  'staff.add': staffSchema,
  'staff.update': staffSchema.partial().extend({ staffId: z.string().min(1) }),
  'staff.remove': z.object({ staffId: z.string().min(1) }),
  'staff.paySalary': z.object({
    staffId: z.string().min(1),
    period,
    amount: money.min(1),
    date: isoDate,
    mode: z.enum(PAYMENT_MODES).default('cash'),
    deductions: money.default(0),
    note: z.string().trim().max(200).default('')
  }),
  'attendance.mark': z.object({
    staffId: z.string().min(1),
    date: isoDate,
    status: z.enum(ATTENDANCE_STATUSES),
    inAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    outAt: z.string().regex(/^\d{2}:\d{2}$/).optional()
  }),
  'attendance.checkIn': z.object({ date: isoDate, time: z.string().regex(/^\d{2}:\d{2}$/) }),
  'attendance.checkOut': z.object({ date: isoDate, time: z.string().regex(/^\d{2}:\d{2}$/) }),
  'task.add': taskSchema,
  'task.update': taskSchema.partial().extend({ taskId: z.string().min(1) }),
  'task.remove': z.object({ taskId: z.string().min(1) }),
  'task.toggle': z.object({ taskId: z.string().min(1), date: isoDate, done: z.boolean(), staffId: z.string().optional() }),
  'request.create': requestSchema,
  'request.update': z.object({
    requestId: z.string().min(1),
    status: z.enum(REQUEST_STATUSES).optional(),
    assignedTo: z.string().nullable().optional(),
    priority: z.enum(REQUEST_PRIORITIES).optional(),
    note: z.string().trim().max(500).optional()
  }),
  'request.comment': z.object({ requestId: z.string().min(1), text: z.string().trim().min(1).max(500) }),
  'notice.post': noticeSchema,
  'notice.update': noticeSchema.partial().extend({ noticeId: z.string().min(1) }),
  'notice.remove': z.object({ noticeId: z.string().min(1) }),
  'notice.ack': z.object({ noticeId: z.string().min(1) }),
  'menu.update': z.object({ day: z.enum(WEEKDAYS), meals: menuDaySchema }),
  'menu.replace': z.record(z.enum(WEEKDAYS), menuDaySchema),
  'meal.skip': z.object({ date: isoDate, meal: z.enum(MEALS), skip: z.boolean(), tenantId: z.string().optional() }),
  'document.add': documentSchema,
  'document.remove': z.object({ documentId: z.string().min(1) }),
  'activity.clear': z.object({})
};

export const COMMAND_TYPES = Object.keys(COMMANDS);

export function validatePayload(type, payload) {
  const schema = COMMANDS[type];
  if (!schema) return { ok: false, error: { code: 'unknown_command', details: { type } } };
  const result = schema.safeParse(payload ?? {});
  if (result.success) return { ok: true, value: result.data };
  const issue = result.error.issues[0];
  return {
    ok: false,
    error: { code: 'invalid_input', details: { field: issue?.path?.join('.') || '', message: issue?.message || 'invalid' } }
  };
}
