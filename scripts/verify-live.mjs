/**
 * End-to-end smoke test of a DEPLOYED build, driven through a real Chrome.
 *
 *   npm run verify:live                                        # Firebase mirror
 *   BASE_URL=https://sejuk-sejuk-ops-five.vercel.app npm run verify:live
 *
 * It walks the product the way a person would — with screenshots at every step
 * and a summary.json (order number, WhatsApp deep link, the answers it saw, and
 * every console error) so the run is evidence, not a claim.
 *
 * Read-only: it creates ONE order and completes it, then reports. Reset the
 * Supabase rows afterwards if you want a pristine dataset (see README).
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL ?? 'https://sejuk-sejuk-ops.web.app';
const OUT = (process.env.SHOTS_DIR ?? 'scripts/shots') .replace(/\/?$/, '/');
mkdirSync(OUT, { recursive: true });

const DOC = `SEJUK SEJUK SERVICE SDN BHD
Quotation QT-2026-SMOKE
Date: 12/09/2026
Customer: Smoke Test Customer
Phone: 012-8899776
Address: No. 21, Jalan Ujian, Shah Alam
Issue: Aircond indoor unit leaking water and not cold
Service: repair
Total: RM 275.00
Notes: Gate code 4488, dog in the porch`;

const log = (...a) => console.log('•', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { base: BASE, steps: [], errors: [] };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});

function watch(page, tag) {
  page.on('pageerror', (e) => results.errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|manifest/i.test(m.text())) results.errors.push(`${tag} console: ${m.text().slice(0, 180)}`);
  });
}

async function shot(page, name, note) {
  await page.screenshot({ path: `${OUT}${name}.png` });
  results.steps.push({ name, note });
  log(name, '—', note);
}

const clickText = (page, label) =>
  page.evaluate((l) => {
    const el = [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes(l));
    if (el) el.click();
    return !!el;
  }, label);

try {
  /* ---------------------------------------------------------------- admin --- */
  const page = await browser.newPage();
  watch(page, 'desktop');
  await page.setViewport({ width: 1366, height: 950 });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(1200);
  const badge = await page.evaluate(() => (document.body.innerText.includes('supabase') ? 'supabase' : 'demo data'));
  await shot(page, '01-landing', `landing (data mode: ${badge})`);

  await clickText(page, 'Continue as Admin');
  await sleep(1400);
  await shot(page, '02-admin-orders', 'order list with status filters');

  /* ------------------------------- document understanding (advanced AI) --- */
  await clickText(page, '+ New order');
  await sleep(700);
  const opened = await clickText(page, 'Pull fields from a document');
  await sleep(700);
  await page.type('textarea[placeholder^="Quotation — Sejuk Sejuk Service"]', DOC);
  await clickText(page, 'Read document');
  await sleep(12000); // model round-trip
  const readCard = await page.evaluate(() => document.body.innerText);
  results.document_reading = {
    dialogOpened: opened,
    readBy: (readCard.match(/read by:[^\n]*/) || [''])[0].trim(),
    fieldsFound: (readCard.match(/Read (\d+) field\(s\)/) || [, '0'])[1],
  };
  await shot(page, '03-document-reading', `document read: ${results.document_reading.readBy || 'n/a'} · ${results.document_reading.fieldsFound} fields`);

  await clickText(page, 'Use these fields');
  await sleep(900);
  results.form_after_import = await page.evaluate(() => ({
    customer: document.querySelector('input[placeholder="e.g. Ahmad Zaki"]')?.value ?? '',
    phone: document.querySelector('input[placeholder="012-3456789"]')?.value ?? '',
    price: document.querySelector('input[placeholder="180"]')?.value ?? '',
  }));
  await shot(page, '04-order-form-filled', `form filled from the document (${results.form_after_import.customer})`);

  await page.evaluate(() => {
    // technician select inside the dialog (exact option text, never the header role switch)
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.trim() === 'Ali'));
    if (sel) {
      sel.value = 'Ali';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await clickText(page, 'Create order');
  await sleep(2500);
  results.order_no = await page.evaluate(() => (document.body.innerText.match(/Order (SS-\d{4}-\d{4}) created/) ?? [])[1] ?? null);
  await shot(page, '05-order-created', `created ${results.order_no}`);

  await clickText(page, 'Open order summary');
  await sleep(1200);
  results.status_after_create = await page.evaluate(() => (document.body.innerText.match(/\b(New|Assigned|In Progress|Job Done|Reviewed|Closed)\b/) || [''])[0]);
  await shot(page, '06-order-detail', `order detail (status: ${results.status_after_create}) + audit trail`);

  /* ----------------------------------------------------- technician (phone) --- */
  const mobile = await browser.newPage();
  watch(mobile, 'mobile');
  await mobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await mobile.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(1400);
  await mobile.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Ali');
    b?.click();
  });
  await sleep(1600);
  await shot(mobile, '07-tech-queue', 'technician queue (phone viewport, Ali)');

  // start the job on the order the admin just created → In Progress
  results.start_result = await mobile.evaluate((orderNo) => {
    const card = [...document.querySelectorAll('div.card')].find((c) => orderNo && c.textContent.includes(orderNo));
    const btn = card ? [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Start job')) : null;
    if (btn) btn.click();
    return { cardFound: !!card, startClicked: !!btn };
  }, results.order_no);
  await sleep(2000);
  results.status_after_start = await mobile.evaluate((orderNo) => {
    const card = [...document.querySelectorAll('div.card')].find((c) => orderNo && c.textContent.includes(orderNo));
    return card ? (card.textContent.match(/In Progress|Assigned/) || [''])[0] : null;
  }, results.order_no);
  await shot(mobile, '08-tech-started', `after Start job → ${results.status_after_start}`);

  // complete it
  await mobile.evaluate((orderNo) => {
    const card = [...document.querySelectorAll('div.card')].find((c) => orderNo && c.textContent.includes(orderNo));
    const btn = card ? [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Complete job')) : null;
    if (btn) btn.click();
  }, results.order_no);
  await sleep(900);
  await mobile.type('textarea[placeholder="Chemical cleaned indoor unit, topped up gas, tested cooling…"]', 'Replaced the drain hose, cleaned the coil, topped up gas and tested cooling for 20 minutes.');
  await mobile.type('input[placeholder="Customer satisfied, advised next service in 6 months"]', 'Leak fixed, customer advised to service every 6 months.');
  await mobile.evaluate(() => {
    const extra = document.querySelectorAll('input[type="number"]')[0];
    if (extra) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(extra, '25');
      extra.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(600);
  await shot(mobile, '09-tech-complete-form', 'completion form, final amount auto-calculated');
  await clickText(mobile, 'Mark job as done');
  await sleep(3000);

  results.whatsapp = await mobile.evaluate(() => {
    const pre = document.querySelector('pre');
    return pre ? pre.textContent : null;
  });
  results.whatsapp_link = await mobile.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('Send on WhatsApp'));
    return a ? a.getAttribute('href') : null;
  });
  await shot(mobile, '10-whatsapp-notification', 'WhatsApp message + deep link triggered by Job Done');

  /* ------------------------------------------------------------- manager --- */
  const mgr = await browser.newPage();
  watch(mgr, 'manager');
  await mgr.setViewport({ width: 1366, height: 950 });
  await mgr.goto(`${BASE}/review`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  await mgr.select('select', 'Manager:Manager').catch(() => {});
  await sleep(1600);
  await shot(mgr, '11-manager-review', 'review queue with completed jobs');
  await clickText(mgr, 'Approve');
  await sleep(2500);
  results.reviewed = await mgr.evaluate(() => /Reviewed/.test(document.body.innerText));
  await shot(mgr, '12-manager-approved', 'job approved → Reviewed');

  /* ---------------------------------------------------- KPI + insight AI --- */
  await mgr.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' });
  await sleep(2000);
  await clickText(mgr, 'Analyse this period');
  await sleep(14000);
  const dash = await mgr.evaluate(() => document.body.innerText);
  results.insight = {
    card: /AI operational insight/i.test(dash),
    answer: (dash.match(/(?:No technician|The workload|Yes, the workload|Ali)[\s\S]{0,220}/) || [''])[0].replace(/\n/g, ' ').slice(0, 220),
    query: (dash.match(/query: [a-z_]+/) || [''])[0],
    planner: (dash.match(/planner: \w+/) || [''])[0],
  };
  await shot(mgr, '13-dashboard-insight', `KPI + AI insight (${results.insight.query}, ${results.insight.planner})`);

  /* --------------------------------------------------------- AI window --- */
  await mgr.goto(`${BASE}/ai`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  await mgr.type('input[placeholder="e.g. What jobs did technician Ali complete last week?"]', 'How much did we bill this week and what is still outstanding?');
  await clickText(mgr, 'Ask');
  await sleep(14000);
  const ai = await mgr.evaluate(() => document.body.innerText);
  results.ai_answer = {
    planner: /planner: llm/.test(ai) ? 'llm' : /planner: heuristic/.test(ai) ? 'heuristic' : 'n/a',
    phrasing: /answer: llm/.test(ai) ? 'llm' : /answer: template/.test(ai) ? 'template' : 'n/a',
    source: (ai.match(/source: \w+/) || [''])[0],
    currencyOk: !/\$\d/.test(ai),
    snippet: (ai.match(/(?:We billed|The total|RM [\d,]+)[\s\S]{0,180}/) || [''])[0].replace(/\n/g, ' ').slice(0, 200),
  };
  await shot(mgr, '14-ai-window', `AI answer (planner: ${results.ai_answer.planner})`);

  /* -------------------------------------------------------------- activity --- */
  await mgr.goto(`${BASE}/activity`, { waitUntil: 'networkidle2' });
  await sleep(1600);
  await shot(mgr, '15-activity', 'audit trail + WhatsApp notification log');
} catch (err) {
  results.errors.push(`FATAL: ${err.message}`);
} finally {
  await browser.close();
}

writeFileSync(`${OUT}summary.json`, JSON.stringify(results, null, 2));

// Print a compact summary (not the whole JSON: dumping a huge object as the
// process exits lost the output and produced a meaningless exit code), and set
// the exit code from the run itself so this is usable as a CI smoke test.
const checks = {
  order_created: !!results.order_no,
  document_read: Number(results.document_reading?.fieldsFound ?? 0) > 0,
  start_took_effect: results.status_after_start === 'In Progress',
  whatsapp_ready: !!results.whatsapp_link,
  reviewed: results.reviewed === true,
  insight_answered: !!results.insight?.answer,
  ai_answered: !!results.ai_answer?.snippet,
  no_console_errors: results.errors.length === 0,
};

console.log('\n=== SMOKE TEST ===');
console.log(`base: ${BASE}`);
console.log(`order: ${results.order_no} | steps: ${results.steps.length} | shots: ${OUT}`);
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
if (results.order_no) {
  console.log(`\nwhatsapp: ${(results.whatsapp ?? '').split('\n')[2] ?? ''}`);
  console.log(`ai answer: ${(results.ai_answer?.snippet ?? '').slice(0, 150)}`);
}
if (results.errors.length) {
  console.log('\nconsole/page errors:');
  results.errors.forEach((e) => console.log(' -', e));
}
console.log(`\nfull detail: ${OUT}summary.json`);

const failed = Object.values(checks).filter((v) => !v).length;
// `process.exitCode` alone left the process exiting 1 even on a clean run (a
// dangling Chrome child), which makes the script useless as a gate. Exit hard,
// but only after the summary above has been written to stdout.
process.exit(failed ? 1 : 0);
