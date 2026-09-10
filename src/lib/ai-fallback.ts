/**
 * AI fallback shared by the serverless endpoint and the browser.
 *
 * Two responsibilities:
 *   1. map a question onto one of the CONTROLLED queries (deterministic intent
 *      matcher), and
 *   2. phrase an answer from the aggregated rows.
 *
 * The serverless endpoint prefers the LLM for both steps and falls back to this
 * file when no AI key is configured. The browser uses it when the endpoint is
 * unreachable (e.g. a static-only deploy such as Firebase Hosting), so the AI
 * window still answers real questions with real numbers instead of erroring out.
 */
import { findQuery } from './analytics';

type Json = Record<string, unknown>;

export interface QueryChoice {
  name: string;
  args: Record<string, unknown>;
}

export const TECHNICIAN_NAMES = ['Ali', 'John', 'Bala', 'Yusoff'];

/* -------------------------------------------------- intent fallback path --- */

export function detectRange(q: string): string {
  const s = q.toLowerCase();
  if (/\btoday\b|hari ini/.test(s)) return 'today';
  if (/last week|minggu lepas/.test(s)) return 'last_week';
  if (/last 7|past week|7 days/.test(s)) return 'last_7_days';
  if (/last month|bulan lepas/.test(s)) return 'last_month';
  if (/this month|bulan ini/.test(s)) return 'this_month';
  if (/all time|ever|setakat/.test(s)) return 'all_time';
  return 'this_week';
}

/**
 * Deterministic intent matcher — used when no AI key is present. It is
 * deliberately simple and documented as a limitation: it recognises the
 * question shapes listed in the UI, nothing more.
 */
/**
 * Turns whatever the fetch layer threw into a sentence a manager can read.
 *
 * Static hosts (Firebase Hosting here) answer /api/ai-query with index.html, so
 * res.json() throws `Unexpected token '<' …` — a true statement that means
 * nothing to a user. Classify it instead of showing it.
 */
export function describeEndpointFailure(note: string | undefined): string {
  const n = String(note ?? '');
  if (/Unexpected token|not valid JSON|<!doctype|text\/html/i.test(n)) {
    return 'this deployment has no server-side AI endpoint (static hosting)';
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(n)) {
    return 'the AI service could not be reached';
  }
  if (/no data source|not configured|missing/i.test(n)) {
    return 'server-side AI is not configured on this host';
  }
  return 'the AI endpoint is unavailable';
}

export function matchIntent(question: string): QueryChoice {
  const q = question.toLowerCase();
  const tech = TECHNICIAN_NAMES.find((t) => q.includes(t.toLowerCase()));

  if (tech && /(job|kerja|complete|siap|work)/.test(q)) {
    return { name: 'jobs_by_technician', args: { technician: tech, range: detectRange(q) } };
  }
  if (/(most jobs|top performer|leaderboard|rank|best technician|paling banyak|siapa paling|who (billed|earned|made|did) the most|most (money|revenue|billed))/.test(q)) {
    return { name: 'technician_leaderboard', args: { range: detectRange(q) } };
  }
  if (/(how many.*(today|hari ini)|completed today|jobs today)/.test(q)) {
    return { name: 'jobs_completed_today', args: {} };
  }
  if (/(revenue|billed|billing|collected|outstanding|unpaid|berapakah.*(duit|hasil)|sales)/.test(q)) {
    return { name: 'revenue_summary', args: { range: detectRange(q) } };
  }
  if (/(overload|overloaded|too many jobs|capacity|workload|balanced|beban|terlalu banyak job)/.test(q)) {
    return { name: 'technician_workload', args: { range: detectRange(q) } };
  }
  if (/(stuck|stalled|overdue|open for|belum siap|tertunggak|late)/.test(q)) {
    const m = q.match(/(\d+)\s*(day|hari)/);
    return { name: 'stalled_jobs', args: { older_than_days: m ? Number(m[1]) : 3 } };
  }
  // e.g. "over the quoted price", "way above quote", "higher than quoted"
  if (/((over|above|higher than|exceed)[^.?!]{0,14}quot|suspicious|anomal|weird|fraud|red flag|flag)/.test(q)) {
    return { name: 'supervisor_alerts', args: { range: detectRange(q) } };
  }
  if (tech) {
    return { name: 'jobs_by_technician', args: { technician: tech, range: detectRange(q) } };
  }
  return { name: 'business_overview', args: { range: detectRange(q) } };
}


/* ------------------------------------------------- heuristic answer text --- */

