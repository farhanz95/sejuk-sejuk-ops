/**
 * Tests for the AI query path's safety net.
 *
 * The important guarantee is NOT "the LLM answers nicely" — it is that the AI
 * endpoint can only ever touch the controlled catalog, and that the offline
 * intent matcher (used when no AI key is configured) maps the documented
 * example questions onto the right query.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUERY_CATALOG, findQuery } from '../src/lib/analytics';
import { matchIntent } from '../api/ai-query';
import { buildSeed } from '../src/lib/seed';

const TODAY = new Date('2026-09-12T09:00:00+08:00');
const data = buildSeed({ today: TODAY });

test('the intent matcher handles every question advertised in the UI', () => {
  const expectations: [string, string][] = [
    ['What jobs did technician Ali complete last week?', 'jobs_by_technician'],
    ["Show me Bala's jobs this month", 'jobs_by_technician'],
    ['Which technician completed the most jobs this week?', 'technician_leaderboard'],
    ['Who billed the most last month?', 'technician_leaderboard'],
    ['How many jobs were completed today?', 'jobs_completed_today'],
    ['How much did we bill this week and what is still outstanding?', 'revenue_summary'],
    ['Which jobs have been open for more than 3 days?', 'stalled_jobs'],
    ['Any suspicious jobs this month?', 'supervisor_alerts'],
    ['Which jobs went way over the quoted price?', 'supervisor_alerts'],
    ['How is the business doing this week?', 'business_overview'],
    ['Give me an overview.', 'business_overview'],
  ];
  for (const [question, expected] of expectations) {
    assert.equal(matchIntent(question).name, expected, `"${question}"`);
  }
});

test('the intent matcher extracts technician and period arguments', () => {
  const a = matchIntent('What jobs did technician Ali complete last week?');
  assert.equal(a.args.technician, 'Ali');
  assert.equal(a.args.range, 'last_week');

  const b = matchIntent('Bala jobs today');
  assert.equal(b.args.technician, 'Bala');
  assert.equal(b.args.range, 'today');

  const c = matchIntent('which jobs have been open for more than 5 days?');
  assert.equal(c.args.older_than_days, 5);

  // jobs_completed_today takes no arguments — it is always "today".
  const d = matchIntent('jobs completed today');
  assert.equal(d.name, 'jobs_completed_today');
  assert.deepEqual(d.args, {});
});

test('unknown questions fall back to the overview instead of inventing a query', () => {
  const choice = matchIntent('What is the capital of France?');
  assert.equal(choice.name, 'business_overview');
  assert.ok(findQuery(choice.name), 'the fallback exists in the catalog');
});

test('every intent the matcher can produce exists in the catalog (no free-form SQL path)', () => {
  const questions = [
    'Ali jobs this week',
    'who did the most jobs',
    'how many jobs today',
    'revenue this month',
    'anything stuck?',
    'any red flags?',
    'random nonsense question',
  ];
  for (const q of questions) {
    const name = matchIntent(q).name;
    assert.ok(
      QUERY_CATALOG.some((c) => c.name === name),
      `"${q}" → ${name} must be a controlled query`,
    );
  }
});

test('the offline answer path produces real figures from the seeded data', () => {
  // Mirrors what api/ai-query.ts does when no AI key is present.
  const choice = matchIntent('Which technician completed the most jobs this week?');
  const query = findQuery(choice.name)!;
  const rows = query.run(data, choice.args, TODAY) as { top_performer: string | null; leaderboard: { jobs_completed: number }[] };
  assert.ok(rows.top_performer, 'a top performer is named');
  assert.ok(rows.leaderboard[0].jobs_completed >= rows.leaderboard[1].jobs_completed);

  const jobs = matchIntent('What jobs did technician Ali complete last week?');
  const out = findQuery(jobs.name)!.run(data, jobs.args, TODAY) as { count: number; jobs: { order_no: string }[] };
  assert.equal(out.count, out.jobs.length, 'count matches the returned rows');
});
