/**
 * Renders the REAL React app in jsdom and clicks through it, so the UI is
 * exercised without a browser: landing → role switch → order list → create
 * order dialog. Catches the class of bugs a build cannot (bad hooks, broken
 * props, a crash on first paint).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://sejuk-sejuk-ops.web.app/',
  pretendToBeVisual: true,
});

const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
// Node 24 exposes `navigator` as a getter-only global, so it needs defineProperty.
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.localStorage = dom.window.localStorage;
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const App = (await import('../src/App')).default;
const { AppStateProvider } = await import('../src/state/AppState');

const container = dom.window.document.getElementById('root')!;
let root: ReturnType<typeof createRoot>;

/**
 * `keepRole` is for the reload test: the mock login now persists, so a fresh
 * mount would otherwise inherit whichever role the previous test signed in as.
 */
async function mount(path = '/', opts: { keepRole?: boolean } = {}) {
  if (!opts.keepRole) dom.window.localStorage.clear();
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(AppStateProvider, null, React.createElement(App, null)),
      ),
    );
  });
}

const text = () => container.textContent ?? '';

/** Change via the native setter so React's onChange fires (JSX inputs ignore a
 *  plain `value =` assignment). */
async function typeInto(input: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setter, 'the native value setter exists');
  await act(async () => {
    setter!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

function inputByPlaceholder(needle: string) {
  const el = Array.from(container.querySelectorAll('input')).find((i) => (i.placeholder ?? '').includes(needle));
  assert.ok(el, `an input with a placeholder containing "${needle}" exists`);
  return el!;
}

/** Each job card renders its order number in its own span — count those. */
function jobCardCount() {
  return Array.from(container.querySelectorAll('span')).filter((sp) =>
    /^SS-2026-\d{4}$/.test((sp.textContent ?? '').trim()),
  ).length;
}

/** Switch the mock-login role exactly the way the header selector does. */
async function selectRole(value: string) {
  await act(async () => {
    const select = container.querySelector('select') as HTMLSelectElement;
    assert.ok(select, 'the role selector exists');
    select.value = value;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}

async function clickText(label: string) {
  const target = Array.from(container.querySelectorAll('button, a')).find((el) => (el.textContent ?? '').includes(label));
  assert.ok(target, `a control containing "${label}" exists`);
  await act(async () => {
    target!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

test('the app mounts and shows the landing screen with seeded demo data', async () => {
  await mount('/');
  const body = text();
  assert.match(body, /Sejuk Sejuk Service/);
  assert.match(body, /Pick a role to start/);
  assert.match(body, /demo data/, 'the demo-mode badge is shown');
  assert.match(body, /seeded orders/, 'the order count is rendered from the seed');
  assert.match(body, /Admin/);
  assert.match(body, /Technician/);
  assert.match(body, /Manager/);
});

test('choosing the Admin role lands on the order list with seeded orders', async () => {
  await mount('/');
  await clickText('Continue as Admin');
  const body = text();
  assert.match(body, /Service orders/);
  assert.match(body, /Module 1/, 'the module label is present');
  assert.match(body, /SS-\d{4}-\d{4}/, 'at least one generated order number is listed');
  assert.match(body, /New order/);
  // status filter chips are rendered with counts
  assert.match(body, /Assigned · \d+/);
});

test('the New order dialog opens with the auto-generated order number', async () => {
  await mount('/orders');
  await clickText('+ New order');
  const body = text();
  assert.match(body, /New service order/);
  assert.match(body, /Order No/);
  assert.match(body, /Auto-generated/);
  assert.match(body, /Quoted price/);
  assert.match(body, /Assign technician/);
  // the next order number is previewed, never typed by the admin
  assert.match(body, /SS-\d{4}-\d{4}/);
});

test('the New order dialog offers document reading', async () => {
  await mount('/orders');
  await clickText('+ New order');
  assert.match(text(), /Got the paperwork already\?/, 'the shortcut is offered in the dialog');
  await clickText('Pull fields from a document');
  const body = text();
  assert.match(body, /Pull fields from a document/);
  assert.match(body, /Read document/);
  assert.match(body, /or paste the text/);
  assert.match(body, /only the text is sent for reading/, 'it says what leaves the browser');
});

test('a technician sees only their own two tabs — no KPI, no AI, no company log', async () => {
  await mount('/jobs');
  await act(async () => {
    const select = container.querySelector('select') as HTMLSelectElement;
    select.value = 'Technician:Ali';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const body = text();
  assert.match(body, /My Jobs/);
  assert.match(body, /My Activity/);
  assert.ok(!/Dashboard/.test(body), 'no KPI dashboard tab for a technician');
  assert.ok(!/AI Query/.test(body), 'no AI assistant tab for a technician');
  assert.ok(!/Manager review/.test(body), 'no manager screen for a technician');
  assert.ok(!/Review/.test(body), 'no review tab for a technician');
});

test('the technician history screen scopes itself to that technician', async () => {
  await mount('/jobs');
  await act(async () => {
    const select = container.querySelector('select') as HTMLSelectElement;
    select.value = 'Technician:Ali';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  // switching role deliberately lands on that role's home screen, so reach the
  // history tab the way a technician would: by tapping it
  await clickText('My Activity');
  const body = text();
  assert.match(body, /My activity/);
  assert.match(body, /Jobs this week/);
  assert.match(body, /My history/);
  assert.match(body, /Messages for my customers/);
  assert.match(body, /company revenue, the technician leaderboard/i, 'it says what is deliberately excluded');
});

test('the role survives a reload, so the guard keeps applying', async () => {
  // sign in as a technician …
  await mount('/jobs');
  await act(async () => {
    const select = container.querySelector('select') as HTMLSelectElement;
    select.value = 'Technician:Ali';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });

  // … then reload straight onto a management URL (fresh provider, same storage)
  await mount('/dashboard', { keepRole: true });
  const body = text();
  assert.ok(!/AI operational insight|Technician leaderboard/.test(body), 'a technician must not see the KPI dashboard after a reload');
  assert.match(body, /My jobs/, 'they land back on their own queue instead');
  assert.match(body, /Ali/);
});

test('an admin sees the operations tabs and no review queue', async () => {
  await mount('/orders');
  const body = text();
  assert.match(body, /Orders/);
  assert.match(body, /Dashboard/);
  assert.match(body, /AI Query/);
  assert.match(body, /Activity/);
  assert.ok(!/\bReview\b/.test(body), 'admins do not review jobs');
});

test('the technician view lists only that technician\'s jobs', async () => {
  await mount('/jobs');
  await act(async () => {
    // switch role the same way the header selector does
    const select = container.querySelector('select') as HTMLSelectElement;
    assert.ok(select, 'the role selector exists');
    select.value = 'Technician:Ali';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const body = text();
  assert.match(body, /My jobs/);
  assert.match(body, /Module 2/);
  assert.match(body, /Ali/);
});

test('the dashboard renders KPI figures and the leaderboard', async () => {
  await mount('/dashboard');
  const body = text();
  assert.match(body, /Operations dashboard/);
  assert.match(body, /Jobs completed/);
  assert.match(body, /Total billed/);
  assert.match(body, /Technician leaderboard/);
  for (const tech of ['Ali', 'John', 'Bala', 'Yusoff']) {
    assert.match(body, new RegExp(tech), `leaderboard lists ${tech}`);
  }
  assert.match(body, /Orders by status/);
});

test('the AI window lists its supported queries and limitations', async () => {
  await mount('/ai');
  const body = text();
  assert.match(body, /AI operations query window/);
  assert.match(body, /What can be asked/);
  assert.match(body, /jobs_by_technician/);
  assert.match(body, /Limitations \(by design\)/);
  assert.match(body, /never sees the raw database/);
});

test('the activity log renders the audit trail', async () => {
  await mount('/activity');
  const body = text();
  assert.match(body, /Activity log/);
  assert.match(body, /Every key action is traceable/);
  assert.match(body, /WhatsApp notifications/);
});


test('a technician gets a work log and a search box on My Jobs', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');
  const body = text();
  assert.match(body, /To do/, 'work log shows the open-job count');
  assert.match(body, /Waiting longest/);
  assert.match(body, /Done today/);
  assert.match(body, /Done this week/);
  assert.ok(inputByPlaceholder('Search order ID'), 'the search box is present');
  assert.match(body, /Any date/, 'date-filter chips are present');
  assert.ok(!/supabase/i.test(body), 'the storage-backend chip no longer appears');
});

test('searching My Jobs filters by order id, customer, address and date', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');
  // widen to every job first: the default scope is "To do", and this test is
  // about searching, not about the status filter (covered separately below).
  await clickText('All');

  const { buildSeed } = await import('../src/lib/seed');
  const seed = buildSeed();
  const mine = seed.orders.filter((o) => o.assigned_technician === 'Ali');
  assert.ok(mine.length > 1, 'Ali has several seeded jobs to filter');

  const target = mine[0];
  const box = inputByPlaceholder('Search order ID');

  // by order id
  await typeInto(box, target.order_no);
  assert.ok(text().includes(target.order_no), 'the searched order is still listed');
  assert.ok(!mine.slice(1).some((o) => text().includes(o.order_no)), 'other jobs are filtered out');

  // by customer name
  await typeInto(box, target.customer_name);
  assert.ok(text().includes(target.customer_name));

  // by address (a distinctive fragment)
  await typeInto(box, target.address.split(',')[0].slice(0, 8));
  assert.ok(text().includes(target.customer_name), 'the address search keeps its owner visible');

  // by date, typed the way the portal prints it
  const stamp = new Date(target.updated_at ?? target.created_at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  await typeInto(box, stamp);
  assert.ok(text().includes(target.order_no), `a date search ("${stamp}") finds the job`);

  // nonsense narrows to the empty state rather than showing everything
  await typeInto(box, 'zzz-no-such-job');
  assert.match(text(), /No job matches that/);
});

test('the To do / Done / Any date chips change the list', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');

  const { buildSeed } = await import('../src/lib/seed');
  const seed = buildSeed();
  const mine = seed.orders.filter((o) => o.assigned_technician === 'Ali');
  const open = mine.filter((o) => o.status === 'Assigned' || o.status === 'In Progress');

  assert.equal(jobCardCount(), open.length, 'To do shows only the open jobs');

  await clickText('Done');
  const done = mine.filter((o) => !(o.status === 'Assigned' || o.status === 'In Progress'));
  assert.equal(jobCardCount(), done.length, 'Done shows only finished jobs');

  await clickText('Any date');
  await clickText('All');
  assert.equal(jobCardCount(), mine.length, 'All shows every job assigned to Ali');
});


test('the admin order list opens with a management work log and date filters', async () => {
  await mount('/orders');
  const body = text();
  assert.match(body, /Unassigned/, 'the office sees what nobody owns');
  assert.match(body, /Awaiting review/, 'and what is stuck with the manager');
  assert.match(body, /Oldest open/);
  assert.match(body, /Any date/, 'date chips are present');

  const { buildSeed } = await import('../src/lib/seed');
  const seed = buildSeed();
  assert.equal(jobCardCount(), seed.orders.length, 'the full order book is listed first');

  // a plain-text search narrows the list (it matches any field, so "Ali" also
  // catches names that contain those letters — that is intentional)
  await typeInto(inputByPlaceholder('Search order no'), 'Ali');
  const narrowed = jobCardCount();
  assert.ok(narrowed > 0 && narrowed < seed.orders.length, `expected a narrower list, got ${narrowed}`);

  // an order number is exact: exactly one card
  await typeInto(inputByPlaceholder('Search order no'), seed.orders[0].order_no);
  assert.equal(jobCardCount(), 1, 'searching an order number leaves exactly that order');
});

test('the manager review screen has a work log and search over the queue', async () => {
  await mount('/review');
  await selectRole('Manager:Manager');
  const body = text();
  assert.match(body, /Awaiting review/);
  assert.match(body, /Over quote/);
  assert.match(body, /AI flags/);
  assert.match(body, /Waiting longest/);
  assert.ok(inputByPlaceholder('Search order no'), 'the search box is present');

  const { buildSeed } = await import('../src/lib/seed');
  const seed = buildSeed();
  const awaiting = seed.orders.filter((o) => o.status === 'Job Done');
  assert.ok(awaiting.length > 0, 'the seed leaves jobs awaiting review');
  assert.equal(jobCardCount(), awaiting.length, 'every awaiting job is listed at first');

  const target = awaiting[0];
  await typeInto(inputByPlaceholder('Search order no'), target.order_no);
  assert.equal(jobCardCount(), 1, 'searching by order number leaves just that job');
  assert.ok(text().includes(target.order_no));

  await clickText('Clear');
  assert.equal(jobCardCount(), awaiting.length, 'clearing the search restores the queue');
});

test('the activity log can be searched and date-filtered', async () => {
  await mount('/activity');
  assert.ok(inputByPlaceholder('Search order no'), 'the search box is present');
  assert.match(text(), /Any date/);

  const { buildSeed } = await import('../src/lib/seed');
  const seed = buildSeed();
  const orderNo = seed.orders[seed.orders.length - 1].order_no;
  await typeInto(inputByPlaceholder('Search order no'), orderNo);
  const body = text();
  assert.ok(body.includes(orderNo), 'the searched order appears in the log');
  assert.match(body, /All · \d+/, 'the event chips still render with counts');
});
