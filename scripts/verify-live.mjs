/**
 * Click-through verification of the live demo with a REAL browser, capturing a
 * screenshot at every meaningful step. Run: node verify.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL ?? 'https://sejuk-sejuk-ops.web.app';
const OUT = new URL('./shots/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('•', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const results = { steps: [], orderNo: null, whatsapp: null, aiAnswer: null, errors: [] };

function watch(page, tag) {
  page.on('pageerror', (e) => results.errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') results.errors.push(`${tag} console: ${m.text().slice(0, 200)}`);
  });
}

async function shot(page, name, note) {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  results.steps.push({ name, note, url: page.url() });
  log('shot', name, '—', note);
}

try {
  const page = await browser.newPage();
  watch(page, 'desktop');
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(800);

  // 1 — landing / role picker
  await shot(page, '01-landing', 'landing + role picker, seeded demo data');

  // 2 — Admin: click through the role card
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Continue as Admin'));
    b?.click();
  });
  await sleep(1000);
  await shot(page, '02-admin-orders', 'Module 1 order list with status filters');

  // 3 — New order dialog, filled in like an admin would
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('New order'));
    b?.click();
  });
  await sleep(600);
  await page.type('input[placeholder="e.g. Ahmad Zaki"]', 'Verification Customer');
  await page.type('input[placeholder="012-3456789"]', '012-7778899');
  await page.type('input[placeholder="No. 12, Jalan Sejuk, Shah Alam"]', 'No. 88, Jalan Verify, Shah Alam');
  await page.type('textarea[placeholder="Aircond not cold, water dripping…"]', 'Aircond not cold, water dripping from indoor unit');
  await page.type('input[placeholder="180"]', '200');
  // The header holds the role switch; only the dialog's selects have the real
  // service types / technicians. Match on EXACT option text so the header's
  // "🔧 Technician — Ali" can never be mistaken for the technician field.
  const picked2 = await page.evaluate(() => {
    const setSelect = (sel, matcher) => {
      const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some(matcher));
      if (!s) return false;
      const opt = [...s.options].find(matcher);
      s.value = opt.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const service = setSelect(null, (o) => o.textContent.trim() === 'Repair');
    const tech = setSelect(null, (o) => o.textContent.trim() === 'Ali');
    return { service, tech };
  });
  results.selects = picked2;
  await sleep(300);
  await shot(page, '03-new-order-form', 'Module 1 form: auto order no, technician assignment');

  // 4 — submit and read the order number back
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Create order'));
    b?.click();
  });
  await sleep(1200);
  results.orderNo = await page.evaluate(() => (document.body.innerText.match(/Order (SS-\d{4}-\d{4}) created/) ?? [])[1] ?? null);
  await shot(page, '04-order-created', `order created: ${results.orderNo}`);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Open order summary'));
    b?.click();
  });
  await sleep(900);
  await shot(page, '05-order-detail', 'order detail + audit trail (traceability)');

  // 6 — Technician role, mobile viewport: complete the job
  const mobile = await browser.newPage();
  watch(mobile, 'mobile');
  await mobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await mobile.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(800);
  await mobile.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Ali');
    b?.click();
  });
  await sleep(1200);
  await shot(mobile, '06-tech-jobs-mobile', 'Module 2 technician queue (phone viewport, Ali)');

  // complete the order the ADMIN just created (proves module 1 → module 2 hand-off)
  const picked = await mobile.evaluate((orderNo) => {
    const cards = [...document.querySelectorAll('div.card')];
    const card = cards.find((c) => orderNo && c.textContent.includes(orderNo));
    const btn = card ? [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Complete job')) : null;
    if (btn) btn.click();
    return { found: !!card, clicked: !!btn, orderNo };
  }, results.orderNo);
  results.completedOrder = picked;
  await sleep(900);
  await mobile.type('textarea[placeholder="Chemical cleaned indoor unit, topped up gas, tested cooling…"]', 'Replaced faulty capacitor, topped up gas, tested cooling for 20 minutes.');
  await mobile.type('input[placeholder="Customer satisfied, advised next service in 6 months"]', 'Customer satisfied, spare part replaced.');
  await mobile.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="number"]')];
    const extra = inputs[0];
    if (extra) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(extra, '25');
      extra.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(500);
  await shot(mobile, '07-tech-complete-form', 'Module 2 completion form: final amount auto-calculated');

  await mobile.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Mark job as done'));
    b?.click();
  });
  await sleep(1500);
  results.whatsapp = await mobile.evaluate(() => {
    const pre = document.querySelector('pre');
    return pre ? pre.textContent : null;
  });
  const link = await mobile.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('Send on WhatsApp'));
    return a ? a.getAttribute('href') : null;
  });
  results.whatsappLink = link;
  await shot(mobile, '08-whatsapp-notification', 'Module 3 WhatsApp message + deep link after Job Done');

  // 7 — Manager review on desktop
  const mgr = await browser.newPage();
  watch(mgr, 'manager');
  await mgr.setViewport({ width: 1366, height: 900 });
  await mgr.goto(`${BASE}/review`, { waitUntil: 'networkidle2' });
  await sleep(900);
  await mgr.select('select', 'Manager:Manager').catch(() => {});
  await sleep(1200);
  await shot(mgr, '09-manager-review', 'manager review queue (completed jobs)');

  await mgr.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Approve'));
    b?.click();
  });
  await sleep(1400);
  await shot(mgr, '10-manager-approved', 'job approved → Reviewed');

  // 8 — KPI dashboard
  await mgr.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  await shot(mgr, '11-dashboard', 'bonus module: KPI leaderboard, revenue, stalled jobs, AI flags');

  // 9 — AI query window
  await mgr.goto(`${BASE}/ai`, { waitUntil: 'networkidle2' });
  await sleep(900);
  await mgr.type('input[placeholder="e.g. What jobs did technician Ali complete last week?"]', 'Which technician completed the most jobs this week?');
  await mgr.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Ask');
    b?.click();
  });
  await sleep(4000);
  results.aiAnswer = await mgr.evaluate(() => {
    const el = [...document.querySelectorAll('p')].find((p) => p.textContent.includes('completed') || p.textContent.includes('jobs'));
    return document.body.innerText.slice(0, 1200);
  });
  await shot(mgr, '12-ai-answer', 'AI operations query window answering with controlled-query data');

  // 10 — activity log
  await mgr.goto(`${BASE}/activity`, { waitUntil: 'networkidle2' });
  await sleep(900);
  await shot(mgr, '13-activity', 'audit trail + WhatsApp notification log');
} catch (err) {
  results.errors.push(`FATAL: ${err.message}`);
} finally {
  await browser.close();
}

writeFileSync(`${OUT}summary.json`, JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify({ orderNo: results.orderNo, whatsapp: results.whatsapp, link: results.whatsappLink, errors: results.errors, steps: results.steps.length }, null, 2));
