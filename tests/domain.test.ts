/**
 * Business-rule tests. These are the rules the brief cares about most:
 * the workflow order, who may do what, the auto-calculated final amount, the
 * 6-file cap, and the WhatsApp message/deep link.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFinalAmount,
  canAssign,
  canMarkDone,
  canReview,
  nextOrderNo,
  supervisorFlags,
  validateCompletion,
  validateOrderDraft,
  waDeepLink,
  waNumber,
  whatsAppMessage,
  MAX_ATTACHMENTS,
} from '../src/lib/domain';
import type { Order, ServiceReport } from '../src/lib/types';

const order = (over: Partial<Order> = {}): Order => ({
  order_no: 'SS-2026-0001',
  customer_name: 'Ahmad Zaki',
  phone: '012-3456789',
  address: 'No. 12, Jalan Sejuk, Shah Alam',
  problem_description: 'Aircond not cold',
  service_type: 'Cleaning',
  quoted_price: 180,
  assigned_technician: 'Ali',
  status: 'Assigned',
  admin_notes: '',
  created_at: '2026-09-10T02:00:00.000Z',
  updated_at: '2026-09-10T02:00:00.000Z',
  ...over,
});

const report = (over: Partial<ServiceReport> = {}): ServiceReport => ({
  id: 'sr-1',
  order_no: 'SS-2026-0001',
  work_done: 'Chemical clean',
  extra_charges: 0,
  final_amount: 180,
  remarks: '',
  technician_name: 'Ali',
  completed_at: '2026-09-10T06:00:00.000Z',
  payment_amount: null,
  payment_method: null,
  attachments: [{ id: 'a1', report_id: 'sr-1', name: 'x.jpg', mime: 'image/jpeg', size: 10, url: '' }],
  ...over,
});

test('order numbers are auto-generated and keep counting', () => {
  assert.equal(nextOrderNo([], 2026), 'SS-2026-0001');
  assert.equal(nextOrderNo(['SS-2026-0001'], 2026), 'SS-2026-0002');
  assert.equal(nextOrderNo(['SS-2026-0001', 'SS-2026-0009'], 2026), 'SS-2026-0010');
  // numbers from another year must not interfere
  assert.equal(nextOrderNo(['SS-2025-0042'], 2026), 'SS-2026-0001');
});

test('final amount is quoted + extra, always rounded to cents', () => {
  assert.equal(computeFinalAmount(180, 0), 180);
  assert.equal(computeFinalAmount(180, 25.5), 205.5);
  assert.equal(computeFinalAmount(0.1, 0.2), 0.3); // float noise is handled
  assert.equal(computeFinalAmount(Number.NaN, 50), 50);
});

test('only Admin assigns technicians', () => {
  assert.equal(canAssign('Admin'), true);
  assert.equal(canAssign('Technician'), false);
  assert.equal(canAssign('Manager'), false);
});

test('only the ASSIGNED technician can complete the job', () => {
  const o = order({ assigned_technician: 'Ali' });
  assert.equal(canMarkDone('Technician', 'Ali', o), true);
  assert.equal(canMarkDone('Technician', 'ali', o), true, 'case-insensitive');
  assert.equal(canMarkDone('Technician', 'Bala', o), false, 'another technician must be refused');
  assert.equal(canMarkDone('Admin', 'Ali', o), false, 'admin is not a technician');
  assert.equal(canMarkDone('Technician', 'Ali', order({ assigned_technician: null })), false, 'unassigned job');
});

test('only a Manager reviews or closes', () => {
  assert.equal(canReview('Manager'), true);
  assert.equal(canReview('Admin'), false);
  assert.equal(canReview('Technician'), false);
});

test('order draft validation catches the obvious mistakes', () => {
  const base = {
    customer_name: 'Ahmad',
    phone: '012-3456789',
    address: 'Shah Alam',
    problem_description: 'Not cold',
    service_type: 'Cleaning',
    quoted_price: 180,
    assigned_technician: 'Ali',
    admin_notes: '',
  };
  assert.deepEqual(validateOrderDraft(base), []);
  assert.ok(validateOrderDraft({ ...base, customer_name: '' }).some((e) => /customer name/i.test(e)));
  assert.ok(validateOrderDraft({ ...base, phone: 'abc' }).some((e) => /phone/i.test(e)));
  assert.ok(validateOrderDraft({ ...base, quoted_price: -5 }).some((e) => /quoted price/i.test(e)));
  assert.ok(validateOrderDraft({ ...base, assigned_technician: 'Nobody' }).some((e) => /technician/i.test(e)));
});

test('completion validation enforces the 6-file cap and the payment ceiling', () => {
  const ok = {
    work_done: 'Cleaned coil',
    extra_charges: 20,
    remarks: '',
    technician_name: 'Ali',
    attachmentCount: 3,
    payment_amount: 200,
    payment_method: 'Cash',
  };
  assert.deepEqual(validateCompletion(ok, 180), []);
  assert.ok(validateCompletion({ ...ok, attachmentCount: 7 }, 180).some((e) => /maximum 6 files/i.test(e)));
  assert.equal(validateCompletion({ ...ok, attachmentCount: MAX_ATTACHMENTS }, 180).length, 0);
  assert.ok(validateCompletion({ ...ok, payment_amount: 500 }, 180).some((e) => /cannot exceed/i.test(e)));
  assert.ok(validateCompletion({ ...ok, payment_amount: 20, payment_method: '' }, 180).some((e) => /payment method/i.test(e)));
  assert.deepEqual(validateCompletion({ ...ok, payment_amount: null, payment_method: null }, 180), [], 'payment is optional');
});

test('WhatsApp message matches the brief template and the deep link is correct', () => {
  const msg = whatsAppMessage(order(), 'Ali', '2026-09-10T06:00:00.000Z');
  assert.match(msg, /^Hi Ahmad Zaki,/);
  assert.match(msg, /Job SS-2026-0001 has been completed by Technician Ali at /);
  assert.match(msg, /Please check and leave feedback\./);
  assert.match(msg, /Thank you!/);

  assert.equal(waNumber('012-3456789'), '60123456789');
  assert.equal(waNumber('+60 12-345 6789'), '60123456789');
  assert.equal(waNumber('60123456789'), '60123456789');

  const link = waDeepLink('012-3456789', 'Hi there');
  assert.ok(link.startsWith('https://wa.me/60123456789?text='));
  assert.ok(link.includes(encodeURIComponent('Hi there')));
});

test('AI workflow supervisor flags ballooning invoices and missing evidence', () => {
  assert.deepEqual(supervisorFlags(order({ quoted_price: 180 }), report({ final_amount: 200 })), []);
  const expensive = supervisorFlags(order({ quoted_price: 180 }), report({ final_amount: 400, extra_charges: 220 }));
  assert.equal(expensive.length, 1);
  assert.match(expensive[0], /above the quoted/i);

  const noEvidence = supervisorFlags(order(), report({ attachments: [] }));
  assert.equal(noEvidence.length, 1);
  assert.match(noEvidence[0], /no photo\/video\/PDF evidence/i);

  // quoted price of 0 must not produce a bogus ratio
  assert.deepEqual(supervisorFlags(order({ quoted_price: 0 }), report({ final_amount: 0, extra_charges: 0 })), []);
});
