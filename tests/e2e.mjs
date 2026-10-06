// End-to-end check in a real browser against the real API (in-memory database).
// Covers: device-mode setup from scratch, billing, payment, move-out; the sample PG; online
// accounts with owner + resident + staff on separate sign-ins; language switch; phone layout.
// Run: npm run build && npm run test:e2e
import { chromium } from 'playwright';
import { createApp } from '../backend/src/app.js';
import { mkdirSync } from 'node:fs';

const shots = process.env.SHOTS_DIR || '';
if (shots) mkdirSync(shots, { recursive: true });
const ctx = await createApp({ DATABASE_URL: '', DATA_DIR: ':memory:', AUTH_DEV_OTP: '123456', NODE_ENV: 'test', silent: true });
const server = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let passed = 0; const failures = [];
const check = (name, ok, extra = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL ${name} ${extra}`); } };

async function open(viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('[data-testid="start-setup"]');
  return { page, context, errors };
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const tid = (id) => `[data-testid="${id}"]`;
const rawKeys = async (page) => page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && /^(?:[a-z]+\.)+[a-zA-Z_]+$/.test((e.textContent || '').trim()) && !/@|\.(csv|json)$/.test(e.textContent)).map((e) => e.textContent.trim()));
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  // ---------- 1. device mode, from an empty app ----------
  console.log('device mode: set up a PG from scratch');
  let { page, context, errors } = await open();
  await page.click(tid('start-setup'));
  await page.click('button.choice:has-text("This device only")');
  await page.fill('#setup-owner-name', 'Meena Rao'); await page.fill('#setup-owner-phone', '9811100001'); await page.click(tid('setup-next'));
  await page.fill('#setup-pg-name', 'Rao Ladies PG'); await page.fill('#setup-city', 'Mysuru'); await page.fill('#setup-upi', 'meena@okhdfc'); await page.click(tid('setup-next'));
  await page.fill('#setup-floors', '2'); await page.fill('#setup-rooms-per-floor', '3'); await page.fill('#setup-beds', '2'); await page.fill('#setup-rent', '6500'); await page.click(tid('setup-next'));
  await page.waitForSelector('h1:has-text("Rao Ladies PG")');
  await page.click(tid('nav-rooms')); await page.waitForSelector(tid('room-101'));
  check('wizard created 6 rooms', (await page.locator('.room').count()) === 6);
  // add a resident through an empty bed
  await page.click(`${tid('room-101')} .bed.free >> nth=0`);
  await page.fill('#res-name', 'Kavya Shetty'); await page.fill('#res-phone', '98111 00002'); await page.fill('#res-deposit-paid', '6500'); await page.click(tid('resident-save'));
  await page.waitForSelector('h1:has-text("Kavya Shetty")');
  check('resident saved with deposit held', (await page.locator('.stat:has-text("Deposit held") .v').innerText()).includes('6,500'));
  // duplicate phone is refused with a readable message
  await page.click(tid('nav-residents')); await page.click(tid('resident-add'));
  await page.fill('#res-name', 'Dup'); await page.fill('#res-phone', '9811100002'); await page.click(tid('resident-save'));
  await page.waitForSelector('.toast.bad');
  check('duplicate phone refused', (await page.locator('.toast.bad').innerText()).includes('already used by Kavya Shetty'));
  // bills
  await page.click(tid('nav-billing')); await page.click(tid('generate-bills')); await page.click(tid('confirm-yes'));
  await page.waitForSelector(tid('invoice-row'));
  check('one bill generated', (await page.locator(tid('invoice-row')).count()) === 1);
  await page.click(tid('invoice-row')); await page.click(tid('invoice-pay')); await page.fill('#pay-amount', '3000'); await page.click(tid('payment-save'));
  await page.waitForSelector('.modal:has-text("RCP-0002")');
  check('receipt issued for part payment', (await page.locator('.receipt').innerText()).includes('3,000'));
  await page.keyboard.press('Escape');
  check('bill shows part paid', (await page.locator(tid('invoice-row')).innerText()).includes('Part paid') || (await page.locator(tid('invoice-row')).innerText()).includes('Overdue'));
  // expense, staff, notice
  await page.click(tid('nav-expenses')); await page.click(tid('expense-add')); await page.fill('#exp-amount', '1800'); await page.fill('#exp-vendor', 'Local market'); await page.click(tid('expense-save'));
  await page.waitForSelector('.list:has-text("Local market")');
  await page.click(tid('nav-staff')); await page.click(tid('staff-add')); await page.fill('#staff-name', 'Gowri Amma'); await page.fill('#staff-phone', '9811100003'); await page.fill('#staff-salary', '11000'); await page.click(tid('staff-save'));
  await page.waitForSelector(tid('staff-row'));
  await page.click(tid('nav-community')); await page.click(tid('notice-add')); await page.fill('#notice-title', 'Gate closes at 10 pm'); await page.click(tid('notice-save'));
  await page.waitForSelector('.card:has-text("Gate closes at 10 pm")');
  check('expense, staff and notice saved', true);
  // reload: data persists and the session is restored
  await page.reload(); await page.waitForSelector(tid('nav-home'));
  await page.click(tid('nav-home')); await page.waitForSelector('h1:has-text("Rao Ladies PG")');
  check('data survives a reload', (await page.locator('.stat:has-text("Beds occupied") .v').innerText()).trim() === '1/12');
  // move out and settle against the deposit
  await page.click(tid('nav-residents')); await page.click('a.item:has-text("Kavya Shetty")'); await page.click(tid('resident-moveout'));
  await page.waitForSelector(tid('settle-save')); await shot(page, 'settle');
  await page.click(tid('settle-save')); await page.waitForSelector('.card:has-text("Move-out statement")');
  check('move-out produces a statement and frees the bed', (await page.locator('.pill:has-text("Moved out")').count()) > 0);
  await page.click(tid('nav-reports')); await page.waitForSelector('.chart'); check('reports render', (await page.locator('.chart').count()) >= 2);
  check('no raw translation keys (device owner)', (await rawKeys(page)).length === 0, JSON.stringify(await rawKeys(page)));
  // the resident and staff can sign in on the same device with their phone
  await page.click(tid('sign-out')); await page.click(tid('start-signin')); await page.click('.seg button:has-text("This device only")');
  await page.fill('#signin-phone', '9811100003'); await page.click(tid('signin-submit')); await page.waitForSelector(tid('staff-attendance'));
  await page.click(tid('check-in')); await page.waitForSelector('h2:has-text("Checked in at")'); check('staff signs in and checks in (device)', true);
  check('no page errors (device)', errors.length === 0, errors.join(' | '));
  await context.close();

  // ---------- 2. sample PG ----------
  console.log('sample PG');
  ({ page, context, errors } = await open());
  await page.click(tid('start-sample')); await page.waitForSelector(tid('home-claims')); await shot(page, 'home');
  for (const [nav, sel, name] of [['rooms', '.room', 'rooms'], ['residents', 'a.item', 'residents'], ['billing', tid('claims'), 'billing'], ['expenses', '.bar', 'expenses'], ['staff', tid('staff-row'), 'staff'], ['requests', tid('request-card'), 'requests'], ['community', '.card', 'community'], ['reports', '.chart', 'reports'], ['settings', '#set-name', 'settings']]) {
    await page.click(tid(`nav-${nav}`)); await page.waitForSelector(sel); await shot(page, name);
    const keys = await rawKeys(page); if (keys.length) check(`no raw keys on ${nav}`, false, JSON.stringify(keys));
  }
  check('all owner screens render with sample data', true);
  await page.click(tid('nav-billing')); const before = await page.locator(`${tid('claims')} .list > div`).count();
  await page.click(`${tid('claim-confirm')} >> nth=0`); await page.waitForSelector('.receipt'); await page.keyboard.press('Escape');
  check('confirming a claim issues a receipt', (await page.locator(`${tid('claims')} .list > div`).count()) === before - 1);
  // view as a resident, then language
  await page.click(tid('nav-residents')); await page.click('a.item >> nth=0'); await page.click(tid('view-as')); await page.waitForSelector(tid('tenant-due')); await shot(page, 'tenant');
  check('owner can preview the resident portal', (await page.locator(tid('preview-banner')).count()) === 1);
  await page.click('button:has-text("Back to owner view")'); await page.click(tid('nav-settings'));
  await page.selectOption('#set-lang', 'hi'); await page.waitForFunction(() => document.documentElement.lang === 'hi'); await page.waitForTimeout(400);
  const navText = await page.locator(tid('nav-billing')).innerText();
  check('language switch changes the navigation', !/Rent/.test(navText), navText);
  await page.click(tid('nav-home')); await shot(page, 'home-hi');
  await page.click(tid('nav-settings')); await page.selectOption('#set-lang', 'en');
  await page.locator('.seg button:has-text("Dark")').click(); await page.click(tid('nav-home')); await shot(page, 'home-dark');
  check('no page errors (sample)', errors.length === 0, errors.join(' | '));
  await context.close();

  // ---------- 3. online account: three people, three browsers ----------
  console.log('online account');
  const owner = await open();
  page = owner.page;
  await page.click(tid('start-setup')); await page.fill('#setup-owner-name', 'Imran Khan'); await page.fill('#setup-owner-phone', '9822200001'); await page.click(tid('setup-next'));
  await page.waitForSelector('#setup-code'); await page.fill('#setup-code', '123456'); await page.click(tid('setup-next'));
  await page.fill('#setup-pg-name', 'Khan Boys Hostel'); await page.fill('#setup-upi', 'imran@ybl'); await page.click(tid('setup-next'));
  await page.fill('#setup-floors', '1'); await page.fill('#setup-rooms-per-floor', '2'); await page.fill('#setup-beds', '3'); await page.fill('#setup-rent', '5000'); await page.click(tid('setup-next'));
  await page.waitForSelector('h1:has-text("Khan Boys Hostel")');
  await page.click(tid('nav-rooms')); await page.waitForSelector(tid('room-101')); await page.click(`${tid('room-101')} .bed.free >> nth=0`);
  await page.fill('#res-name', 'Farhan Ali'); await page.fill('#res-phone', '9822200002'); await page.click(tid('resident-save')); await page.waitForSelector('h1:has-text("Farhan Ali")');
  await page.click(tid('nav-staff')); await page.click(tid('staff-add')); await page.fill('#staff-name', 'Raju Cook'); await page.fill('#staff-phone', '9822200003'); await page.fill('#staff-salary', '9000'); await page.click(tid('staff-save')); await page.waitForSelector(tid('staff-row'));
  await page.click(tid('nav-billing')); await page.click(tid('generate-bills')); await page.click(tid('confirm-yes')); await page.waitForSelector(tid('invoice-row'));
  check('owner set up an online PG', true);

  const tenant = await open({ width: 390, height: 844 });
  const tp = tenant.page;
  await tp.click(tid('start-signin')); await tp.fill('#signin-phone', '9822200002'); await tp.click(tid('signin-submit')); await tp.fill('#signin-code', '123456'); await tp.click(tid('signin-submit'));
  await tp.waitForSelector(tid('tenant-due')); await shot(tp, 'tenant-phone');
  check('resident signs in with their phone and sees the bill', (await tp.locator(tid('tenant-due')).innerText()).includes('₹'));
  check('resident portal fits a phone', await noOverflow(tp));
  await tp.click(tid('tenant-pay')); await tp.fill('#claim-ref', '412345678901'); await tp.click(tid('claim-submit')); await tp.waitForSelector('.banner:has-text("Waiting")');
  await tp.click('.seg button:has-text("Requests")'); await tp.click(tid('tenant-request')); await tp.fill('#req-title', 'Fan regulator broken'); await tp.click(tid('request-save')); await tp.waitForSelector(tid('request-card'));
  check('resident claims a payment and raises a request', true);

  await page.click(tid('nav-home')); await page.waitForSelector(tid('home-claims'));
  await page.click(tid('nav-billing')); await page.click(tid('claim-confirm')); await page.waitForSelector('.receipt:has-text("412345678901")'); await page.keyboard.press('Escape');
  check('owner sees and confirms the claim', true);
  await tp.click('.seg button:has-text("Bills")'); await tp.waitForSelector('.pill:has-text("Paid")', { timeout: 30000 });
  check('resident sees the bill paid', true);

  const staff = await open({ width: 390, height: 844 });
  const sp = staff.page;
  await sp.click(tid('start-signin')); await sp.fill('#signin-phone', '9822200003'); await sp.click(tid('signin-submit')); await sp.fill('#signin-code', '123456'); await sp.click(tid('signin-submit'));
  await sp.waitForSelector(tid('staff-attendance')); await sp.click(tid('check-in')); await sp.waitForSelector('h2:has-text("Checked in at")');
  await sp.click('.seg button:has-text("Requests")'); await sp.click(tid('request-resolve')); await sp.waitForSelector('.empty'); await shot(sp, 'staff-phone');
  check('staff checks in and fixes the request', true);
  check('staff portal fits a phone', await noOverflow(sp));
  await tp.click('.seg button:has-text("Requests")'); await tp.waitForSelector('button:has-text("Yes, it is fixed")', { timeout: 30000 }); check('resident is asked to confirm the fix', true);
  for (const [who, e] of [['owner', owner.errors], ['resident', tenant.errors], ['staff', staff.errors]]) check(`no page errors (${who}, online)`, e.length === 0, e.join(' | '));

  // owner console on a phone
  const phone = await open({ width: 390, height: 844 });
  await phone.page.click(tid('start-sample')); await phone.page.waitForSelector('.tabbar'); await shot(phone.page, 'home-phone');
  let fits = await noOverflow(phone.page);
  for (const label of ['Rooms', 'Residents', 'Rent']) { await phone.page.click(`.tabbar .tab:has-text("${label}")`); await phone.page.waitForTimeout(150); fits = fits && (await noOverflow(phone.page)); await shot(phone.page, `phone-${label.toLowerCase()}`); }
  check('owner console fits a phone', fits);
} catch (err) {
  failures.push(`crashed: ${err.message.split('\n')[0]}`); console.error(err);
} finally {
  await browser.close(); server.close(); await ctx.db.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
