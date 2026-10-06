// A fictional PG, built by running real commands through the reducer so every figure in it is
// consistent with the billing engine. Dates are relative to "now", so it always looks current.
import { createPropertyState } from './state.js';
import { applyCommand } from './reducer.js';
import { sequentialIds } from './ids.js';
import { toISODate, addDays, periodOf, shiftPeriod, dateInPeriod, periodBounds } from './dates.js';
import { invoiceBalance } from './billing.js';

export const SAMPLE_PROPERTY_ID = 'prop_sample';

const RESIDENTS = [
  ['Aarav Mehta', 'male', 'Software engineer', 'Pune'], ['Priya Nair', 'female', 'Chartered accountant', 'Kochi'],
  ['Rohan Iyer', 'male', 'Student · IIIT', 'Chennai'], ['Sneha Reddy', 'female', 'UX designer', 'Warangal'],
  ['Karthik Rao', 'male', 'Bank officer', 'Mysuru'], ['Ananya Sharma', 'female', 'Doctor · intern', 'Jaipur'],
  ['Vikram Singh', 'male', 'Sales manager', 'Lucknow'], ['Divya Pillai', 'female', 'Content writer', 'Thrissur'],
  ['Arjun Das', 'male', 'Student · MBA', 'Guwahati'], ['Meera Krishnan', 'female', 'Data analyst', 'Coimbatore'],
  ['Siddharth Jain', 'male', 'Architect', 'Indore'], ['Pooja Patel', 'female', 'HR executive', 'Surat'],
  ['Nikhil Verma', 'male', 'Civil engineer', 'Bhopal'], ['Kavya Menon', 'female', 'Teacher', 'Kozhikode'],
  ['Rahul Gupta', 'male', 'Student · CA', 'Kanpur'], ['Shreya Bose', 'female', 'Pharmacist', 'Kolkata'],
  ['Aditya Kulkarni', 'male', 'Product manager', 'Nashik'], ['Neha Joshi', 'female', 'Lawyer', 'Dehradun'],
  ['Varun Chandra', 'male', 'Mechanical engineer', 'Vizag'], ['Ishita Roy', 'female', 'Student · MSc', 'Ranchi'],
  ['Manish Yadav', 'male', 'Delivery operations', 'Patna'], ['Tanvi Desai', 'female', 'Graphic designer', 'Vadodara'],
  ['Harsh Agarwal', 'male', 'Trader', 'Agra'], ['Riya Kapoor', 'female', 'Nurse', 'Chandigarh'],
  ['Dev Malhotra', 'male', 'Student · B.Tech', 'Amritsar'], ['Lavanya Setty', 'female', 'Research associate', 'Hubballi']
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * @param {{ ownerName?: string, ownerPhone?: string, now?: Date | string, newId?: (p: string) => string }} opts
 */
export function buildSampleState(opts = {}) {
  const nowDate = opts.now ? new Date(opts.now) : new Date();
  const today = toISODate(nowDate);
  const nowIso = nowDate.toISOString();
  const newId = opts.newId || sequentialIds();
  const rand = rng(20261006);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const owner = { role: 'owner', name: opts.ownerName || 'Sample owner', refId: null };
  const at = (iso) => `${iso}T10:00:00.000Z`;

  const period0 = periodOf(today);
  const periodM1 = shiftPeriod(period0, -1);
  const periodM2 = shiftPeriod(period0, -2);

  let state = createPropertyState(
    {
      name: 'Shanti Nivas PG',
      type: 'pg',
      address: 'Plot 42, Ayyappa Society Road, Madhapur',
      city: 'Hyderabad',
      pincode: '500081',
      ownerName: owner.name,
      ownerPhone: opts.ownerPhone || '9000000000',
      upiId: 'shantinivas@okaxis',
      rules: { billingStart: periodM2, dueDay: 5, graceDays: 3, lateFeeType: 'flat', lateFeeValue: 200, electricityMode: 'meter', electricityRate: 8, depositMonths: 1, noticeDays: 30 }
    },
    { id: opts.id || SAMPLE_PROPERTY_ID, now: at(addDays(today, -400)) }
  );
  state.sample = true;

  const run = (type, payload, when = nowIso, actor = owner) => {
    const out = applyCommand(state, { type, payload }, { now: when, actor, newId });
    state = out.state;
    return out.result;
  };

  // Rooms: 2 on the ground floor, 4 per floor on floors 1–3.
  run('room.add', { number: 'G01', floor: 0, beds: 2, rent: 8500, ac: false, attachedBath: true, meterNumber: 'MTR-G01' }, at(addDays(today, -400)));
  run('room.add', { number: 'G02', floor: 0, beds: 1, rent: 12000, ac: true, attachedBath: true, meterNumber: 'MTR-G02' }, at(addDays(today, -400)));
  run('room.addMany', { floors: 3, roomsPerFloor: 4, beds: 3, rent: 7500, startFloor: 1 }, at(addDays(today, -400)));
  const rooms = state.rooms;
  const twoBed = (n) => run('room.update', { roomId: rooms.find((r) => r.number === n).id, beds: 2, rent: 9000, ac: true }, at(addDays(today, -399)));
  twoBed('101'); twoBed('201'); twoBed('301');
  for (const r of state.rooms) if (!r.meterNumber) run('room.update', { roomId: r.id, meterNumber: `MTR-${r.number}` }, at(addDays(today, -399)));

  // Residents: fill beds leaving a few vacant; joining dates spread over the last 14 months.
  const slots = [];
  for (const room of state.rooms) for (let b = 0; b < room.beds; b++) slots.push({ room, bed: 'ABCDEFGHIJKL'[b] });
  const vacantSlots = new Set([slots.length - 1, slots.length - 4, slots.length - 7, 2]);
  const tenants = [];
  let phoneSeq = 98100 + 10000;
  RESIDENTS.forEach((person, i) => {
    const slot = slots[i];
    if (!slot || vacantSlots.has(i)) return;
    const [name, gender, occupation, homeTown] = person;
    const daysAgo = i < 6 ? 300 + Math.floor(rand() * 120) : i < 18 ? 60 + Math.floor(rand() * 200) : 5 + Math.floor(rand() * 50);
    const joinedOn = addDays(today, -daysAgo);
    phoneSeq += 137;
    const phone = `9${String(phoneSeq).padStart(9, '7')}`.slice(0, 10);
    const result = run(
      'tenant.add',
      {
        name, phone, gender, occupation, homeTown, roomId: slot.room.id, bed: slot.bed, rent: slot.room.rent,
        deposit: slot.room.rent, joinedOn, idType: pick(['aadhaar', 'pan', 'driving_licence']), idNumber: `XXXX-XXXX-${1000 + i * 37}`,
        emergencyName: 'Family', emergencyPhone: `9${String(phoneSeq + 5000).padStart(9, '3')}`.slice(0, 10),
        depositPaid: slot.room.rent, depositMode: pick(['upi', 'bank', 'cash'])
      },
      at(joinedOn)
    );
    tenants.push({ id: result.tenantId, name, joinedOn, room: slot.room });
  });

  // Staff, their checklists and attendance for the last ten days.
  const cook = run('staff.add', { name: 'Lakshmi Prasad', phone: '9848012345', role: 'cook', salary: 14000, payDay: 1, joinedOn: addDays(today, -380), shift: '6:00 – 14:00' }, at(addDays(today, -380))).staffId;
  const cleaner = run('staff.add', { name: 'Ravi Kumar', phone: '9848054321', role: 'cleaner', salary: 9000, payDay: 1, joinedOn: addDays(today, -300), shift: '7:00 – 12:00' }, at(addDays(today, -300))).staffId;
  const warden = run('staff.add', { name: 'Suresh Babu', phone: '9848098765', role: 'warden', salary: 16000, payDay: 1, joinedOn: addDays(today, -390), shift: 'Night' }, at(addDays(today, -390))).staffId;
  const tasks = [
    ['Breakfast ready by 7:30', 'cook', '07:00'], ['Lunch tiffin packing', 'cook', '11:30'], ['Dinner ready by 20:00', 'cook', '19:00'],
    ['Kitchen deep clean', 'cook', '14:00'], ['Sweep and mop all floors', 'cleaner', '07:30'], ['Clean common bathrooms', 'cleaner', '09:00'],
    ['Collect garbage from floors', 'cleaner', '10:30'], ['Water tank level check', 'warden', '08:00'], ['Lock main gate', 'warden', '23:00'],
    ['Visitor register check', 'warden', '21:00']
  ];
  for (const [title, role, time] of tasks) run('task.add', { title, role, time, days: role === 'cook' && title.includes('deep') ? ['sun'] : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, at(addDays(today, -300)));
  for (let d = 10; d >= 1; d--) {
    const date = addDays(today, -d);
    for (const staffId of [cook, cleaner, warden]) {
      const absent = rand() < 0.08;
      run('attendance.mark', { staffId, date, status: absent ? 'absent' : 'present', inAt: absent ? undefined : pick(['06:05', '06:20', '07:02', '07:15']), outAt: absent ? undefined : pick(['14:00', '13:45', '12:10']) }, at(date));
    }
  }
  run('attendance.checkIn', { date: today, time: '06:12' }, nowIso, { role: 'staff', refId: cook, name: 'Lakshmi Prasad' });
  run('attendance.checkIn', { date: today, time: '07:05' }, nowIso, { role: 'staff', refId: cleaner, name: 'Ravi Kumar' });
  for (const t of state.tasks.filter((x) => x.role === 'cook').slice(0, 2)) run('task.toggle', { taskId: t.id, date: today, done: true }, nowIso, { role: 'staff', refId: cook, name: 'Lakshmi Prasad' });
  for (const period of [periodM2, periodM1]) {
    for (const staffId of [cook, cleaner, warden]) {
      const member = state.staff.find((s) => s.id === staffId);
      run('staff.paySalary', { staffId, period, amount: member.salary, date: dateInPeriod(shiftPeriod(period, 1), 2), mode: 'bank' }, at(dateInPeriod(shiftPeriod(period, 1), 2)));
    }
  }

  // Menu.
  run('menu.replace', {
    mon: { breakfast: 'Idli, sambar, chutney', lunch: 'Rice, dal, aloo gobi, curd', dinner: 'Chapati, paneer butter masala' },
    tue: { breakfast: 'Poha, tea', lunch: 'Rice, rasam, beans poriyal', dinner: 'Chapati, egg curry / chana masala' },
    wed: { breakfast: 'Upma, coconut chutney', lunch: 'Veg pulao, raita', dinner: 'Chapati, mixed veg, dal tadka' },
    thu: { breakfast: 'Dosa, tomato chutney', lunch: 'Rice, sambar, cabbage curry', dinner: 'Chapati, chicken curry / kadai paneer' },
    fri: { breakfast: 'Puri, aloo bhaji', lunch: 'Lemon rice, papad, curd', dinner: 'Chapati, rajma, jeera rice' },
    sat: { breakfast: 'Bread, omelette / peanut butter', lunch: 'Rice, dal, bhindi fry', dinner: 'Fried rice, gobi manchurian' },
    sun: { breakfast: 'Pongal, vada, chutney', lunch: 'Chicken biryani / veg biryani, raita', dinner: 'Chapati, dal makhani' }
  }, at(addDays(today, -200)));

  // Electricity readings for the last two months (and the current one for some rooms).
  const meters = new Map();
  for (const room of state.rooms) meters.set(room.id, 1200 + Math.floor(rand() * 3000));
  for (const period of [periodM2, periodM1, period0]) {
    for (const room of state.rooms) {
      if (period === period0 && rand() < 0.6) continue;
      const occupants = state.tenants.filter((t) => t.roomId === room.id && t.status !== 'left').length;
      if (!occupants) continue;
      const previous = meters.get(room.id);
      const current = previous + Math.floor((room.ac ? 110 : 45) * occupants + rand() * 60);
      meters.set(room.id, current);
      run('meter.record', { roomId: room.id, period, previous, current, readOn: dateInPeriod(period, 1) }, at(dateInPeriod(period, 1)));
    }
  }

  // Bills for the last two months and the current one, then payments against them.
  const payModes = ['upi', 'upi', 'upi', 'cash', 'bank'];
  for (const period of [periodM2, periodM1, period0]) {
    run('billing.generate', { period }, at(dateInPeriod(period, 1)));
    const invoices = state.invoices.filter((i) => i.period === period);
    invoices.forEach((inv, idx) => {
      const tenant = tenants.find((t) => t.id === inv.tenantId);
      if (!tenant) return;
      let chance = period === period0 ? 0.62 : period === periodM1 ? 0.92 : 1;
      if (period !== period0 && idx % 13 === 4) chance = 0; // a couple of long-standing defaulters
      if (rand() > chance) return;
      const partial = period === periodM1 && idx % 8 === 3;
      const amount = partial ? Math.round(inv.total * 0.5) : inv.total;
      const date = addDays(inv.dueOn, Math.floor(rand() * 7) - 3);
      if (date > today) return;
      const mode = pick(payModes);
      run('payment.record', { tenantId: inv.tenantId, amount, date, mode, kind: 'rent', reference: mode === 'upi' ? `UTR${Math.floor(rand() * 9e11 + 1e11)}` : '', invoiceId: inv.id }, at(date));
    });
  }
  run('billing.applyLateFees', { period: periodM1 }, nowIso);

  // Two residents say they have paid by UPI; the owner still has to confirm.
  const unpaidNow = state.invoices.filter((i) => i.period === period0 && invoiceBalance(i) > 0).slice(0, 2);
  unpaidNow.forEach((inv, i) => {
    const tenant = state.tenants.find((t) => t.id === inv.tenantId);
    run('payment.claim', { amount: invoiceBalance(inv), mode: 'upi', reference: `4287${31000 + i * 917}${Math.floor(rand() * 900 + 100)}`, invoiceId: inv.id }, nowIso, { role: 'tenant', refId: tenant.id, name: tenant.name });
  });

  // One resident is on notice; another left last month and was settled against the deposit.
  const onNotice = tenants[7];
  run('tenant.giveNotice', { tenantId: onNotice.id, leaveOn: addDays(today, 18), reason: 'Moving to Bengaluru for a new job' }, at(addDays(today, -6)));
  const leaver = tenants[tenants.length - 1];
  const leftOn = dateInPeriod(periodM1, 20);
  run('tenant.settle', { tenantId: leaver.id, leftOn, deductions: [{ label: 'Broken cupboard handle', amount: 350 }], refundMode: 'upi', refundReference: 'UTR90812' }, at(leftOn));

  // Expenses over the last three months.
  const expenseSets = [
    ['groceries', 'More Supermarket', 18000, 26000], ['groceries', 'Vegetable market', 7000, 11000], ['gas', 'HP Gas (3 cylinders)', 5200, 5800],
    ['electricity', 'TSSPDCL', 21000, 31000], ['water', 'Tanker water', 3000, 6000], ['internet', 'ACT Fibernet', 2499, 2499],
    ['maintenance', 'Plumber / electrician', 800, 4000], ['cleaning', 'Cleaning supplies', 1200, 2500]
  ];
  for (const period of [periodM2, periodM1, period0]) {
    const { days } = periodBounds(period);
    for (const [category, vendor, lo, hi] of expenseSets) {
      const day = 1 + Math.floor(rand() * Math.min(days, period === period0 ? Math.max(1, Number(today.slice(8)) - 1) : days));
      const date = dateInPeriod(period, day);
      if (date > today) continue;
      run('expense.add', { date, category, amount: Math.round(lo + rand() * (hi - lo)), vendor, mode: category === 'groceries' ? 'upi' : 'bank' }, at(date));
    }
  }

  // Requests from residents at different stages, and notices on the board.
  const req = (tenantIdx, category, title, description, daysAgo, priority = 'normal') => {
    const tenant = tenants[tenantIdx];
    return run('request.create', { category, title, description, priority }, at(addDays(today, -daysAgo)), { role: 'tenant', refId: tenant.id, name: tenant.name });
  };
  const r1 = req(3, 'plumbing', 'Geyser not heating', 'The geyser in the first-floor bathroom has not been heating since yesterday morning.', 2, 'high').requestId;
  const r2 = req(10, 'wifi', 'Wi-Fi drops every evening', 'Between 8 and 11 pm the connection keeps dropping on the second floor.', 5).requestId;
  const r3 = req(14, 'cleaning', 'Room not cleaned on Tuesday', 'Our room was skipped during Tuesday cleaning.', 9, 'low').requestId;
  const r4 = req(1, 'furniture', 'Study table wobbles', 'One leg of the study table is loose.', 20).requestId;
  run('request.update', { requestId: r1, assignedTo: warden, status: 'in_progress', note: 'Electrician visiting today after 4 pm.' }, at(addDays(today, -1)));
  run('request.update', { requestId: r3, assignedTo: cleaner, status: 'resolved', note: 'Cleaned and apologised; added to the Tuesday checklist.' }, at(addDays(today, -7)), owner);
  run('request.update', { requestId: r3, status: 'closed' }, at(addDays(today, -6)), { role: 'tenant', refId: tenants[14].id, name: tenants[14].name });
  run('request.update', { requestId: r4, assignedTo: warden, status: 'resolved', note: 'Carpenter fixed the leg.' }, at(addDays(today, -17)), owner);
  run('request.comment', { requestId: r2, text: 'Raised a ticket with ACT Fibernet; technician visit booked for Thursday.' }, at(addDays(today, -4)), owner);
  run('request.comment', { requestId: r2, text: 'Still dropping last night around 9:30.' }, at(addDays(today, -2)), { role: 'tenant', refId: tenants[10].id, name: tenants[10].name });

  run('notice.post', { title: 'Water supply maintenance on Sunday', body: 'The overhead tank will be cleaned on Sunday between 10 am and 1 pm. Please store water in advance.', audience: 'all', pinned: true }, at(addDays(today, -2)));
  run('notice.post', { title: 'Rent due on the 5th', body: 'A reminder that rent is due by the 5th of every month. Pay through the app or by UPI to shantinivas@okaxis and tap "I have paid".', audience: 'tenants' }, at(addDays(today, -12)));
  run('notice.post', { title: 'Festival dinner on Friday', body: 'Special dinner on Friday evening. Tell Lakshmi by Thursday if you will be away.', audience: 'all', expiresOn: addDays(today, 10) }, at(addDays(today, -1)));
  for (const t of tenants.slice(0, 9)) run('notice.ack', { noticeId: state.notices[0].id }, nowIso, { role: 'tenant', refId: t.id, name: t.name });

  // A few residents will skip dinner tomorrow.
  const tomorrow = addDays(today, 1);
  for (const t of tenants.slice(2, 6)) run('meal.skip', { date: tomorrow, meal: 'dinner', skip: true }, nowIso, { role: 'tenant', refId: t.id, name: t.name });

  state.activity.sort((a, b) => (a.at < b.at ? 1 : -1));
  state.sample = true;
  state.updatedAt = nowIso;
  return state;
}
