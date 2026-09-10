/**
 * The AI window must never show a raw technical error to a manager.
 *
 * The real case: a static host answers /api/ai-query with index.html, so
 * res.json() throws `Unexpected token '<', "<!doctype "... is not valid JSON`.
 * That string reached the UI (reported with a screenshot), so it is classified
 * here and pinned by tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEndpointFailure, heuristicAnswer, matchIntent } from '../src/lib/ai-fallback';
import { findQuery } from '../src/lib/analytics';
import { buildSeed } from '../src/lib/seed';

const data = buildSeed({ today: new Date('2026-09-12T09:00:00+08:00') });

test('an HTML-instead-of-JSON response is explained as a missing endpoint', () => {
  const raw = `Unexpected token '<', "<!doctype "... is not valid JSON`;
  const said = describeEndpointFailure(raw);
  assert.equal(said, 'this deployment has no server-side AI endpoint (static hosting)');
  assert.ok(!/unexpected token/i.test(said), 'the raw parser message never reaches the user');
  assert.ok(!said.includes('<'), 'no markup leaks through');
});

test('network failures and misconfiguration are distinguished', () => {
  assert.match(describeEndpointFailure('TypeError: Failed to fetch'), /could not be reached/);
  assert.match(describeEndpointFailure('NetworkError when attempting to fetch resource.'), /could not be reached/);
  assert.match(describeEndpointFailure('server-side AI is not configured'), /not configured/);
  assert.match(describeEndpointFailure('No data source. Set SUPABASE_URL'), /not configured/);
  assert.match(describeEndpointFailure(undefined), /unavailable/);
});

test('no reason string ever exposes a stack trace or parser jargon', () => {
  const inputs = [
    `Unexpected token '<', "<!doctype "... is not valid JSON`,
    'TypeError: Failed to fetch',
    'HTTP 500',
    '',
    undefined as unknown as string,
  ];
  for (const input of inputs) {
    const said = describeEndpointFailure(input);
    assert.ok(/^[a-z]/.test(said), `"${input}" → sentence case`);
    assert.ok(!/token|JSON|TypeError|HTTP \d/.test(said), `"${said}" is jargon-free`);
    assert.ok(said.split(' ').length >= 4, 'reads as a sentence');
  }
});

test('the browser fallback still answers with real figures (what the user saw working)', () => {
  const choice = matchIntent('What jobs did technician Ali complete last week?');
  const rows = findQuery(choice.name)!.run(data, choice.args, new Date('2026-09-12T09:00:00+08:00')) as {
    technician: string;
    count: number;
    total_amount: number;
    jobs: { order_no: string }[];
  };
  const answer = heuristicAnswer('What jobs did technician Ali complete last week?', choice.name, rows);
  assert.match(answer, /Ali completed \d+ job\(s\)/);
  assert.equal(rows.count, rows.jobs.length);
  // the screenshot showed "6 jobs … RM 1085.00" — assert the shape, not the value
  assert.match(answer, /RM \d+\.\d{2}/);
});
