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
const { AuthProvider } = await import('../src/state/AuthState');

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
        React.createElement(
          AuthProvider,
          null,
          React.createElement(AppStateProvider, null, React.createElement(App, null)),
        ),
      ),
    );
  });
}

/**
 * The sign-in screen on its own. In this suite the app runs in demo mode (no
 * Firebase/Supabase env), so `AuthGate` lets the demo through and the login screen
 * would never be exercised through `mount`. Rendering it directly is the only way
 * to test what a real signed-out visitor sees.
 */
async function renderSignIn() {
  const { default: LoginPage } = await import('../src/pages/LoginPage');
  dom.window.localStorage.clear();
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(AuthProvider, null, React.createElement(LoginPage, null)),
    );
  });
  return {
    text: () => container.textContent ?? '',
    buttons: () => [...container.querySelectorAll('button')].map((b) => (b.textContent || '').trim()),
    click: async (re: RegExp) => {
      const el = [...container.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));
      assert.ok(el, `a button matching ${re} exists`);
      await act(async () => {
        el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    },
  };
}

const text = () => container.textContent ?? '';

/** Change via the native setter so React's onChange fires (JSX inputs ignore a
 *  plain `value =` assignment). */
async function typeInto(input: Element, value: string) {
  const proto = input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  assert.ok(setter, 'the native value setter exists');
  await act(async () => {
    (input as HTMLElement).focus();
    setter!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}

function textareaByPlaceholder(needle: string) {
  const el = Array.from(container.querySelectorAll('textarea')).find((t) => (t.placeholder ?? '').includes(needle));
  assert.ok(el, `a textarea with a placeholder containing "${needle}" exists`);
  return el!;
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


test('completing a job asks for confirmation instead of submitting straight away', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');
  await clickText('Complete job');

  const body0 = text();
  assert.match(body0, /Complete SS-2026-/, 'the completion sheet opened');

  // Pressing the button with an empty "work done" must NOT submit, and must say
  // why next to the button (it used to print the error off-screen at the top).
  await clickText('Mark job as done');
  assert.match(text(), /Not saved yet — please fix this:/, 'the failure is shown at the button');
  assert.match(text(), /Describe the work done/);
  assert.ok(!/Mark this job as done\?/.test(text()), 'nothing was submitted');

  // Fill the work, then confirm.
  await typeInto(textareaByPlaceholder('Chemical cleaned indoor unit'), 'Serviced the unit and tested cooling');
  await clickText('Mark job as done');
  const confirmText = text();
  assert.match(confirmText, /Mark this job as done\?/, 'the confirmation panel appears');
  assert.match(confirmText, /Final amount/, 'the panel summarises what will be sent');
  assert.match(confirmText, /Serviced the unit and tested cooling/);
  assert.match(confirmText, /Evidence.*no photos attached/s);

  // Going back returns to the form, nothing submitted.
  await clickText('Back to the form');
  assert.ok(!/Mark this job as done\?/.test(text()), 'the panel closed');
  assert.match(text(), /Work done/, 'the form is still there');

  // Now really confirm.
  await clickText('Mark job as done');
  await clickText('Yes, mark it as done');
  const after = text();
  assert.match(after, /completed/i, 'the job is reported as completed');
  assert.match(after, /wa\.me|WhatsApp/i, 'and the customer message is offered');
});


test('the sample-data button fills a long form in one tap', async () => {
  await mount('/orders');
  await clickText('+ New order');
  const fill = container.querySelector('button[title="Fill this form with sample data"]');
  assert.ok(fill, 'the draggable filler is rendered inside the form');
  await act(async () => {
    fill!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const value = (placeholder: string) => (inputByPlaceholder(placeholder) as HTMLInputElement).value;
  assert.equal(value('Ahmad Zaki'), 'Sample Customer', 'the customer name was filled');
  assert.equal(value('012-3456789'), '012-345 6789', 'a valid phone number was filled');
  assert.equal(value('180'), '180', 'a quoted price was filled');
  assert.ok(!/Enter a phone number|cannot contain letters/i.test(text()), 'the sample passes the phone rule');
  assert.ok(!/must be a number|negative|too large/i.test(text()), 'the sample passes the amount rule');
});

test('pressing the filler without moving fills, dragging does not', async () => {
  await mount('/orders');
  await clickText('+ New order');
  const fill = container.querySelector('button[title="Fill this form with sample data"]') as HTMLElement;
  assert.ok(fill);
  // a real drag: pointer moves well past the slop threshold, so no fill happens
  await act(async () => {
    fill.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }));
    fill.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 300 }));
    fill.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 200, clientY: 300 }));
  });
  assert.ok(!/Sample Customer/.test(text()), 'dragging the button must not fill the form');
});

