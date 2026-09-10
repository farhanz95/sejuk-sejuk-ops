import { useMemo } from 'react';
import { useApp } from '../state/AppState';
import { Card, EmptyState, MoneyText, SectionTitle, StatCard, TimeText } from '../components/ui';
import { reportsInRange, startOfWeek, daysAgo, endOfWeek } from '../lib/analytics';
import type { EventType } from '../lib/types';

const EVENT_ICON: Record<EventType, string> = {
  created: '🆕',
  assigned: '👷',
  started: '▶️',
  completed: '✅',
  rescheduled: '🔁',
  reviewed: '🧾',
  closed: '🔒',
  notified: '💬',
  payment_recorded: '💰',
};

/**
 * The technician's own screen.
 *
 * Deliberately scoped to the signed-in technician: their jobs, their numbers,
 * their history. No company revenue, no colleague leaderboard, no audit log of
 * other people's orders — a technician needs to know what they did, not what the
 * business billed.
 */
export default function MyActivity() {
  const { data, actor } = useApp();
  const me = actor.name;

  const myOrders = useMemo(
    () => new Set(data.orders.filter((o) => (o.assigned_technician ?? '').toLowerCase() === me.toLowerCase()).map((o) => o.order_no)),
    [data.orders, me],
  );

  const weekly = useMemo(() => {
    const now = new Date();
    const range = { from: startOfWeek(now), to: endOfWeek(now) };
    const mine = reportsInRange(data, range).filter((r) => r.technician_name.toLowerCase() === me.toLowerCase());
    return {
      jobs: mine.length,
      billed: mine.reduce((s, r) => s + r.final_amount, 0),
      withEvidence: mine.filter((r) => r.attachments.length > 0).length,
    };
  }, [data, me]);

  const monthly = useMemo(() => {
    const range = { from: daysAgo(30), to: new Date() };
    const mine = reportsInRange(data, range).filter((r) => r.technician_name.toLowerCase() === me.toLowerCase());
    return { jobs: mine.length, billed: mine.reduce((s, r) => s + r.final_amount, 0) };
  }, [data, me]);

  const myEvents = useMemo(
    () =>
      data.events
        .filter((e) => myOrders.has(e.order_no))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        .slice(0, 60),
    [data.events, myOrders],
  );

  const myMessages = useMemo(
    () => data.notifications.filter((n) => myOrders.has(n.order_no)).slice(0, 10),
    [data.notifications, myOrders],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">My activity</h1>
        <p className="text-sm text-slate-500">
          Everything here is your own work — job queue history, the numbers you billed, and the messages sent to your customers.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Jobs this week" value={String(weekly.jobs)} sub="completed by you" />
        <StatCard label="Billed this week" value={'RM ' + weekly.billed.toFixed(2)} sub={`${weekly.withEvidence} with photo evidence`} tone={weekly.jobs && weekly.withEvidence === weekly.jobs ? 'good' : 'default'} />
        <StatCard label="Jobs last 30 days" value={String(monthly.jobs)} sub={`RM ${monthly.billed.toFixed(2)} billed`} />
        <StatCard label="My open jobs" value={String(data.orders.filter((o) => myOrders.has(o.order_no) && ['Assigned', 'In Progress'].includes(o.status)).length)} sub="waiting for you" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-5">
          <SectionTitle right={<span className="text-xs text-slate-400">your jobs only</span>}>My history</SectionTitle>
          {myEvents.length === 0 ? (
            <EmptyState icon="🕘" title="Nothing recorded yet" hint="Your assigned jobs and their progress appear here." />
          ) : (
            <ol className="space-y-3">
              {myEvents.map((e) => (
                <li key={e.id} className="flex items-start gap-3">
                  <span className="text-base">{EVENT_ICON[e.event_type] ?? '•'}</span>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-700">{e.detail}</div>
                    <div className="text-xs text-slate-400">
                      {e.order_no} · <TimeText iso={e.created_at} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle right={<span className="chip bg-slate-100 text-slate-600">{myMessages.length}</span>}>
            Messages for my customers
          </SectionTitle>
          {myMessages.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing yet — a message is prepared automatically when you mark a job done.</p>
          ) : (
            <div className="space-y-2">
              {myMessages.map((n) => (
                <div key={n.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">{n.order_no} → {n.target}</span>
                    <span className={`chip ${n.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{n.status}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-slate-500">{n.message.split('\n')[2] ?? n.message}</div>
                  <a className="btn-secondary mt-2 !py-1.5 text-xs" href={n.deep_link} target="_blank" rel="noreferrer">
                    Open in WhatsApp
                  </a>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            You only see messages for jobs assigned to you. Company figures and the other technicians' numbers are on the
            manager's dashboard.
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-sm text-slate-600">
          <strong>What you cannot see here, by design:</strong> company revenue, the technician leaderboard, the audit log for
          other people's orders, and the AI query assistant. Those are management screens — ask your manager if you need a
          figure from them.
        </div>
      </Card>
    </div>
  );
}
