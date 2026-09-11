/**
 * Single application store: session (role switch), the loaded operations data,
 * and every mutation the UI can perform. Keeping mutations here means the
 * workflow rules (who may assign / complete / review) live in one place.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthState';
import type { OpsData, Order, Role, ServiceReport, Technician } from '../lib/types';
import { createRepo, type Actor, type CompletionInput, type OpsRepo, type OrderInput } from '../lib/repo';
import { canAssign, canMarkDone, canReview } from '../lib/domain';

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface AppState {
  ready: boolean;
  mode: 'supabase' | 'demo';
  data: OpsData;
  actor: Actor;
  setActor: (a: Actor) => void;
  resetActor: () => void;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: string) => void;
  reload: () => Promise<void>;
  error: string | null;
  repo: OpsRepo;
  createOrder: (input: OrderInput) => Promise<Order | null>;
  assignTechnician: (orderNo: string, tech: Technician) => Promise<void>;
  startJob: (orderNo: string) => Promise<void>;
  completeJob: (orderNo: string, input: CompletionInput) => Promise<{ report: ServiceReport } | null>;
  reschedule: (orderNo: string, reason: string) => Promise<void>;
  review: (orderNo: string) => Promise<void>;
  close: (orderNo: string) => Promise<void>;
  markSent: (orderNo: string) => Promise<void>;
  resetDemo: () => Promise<void>;
  /** true when the actor is a signed-in staff account rather than the demo switch */
  authManaged: boolean;
  order: (orderNo: string) => Order | undefined;
  reportFor: (orderNo: string) => ServiceReport | undefined;
}

const EMPTY: OpsData = { orders: [], reports: [], events: [], notifications: [] };

/**
 * The mock login survives a reload. Without this, refreshing the page silently
 * signed you back in as Admin — which also meant a technician could reach a
 * management screen simply by reloading on that URL.
 */
const ACTOR_KEY = 'ss_actor_v1';
const DEFAULT_ACTOR: Actor = { role: 'Admin', name: 'Admin (desk)' };

function readStoredActor(): Actor {
  try {
    const raw = localStorage.getItem(ACTOR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Actor;
      if (parsed && ['Admin', 'Manager', 'Technician'].includes(parsed.role) && parsed.name) return parsed;
    }
  } catch {
    /* ignore corrupt storage */
  }
  return DEFAULT_ACTOR;
}

const Ctx = createContext<AppState | null>(null);

export const TECHNICIAN_ROLE_NAME = 'Ali';

export function AppStateProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => createRepo(), []);
  const [data, setData] = useState<OpsData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [actor, setActor] = useState<Actor>(() => readStoredActor());

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const reload = useCallback(async () => {
    try {
      const next = await repo.load();
      setData(next);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast('error', `Could not load data: ${message}`);
    }
  }, [repo, toast]);

  useEffect(() => {
    (async () => {
      await reload();
      setReady(true);
    })();
  }, [reload]);

  /** Role switch also swaps the acting technician, as the brief suggests. */
  const changeActor = useCallback((a: Actor) => {
    const next = a.role === 'Technician' ? { role: 'Technician' as const, name: a.name || TECHNICIAN_ROLE_NAME } : a;
    setActor(next);
    try {
      localStorage.setItem(ACTOR_KEY, JSON.stringify(next));
    } catch {
      /* private mode — the session simply does not persist */
    }
  }, []);

  /** Sign out of the mock login (returns to the role picker). */
  const resetActor = useCallback(() => {
    try {
      localStorage.removeItem(ACTOR_KEY);
    } catch {
      /* ignore */
    }
    setActor(DEFAULT_ACTOR);
  }, []);

  // A signed-in staff account defines the actor: their role and, for a
  // technician, which field team they are. The demo role switch is only used
  // when there is no account (reviewers) — otherwise anyone could switch into
  // the manager's screens from the header.
  const auth = useAuth();
  const authManaged = auth.configured && Boolean(auth.profile);

  useEffect(() => {
    const profile = auth.profile;
    if (!authManaged || !profile) return;
    const name =
      profile.role === 'Technician'
        ? profile.technician_name ?? profile.display_name ?? profile.email ?? 'Technician'
        : profile.display_name ?? profile.email ?? profile.role;
    setActor((prev) => (prev.role === profile.role && prev.name === name ? prev : { role: profile.role, name }));
  }, [authManaged, auth.profile]);

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>, okMessage: string, allow: boolean, denyMessage: string): Promise<T | null> => {
      if (!allow) {
        toast('error', denyMessage);
        return null;
      }
      try {
        const result = await fn();
        await reload();
        if (okMessage) toast('success', okMessage);
        return result;
      } catch (err) {
        toast('error', err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [reload, toast],
  );

  const value: AppState = {
    ready,
    authManaged,
    mode: repo.mode,
    data,
    actor,
    setActor: changeActor,
    resetActor,
    toasts,
    toast,
    dismissToast,
    reload,
    error,
    repo,
    order: (orderNo) => data.orders.find((o) => o.order_no === orderNo),
    reportFor: (orderNo) => data.reports.find((r) => r.order_no === orderNo),

    createOrder: (input) =>
      guard(() => repo.createOrder(input, actor), `Order created.`, true, ''),

    assignTechnician: (orderNo, tech) =>
      guard(
        () => repo.assignTechnician(orderNo, tech, actor),
        `${orderNo} assigned to ${tech}.`,
        canAssign(actor.role),
        'Only an Admin can assign technicians.',
      ).then(() => undefined),

    startJob: (orderNo) =>
      guard(() => repo.startJob(orderNo, actor), `${orderNo} started.`, true, '').then(() => undefined),

    completeJob: (orderNo, input) => {
      const order = data.orders.find((o) => o.order_no === orderNo);
      const allow = !!order && canMarkDone(actor.role, actor.name, order);
      return guard(
        () => repo.completeJob(orderNo, input, actor),
        `Job ${orderNo} marked as done — WhatsApp message prepared.`,
        allow,
        'Only the assigned technician can complete this job.',
      );
    },

    reschedule: (orderNo, reason) =>
      guard(() => repo.reschedule(orderNo, reason, actor), `${orderNo} rescheduled.`, true, '').then(() => undefined),

    review: (orderNo) =>
      guard(
        () => repo.reviewOrder(orderNo, actor),
        `${orderNo} reviewed.`,
        canReview(actor.role),
        'Only a Manager can review completed jobs.',
      ).then(() => undefined),

    close: (orderNo) =>
      guard(
        () => repo.closeOrder(orderNo, actor),
        `${orderNo} closed.`,
        canReview(actor.role),
        'Only a Manager can close an order.',
      ).then(() => undefined),

    markSent: (orderNo) => guard(() => repo.markNotificationSent(orderNo), 'Marked as sent.', true, '').then(() => undefined),

    resetDemo: async () => {
      repo.resetDemo?.();
      await reload();
      toast('info', 'Demo data reset to the seeded dataset.');
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}

export const ROLE_OPTIONS: { role: Role; label: string; hint: string }[] = [
  { role: 'Admin', label: 'Admin', hint: 'Creates orders, assigns technicians, reschedules' },
  { role: 'Technician', label: 'Technician', hint: 'Sees own jobs, records service completion' },
  { role: 'Manager', label: 'Manager', hint: 'Reviews completed jobs, watches KPIs' },
];
