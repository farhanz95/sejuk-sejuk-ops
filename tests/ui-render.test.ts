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
