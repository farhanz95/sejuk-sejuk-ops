/**
 * Aggregations + the CONTROLLED QUERY CATALOG.
 *
 * The brief is explicit: the AI "should not rely on unrestricted access to the
 * entire database" — it must answer from structured data retrieved through
 * controlled queries. So the assistant is given exactly the functions in
 * QUERY_CATALOG below: each one takes a narrow, typed argument set and returns
 * pre-aggregated rows. There is no free-form SQL anywhere in the AI path.
 */
import type { OpsData, Order, OrderStatus, ServiceReport, Technician } from './types';
import { TECHNICIANS } from './types';
import { round2, supervisorFlags } from './domain';

export interface Range {
  from: Date;
  to: Date;
}

export function inRange(iso: string, range: Range): boolean {
  const t = new Date(iso).getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0 = Sunday
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfWeek(d: Date): Date {
  const s = startOfWeek(d);
  s.setDate(s.getDate() + 7);
  return s;
}

export function dayRange(d: Date): Range {
  const from = new Date(d);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export function daysAgo(n: number, anchor = new Date()): Date {
  const d = new Date(anchor);
  d.setDate(d.getDate() - n);
  return d;
}

export interface TechStat {
  technician: string;
  /** Jobs marked "Job Done" (or beyond) inside the range. */
  jobs_completed: number;
  /** Sum of final amounts for those jobs. */
  total_amount: number;
  /** How many of the technician's jobs were postponed/rescheduled in the range. */
  reschedules: number;
  /** Average final amount. */
  average_amount: number;
}

export function reportsInRange(data: OpsData, range: Range): ServiceReport[] {
  return data.reports.filter((r) => inRange(r.completed_at, range));
}

export function orderByNo(data: OpsData, orderNo: string): Order | undefined {
  return data.orders.find((o) => o.order_no === orderNo);
}

/** KPI module: one row per technician — jobs completed, total amount, reschedules. */
export function technicianLeaderboard(data: OpsData, range: Range): TechStat[] {
  const reports = reportsInRange(data, range);
  return TECHNICIANS.map((tech) => {
    const mine = reports.filter((r) => r.technician_name === tech);
    const total = round2(mine.reduce((sum, r) => sum + r.final_amount, 0));
    const reschedules = data.events.filter(
      (e) => e.event_type === 'rescheduled' && inRange(e.created_at, range) && orderByNo(data, e.order_no)?.assigned_technician === tech,
    ).length;
    return {
      technician: tech,
      jobs_completed: mine.length,
      total_amount: total,
      reschedules,
      average_amount: mine.length ? round2(total / mine.length) : 0,
    };
  }).sort((a, b) => b.jobs_completed - a.jobs_completed || b.total_amount - a.total_amount);
}

export function jobsByTechnician(data: OpsData, technician: string, range: Range) {
  const reports = reportsInRange(data, range).filter(
    (r) => r.technician_name.toLowerCase() === technician.toLowerCase(),
  );
  return reports.map((r) => {
    const order = orderByNo(data, r.order_no);
    return {
      order_no: r.order_no,
      service_type: order?.service_type ?? 'Unknown',
      customer_name: order?.customer_name ?? 'Unknown',
      final_amount: r.final_amount,
      completed_at: r.completed_at,
    };
  });
}

export function jobsCompletedOn(data: OpsData, date: Date) {
  const range = dayRange(date);
  return reportsInRange(data, range).map((r) => {
    const order = orderByNo(data, r.order_no);
    return {
      order_no: r.order_no,
      technician: r.technician_name,
      customer_name: order?.customer_name ?? 'Unknown',
      final_amount: r.final_amount,
      completed_at: r.completed_at,
    };
  });
}

export function revenueSummary(data: OpsData, range: Range) {
  const reports = reportsInRange(data, range);
  const total = round2(reports.reduce((s, r) => s + r.final_amount, 0));
  const collected = round2(reports.reduce((s, r) => s + (r.payment_amount ?? 0), 0));
  return {
    jobs: reports.length,
    total_billed: total,
    total_collected: collected,
    outstanding: round2(total - collected),
    average_job_value: reports.length ? round2(total / reports.length) : 0,
  };
}

/** Jobs sitting in an unfinished state for too long — an operations bottleneck. */
export function stalledJobs(data: OpsData, olderThanDays: number, now = new Date()) {
  const open: OrderStatus[] = ['New', 'Assigned', 'In Progress'];
  const cutoff = daysAgo(olderThanDays, now).getTime();
  return data.orders
    .filter((o) => open.includes(o.status) && new Date(o.created_at).getTime() <= cutoff)
    .map((o) => ({
      order_no: o.order_no,
      status: o.status,
      technician: o.assigned_technician ?? '—',
      days_open: Math.floor((now.getTime() - new Date(o.created_at).getTime()) / 86_400_000),
      customer_name: o.customer_name,
    }))
    .sort((a, b) => b.days_open - a.days_open);
}

/** Advanced AI challenge: flag completed jobs that look off, with a reason. */
export function supervisorAlerts(data: OpsData, range: Range, ratioThreshold = 1.5) {
  const alerts: { order_no: string; technician: string; flags: string[] }[] = [];
  for (const report of reportsInRange(data, range)) {
    const order = orderByNo(data, report.order_no);
    if (!order) continue;
    const flags = supervisorFlags(order, report, ratioThreshold);
    if (flags.length) alerts.push({ order_no: report.order_no, technician: report.technician_name, flags });
  }
  return alerts;
}

export function businessOverview(data: OpsData, range: Range) {
  const leaderboard = technicianLeaderboard(data, range);
  const revenue = revenueSummary(data, range);
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    counts_by_status: (['New', 'Assigned', 'In Progress', 'Job Done', 'Reviewed', 'Closed'] as OrderStatus[]).map((s) => ({
      status: s,
      count: data.orders.filter((o) => o.status === s).length,
    })),
    revenue,
    leaderboard,
    technicians_with_no_jobs: TECHNICIANS.filter(
      (t) => !leaderboard.some((r) => r.technician === t && r.jobs_completed > 0),
    ),
    stalled_jobs: stalledJobs(data, 3).slice(0, 5),
    supervisor_alerts: supervisorAlerts(data, range).slice(0, 5),
  };
}

/**
 * THE CATALOG. Single source of truth used by:
 *   - the serverless AI function (tool/function calling schema),
 *   - the offline fallback intent matcher,
 *   - the UI ("what can I ask?" helper list).
 */
export interface QueryDef {
  name: string;
  description: string;
  params: { name: string; type: 'string' | 'number'; required: boolean; description: string }[];
  examples: string[];
  run: (data: OpsData, args: Record<string, unknown>, now?: Date) => unknown;
}

const asString = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const asNumber = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function rangeFromArgs(args: Record<string, unknown>, now = new Date()): Range {
  const preset = asString(args.range, 'this_week').toLowerCase();
  if (preset === 'today') return dayRange(now);
  if (preset === 'last_week') {
    const from = startOfWeek(daysAgo(7, now));
    return { from, to: endOfWeek(daysAgo(7, now)) };
  }
  if (preset === 'last_7_days') return { from: daysAgo(7, now), to: now };
  if (preset === 'this_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: now };
  }
  if (preset === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to };
  }
  if (preset === 'all_time') return { from: new Date(0), to: new Date(8.64e15) };
  return { from: startOfWeek(now), to: endOfWeek(now) };
}