test('a money field clears its 0 on focus and restores it on blur', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');
  await clickText('Complete job');
  assert.match(text(), /Complete SS-2026-/);

  const extra = inputByPlaceholder('0') as HTMLInputElement;
  assert.equal(extra.value, '0', 'the field starts at 0');

  await act(async () => {
    extra.focus();
  });
  assert.equal(extra.value, '', 'focusing clears the 0 so you can just type');

  await act(async () => {
    extra.blur();
  });
  assert.equal(extra.value, '0', 'leaving it empty restores the 0');
});

test('the phone and amount rules complain beside the field', async () => {
  await mount('/orders');
  await clickText('+ New order');

  const phone = inputByPlaceholder('012-3456789');
  await typeInto(phone, 'abc');
  assert.match(text(), /cannot contain letters/i, 'the phone complaint is shown');

  const price = inputByPlaceholder('180') as HTMLInputElement;
  // Spaces and letters are stripped as you type, so what reaches the rule is a number
  await typeInto(price, '12 0a00');
  assert.equal(price.value, '12000', 'the field keeps digits, a dot and a minus only');

  await typeInto(price, '9999999');
  assert.match(text(), /too large/i, 'an implausible amount is refused');

  await typeInto(price, '180');
  await typeInto(phone, '012-345 6789');
  assert.ok(!/cannot contain letters/i.test(text()), 'fixing the phone clears the complaint');
  assert.ok(!/too large/i.test(text()), 'fixing the amount clears its complaint');
});

test('the completion report can be filled with sample data', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');
  await clickText('Complete job');
  const fill = container.querySelector('button[title="Fill this report with sample data"]');
  assert.ok(fill, 'the filler is rendered in the report form');
  await act(async () => {
    fill!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const workDone = textareaByPlaceholder('Chemical cleaned indoor unit') as HTMLTextAreaElement;
  assert.match(workDone.value, /Chemical cleaned the indoor unit/, 'work done was filled');
  assert.match(workDone.value, /tested cooling/, 'the whole sample sentence was used');
  const remarks = inputByPlaceholder('Customer satisfied') as HTMLInputElement;
  assert.match(remarks.value, /reminder in 6 months/, 'remarks were filled');
  const extra = inputByPlaceholder('0') as HTMLInputElement;
  assert.equal(extra.value, '25', 'extra charges were filled');
});


test('starting a job asks for confirmation first', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');
  await clickText('Start job');

  const body = text();
  assert.match(body, /Start this job now\?/, 'the confirmation appears');
  assert.match(body, /Yes, start job/);
  assert.match(body, /Not now/);
  assert.match(body, /SS-2026-\d{4}/, 'it names the job being started');

  // cancel first: nothing changes
  await clickText('Not now');
  assert.ok(!/Start this job now\?/.test(text()), 'the panel closed without starting');

  // then confirm
  await clickText('Start job');
  await clickText('Yes, start job');
  assert.match(text(), /In Progress|started/i, 'the job is now in progress');
});

test('the confirmation panel replaces the form instead of stacking on it', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');
  await clickText('Complete job');
  await typeInto(textareaByPlaceholder('Chemical cleaned indoor unit'), 'Serviced the unit');
  await clickText('Mark job as done');

  const body = text();
  assert.match(body, /Mark this job as done\?/);
  // the sheet's own fields must not still be on screen underneath
  assert.ok(!/Extra charges \(RM\)/.test(body), 'the completion form is not rendered behind the panel');
  assert.ok(!/Payment method/.test(body), 'nor its payment fields');
});


test('the phone back button closes a modal instead of leaving the screen', async () => {
  await mount('/orders');
  await clickText('+ New order');
  assert.match(text(), /New service order/, 'the dialog is open');

  // Android back = a popstate event; it must close the dialog and stay put.
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.ok(!/New service order/.test(text()), 'back closed the dialog');
  assert.match(text(), /Service orders/, 'and left the order list on screen');
  assert.ok(inputByPlaceholder('Search order no'), 'the list search is still there');

  // Reopening then closing with the button must not leave a stale history entry
  // behind: the next back press should close it again, not a phantom one.
  await clickText('+ New order');
  assert.match(text(), /New service order/);
  await clickText('Cancel');
  assert.ok(!/New service order/.test(text()), 'the button closed it');

  await clickText('+ New order');
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.ok(!/New service order/.test(text()), 'back still works after a button close');
});

test('Escape closes a modal too', async () => {
  await mount('/orders');
  await clickText('+ New order');
  assert.match(text(), /New service order/);
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.ok(!/New service order/.test(text()), 'Escape closed the dialog');
});

test('demo mode can be left again', async () => {
  localStorage.setItem('ss_demo_mode', '1');
  await mount('/orders', { keepRole: true });
  assert.ok(/exit demo/i.test(text()), 'the header offers a way out of demo mode');

  await clickText('exit demo');
  assert.equal(localStorage.getItem('ss_demo_mode'), null, 'the demo flag was cleared');
});


