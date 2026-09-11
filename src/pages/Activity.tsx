import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { Card, EmptyState, SectionTitle, TimeText } from '../components/ui';
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

const FILTERS: (EventType | 'all')[] = ['all', 'created', 'assigned', 'started', 'completed', 'rescheduled', 'reviewed', 'notified', 'payment_recorded'];

export default function Activity() {
  const { data } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<EventType | 'all'>('all');
  // Same search + date-filter pattern as the other screens: the audit log grows
  // all day, and "who touched SS-2026-0042?" is the usual question.
  const [query, setQuery] = useState('');
  const [when, setWhen] = useState<'All' | 'Today' | 'This week' | 'This month'>('All');

  const events = useMemo(() => {
    const q = query.trim().toLowerCase();
    const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
    const cutoff =
      when === 'Today' ? today : when === 'This week' ? today - 7 * 86400000 : when === 'This month' ? today - 30 * 86400000 : null;
    const sorted = [...data.events].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return sorted
      .filter((e) => filter === 'all' || e.event_type === filter)
      .filter((e) => {
        if (cutoff === null) return true;
        const d = new Date(e.created_at);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() >= cutoff;
      })
      .filter((e) => {
        if (!q) return true;
        const d = new Date(e.created_at);
        const stamp = [
          d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
          d.toISOString().slice(0, 10),
          `${d.getDate()}/${d.getMonth() + 1}`,
        ].join(' ');
        return [e.order_no, e.detail, e.actor_name ?? '', e.actor_role, e.event_type, stamp]
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 150);
  }, [data.events, filter, query, when]);

  const notifications = data.notifications.slice(0, 20);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Activity log</h1>
        <p className="text-sm text-slate-500">
          Every key action is traceable — who created, assigned, completed, rescheduled, reviewed or notified. {data.events.length} events recorded.
        </p>
      </div>

      <Card className="p-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input
            className="input !pl-9"
            placeholder="Search order no, what happened, who did it, date…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`chip border ${filter === f ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? `All · ${data.events.length}` : `${EVENT_ICON[f as EventType]} ${f}`}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {(['All', 'Today', 'This week', 'This month'] as const).map((w) => (
            <button
              key={w}
              className={`chip border ${when === w ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}
              onClick={() => setWhen(w)}
            >
              {w === 'All' ? 'Any date' : w}
            </button>
          ))}
        </div>
      </Card>

      {events.length === 0 ? (
        <EmptyState
          icon="🕘"
          title={query ? 'No event matches that search' : 'No events for this filter'}
          hint={query ? 'Try an order number (SS-2026-…), a person, or a word from the event (assigned, closed…).' : undefined}
        />
      ) : (
        <Card className="divide-y divide-slate-100">
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-3 p-4">
              <span className="text-lg">{EVENT_ICON[e.event_type] ?? '•'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-700">{e.detail}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  <button className="text-brand-700 hover:underline" onClick={() => navigate(`/orders/${e.order_no}`)}>
                    {e.order_no}
                  </button>{' '}
                  · {e.actor_role}
                  {e.actor_name ? ` (${e.actor_name})` : ''} · <TimeText iso={e.created_at} />
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle right={<span className="chip bg-slate-100 text-slate-600">{data.notifications.filter((n) => n.status === 'sent').length}/{data.notifications.length} sent</span>}>
          WhatsApp notifications (Module 3)
        </SectionTitle>
        {notifications.length === 0 ? (
          <p className="text-sm text-slate-500">No notifications yet — they are created automatically when a job is marked done.</p>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">
                    {n.order_no} → {n.target}
                  </div>
                  <div className="line-clamp-1 text-xs text-slate-500">{n.message.split('\n')[1] ?? n.message}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`chip ${n.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{n.status}</span>
                  <a className="btn-secondary !py-1.5 text-xs" href={n.deep_link} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