export const QUERY_CATALOG: QueryDef[] = [
  {
    name: 'jobs_by_technician',
    description: "List the jobs (order no, service type, customer, amount, completion time) a named technician completed in a period.",
    params: [
      { name: 'technician', type: 'string', required: true, description: `One of: ${TECHNICIANS.join(', ')}` },
      { name: 'range', type: 'string', required: false, description: 'today | this_week | last_week | last_7_days | this_month | last_month | all_time (default this_week)' },
    ],
    examples: [
      'What jobs did technician Ali complete last week?',
      'Show me Bala\'s jobs this month',
    ],
    run: (data, args, now = new Date()) => {
      const tech = asString(args.technician, '');
      const range = rangeFromArgs(args, now);
      if (!TECHNICIANS.some((t) => t.toLowerCase() === tech.toLowerCase())) {
        return { error: `Unknown technician "${tech}". Known technicians: ${TECHNICIANS.join(', ')}.` };
      }
      const rows = jobsByTechnician(data, tech, range);
      return { technician: tech, period: rangeLabel(range), count: rows.length, jobs: rows, total_amount: round2(rows.reduce((s, r) => s + r.final_amount, 0)) };
    },
  },
  {
    name: 'technician_leaderboard',
    description: 'Ranking of all technicians by jobs completed and total billed amount in a period (also reports reschedules).',
    params: [{ name: 'range', type: 'string', required: false, description: 'today | this_week | last_week | last_7_days | this_month | last_month | all_time' }],
    examples: ['Which technician completed the most jobs this week?', 'Who billed the most last month?'],
    run: (data, args, now = new Date()) => {
      const range = rangeFromArgs(args, now);
      const rows = technicianLeaderboard(data, range);
      const top = rows[0];
      return {
        period: rangeLabel(range),
        leaderboard: rows,
        top_performer: top && top.jobs_completed > 0 ? top.technician : null,
        note: top && top.jobs_completed > 0 ? `${top.technician} completed ${top.jobs_completed} jobs worth RM ${top.total_amount.toFixed(2)}.` : 'No jobs completed in this period.',
      };
    },
  },
  {
    name: 'jobs_completed_today',
    description: 'How many jobs were completed today, with the list.',
    params: [],
    examples: ['How many jobs were completed today?'],
    run: (data, _args, now = new Date()) => {
      const rows = jobsCompletedOn(data, now);
      return { date: now.toISOString().slice(0, 10), count: rows.length, jobs: rows };
    },
  },
  {
    name: 'revenue_summary',
    description: 'Billed vs collected money, outstanding balance and average job value for a period.',
    params: [{ name: 'range', type: 'string', required: false, description: 'today | this_week | last_week | last_7_days | this_month | last_month | all_time' }],
    examples: ['How much did we bill this week and how much is still outstanding?'],
    run: (data, args, now = new Date()) => {
      const range = rangeFromArgs(args, now);
      return { period: rangeLabel(range), ...revenueSummary(data, range) };
    },
  },
  {
    name: 'stalled_jobs',
    description: 'Open jobs (New / Assigned / In Progress) that have been sitting for more than N days.',
    params: [{ name: 'older_than_days', type: 'number', required: false, description: 'default 3' }],
    examples: ['Which jobs have been open for more than 3 days?', 'Any orders stuck?'],
    run: (data, args, now = new Date()) => {
      const days = asNumber(args.older_than_days, 3);
      const rows = stalledJobs(data, days, now);
      return { older_than_days: days, count: rows.length, jobs: rows.slice(0, 20) };
    },
  },
  {
    name: 'supervisor_alerts',
    description: 'AI workflow supervisor: completed jobs where the final amount is far above the quote, or the job was closed with no photo evidence.',
    params: [
      { name: 'range', type: 'string', required: false, description: 'period preset' },
      { name: 'ratio_threshold', type: 'number', required: false, description: 'final/quoted ratio that counts as "too high" — default 1.5' },
    ],
    examples: ['Any suspicious jobs this month?', 'Which jobs went way over the quoted price?'],
    run: (data, args, now = new Date()) => {
      const range = rangeFromArgs(args, now);
      const threshold = asNumber(args.ratio_threshold, 1.5);
      const rows = supervisorAlerts(data, range, threshold);
      return { period: rangeLabel(range), ratio_threshold: threshold, count: rows.length, alerts: rows.slice(0, 20) };
    },
  },
  {
    name: 'business_overview',
    description: 'Overall snapshot: order counts by status, revenue, technician leaderboard, stalled jobs and supervisor alerts. Use this for general "how are we doing" questions.',
    params: [{ name: 'range', type: 'string', required: false, description: 'period preset (default this_week)' }],
    examples: ['How is the business doing this week?', 'Give me an overview.'],
    run: (data, args, now = new Date()) => {
      const range = rangeFromArgs(args, now);
      return businessOverview(data, range);
    },
  },
];

export function rangeLabel(range: Range): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${fmt(range.from)} → ${fmt(range.to)}`;
}

export function findQuery(name: string): QueryDef | undefined {
  return QUERY_CATALOG.find((q) => q.name === name);
}

export function technicianNames(): readonly Technician[] {
  return TECHNICIANS;
}
