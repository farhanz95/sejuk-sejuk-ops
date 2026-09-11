/**
 * Business-rule tests. These are the rules the brief cares about most:
 * the workflow order, who may do what, the auto-calculated final amount, the
 * 6-file cap, and the WhatsApp message/deep link.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amountProblem,
  computeFinalAmount,
  formatPhoneInput,
  normalisePhone,
  pinHash,
  phoneProblem,
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


// ---------------------------------------------------------------- input rules

test('phone numbers are accepted in every shape people write them', () => {
  for (const ok of ['0123456789', '012-345 6789', '+60 12-345 6789', '60123456789', '03-1234 5678', '(03) 1234-5678']) {
    assert.equal(phoneProblem(ok), null, `${ok} should be accepted`);
  }
});

test('phone numbers that are obviously wrong are rejected with a reason', () => {
  assert.match(phoneProblem('') ?? '', /Enter a phone number/);
  assert.match(phoneProblem('12345') ?? '', /short/i);
  assert.match(phoneProblem('0123456789012345') ?? '', /too long/i);
  assert.match(phoneProblem('12-345 6789') ?? '', /Start with 0/);
  assert.match(phoneProblem('call me') ?? '', /letters/i);
  assert.match(phoneProblem('0012345678') ?? '', /second digit/i);
});

test('a stored phone keeps the leading 0 and drops the country code', () => {
  assert.equal(normalisePhone('+60 12-345 6789'), '0123456789');
  assert.equal(normalisePhone('012-345 6789'), '0123456789');
  assert.equal(normalisePhone('60123456789'), '0123456789');
});

test('amounts are validated as money, not free text', () => {
  assert.equal(amountProblem('180'), null);
  assert.equal(amountProblem('180.50'), null);
  assert.equal(amountProblem(0), null);
  assert.equal(amountProblem('', { required: false }), null);
  assert.match(amountProblem('', { required: true }) ?? '', /required/i);
  assert.match(amountProblem('abc') ?? '', /must be a number/i);
  assert.match(amountProblem('12 000') ?? '', /must be a number/i);
  assert.match(amountProblem('-5') ?? '', /negative/i);
  assert.match(amountProblem('3.999') ?? '', /2 decimal/i);
  assert.match(amountProblem('9999999') ?? '', /too large/i);
});

test('the order draft uses the phone and price rules', () => {
  const base = {
    customer_name: 'Ahmad Zaki',
    phone: '012-345 6789',
    address: 'No. 12, Jalan Sejuk, Shah Alam',
    problem_description: 'Not cold',
    service_type: 'Cleaning',
    quoted_price: '180',
    assigned_technician: 'Ali',
    admin_notes: '',
  };
  assert.deepEqual(validateOrderDraft(base as never), []);

  const badPhone = validateOrderDraft({ ...base, phone: 'abc' } as never);
  assert.ok(badPhone.some((e) => /letters/i.test(e)), JSON.stringify(badPhone));

  const badPrice = validateOrderDraft({ ...base, quoted_price: '-10' } as never);
  assert.ok(badPrice.some((e) => /negative/i.test(e)), JSON.stringify(badPrice));

  const hugePrice = validateOrderDraft({ ...base, quoted_price: '9999999' } as never);
  assert.ok(hugePrice.some((e) => /too large/i.test(e)), JSON.stringify(hugePrice));
});

test('the completion report validates the money fields it collects', () => {
  const draft = {
    work_done: 'Serviced the unit',
    extra_charges: '25',
    remarks: '',
    technician_name: 'Ali',
    attachmentCount: 0,
    payment_amount: '100',
    payment_method: 'Cash' as const,
  };
  assert.deepEqual(validateCompletion(draft, 320), []);

  const badExtra = validateCompletion({ ...draft, extra_charges: '-5' }, 320);
  assert.ok(badExtra.some((e) => /cannot be negative/i.test(e)), JSON.stringify(badExtra));

  const badPayment = validateCompletion({ ...draft, payment_amount: 'abc' }, 320);
  assert.ok(badPayment.some((e) => /must be a number/i.test(e)), JSON.stringify(badPayment));

  const overPaid = validateCompletion({ ...draft, payment_amount: '500' }, 320);
  assert.ok(overPaid.some((e) => /cannot exceed/i.test(e)), JSON.stringify(overPaid));
});

test('a phone number formats itself as it is typed', () => {
  // Requested: typing a number should look like 012-345 6789, with the dash and the
  // space, so the field reads like a phone number rather than a run of digits.
  assert.equal(formatPhoneInput('0123456789'), '012-345 6789', 'mobile number');
  assert.equal(formatPhoneInput('0132224455'), '013-222 4455', 'another mobile');
  assert.equal(formatPhoneInput('+60 12-345 6789'), '012-345 6789', 'a pasted international number looks local');
  assert.equal(formatPhoneInput('60123456789'), '012-345 6789', 'so does a number without the plus');
  assert.equal(formatPhoneInput('03-1234 5678'), '03-1234 5678', 'landline keeps its own grouping');
  assert.equal(formatPhoneInput('0312345678'), '03-1234 5678', 'landline typed bare');
  assert.equal(formatPhoneInput('012'), '012', 'partial input is left alone');
  assert.equal(formatPhoneInput('0123'), '012-3', 'and gains the dash as it goes');
  assert.equal(formatPhoneInput('abc'), '', 'letters are dropped entirely');
  assert.equal(formatPhoneInput(''), '', 'empty stays empty');
});


test('the browser PIN hash is byte-identical to the SQL hash', async () => {
  // The admin screen writes pin_hash itself, so it must produce exactly what the login
  // function compares against: encode(digest(phone || ':' || pin, 'sha256'), 'hex'),
  // with the phone normalised first.
  const expected = 'e374eb097b194d3ccfc524b73996c8e38ff46a53bbf39f555cd6ad73792ab28b'; // sha256("0123456789:1234")
  assert.equal(await pinHash('0123456789', '1234'), expected, 'digits only');
  assert.equal(await pinHash('012-345 6789', '1234'), expected, 'a formatted number normalises to the same hash');
  assert.equal(await pinHash('+60 12-345 6789', '1234'), expected, 'and so does an international one');
  assert.notEqual(await pinHash('0123456789', '1235'), expected, 'a different PIN hashes differently');
});
