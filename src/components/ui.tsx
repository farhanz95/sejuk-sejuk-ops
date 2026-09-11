import type { ReactNode } from 'react';
import type { OrderStatus } from '../lib/types';
import { useApp } from '../state/AppState';

const STATUS_STYLE: Record<OrderStatus, string> = {
  New: 'bg-slate-100 text-slate-700 border-slate-200',
  Assigned: 'bg-amber-50 text-amber-700 border-amber-200',
  'In Progress': 'bg-blue-50 text-blue-700 border-blue-200',
  'Job Done': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Reviewed: 'bg-violet-50 text-violet-700 border-violet-200',
  Closed: 'bg-slate-800 text-white border-slate-800',
};

export function StatusPill({ status, size = 'sm' }: { status: OrderStatus; size?: 'sm' | 'xs' }) {
  return (
    <span
      className={`chip border ${STATUS_STYLE[status]} ${size === 'xs' ? 'px-2 py-0.5 text-[11px]' : ''}`}
      title={status}
    >
      {status}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{children}</h2>
      {right}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' }) {
  const tones = {
    default: 'text-slate-900',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
  } as const;
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </Card>
  );
}

export function EmptyState({ title, hint, icon = '📭' }: { title: string; hint?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <div className="mt-2 font-semibold text-slate-700">{title}</div>
      {hint ? <div className="mt-1 max-w-md text-sm text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm md:items-center md:p-6">
      <div className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl md:rounded-3xl ${wide ? 'md:max-w-3xl' : 'md:max-w-xl'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button type="button" className="btn-ghost !px-2 !py-1 text-xl leading-none" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <label className="label">{label}</label>
      {children}
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] w-[min(92vw,26rem)] -translate-x-1/2 space-y-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg ${
            t.kind === 'success' ? 'bg-emerald-600 text-white' : t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white'
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

export function MoneyText({ value, className = '' }: { value: number; className?: string }) {
  return <span className={className}>RM {value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

export function TimeText({ iso, withDate = true }: { iso: string; withDate?: boolean }) {
  const d = new Date(iso);
  return (
    <span title={d.toString()}>
      {d.toLocaleString('en-MY', withDate ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}
