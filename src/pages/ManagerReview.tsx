import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { Card, EmptyState, MoneyText, SectionTitle, StatusPill, TimeText } from '../components/ui';
import { money, overQuoteRatio, supervisorFlags } from '../lib/domain';

export default function ManagerReview() {
  const { data, actor, review, close } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'queue' | 'reviewed' | 'flags'>('queue');
  const mayReview = actor.role === 'Manager';

  const queue = useMemo(() => data.orders.filter((o) => o.status === 'Job Done'), [data.orders]);
  const reviewed = useMemo(() => data.orders.filter((o) => o.status === 'Reviewed'), [data.orders]);

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
          <EmptyState icon="✅" title="Nothing waiting for review" hint="Complete a job from the Technician role to see it appear here." />
        ) : (
          <div className="space-y-2">
            {queue.map((o) => {
              const report = data.reports.find((r) => r.order_no === o.order_no);
              const flags = report ? supervisorFlags(o, report) : [];
              return (
                <Card key={o.order_no} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{o.order_no}</span>
                        <StatusPill status={o.status} />
                        {flags.length ? <span className="chip bg-amber-100 text-amber-800">⚠ {flags.length} flag(s)</span> : null}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {o.customer_name} · {o.service_type} · technician {report?.technician_name ?? o.assigned_technician}
                      </div>
                      <div className="text-xs text-slate-500">
                        Completed {report ? <TimeText iso={report.completed_at} /> : '—'}
                      </div>
                    </div>
                    <div className="text-right">
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
          <EmptyState icon="📦" title="No reviewed jobs yet" />
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
