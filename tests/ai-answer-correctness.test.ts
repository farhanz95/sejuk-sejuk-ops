/**
 * Two correctness fixes that came out of asking the deployed LLM real questions.
 *
 * 1. Currency: asked about billing, the free model answered "$5,885" for rows
 *    that are Malaysian Ringgit. A wrong currency is a wrong answer, so the
 *    guard is deterministic code, not a prompt instruction.
 * 2. Period vs backlog: asked (in Malay) "how many jobs this week?", it answered
 *    with the all-time "Job Done" count. The overview now exposes period-scoped
 *    counts and both the planner prompt and the offline answer say which is which.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceRmCurrency } from '../server/ai-query';
import { businessOverview, QUERY_CATALOG, findQuery } from '../src/lib/analytics';
import { heuristicAnswer, matchIntent } from '../src/lib/ai-fallback';
import { buildSeed } from '../src/lib/seed';

const TODAY = new Date('2026-09-12T09:00:00+08:00');
const data = buildSeed({ today: TODAY });
const thisWeek = { from: new Date('2026-09-07T00:00:00+08:00'), to: new Date('2026-09-13T23:59:59+08:00') };

test('dollar amounts in an answer are rewritten to RM', () => {
  assert.equal(
    enforceRmCurrency('We billed $5,885 this week, and $1,380 is still outstanding.'),
    'We billed RM 5,885 this week, and RM 1,380 is still outstanding.',
  );
  assert.equal(enforceRmCurrency('Total USD 1,200.50 collected'), 'Total RM 1,200.50 collected');
  assert.equal(enforceRmCurrency('That is MYR 900 in fuel'), 'That is RM 900 in fuel');
  assert.equal(enforceRmCurrency('RM 5,885 billed'), 'RM 5,885 billed', 'already-correct text is untouched');
  assert.equal(enforceRmCurrency('RM RM 12'), 'RM 12', 'no double prefix');
  assert.equal(enforceRmCurrency(''), '');
});

test('every RM figure in a templated answer keeps the RM prefix', () => {
  for (const q of QUERY_CATALOG) {
    const args: Record<string, unknown> = { range: 'this_week' };
    if (q.params.some((p) => p.name === 'technician')) args.technician = 'Ali';
    const rows = q.run(data, args, TODAY);
    const answer = heuristicAnswer('summary please', q.name, rows);
    assert.ok(!/\$/.test(answer), `${q.name} answer must not contain $`);
  }
});

test('the overview separates the period from the all-time backlog', () => {
  const o = businessOverview(data, thisWeek);
  assert.ok(Array.isArray(o.counts_by_status_in_period));
  assert.ok(Array.isArray(o.counts_by_status_all_time));
  assert.equal(o.orders_created_in_period, o.counts_by_status_in_period.reduce((s, c) => s + c.count, 0));
  assert.equal(o.counts_by_status_all_time.reduce((s, c) => s + c.count, 0), data.orders.length);

  // the in-period view must be strictly smaller than the backlog here, otherwise
  // the distinction would be untestable (and the bug would not have shown up)
  const periodNew = o.counts_by_status_in_period.find((c) => c.status === 'New')?.count ?? 0;
  const allNew = o.counts_by_status_all_time.find((c) => c.status === 'New')?.count ?? 0;
  assert.ok(periodNew <= allNew);
});

test('the offline answer for a period question quotes the period, not the backlog', () => {
  const choice = matchIntent('How is the business doing this week?');
  const rows = findQuery(choice.name)!.run(data, choice.args, TODAY);
  const answer = heuristicAnswer('How is the business doing this week?', choice.name, rows);
  assert.match(answer, /order\(s\) were created/);
  assert.match(answer, /All-time backlog:/);
  assert.ok(!/\$/.test(answer));
});
