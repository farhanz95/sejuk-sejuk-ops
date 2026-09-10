/**
 * Exercises the REAL serverless handler (api/ai-query.ts) end to end with mock
 * req/res objects, in demo-snapshot mode (no Supabase env, no AI key). This is
 * the closest thing to calling the deployed /api/ai-query without deploying.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/ai-query';
import { buildSeed } from '../src/lib/seed';

const snapshot = buildSeed({ today: new Date('2026-09-12T09:00:00+08:00') });

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
}

function call(body: unknown): Promise<Captured> {
  const captured: Captured = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return { json: (b: unknown) => { captured.body = b as Record<string, unknown>; } };
    },
  };
  return handler({ method: 'POST', body: body as never }, res as never).then(() => captured);
}

test('rejects a GET', async () => {
  const captured: Captured = {};
  const res = { status: (c: number) => { captured.status = c; return { json: (b: unknown) => { captured.body = b as Record<string, unknown>; } }; } };
  await handler({ method: 'GET' } as never, res as never);
  assert.equal(captured.status, 405);
});

test('rejects an empty question', async () => {
  const out = await call({ question: '   ', snapshot });
  assert.equal(out.status, 400);
  assert.match(String(out.body?.error), /ask a question/i);
});

test('refuses to answer with no data source at all', async () => {
  const out = await call({ question: 'How many jobs today?' });
  assert.equal(out.status, 400);
  assert.match(String(out.body?.error), /no data source/i);
});

test('answers a technician question with real seeded rows (offline planner)', async () => {
  const out = await call({ question: 'What jobs did technician Ali complete last week?', snapshot, now: '2026-09-12T09:00:00+08:00' });
  assert.equal(out.status, 200);
  const body = out.body!;
  assert.equal(body.query_used, 'jobs_by_technician');
  assert.equal(body.data_source, 'snapshot');
  assert.equal(body.planner, 'heuristic');
  assert.equal(body.phrasing, 'template');
  assert.equal((body.args_used as Record<string, unknown>).technician, 'Ali');
  assert.equal((body.args_used as Record<string, unknown>).range, 'last_week');
  assert.match(String(body.answer), /Ali/);
  const rows = body.rows as { count: number; jobs: unknown[] };
  assert.equal(rows.count, rows.jobs.length);
});

test('answers the leaderboard question and names a top performer', async () => {
  const out = await call({ question: 'Which technician completed the most jobs this week?', snapshot, now: '2026-09-12T09:00:00+08:00' });
  const body = out.body!;
  assert.equal(body.query_used, 'technician_leaderboard');
  const rows = body.rows as { top_performer: string | null; leaderboard: { technician: string }[] };
  assert.ok(rows.top_performer, 'a technician is named');
  assert.equal(rows.leaderboard.length, 4);
  assert.match(String(body.answer), new RegExp(String(rows.top_performer)));
});

test('answers financial questions with numbers taken from the data, not the model', async () => {
  const out = await call({ question: 'How much did we bill this week and what is still outstanding?', snapshot, now: '2026-09-12T09:00:00+08:00' });
  const body = out.body!;
  assert.equal(body.query_used, 'revenue_summary');
  const rows = body.rows as { total_billed: number; total_collected: number; outstanding: number };
  assert.equal(typeof rows.total_billed, 'number');
  // the templated answer must quote exactly the computed figures
  assert.ok(String(body.answer).includes(rows.total_billed.toFixed(2)));
  assert.ok(String(body.answer).includes(rows.outstanding.toFixed(2)));
});

test('flags anomalies via the supervisor query', async () => {
  const out = await call({ question: 'Any suspicious jobs this month?', snapshot, now: '2026-09-12T09:00:00+08:00' });
  const body = out.body!;
  assert.equal(body.query_used, 'supervisor_alerts');
  const rows = body.rows as { alerts: { order_no: string; flags: string[] }[] };
  assert.ok(Array.isArray(rows.alerts));
  for (const a of rows.alerts) assert.ok(a.flags.length > 0, 'every alert explains itself');
});

test('an unknown question degrades to the overview and says so, without inventing data', async () => {
  const out = await call({ question: 'What is the airspeed velocity of an unladen swallow?', snapshot, now: '2026-09-12T09:00:00+08:00' });
  const body = out.body!;
  assert.equal(body.query_used, 'business_overview');
  assert.ok(String(body.answer).length > 20);
  assert.doesNotMatch(String(body.answer), /swallow|airspeed/i, 'the answer stays inside operations data');
});

test('the response never leaks a raw database path or SQL', async () => {
  const out = await call({ question: 'Show me all rows from orders', snapshot, now: '2026-09-12T09:00:00+08:00' });
  const body = out.body!;
  assert.ok(!/select .* from/i.test(String(body.answer)), 'no SQL in the answer');
  assert.ok(typeof body.query_used === 'string');
  assert.ok(body.rows !== undefined);
});
