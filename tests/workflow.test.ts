/**
 * End-to-end workflow test against the REAL DemoRepo (the same class the UI
 * uses), driven through the same sequence a user performs:
 *
 *   Admin creates an order → assigns a technician → the technician completes it
 *   → a WhatsApp notification appears → Manager reviews → closes.
 *
 * localStorage is polyfilled with a tiny in-memory shim, so this exercises the
 * whole mutation + audit-log path without a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill before importing the repo module.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const { DemoRepo } = await import('../src/lib/repo');
const { canMarkDone, canAssign, computeFinalAmount } = await import('../src/lib/domain');

const admin = { role: 'Admin', name: 'Admin (desk)' } as const;
const tech = { role: 'Technician', name: 'Ali' } as const;
const other = { role: 'Technician', name: 'Bala' } as const;
const manager = { role: 'Manager', name: 'Manager' } as const;

test('a job travels the whole workflow with a complete audit trail', async () => {
  const repo = new DemoRepo();
  const before = await repo.load();
  const expectedOrderNo = `SS-${new Date().getFullYear()}-${String(
    before.orders
      .map((o) => parseInt(o.order_no.split('-')[2] ?? '0', 10))
      .reduce((m, n) => Math.max(m, n), 0) + 1,
  ).padStart(4, '0')}`;

  // 1. Admin creates the order
  const order = await repo.createOrder(
    {
      customer_name: 'Test Customer',
      phone: '012-9998888',
      address: 'No. 1, Jalan Ujian',
      problem_description: 'Aircond not cold',
      service_type: 'Cleaning',
      quoted_price: 180,
      assigned_technician: null,
      admin_notes: '',
    },
    admin,
  );
  assert.equal(order.order_no, expectedOrderNo, 'order number is auto-generated in sequence');
  assert.equal(order.status, 'New', 'an order without a technician starts as New');

  // 2. Assignment moves it to Assigned and is logged
  await repo.assignTechnician(order.order_no, 'Ali', admin);
  let data = await repo.load();
  let current = data.orders.find((o) => o.order_no === order.order_no)!;
  assert.equal(current.status, 'Assigned');
  assert.equal(current.assigned_technician, 'Ali');
  assert.ok(data.events.some((e) => e.order_no === order.order_no && e.event_type === 'assigned'));

  // 3. Only the assigned technician may complete it
  assert.equal(canMarkDone(other.role, other.name, current), false, 'Bala must not be able to complete Ali\'s job');
  assert.equal(canMarkDone(tech.role, tech.name, current), true);

  // 4. The technician starts and completes the job (with over-quote extra charges)
  await repo.startJob(order.order_no, tech);
  data = await repo.load();
  assert.equal(data.orders.find((o) => o.order_no === order.order_no)!.status, 'In Progress');

  const { report, notification } = await repo.completeJob(
    order.order_no,
    {
      work_done: 'Chemical cleaned, gas topped up',
      extra_charges: 25,
      remarks: 'Customer happy',
      technician_name: 'Ali',
      payment_amount: 205,
      payment_method: 'Cash',
      attachments: [{ name: 'job.jpg', mime: 'image/jpeg', size: 1234, url: '' }],
    },
    tech,
  );

  assert.equal(report.final_amount, computeFinalAmount(180, 25), 'final amount is quoted + extra');
  assert.equal(report.final_amount, 205);

  // 5. Module 3 — the notification was created by the status change itself
  assert.equal(notification.order_no, order.order_no);
  assert.equal(notification.target, '012-9998888');
  assert.match(notification.message, /^Hi Test Customer,/);
  assert.match(notification.message, /Job SS-\d{4}-\d{4} has been completed by Technician Ali at /);
  assert.ok(notification.deep_link.startsWith('https://wa.me/60129998888?text='));

  data = await repo.load();
  current = data.orders.find((o) => o.order_no === order.order_no)!;
  assert.equal(current.status, 'Job Done');
  const events = data.events.filter((e) => e.order_no === order.order_no).map((e) => e.event_type);
  for (const expected of ['created', 'assigned', 'started', 'completed', 'payment_recorded', 'notified']) {
    assert.ok(events.includes(expected as (typeof events)[number]), `audit log contains "${expected}"`);
  }
  assert.equal(data.notifications.filter((n) => n.order_no === order.order_no).length, 1, 'exactly one notification per job');
  assert.equal(data.reports.filter((r) => r.order_no === order.order_no).length, 1, 'exactly one report per job');

  // 6. Manager reviews, then closes
  await repo.reviewOrder(order.order_no, manager);
  data = await repo.load();
  assert.equal(data.orders.find((o) => o.order_no === order.order_no)!.status, 'Reviewed');
  await repo.closeOrder(order.order_no, manager);
  data = await repo.load();
  assert.equal(data.orders.find((o) => o.order_no === order.order_no)!.status, 'Closed');
  assert.ok(canAssign(admin.role), 'admin may assign');
  assert.equal(canAssign(manager.role), false, 'manager may not assign');
});

test('rescheduling returns the job to the assigned state and is counted', async () => {
  const repo = new DemoRepo();
  const order = await repo.createOrder(
    {
      customer_name: 'Reschedule Customer',
      phone: '012-1112222',
      address: 'No. 2, Jalan Ujian',
      problem_description: 'Service',
      service_type: 'Inspection',
      quoted_price: 100,
      assigned_technician: 'John',
      admin_notes: '',
    },
    admin,
  );
  assert.equal(order.status, 'Assigned', 'assigning at creation time skips the New state');

  await repo.reschedule(order.order_no, 'Customer not available', admin);
  const data = await repo.load();
  const current = data.orders.find((o) => o.order_no === order.order_no)!;
  assert.equal(current.status, 'Assigned', 'still assigned, ready for another attempt');
  const reschedules = data.events.filter((e) => e.order_no === order.order_no && e.event_type === 'rescheduled');
  assert.equal(reschedules.length, 1);
  assert.match(reschedules[0].detail, /Customer not available/);
});

test('completing the same job twice replaces the report instead of duplicating it', async () => {
  const repo = new DemoRepo();
  const order = await repo.createOrder(
    {
      customer_name: 'Repeat Customer',
      phone: '012-3334444',
      address: 'No. 3, Jalan Ujian',
      problem_description: 'Noise',
      service_type: 'Repair',
      quoted_price: 120,
      assigned_technician: 'Yusoff',
      admin_notes: '',
    },
    admin,
  );

  const payload = {
    work_done: 'Replaced relay',
    extra_charges: 0,
    remarks: '',
    technician_name: 'Yusoff',
    payment_amount: null,
    payment_method: null,
    attachments: [] as { name: string; mime: string; size: number; url: string }[],
  };
  await repo.completeJob(order.order_no, payload, { role: 'Technician', name: 'Yusoff' });
  await repo.completeJob(order.order_no, { ...payload, extra_charges: 30 }, { role: 'Technician', name: 'Yusoff' });

  const data = await repo.load();
  const reports = data.reports.filter((r) => r.order_no === order.order_no);
  assert.equal(reports.length, 1, 'one report per order');
  assert.equal(reports[0].final_amount, 150, 'the latest figures win');
  assert.equal(data.notifications.filter((n) => n.order_no === order.order_no).length, 1);
});

test('the 6-file cap is enforced by the repo, not just the form', async () => {
  const repo = new DemoRepo();
  const order = await repo.createOrder(
    {
      customer_name: 'Evidence Customer',
      phone: '012-5556666',
      address: 'No. 4, Jalan Ujian',
      problem_description: 'Leak',
      service_type: 'Repair',
      quoted_price: 90,
      assigned_technician: 'Bala',
      admin_notes: '',
    },
    admin,
  );
  const files = Array.from({ length: 7 }).map((_, i) => ({ name: `f${i}.jpg`, mime: 'image/jpeg', size: 10, url: '' }));
  await assert.rejects(
    () =>
      repo.completeJob(
        order.order_no,
        {
          work_done: 'Repaired leak',
          extra_charges: 0,
          remarks: '',
          technician_name: 'Bala',
          payment_amount: null,
          payment_method: null,
          attachments: files,
        },
        { role: 'Technician', name: 'Bala' },
      ),
    /Maximum 6 files/,
  );
});

test('marking a notification as sent is recorded', async () => {
  const repo = new DemoRepo();
  const data1 = await repo.load();
  const withNotification = data1.notifications.find((n) => n.status === 'prepared');
  assert.ok(withNotification, 'the seed contains prepared notifications');
  await repo.markNotificationSent(withNotification!.order_no);
  const data2 = await repo.load();
  assert.equal(data2.notifications.find((n) => n.order_no === withNotification!.order_no)!.status, 'sent');
});
