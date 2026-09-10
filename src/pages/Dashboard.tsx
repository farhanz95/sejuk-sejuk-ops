import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { Card, EmptyState, MoneyText, SectionTitle, StatCard, StatusPill, TimeText } from '../components/ui';
import { dayRange, endOfWeek, jobsCompletedOn, reportsInRange, revenueSummary, stalledJobs, startOfWeek, supervisorAlerts, technicianLeaderboard, type Range } from '../lib/analytics';
import { askAi, type AiResponse } from '../lib/ask-ai';

type Preset = 'today' | 'this_week' | 'last_week' | 'this_month';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
];

function periodPhrase(preset: Preset): string {
  return { today: 'today', this_week: 'this week', last_week: 'last week', this_month: 'this month' }[preset];
}

function rangeFor(preset: Preset): Range {
  const now = new Date();
  if (preset === 'today') return dayRange(now);
  if (preset === 'last_week') {
    const last = new Date(now.getTime() - 7 * 86_400_000);
    return { from: startOfWeek(last), to: endOfWeek(last) };
  }
  if (preset === 'this_month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  return { from: startOfWeek(now), to: endOfWeek(now) };
}

export default function Dashboard() {
  const { data, mode } = useApp();
  const navigate = useNavigate();
  const [preset, setPreset] = useState<Preset>('this_week');
  const [insight, setInsight] = useState<AiResponse | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);

  const range = useMemo(() => rangeFor(preset), [preset]);
  const board = useMemo(() => technicianLeaderboard(data, range), [data, range]);
  const revenue = useMemo(() => revenueSummary(data, range), [data, range]);
  const alerts = useMemo(() => supervisorAlerts(data, range), [data, range]);
  const stalled = useMemo(() => stalledJobs(data, 3), [data]);
  const todayJobs = useMemo(() => jobsCompletedOn(data, new Date()), [data]);
  const reports = useMemo(() => reportsInRange(data, range), [data, range]);

  const maxJobs = Math.max(1, ...board.map((b) => b.jobs_completed));
  const maxAmount = Math.max(1, ...board.map((b) => b.total_amount));
  const statusCounts = ['New', 'Assigned', 'In Progress', 'Job Done', 'Reviewed', 'Closed'].map((s) => ({
    status: s as (typeof data.orders)[number]['status'],
    count: data.orders.filter((o) => o.status === s).length,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Operations dashboard</h1>
          <p className="text-sm text-slate-500">
            Bonus module — technician performance, revenue and anomalies. Period: {range.from.toLocaleDateString('en-MY')} →{' '}
            {range.to.toLocaleDateString('en-MY')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`chip border ${preset === p.key ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Jobs completed" value={String(revenue.jobs)} sub={`${reports.length} service reports in period`} />
        <StatCard label="Total billed" value={'RM ' + revenue.total_billed.toFixed(2)} sub={`avg RM ${revenue.average_job_value.toFixed(2)} per job`} />
        <StatCard label="Collected" value={'RM ' + revenue.total_collected.toFixed(2)} tone="good" sub={`outstanding RM ${revenue.outstanding.toFixed(2)}`} />
        <StatCard label="Completed today" value={String(todayJobs.length)} sub={todayJobs.length ? `${todayJobs.map((j) => j.technician).join(', ')}` : 'none yet'} />
      </div>

      <Card className="p-5">
        <SectionTitle right={<span className="text-xs text-slate-400">weekly data minimum, as specified</span>}>Technician leaderboard</SectionTitle>
        <div className="space-y-3">
          {board.map((b, i) => (
            <div key={b.technician}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${i === 0 && b.jobs_completed > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                    {i + 1}
                  </span>
                  <span className="font-semibold text-slate-800">{b.technician}</span>
                  <span className="text-xs text-slate-500">
                    {b.jobs_completed} jobs · <MoneyText value={b.total_amount} />
                    {b.reschedules ? ` · ${b.reschedules} reschedule(s)` : ''}
                  </span>
                </div>
                <span className="text-xs text-slate-400">avg <MoneyText value={b.average_amount} /></span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(b.jobs_completed / maxJobs) * 100}%` }} />
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(b.total_amount / maxAmount) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Top bar = jobs completed · bottom bar = RM billed (relative to the best technician in this period).</p>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>Orders by status</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {statusCounts.map((s) => (
              <div key={s.status} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <StatusPill status={s.status} size="xs" />
                <span className="text-sm font-bold text-slate-700">{s.count}</span>
              </div>
            ))}
          </div>
          <SectionTitle>
            <span className="mt-4 block">Stalled jobs (open &gt; 3 days)</span>
          </SectionTitle>
          {stalled.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing is stuck. </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {stalled.slice(0, 5).map((j) => (
                <li key={j.order_no} className="flex items-center justify-between gap-2">
                  <button className="text-brand-700 hover:underline" onClick={() => navigate(`/orders/${j.order_no}`)}>
                    {j.order_no}
                  </button>
                  <span className="text-xs text-slate-500">
                    {j.status} · {j.technician} · {j.days_open} days
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle right={<span className="chip bg-amber-100 text-amber-800">{alerts.length}</span>}>AI workflow supervisor</SectionTitle>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-500">
              No completed job in this period looks suspicious (final amount within 1.5× the quote, evidence attached).
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {alerts.slice(0, 5).map((a) => (
                <li key={a.order_no} className="rounded-xl bg-amber-50 p-2">
                  <button className="font-semibold text-amber-900 hover:underline" onClick={() => navigate(`/orders/${a.order_no}`)}>
                    {a.order_no} · {a.technician}
                  </button>
                  <div className="text-xs text-amber-800">{a.flags.join(' ')}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Rule-based detection with AI phrasing in the query window — see the “Any suspicious jobs?” example.
          </p>
        </Card>
      </div>

      <Card className="border-brand-200 bg-brand-50/60 p-5">
        <SectionTitle
          right={
            <button
              className="btn-primary !py-1.5 text-xs"
              disabled={insightBusy}
              onClick={async () => {
                setInsightBusy(true);
                const { response } = await askAi(
                  `Which technician might be overloaded in ${periodPhrase(preset)}, and what should the manager watch?`,
                  data,
                  mode,
                );
                setInsight(response);
                setInsightBusy(false);
              }}
            >
              {insightBusy ? 'Analysing…' : '✨ Analyse this period'}
            </button>
          }
        >
          AI operational insight
        </SectionTitle>
        {insight ? (
          <>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{insight.answer}</p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              <span className="chip bg-white text-slate-600">query: {insight.query_used}</span>
              <span className="chip bg-white text-slate-600">planner: {insight.planner}</span>
              <span className="chip bg-white text-slate-600">data: {insight.data_source}</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Ask the assistant to read the period's workload and call out who is stretched thin — it answers from the same
            controlled queries as the AI window (never raw SQL), so the names and counts match the leaderboard above.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle>Recent completions</SectionTitle>
        {reports.length === 0 ? (
          <EmptyState icon="📈" title="No completed jobs in this period" hint="Try a wider period, or complete a job as a technician." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Order</th>
                  <th className="py-2">Technician</th>
                  <th className="py-2">Customer</th>
                  <th className="py-2">Final amount</th>
                  <th className="py-2">Completed</th>
                </tr>
              </thead>
              <tbody>
                {reports.slice(0, 12).map((r) => {
                  const order = data.orders.find((o) => o.order_no === r.order_no);
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="py-2">
                        <button className="text-brand-700 hover:underline" onClick={() => navigate(`/orders/${r.order_no}`)}>
                          {r.order_no}
                        </button>
                      </td>
                      <td className="py-2">{r.technician_name}</td>
                      <td className="py-2">{order?.customer_name ?? '—'}</td>
                      <td className="py-2 font-medium">
                        <MoneyText value={r.final_amount} />
                      </td>
                      <td className="py-2 text-slate-500">
                        <TimeText iso={r.completed_at} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