export function heuristicAnswer(question: string, queryName: string, data: unknown): string {
  const d = data as Json;
  const money = (n: unknown) => 'RM ' + Number(n ?? 0).toFixed(2);
  const label = (args: Json) => String(args.period ?? d.period ?? d.date ?? '');

  switch (queryName) {
    case 'jobs_by_technician': {
      const jobs = (d.jobs as Json[]) ?? [];
      if (d.error) return String(d.error);
      if (!jobs.length) return `${d.technician} completed no jobs in ${label(d)}.`;
      const lines = jobs.map((j) => `• ${j.order_no} — ${j.service_type} (${money(j.final_amount)})`).join('\n');
      return `${d.technician} completed ${jobs.length} job(s) in ${label(d)}, worth ${money(d.total_amount)}:\n${lines}`;
    }
    case 'technician_leaderboard': {
      const rows = (d.leaderboard as Json[]) ?? [];
      const withJobs = rows.filter((r) => Number(r.jobs_completed) > 0);
      if (!withJobs.length) return `No jobs were completed in ${label(d)}.`;
      const lines = withJobs
        .map((r) => `• ${r.technician}: ${r.jobs_completed} jobs, ${money(r.total_amount)}${Number(r.reschedules) ? `, ${r.reschedules} reschedule(s)` : ''}`)
        .join('\n');
      return `Top performer in ${label(d)} is ${d.top_performer}.\n${lines}`;
    }
    case 'jobs_completed_today': {
      const jobs = (d.jobs as Json[]) ?? [];
      if (!jobs.length) return `No jobs were completed today (${d.date}).`;
      return `${jobs.length} job(s) completed today (${d.date}):\n${jobs.map((j) => `• ${j.order_no} — ${j.technician} (${money(j.final_amount)})`).join('\n')}`;
    }
    case 'revenue_summary':
      return `For ${label(d)}: ${d.jobs} jobs billed ${money(d.total_billed)}, collected ${money(d.total_collected)}, outstanding ${money(d.outstanding)}. Average job value ${money(d.average_job_value)}.`;
    case 'stalled_jobs': {
      const jobs = (d.jobs as Json[]) ?? [];
      if (!jobs.length) return `No open jobs older than ${d.older_than_days} day(s).`;
      return `${jobs.length} job(s) have been open longer than ${d.older_than_days} day(s):\n${jobs.map((j) => `• ${j.order_no} — ${j.status}, ${j.technician}, ${j.days_open} days`).join('\n')}`;
    }
    case 'technician_workload': {
      const rows = (d.workload as Json[]) ?? [];
      if (!rows.length) return `No jobs were completed in ${label(d)}.`;
      const lines = rows.map(
        (r) => `• ${r.technician}: ${r.jobs_completed} jobs${Number(r.vs_average) ? ` (${Number(r.vs_average).toFixed(1)}× the team average)` : ''}`,
      );
      return `${d.summary}\n${lines.join('\n')}`;
    }
    case 'supervisor_alerts': {
      const alerts = (d.alerts as Json[]) ?? [];
      if (!alerts.length) return `No anomalies detected in ${label(d)} (threshold: final amount ≥ ${d.ratio_threshold}× the quote).`;
      return `${alerts.length} job(s) flagged in ${label(d)}:\n${alerts.map((a) => `• ${a.order_no} (${a.technician}): ${(a.flags as string[]).join(' ')}`).join('\n')}`;
    }
    case 'business_overview': {
      const inPeriod = (d.counts_by_status_in_period as Json[]) ?? (d.counts_by_status as Json[]) ?? [];
      const allTime = (d.counts_by_status_all_time as Json[]) ?? [];
      const rev = d.revenue as Json | undefined;
      const live = inPeriod.filter((c) => Number(c.count) > 0).map((c) => `${c.count} ${c.status}`).join(', ');
      return (
        `In ${label(d)}: ${d.orders_created_in_period ?? '?'} order(s) were created` +
        (live ? ` (${live})` : '') +
        (rev ? `. ${rev.jobs} job(s) completed, billed ${money(rev.total_billed)}, outstanding ${money(rev.outstanding)}.` : '.') +
        (allTime.length ? ` All-time backlog: ${allTime.map((c) => `${c.count} ${c.status}`).join(', ')}.` : '') +
        ((d.stalled_jobs as Json[])?.length ? ` ${(d.stalled_jobs as Json[]).length} job(s) have been open more than 3 days.` : '')
      );
    }
    default:
      return 'I could not map that question to a supported query.';
  }
}

