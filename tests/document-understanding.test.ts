/**
 * Document understanding: the parts that must never be a guess.
 *
 * The LLM reads the document, but normalizeFields() decides what is allowed to
 * become an order field — so these tests are the contract that protects the
 * database from a creative model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_FIELDS,
  extractFieldsHeuristically,
  mergeExtractions,
  normalizeFields,
  parseLooseDate,
  describeExtraction,
} from '../src/lib/doc-fields';
import handler from '../server/extract-document';

const QUOTATION = `SEJUK SEJUK SERVICE SDN BHD
Quotation QT-2026-0912
Date: 12/09/2026
Customer: Ahmad Zaki
Phone: 012-3456789
Address: No. 12, Jalan Sejuk, Shah Alam
Issue: Aircond not cold, water dripping from indoor unit
Service: cleaning
Total: RM 180
Notes: Customer prefers morning slot`;

const WHATSAPP = `Hi, saya nak service aircond
rumah saya No. 5, Lorong Aman 3, Taman Sri Indah
Nama: Siti Nurhaliza
No tel 013-7788990
aircond bunyi kuat and tak sejuk
boleh datang Sabtu 20 Sept 2026
harga dalam RM 250`;

test('the heuristic reader handles a quotation', () => {
  const { fields } = extractFieldsHeuristically(QUOTATION);
  assert.equal(fields.customer_name, 'Ahmad Zaki');
  assert.equal(fields.phone, '012-3456789');
  assert.equal(fields.address, 'No. 12, Jalan Sejuk, Shah Alam');
  assert.equal(fields.service_type, 'Cleaning');
  assert.equal(fields.quoted_price, 180);
  assert.equal(fields.date, '2026-09-12');
  assert.match(fields.problem_description ?? '', /Aircond not cold/i);
  assert.match(fields.admin_notes ?? '', /morning slot/i);
});

test('the heuristic reader handles a WhatsApp-style message', () => {
  const { fields } = extractFieldsHeuristically(WHATSAPP);
  assert.equal(fields.customer_name, 'Siti Nurhaliza');
  assert.equal(fields.phone, '013-7788990');
  assert.equal(fields.quoted_price, 250, 'picks the RM amount, not the house number');
  assert.equal(fields.date, '2026-09-20');
  assert.ok(fields.address && /Lorong Aman/i.test(fields.address));
});

test('dates are parsed in the forms Malaysian paperwork actually uses', () => {
  assert.equal(parseLooseDate('2026-09-12'), '2026-09-12');
  assert.equal(parseLooseDate('12/09/2026'), '2026-09-12');
  assert.equal(parseLooseDate('20 Sept 2026'), '2026-09-20');
  assert.equal(parseLooseDate('september 5, 2026'), '2026-09-05');
  assert.equal(parseLooseDate('31/02/2026'), null, 'impossible dates are refused');
  assert.equal(parseLooseDate('no date here'), null);
});

test('normalizeFields refuses anything the app cannot defend', () => {
  const { fields, missing } = normalizeFields({
    customer_name: '  Ahmad Zaki ',
    phone: 'call me maybe',           // not a phone number
    service_type: 'Magic',            // not one of ours
    quoted_price: 'RM 1,250.50',      // string with symbol
    date: '12/09/2026',
    address: 'null',                  // the model literally wrote "null"
    problem_description: '',
    admin_notes: 'Ring the bell twice',
  });

  assert.equal(fields.customer_name, 'Ahmad Zaki', 'trimmed');
  assert.equal(fields.phone, null, 'a non-phone is rejected');
  assert.equal(fields.service_type, null, 'an unknown service type is rejected');
  assert.equal(fields.quoted_price, 1250.5, 'currency symbol stripped, still a number');
  assert.equal(fields.date, '2026-09-12');
  assert.equal(fields.address, null, 'the literal string "null" is not an address');
  assert.equal(fields.problem_description, null, 'empty string is not a description');
  assert.equal(fields.admin_notes, 'Ring the bell twice');

  for (const key of ['phone', 'service_type', 'address', 'problem_description'] as const) {
    assert.ok(missing.includes(key), `${key} is reported as missing`);
  }
});

test('service types are matched case-insensitively but nothing else is invented', () => {
  assert.equal(normalizeFields({ service_type: 'cleaning' }).fields.service_type, 'Cleaning');
  assert.equal(normalizeFields({ service_type: 'GAS REFILL' }).fields.service_type, 'Gas Refill');
  assert.equal(normalizeFields({ service_type: 'installation' }).fields.service_type, 'Installation');
  assert.equal(normalizeFields({ service_type: 'replacement parts' }).fields.service_type, null);
});

test('an empty document produces no fields and says so', () => {
  const { fields, missing } = normalizeFields({});
  assert.deepEqual(fields, EMPTY_FIELDS);
  assert.equal(missing.length, Object.keys(EMPTY_FIELDS).length);
  assert.match(describeExtraction(fields, missing), /Nothing usable/);
});

test('fields the model drops are filled by the rules (measured behaviour)', () => {
  // what the deployed free-tier model actually returned for the QUOTATION above:
  // it read the identity fields and left problem/price/notes empty
  const byModel = normalizeFields({
    customer_name: 'Ahmad Zaki',
    phone: '012-3456789',
    address: 'No. 12, Jalan Sejuk, Shah Alam',
    service_type: 'Cleaning',
    problem_description: null,
    quoted_price: null,
    date: '2026-09-12',
    admin_notes: null,
  }).fields;
  const { fields: byRules } = extractFieldsHeuristically(QUOTATION);

  const merged = mergeExtractions(byModel, byRules);
  assert.equal(merged.fields.customer_name, 'Ahmad Zaki', 'the model keeps what it read');
  assert.equal(merged.fields.quoted_price, 180, 'the price the model dropped is recovered');
  assert.match(merged.fields.problem_description ?? '', /Aircond not cold/i);
  assert.match(merged.fields.admin_notes ?? '', /morning slot/i);
  assert.deepEqual(merged.filled.sort(), ['admin_notes', 'problem_description', 'quoted_price'].sort());
});

test('a complete model reading is left alone', () => {
  const complete = {
    customer_name: 'A', phone: '012-3456789', address: 'B', service_type: null,
    problem_description: 'C', quoted_price: 10, date: '2026-09-12', admin_notes: 'D',
  };
  const merged = mergeExtractions(complete, EMPTY_FIELDS);
  assert.equal(merged.fields.quoted_price, 10);
  assert.equal(merged.fields.problem_description, 'C');
  assert.equal(merged.filled.length, 0, 'nothing was overwritten');
});

test('the endpoint reads a document without an AI key (heuristic path)', async () => {
  let captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return { json: (b: unknown) => { captured.body = b as Record<string, unknown>; } };
    },
  };
  await handler({ method: 'POST', body: { text: QUOTATION, filename: 'quote.pdf' } } as never, res as never);

  assert.equal(captured.status, 200);
  const body = captured.body!;
  assert.equal(body.extractor, 'heuristic', 'no AI key in the test environment');
  const fields = body.fields as Record<string, unknown>;
  assert.equal(fields.customer_name, 'Ahmad Zaki');
  assert.equal(fields.quoted_price, 180);
  assert.equal(body.filename, 'quote.pdf');
  assert.ok(Array.isArray(body.missing_labels));
  assert.match(String(body.summary), /Read \d+ field/);
});

test('the endpoint rejects a GET and a too-short body', async () => {
  let status: number | undefined;
  const res = { status: (c: number) => { status = c; return { json: () => {} }; } };
  await handler({ method: 'GET' } as never, res as never);
  assert.equal(status, 405);

  await handler({ method: 'POST', body: { text: 'hi' } } as never, res as never);
  assert.equal(status, 400);
});
