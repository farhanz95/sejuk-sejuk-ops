import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { Card, EmptyState, MoneyText, SectionTitle, StatCard, StatusPill, TimeText } from '../components/ui';
import { money, overQuoteRatio, supervisorFlags } from '../lib/domain';

export default function ManagerReview() {
  const { data, actor, review, close } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'queue' | 'reviewed' | 'flags'>('queue');
  // Same search + date-filter pattern as My Jobs and the admin order list.
  const [query, setQuery] = useState('');
  const [when, setWhen] = useState<'All' | 'Today' | 'This week' | 'This month'>('All');
  const mayReview = actor.role === 'Manager';

  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  /** Matches a job on the things a manager looks it up by: order no, customer,
   *  technician, address, service or date. */
  const matches = (orderNo: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const order = data.orders.find((o) => o.order_no === orderNo);
    if (!order) return false;
    const report = data.reports.find((r) => r.order_no === orderNo);
    const stamp = (iso?: string) => {
      if (!iso) return '';
      const d = new Date(iso);
      return [
        d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        d.toISOString().slice(0, 10),
        `${d.getDate()}/${d.getMonth() + 1}`,
        `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      ].join(' ');
    };
    return [
      order.order_no,
      order.customer_name,
      order.address,
      order.service_type,
      order.assigned_technician ?? '',
      report?.technician_name ?? '',
      stamp(report?.completed_at ?? order.updated_at),
    ]
      .join(' ')
      .toLowerCase()
      .includes(q);
  };

  const inRange = (iso?: string) => {
    if (when === 'All') return true;
    if (!iso) return false;
    const today = dayStart(new Date());
    const cutoff = when === 'Today' ? today : when === 'This week' ? today - 7 * 86400000 : today - 30 * 86400000;
    return dayStart(new Date(iso)) >= cutoff;
  };

  const queue = useMemo(
    () =>
      data.orders.filter(
        (o) => o.status === 'Job Done' && inRange(data.reports.find((r) => r.order_no === o.order_no)?.completed_at) && matches(o.order_no),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.orders, data.reports, query, when],
  );
  const reviewed = useMemo(
    () => data.orders.filter((o) => o.status === 'Reviewed' && inRange(o.updated_at) && matches(o.order_no)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.orders, data.reports, query, when],
  );

  /** What a manager wants at a glance: how much is waiting, what looks wrong
   *  with it, and how long the oldest one has been sitting. */
  const workLog = useMemo(() => {
    const awaiting = data.orders.filter((o) => o.status === 'Job Done');
    const oldestDays = awaiting.length
      ? Math.max(
          ...awaiting.map((o) => {
            const report = data.reports.find((r) => r.order_no === o.order_no);
            const iso = report?.completed_at ?? o.updated_at;
            return Math.floor((dayStart(new Date()) - dayStart(new Date(iso))) / 86400000);
          }),
        )
      : 0;
    const overQuote = awaiting.filter((o) => {
      const report = data.reports.find((r) => r.order_no === o.order_no);
      return report ? report.final_amount > o.quoted_price : false;
    }).length;
    return { awaiting: awaiting.length, oldestDays, overQuote };
  }, [data.orders, data.reports]);

  const flagged = useMemo(
    () =>
      data.reports
        .map((r) => {
          const order = data.orders.find((o) => o.order_no === r.order_no);
          if (!order) return null;
          const flags = supervisorFlags(order, r);
          return flags.length ? { report: r, order, flags, ratio: overQuoteRatio(order, r) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => (b.ratio === Infinity ? 99 : b.ratio) - (a.ratio === Infinity ? 99 : a.ratio)),
    [data.reports, data.orders],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Manager review</h1>
        <p className="text-sm text-slate-500">
          Completed jobs arrive here for approval. Signed in as <strong>{actor.name}</strong>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard
          label="Awaiting review"
          value={String(workLog.awaiting)}
          sub="completed, not approved"
          tone={workLog.awaiting > 0 ? 'warn' : 'default'}
        />
        <StatCard
          label="Waiting longest"
          value={workLog.oldestDays <= 0 ? 'today' : `${workLog.oldestDays}d`}
          sub="since the job was finished"
        />
        <StatCard
          label="Over quote"
          value={String(workLog.overQuote)}
          sub="final above the quote"
          tone={workLog.overQuote > 0 ? 'warn' : 'default'}
        />
        <StatCard label="AI flags" value={String(flagged.length)} sub="supervisor anomalies" />
      </div>

      <Card className="p-3">
        <input
          className="input"
          placeholder="Search order no, customer, technician, address, service, date…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(['All', 'Today', 'This week', 'This month'] as const).map((w) => (
            <button
              key={w}
              className={`chip border ${when === w ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}
              onClick={() => setWhen(w)}
            >
              {w === 'All' ? 'Any date' : w}
            </button>
          ))}
          {query || when !== 'All' ? (
            <button className="btn-ghost !py-1 text-xs" onClick={() => { setQuery(''); setWhen('All'); }}>
              Clear
            </button>
          ) : null}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['queue', `Awaiting review · ${queue.length}`],
            ['reviewed', `Reviewed · ${reviewed.length}`],
            ['flags', `⚠ AI flags · ${flagged.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`chip border ${tab === key ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'queue' ? (
        queue.length === 0 ? (
          <EmptyState
            icon="✅"
            title={query || when !== 'All' ? 'No completed job matches that' : 'Nothing waiting for review'}
            hint={
              query || when !== 'All'
                ? 'Try an order number (SS-2026-…), a customer or technician name, or widen the date filter to Any date.'
                : 'Complete a job from the Technician role to see it appear here.'
            }
          />
        ) : (
          <div className="space-y-2">
            {queue.map((o) => {
              const report = data.reports.find((r) => r.order_no === o.order_no);
              const flags = report ? supervisorFlags(o, report) : [];
              return (
                <Card key={o.order_no} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-800">{o.order_no}</span>
                        <StatusPill status={o.status} />
                        {flags.length ? <span className="chip bg-amber-100 text-amber-800">⚠ {flags.length} flag(s)</span> : null}
                      </div>
                      <div className="mt-1 truncate text-sm text-slate-600">
                        {o.customer_name} · {o.service_type}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-slate-500">Quoted → final</div>
                      <div className="font-semibold text-slate-800">
                        <MoneyText value={o.quoted_price} /> → <MoneyText value={report?.final_amount ?? o.quoted_price} />
                      </div>
                      {report && report.final_amount > o.quoted_price ? (
                        <div className="text-xs text-amber-700">
                          +{money(report.final_amount - o.quoted_price)} over quote
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>👷 {report?.technician_name ?? o.assigned_technician ?? '—'}</span>
                    <span>Completed {report ? <TimeText iso={report.completed_at} /> : '—'}</span>
                  </div>

                  {flags.length ? (
                    <ul className="mt-2 list-inside list-disc rounded-xl bg-amber-50 p-2 text-xs text-amber-800">
                      {flags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-primary" disabled={!mayReview} onClick={() => void review(o.order_no)}>
                      ✅ Approve (reviewed)
                    </button>
                    <button className="btn-secondary" onClick={() => navigate(`/orders/${o.order_no}`)}>
                      Inspect job
                    </button>
                    {!mayReview ? <span className="self-center text-xs text-rose-600">Switch to the Manager role to approve.</span> : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {tab === 'reviewed' ? (
        reviewed.length === 0 ? (
          <EmptyState
            icon="📦"
            title={query || when !== 'All' ? 'No approved job matches that' : 'No reviewed jobs yet'}
          />
        ) : (
          <div className="space-y-2">
            {reviewed.slice(0, 30).map((o) => (
              <Card key={o.order_no} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <button className="text-left" onClick={() => navigate(`/orders/${o.order_no}`)}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{o.order_no}</span>
                    <StatusPill status={o.status} />
                  </div>
                  <div className="text-sm text-slate-500">{o.customer_name}</div>
                </button>
                <button className="btn-secondary" disabled={!mayReview} onClick={() => void close(o.order_no)}>
                  Close order
                </button>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'flags' ? (
        flagged.length === 0 ? (
          <EmptyState icon="🛡️" title="No anomalies detected" hint="The AI workflow supervisor flags jobs where the final amount is ≥1.5× the quote, or jobs closed with no photo evidence." />
        ) : (
          <div className="space-y-2">
            {flagged.slice(0, 30).map(({ order, report, flags, ratio }) => (
              <Card key={order.order_no} className="border-amber-200 p-4">
                <SectionTitle
                  right={
                    <span className="chip bg-amber-100 text-amber-800">
                      {ratio === Infinity ? '≫ quote' : `${ratio.toFixed(1)}× quote`}
                    </span>
                  }
                >
                  {order.order_no} · {report.technician_name}
                </SectionTitle>
                <ul className="list-inside list-disc space-y-0.5 text-sm text-amber-900">
                  {flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <button className="btn-secondary mt-3" onClick={() => navigate(`/orders/${order.order_no}`)}>
                  Inspect
                </button>
              </Card>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
