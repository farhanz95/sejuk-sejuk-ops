/**
 * The LLM planner returns human-ish arguments ("last week", "ALI", "3").
 * The catalog matches machine-ish ones (last_week, Ali, 3).
 *
 * Measured against Groq's free models: they really do return
 * `{"range":"last week"}`. Without normalisation that string misses every branch
 * in rangeFromArgs() and silently becomes "this week" — a wrong answer with no
 * error. These tests pin the translation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArgs } from '../server/ai-query';
import { findQuery } from '../src/lib/analytics';
import { buildSeed } from '../src/lib/seed';

const data = buildSeed({ today: new Date('2026-09-12T09:00:00+08:00') });

test('spaced period names from the model become catalog ranges', () => {
  assert.equal(normalizeArgs({ range: 'last week' }).range, 'last_week');
  assert.equal(normalizeArgs({ range: 'this week' }).range, 'this_week');
  assert.equal(normalizeArgs({ range: 'Last Week' }).range, 'last_week');
  assert.equal(normalizeArgs({ range: 'last-week' }).range, 'last_week');
  assert.equal(normalizeArgs({ range: 'this month' }).range, 'this_month');
  assert.equal(normalizeArgs({ range: 'last month' }).range, 'last_month');
  assert.equal(normalizeArgs({ range: 'all time' }).range, 'all_time');
  assert.equal(normalizeArgs({ range: 'today' }).range, 'today');
});

test('already-correct ranges pass through untouched', () => {
  for (const r of ['today', 'this_week', 'last_week', 'last_7_days', 'this_month', 'last_month', 'all_time']) {
    assert.equal(normalizeArgs({ range: r }).range, r);
  }
});

test('technician names are matched to the four field teams regardless of case', () => {
  assert.equal(normalizeArgs({ technician: 'ALI' }).technician, 'Ali');
  assert.equal(normalizeArgs({ technician: '  bala ' }).technician, 'Bala');
  assert.equal(normalizeArgs({ technician: 'technician yusoff' }).technician, 'Yusoff');
  // an unknown name is left for the catalog to reject explicitly
  assert.equal(normalizeArgs({ technician: 'Ghost' }).technician, 'Ghost');
});

test('numeric arguments arriving as strings are converted', () => {
  assert.equal(normalizeArgs({ older_than_days: '5' }).older_than_days, 5);
  assert.equal(normalizeArgs({ ratio_threshold: '1.5' }).ratio_threshold, 1.5);
  assert.equal(normalizeArgs({ older_than_days: 2 }).older_than_days, 2);
});

test('normalised arguments actually select the right period (the bug this fixes)', () => {
  const now = new Date('2026-09-12T09:00:00+08:00');
  const query = findQuery('technician_leaderboard')!;

  const fromModel = normalizeArgs({ range: 'last week' });
  const out = query.run(data, fromModel, now) as { period: string; leaderboard: { jobs_completed: number }[] };
  const thisWeek = query.run(data, { range: 'this_week' }, now) as { period: string };

  assert.notEqual(out.period, thisWeek.period, 'last week must NOT collapse into this week');
  assert.match(out.period, /2026-08-3|2026-09-0/, `period looked like ${out.period}`);

  // and it must be the window that contains the seeded jobs for that range
  const jobs = data.reports.filter((r) => {
    const t = new Date(r.completed_at).getTime();
    const from = new Date('2026-08-31T00:00:00+08:00').getTime();
    const to = new Date('2026-09-06T23:59:59+08:00').getTime();
    return t >= from && t <= to;
  }).length;
  const total = out.leaderboard.reduce((s, r) => s + r.jobs_completed, 0);
  assert.equal(total, jobs, 'the leaderboard counted exactly the last-week jobs');
});

test('unknown shapes do not throw', () => {
  assert.deepEqual(normalizeArgs({}), {});
  assert.equal(normalizeArgs({ range: 42 }).range, 42);
  assert.equal(normalizeArgs({ technician: null }).technician, null);
});