test('the tab bar marks the tab you are actually on', async () => {
  await mount('/orders');
  const active = Array.from(container.querySelectorAll('a[aria-current="page"]')).map((a) => (a.textContent || '').trim());
  assert.ok(active.length >= 1, 'one tab is marked as current');
  assert.ok(
    active.some((t) => /Orders/.test(t)),
    `the Orders tab is the active one, got: ${JSON.stringify(active)}`,
  );

  await mount('/dashboard');
  const active2 = Array.from(container.querySelectorAll('a[aria-current="page"]')).map((a) => (a.textContent || '').trim());
  assert.ok(active2.some((t) => /Dashboard/.test(t)), `Dashboard is marked, got ${JSON.stringify(active2)}`);
  assert.ok(!active2.some((t) => /Orders/.test(t)), 'and Orders is not');
});

test('the active tab is also styled, not only marked for screen readers', async () => {
  await mount('/ai');
  const aiTab = Array.from(container.querySelectorAll('a')).find((a) => /AI Query/.test(a.textContent || ''));
  assert.ok(aiTab, 'the AI Query tab exists');
  assert.match(aiTab!.className, /text-brand-700/, 'the active tab is highlighted');
  const other = Array.from(container.querySelectorAll('a')).find((a) => /Dashboard/.test(a.textContent || ''));
  assert.ok(other, 'another tab exists');
  assert.ok(!/text-brand-700/.test(other!.className), 'the inactive tab is not highlighted');
});

test('sign-in offers exactly two ways in, and says the admin must register you', async () => {
  // Access keys are gone: the admin whitelists an email and/or a phone number in
  // Staff access, and that is the invitation.
  const screen = await renderSignIn();
  const body = screen.text();
  assert.ok(!/access key/i.test(body), 'no access-key language anywhere');
  assert.ok(!/join with an access key/i.test(body), 'the old join screen is gone');
  assert.match(body, /must be registered by your admin/, 'the one rule a new person needs is stated');
  const buttons = screen.buttons();
  assert.ok(buttons.some((b) => /Login using email/.test(b)), `email login offered, got: ${buttons.join(' | ')}`);
  assert.ok(buttons.some((b) => /Login using phone number/.test(b)), 'phone login offered');
  assert.equal(buttons.filter((b) => /Login using/.test(b)).length, 2, 'exactly two ways in');
});

test('the phone step has a small way back, and no sign-out before signing in', async () => {
  // Reported: the phone path had no back button, and it showed a sign-out button
  // before the person had signed in.
  const screen = await renderSignIn();
  await screen.click(/Login using phone number/);

  assert.ok(/Login using phone number/.test(screen.text()), 'the phone step opened');
  const back = screen.buttons().find((b) => /^←\s*Back$/.test(b.trim()));
  assert.ok(back, `a back button is present, got: ${screen.buttons().join(' | ')}`);
  assert.ok(!/Sign out/i.test(screen.text()), 'no sign-out button before signing in');

  const backEl = [...container.querySelectorAll('button')].find((b) => /^←\s*Back$/.test((b.textContent || '').trim()))!;
  assert.ok(/text-xs/.test(backEl.className), 'and the back control is small');
  await act(async () => {
    backEl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.ok(/Login using email/.test(screen.text()), 'back returns to the two choices');
});

test('a signed-in member of staff lands in their own workspace, never the demo picker', async () => {
  const { indexDestination } = await import('../src/App');
  // Reported: "after I sign in using google it goes to nowhere" — `/` showed the mock
  // "Pick a role to start (mock login)" screen to a real account.
  assert.equal(indexDestination(true, 'Admin'), '/orders', 'an admin goes to the order desk');
  assert.equal(indexDestination(true, 'Manager'), '/review', 'a manager goes to the review queue');
  assert.equal(indexDestination(true, 'Technician'), '/jobs', 'a technician goes to their jobs');
  assert.equal(indexDestination(false, 'Admin'), null, 'demo mode still shows the picker');
});

test('an admin can actually open the Staff access tab (the guard used to bounce it)', async () => {
  // Reported: "the staff access tab I cant seem to access from admin". Cause: the
  // route moved to /staff but ROLE_SCREENS still listed the old /access-keys, so
  // RequireRole answered every click by navigating back to /orders — the tab looked
  // selected while the order list stayed on screen.
  // The nav tab only appears when Firebase/Supabase env is configured, which it is
  // not in this suite — so the route is exercised directly, after signing in as an
  // admin (the guard reads the persisted role).
  const { canOpen } = await import('../src/components/RequireRole');
  assert.ok(canOpen('Admin', '/staff'), 'an admin may open the staff screen');
  assert.ok(!canOpen('Manager', '/staff'), 'a manager may not');
  assert.ok(!canOpen('Technician', '/staff'), 'a technician may not');

  await mount('/');
  await selectRole('Admin');
  await mount('/staff', { keepRole: true });
  const body = text();
  assert.ok(!/Page not found/.test(body), 'not the 404 page');
  assert.ok(!/Service orders/.test(body), `the order list did not come back, got: ${body.slice(0, 140)}`);
});

test('demo mode shows the staff list without writing to the live whitelist', async () => {
  await mount('/');
  await selectRole('Admin');
  dom.window.localStorage.setItem('ss_demo_mode', '1');
  await mount('/staff', { keepRole: true });
  const body = text();
  assert.match(body, /sample data, and nothing here is saved/i, 'the screen says it is read-only');
  assert.match(body, /Ali bin Ahmad/, 'sample entries are shown so the feature is reviewable');
  dom.window.localStorage.removeItem('ss_demo_mode');
});

test('the staff list is the way people are invited (no key screen)', async () => {
  const { default: StaffAccessPage } = await import('../src/pages/StaffAccessPage');
  dom.window.localStorage.clear();
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AuthProvider, null, React.createElement(StaffAccessPage, null)));
  });
  const body = container.textContent ?? '';
  assert.ok(!/access key/i.test(body), 'the key screen is gone');
  assert.match(body, /Staff access|not configured/i, `staff access screen renders, got: ${body.slice(0, 120)}`);
});


