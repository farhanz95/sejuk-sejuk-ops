/**
 * Tests for the aggregations that feed both the KPI dashboard and the AI query
 * window. If these numbers are wrong, the AI will confidently report wrong
 * numbers — so they are pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUERY_CATALOG,
  businessOverview,
  dayRange,
  findQuery,
  jobsByTechnician,
  jobsCompletedOn,
  revenueSummary,
  stalledJobs,
  supervisorAlerts,
  technicianLeaderboard,
  type Range,
} from '../src/lib/analytics';
import { buildSeed } from '../src/lib/seed';
import { TECHNICIANS } from '../src/lib/types';

const TODAY = new Date('2026-09-12T09:00:00+08:00');
const data = buildSeed({ today: TODAY });

const lastWeek: Range = { from: new Date('2026-08-31T00:00:00+08:00'), to: new Date('2026-09-06T23:59:59+08:00') };
const thisWeek: Range = { from: new Date('2026-09-07T00:00:00+08:00'), to: new Date('2026-09-13T23:59:59+08:00') };

test('the seed is deterministic (same input, same dataset)', () => {
  const again = buildSeed({ today: TODAY });
  assert.equal(again.orders.length, data.orders.length);
  assert.equal(again.orders[0].order_no, data.orders[0].order_no);
  assert.equal(again.reports.length, data.reports.length);
  assert.deepEqual(
    again.reports.slice(0, 5).map((r) => r.final_amount),
    data.reports.slice(0, 5).map((r) => r.final_amount),
  );
});

test('the seed is rich enough for the dashboard and the AI window to be meaningful', () => {
  assert.ok(data.orders.length >= 30, 'at least 30 orders');
  assert.ok(data.reports.length >= 20, 'at least 20 completed jobs');
  assert.equal(data.notifications.length, data.reports.length, 'every completed job produced a WhatsApp notification');
  // every technician must have work, otherwise the leaderboard looks broken
  for (const t of TECHNICIANS) {
    assert.ok(data.reports.some((r) => r.technician_name === t), `${t} has completed jobs`);
  }
  const statuses = new Set(data.orders.map((o) => o.status));
  assert.ok(statuses.has('Job Done') || statuses.has('Reviewed') || statuses.has('Closed'));
});

test('leaderboard ranks technicians and totals match the raw reports', () => {
  const board = technicianLeaderboard(data, thisWeek);
  assert.equal(board.length, TECHNICIANS.length, 'always one row per technician');
  assert.ok(board[0].jobs_completed >= board[board.length - 1].jobs_completed, 'sorted by jobs completed');

  const expected = data.reports
    .filter((r) => new Date(r.completed_at) >= thisWeek.from && new Date(r.completed_at) <= thisWeek.to)
    .reduce((s, r) => s + r.final_amount, 0);
  const actual = board.reduce((s, b) => s + b.total_amount, 0);
  assert.ok(Math.abs(expected - actual) < 0.01, `totals agree (${expected} vs ${actual})`);
});

test('jobs_by_technician only returns that technician, inside the range', () => {
  const rows = jobsByTechnician(data, 'Ali', thisWeek);
  assert.ok(rows.every((r) => r.order_no), 'rows carry an order number');
  const allAli = data.reports.filter((r) => r.technician_name === 'Ali');
  const inRangeAli = allAli.filter((r) => new Date(r.completed_at) >= thisWeek.from && new Date(r.completed_at) <= thisWeek.to);
  assert.equal(rows.length, inRangeAli.length);
  assert.equal(jobsByTechnician(data, 'Nobody', thisWeek).length, 0);
});

test('jobs completed today counts only today', () => {
  const today = jobsCompletedOn(data, TODAY);
  const expected = data.reports.filter((r) => {
    const d = new Date(r.completed_at);
    return d >= dayRange(TODAY).from && d < dayRange(TODAY).to;
  });
  assert.equal(today.length, expected.length);
});

test('revenue summary adds up: collected + outstanding = billed', () => {
  const rev = revenueSummary(data, lastWeek);
  assert.ok(rev.jobs > 0, 'last week has completed jobs');
  // Each figure is individually rounded to cents, so the identity can be off by
  // at most one cent in either direction — assert at cent precision, not tighter.
  assert.ok(Math.abs(rev.total_collected + rev.outstanding - rev.total_billed) <= 0.011, `${rev.total_collected} + ${rev.outstanding} vs ${rev.total_billed}`);
  assert.ok(rev.outstanding >= 0);
});

test('stalled jobs only lists unfinished orders older than the threshold', () => {
  const stalled = stalledJobs(data, 3, TODAY);
  for (const j of stalled) {
    assert.ok(['New', 'Assigned', 'In Progress'].includes(j.status));
    assert.ok(j.days_open >= 3);
  }
});

test('supervisor alerts carry a human-readable reason', () => {
  const alerts = supervisorAlerts(data, thisWeek);
  for (const a of alerts) {
    assert.ok(a.flags.length > 0);
    assert.ok(a.flags.every((f) => f.length > 10));
  }
});

test('business overview is self-consistent', () => {
  const overview = businessOverview(data, thisWeek);
  const total = overview.counts_by_status.reduce((s, c) => s + c.count, 0);
  assert.equal(total, data.orders.length, 'status counts cover every order');
  assert.equal(overview.leaderboard.length, TECHNICIANS.length);
});

test('every catalog query runs and returns structured data', () => {
  const now = TODAY;
  for (const q of QUERY_CATALOG) {
    const args: Record<string, unknown> = {};
    for (const p of q.params) {
      if (p.name === 'technician') args[p.name] = 'Ali';
      if (p.name === 'range') args[p.name] = 'last_week';
      if (p.name === 'older_than_days') args[p.name] = 2;
      if (p.name === 'ratio_threshold') args[p.name] = 1.5;
    }
    const out = q.run(data, args, now) as Record<string, unknown>;
    assert.ok(out && typeof out === 'object', `${q.name} returns an object`);
    assert.ok(!('error' in out) || q.name === 'jobs_by_technician', `${q.name} has no error for valid args`);
    assert.ok(q.examples.length > 0, `${q.name} documents at least one example question`);
    assert.ok(q.description.length > 20, `${q.name} is described for the planner`);
  }
});

test('the catalog refuses unknown technicians instead of inventing rows', () => {
  const out = findQuery('jobs_by_technician')!.run(data, { technician: 'Ghost', range: 'this_week' }, TODAY) as { error?: string };
  assert.ok(out.error, 'returns an error');
  assert.match(out.error!, /Unknown technician/i);
  assert.match(out.error!, /Ali/);
});

test('range presets resolve to sane windows', () => {
  const today = findQuery('jobs_completed_today')!.run(data, {}, TODAY) as { date: string; count: number };
  assert.equal(today.date, TODAY.toISOString().slice(0, 10));

  const lastWeekOut = findQuery('technician_leaderboard')!.run(data, { range: 'last_week' }, TODAY) as { period: string };
  assert.ok(lastWeekOut.period.includes('→'));

  const allTime = findQuery('business_overview')!.run(data, { range: 'all_time' }, TODAY) as { revenue: { jobs: number } };
  assert.equal(allTime.revenue.jobs, data.reports.length, 'all_time covers every report');
});