test('two dialogs stacked: a state change in the lower one must not close the upper one', async () => {
  // Reading a document happens inside the New order dialog. Cleaning up the lower
  // dialog's history entry fired popstate, and the handler read that as "back was
  // pressed" — closing the document reader on top. Reported from the live build as
  // "Use these fields does nothing".
  await mount('/');
  await selectRole('Admin');
  await mount('/orders', { keepRole: true });
  await clickText('+ New order');
  assert.match(text(), /New service order/, 'the order dialog is open');

  await clickText('Pull fields from a document');
  const readerBefore = /Read a document|Pull fields from a document/.test(text());
  assert.ok(readerBefore, 'the document reader opened on top');

  // typing in the reader is a state change in the dialog stack
  const area = [...container.querySelectorAll('textarea')].pop()!;
  assert.ok(area, 'the paste area exists');
  await typeInto(area, 'Quotation — Sejuk Sejuk Service\nCustomer: Nadia, 013-222 4455');
  await act(async () => {});

  assert.match(text(), /Read a document|Pull fields from a document/, 'the reader is still open');
  assert.match(text(), /New service order/, 'and the order dialog is still behind it');
});

test('a modal survives state changes inside it (typing, filling, pressing buttons)', async () => {
  // Reported as "clicking the sample-data button / Mark job as done closes the
  // modal" on every device. Cause: Modal re-registered its history entry on every
  // render (onClose was an inline arrow), and the cleanup walked the entry off —
  // history.back() → popstate → the dialog closed itself.
  await mount('/orders');
  await clickText('+ New order');
  assert.match(text(), /New service order/, 'dialog open');

  // typing
  await typeInto(inputByPlaceholder('Ahmad Zaki'), 'Ahmad');
  assert.match(text(), /New service order/, 'typing must not close it');
  assert.equal((inputByPlaceholder('Ahmad Zaki') as HTMLInputElement).value, 'Ahmad', 'the field kept the text');

  // a state-changing button (the same one the user pressed)
  const fill = container.querySelector('button[title="Fill this form with sample data"]');
  assert.ok(fill, 'the sample-data button is present');
  await act(async () => {
    fill!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.match(text(), /New service order/, 'the sample-data button must not close it');
  assert.equal((inputByPlaceholder('Ahmad Zaki') as HTMLInputElement).value, 'Sample Customer', 'and it filled the form');

  // the primary action inside the dialog
  await clickText('Create order');
  assert.ok(!/Page not found/.test(text()), 'the app is still on a real screen');
});

test('the completion dialog stays open through its own buttons', async () => {
  await mount('/jobs');
  await selectRole('Technician:Ali');
  await clickText('My Jobs');
  await clickText('Complete job');
  assert.match(text(), /Complete SS-2026-/, 'sheet open');

  // the sample-data button inside the completion sheet
  const fill = container.querySelector('button[title="Fill this report with sample data"]');
  assert.ok(fill, 'the report filler is present');
  await act(async () => {
    fill!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.match(text(), /Complete SS-2026-/, 'the sheet must still be open after filling');
  assert.match(text(), /Chemical cleaned the indoor unit/, 'and it filled the report');

  // pressing the primary action opens the confirm panel instead of closing
  await clickText('Mark job as done');
  assert.match(text(), /Mark this job as done\?/, 'the confirm panel appears');
  await clickText('Back to the form');
  assert.match(text(), /Complete SS-2026-/, 'and we are back on the form, not out of the sheet');
});
