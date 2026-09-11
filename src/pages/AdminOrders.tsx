import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { SERVICE_TYPES, TECHNICIANS, type OrderStatus, type ServiceType, type Technician } from '../lib/types';
import { money, nextOrderNo, validateOrderDraft, type OrderDraft } from '../lib/domain';
import { Card, EmptyState, Field, MoneyText, SectionTitle, StatCard, StatusPill, TimeText, Modal } from '../components/ui';
import DocumentImport from '../components/DocumentImport';
import type { ExtractedFields } from '../lib/doc-fields';

const STATUSES: OrderStatus[] = ['New', 'Assigned', 'In Progress', 'Job Done', 'Reviewed', 'Closed'];

/** The date forms someone might search by: printed, ISO, d/m and dd/mm. */
function dateStamp(iso: string): string {
  const d = new Date(iso);
  return [
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    d.toISOString().slice(0, 10),
    `${d.getDate()}/${d.getMonth() + 1}`,
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
  ].join(' ');
}

const blank: OrderDraft = {
  customer_name: '',
  phone: '',
  address: '',
  problem_description: '',
  service_type: 'Cleaning',
  quoted_price: '',
  assigned_technician: '',
  admin_notes: '',
};

export default function AdminOrders() {
  const { data, createOrder, assignTechnician, actor, toast } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'All'>('All');
  // Same search + filter pattern as the technician's My Jobs screen.
  const [when, setWhen] = useState<'All' | 'Today' | 'This week' | 'This month'>('All');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(blank);
  const [errors, setErrors] = useState<string[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const isAdmin = actor.role === 'Admin';
  const previewNo = useMemo(() => nextOrderNo(data.orders.map((o) => o.order_no), new Date().getFullYear()), [data.orders]);

  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const today = dayStart(new Date());
    const cutoff =
      when === 'Today' ? today : when === 'This week' ? today - 7 * 86400000 : when === 'This month' ? today - 30 * 86400000 : null;
    return data.orders.filter((o) => {
      if (cutoff !== null && dayStart(new Date(o.created_at)) < cutoff) return false;
      const matchesQuery =
        !q ||
        [o.order_no, o.customer_name, o.phone, o.address, o.problem_description, o.assigned_technician ?? '', o.status, dateStamp(o.created_at)]
          .join(' ')
          .toLowerCase()
          .includes(q);
      const matchesStatus = status === 'All' || o.status === status;
      return matchesQuery && matchesStatus;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.orders, query, status, when]);

  /** What the office needs to act on: work nobody owns, work in flight, work
   *  waiting on the manager, and how stale the oldest open job is. */
  const workLog = useMemo(() => {
    const open = data.orders.filter((o) => o.status !== 'Closed' && o.status !== 'Reviewed');
    const unassigned = data.orders.filter((o) => !o.assigned_technician && o.status === 'New');
    const waitingDays = open.length
      ? Math.max(...open.map((o) => Math.floor((dayStart(new Date()) - dayStart(new Date(o.created_at))) / 86400000)))
      : 0;
    return {
      unassigned: unassigned.length,
      inProgress: data.orders.filter((o) => o.status === 'In Progress').length,
      awaitingReview: data.orders.filter((o) => o.status === 'Job Done').length,
      waitingDays,
    };
  }, [data.orders]);

  const counts = useMemo(() => {
    const map = new Map<OrderStatus, number>();
    for (const o of data.orders) map.set(o.status, (map.get(o.status) ?? 0) + 1);
    return map;
  }, [data.orders]);

  const submit = async () => {
    const found = validateOrderDraft(draft);
    setErrors(found);
    if (found.length) return;
    setSaving(true);
    const order = await createOrder({
      customer_name: draft.customer_name.trim(),
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      problem_description: draft.problem_description.trim(),
      service_type: draft.service_type as ServiceType,
      quoted_price: Number(draft.quoted_price),
      assigned_technician: (draft.assigned_technician || null) as Technician | null,
      admin_notes: draft.admin_notes.trim(),
    });
    setSaving(false);
    if (order) {
      setCreatedOrder(order.order_no);
      setDraft(blank);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Service orders</h1>
          <p className="text-sm text-slate-500">Module 1 — admin creates an order and assigns a technician.</p>
        </div>
        <button
          className="btn-primary"
          disabled={!isAdmin}
          title={isAdmin ? 'Create a new service order' : 'Only an Admin can create orders'}
          onClick={() => {
            setDraft(blank);
            setErrors([]);
            setCreatedOrder(null);
            setCreating(true);
          }}
        >
          + New order
        </button>
      </div>

      {/* Work log — what the office opens this screen to answer: what is
          unowned, what is moving, what is stuck with the manager. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard
          label="Unassigned"
          value={String(workLog.unassigned)}
          sub="new orders, no technician"
          tone={workLog.unassigned > 0 ? 'warn' : 'default'}
        />
        <StatCard label="In progress" value={String(workLog.inProgress)} sub="technicians on site" />
        <StatCard
          label="Awaiting review"
          value={String(workLog.awaitingReview)}
          sub="waiting on the manager"
          tone={workLog.awaitingReview > 0 ? 'warn' : 'default'}
        />
        <StatCard label="Oldest open" value={workLog.waitingDays <= 0 ? 'new' : `${workLog.waitingDays}d`} sub="since the job came in" />
      </div>

      <Card className="p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            className="input md:flex-1"
            placeholder="Search order no, customer, phone, address, technician, date…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              className={`chip border ${status === 'All' ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}
              onClick={() => setStatus('All')}
            >
              All · {data.orders.length}
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`chip border ${status === s ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}
                onClick={() => setStatus(s)}
              >
                {s} · {counts.get(s) ?? 0}
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
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState icon="🧾" title="No orders match" hint="Try clearing the search or switching the status filter." />
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 60).map((o) => (
            <Card key={o.order_no} className="p-4 transition hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button className="text-left" onClick={() => navigate(`/orders/${o.order_no}`)}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">{o.order_no}</span>
                    <StatusPill status={o.status} />
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {o.customer_name} · {o.phone}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{o.problem_description}</div>
                </button>
                <div className="text-right">
                  <div className="font-semibold text-slate-800">
                    <MoneyText value={o.quoted_price} />
                  </div>
                  <div className="text-xs text-slate-500">
                    {o.service_type} · <TimeText iso={o.created_at} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {o.assigned_technician ? `👷 ${o.assigned_technician}` : '— unassigned'}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="btn-secondary !py-1.5 text-xs" onClick={() => navigate(`/orders/${o.order_no}`)}>
                  Open
                </button>
                {isAdmin ? (
                  <button className="btn-secondary !py-1.5 text-xs" onClick={() => setAssigning(o.order_no)}>
                    {o.assigned_technician ? 'Reassign' : 'Assign technician'}
                  </button>
                ) : null}
                {o.status === 'Job Done' ? <span className="chip bg-emerald-50 text-emerald-700">WhatsApp prepared</span> : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={creating} title="New service order" onClose={() => setCreating(false)} wide>
        {createdOrder ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-semibold text-emerald-800">Order {createdOrder} created ✅</div>
              <p className="mt-1 text-sm text-emerald-700">
                {draft.assigned_technician ? 'The technician has been assigned.' : 'Assign a technician when you are ready.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => navigate(`/orders/${createdOrder}`)}>
                Open order summary
              </button>
              <button className="btn-secondary" onClick={() => setCreatedOrder(null)}>
                Create another
              </button>
              <button className="btn-ghost" onClick={() => setCreating(false)}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3">
              <div className="flex-1 text-xs text-brand-900">
                <strong>Got the paperwork already?</strong> Read a quotation, invoice or the customer's WhatsApp message and
                fill this form from it.
              </div>
              <button className="btn-secondary !py-1.5 text-xs" onClick={() => setImporting(true)}>
                📄 Pull fields from a document
              </button>
            </div>

            {errors.length ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <ul className="list-inside list-disc space-y-0.5">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-x-4 md:grid-cols-2">
              <Field label="Order No" hint="Auto-generated">
                <input className="input" value={previewNo} disabled />
              </Field>
              <Field label="Service type">
                <select className="input" value={draft.service_type} onChange={(e) => setDraft({ ...draft, service_type: e.target.value })}>
                  {SERVICE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Customer name">
                <input className="input" value={draft.customer_name} onChange={(e) => setDraft({ ...draft, customer_name: e.target.value })} placeholder="e.g. Ahmad Zaki" />
              </Field>
              <Field label="Phone">
                <input className="input" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="012-3456789" />
              </Field>
            </div>

            <Field label="Address">
              <input className="input" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="No. 12, Jalan Sejuk, Shah Alam" />
            </Field>

            <Field label="Problem description">
              <textarea className="input" rows={3} value={draft.problem_description} onChange={(e) => setDraft({ ...draft, problem_description: e.target.value })} placeholder="Aircond not cold, water dripping…" />
            </Field>

            <div className="grid gap-x-4 md:grid-cols-2">
              <Field label="Quoted price (RM)">
                <input className="input" type="number" min={0} step="0.01" value={draft.quoted_price} onChange={(e) => setDraft({ ...draft, quoted_price: e.target.value })} placeholder="180" />
              </Field>
              <Field label="Assign technician" hint="Only Admin can assign — can also be done later">
                <select className="input" value={draft.assigned_technician} onChange={(e) => setDraft({ ...draft, assigned_technician: e.target.value })}>
                  <option value="">— unassigned —</option>
                  {TECHNICIANS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Admin notes">
              <input className="input" value={draft.admin_notes} onChange={(e) => setDraft({ ...draft, admin_notes: e.target.value })} placeholder="Customer prefers morning slot" />
            </Field>

            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-primary" disabled={saving} onClick={() => void submit()}>
                {saving ? 'Saving…' : 'Create order'}
              </button>
              <button className="btn-ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
              {draft.quoted_price ? (
                <span className="ml-auto self-center text-sm text-slate-500">
                  Quoted: <strong>{money(Number(draft.quoted_price))}</strong>
                </span>
              ) : null}
            </div>
          </>
        )}
      </Modal>

      <DocumentImport
        open={importing}
        onClose={() => setImporting(false)}
        onApply={(fields: ExtractedFields) =>
          setDraft((prev) => ({
            ...prev,
            customer_name: fields.customer_name ?? prev.customer_name,
            phone: fields.phone ?? prev.phone,
            address: fields.address ?? prev.address,
            problem_description: fields.problem_description ?? prev.problem_description,
            service_type: fields.service_type ?? prev.service_type,
            quoted_price: fields.quoted_price !== null ? String(fields.quoted_price) : prev.quoted_price,
            admin_notes: fields.admin_notes ?? prev.admin_notes,
          }))
        }
      />

      <Modal open={!!assigning} title={`Assign ${assigning ?? ''}`} onClose={() => setAssigning(null)}>
        <SectionTitle>Field teams</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {TECHNICIANS.map((t) => (
            <button
              key={t}
              className="btn-secondary"
              onClick={async () => {
                if (!assigning) return;
                await assignTechnician(assigning, t);
                setAssigning(null);
              }}
            >
              👷 {t}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          The technician will see this job in their mobile queue. Assignment is logged in the order timeline.
        </p>
        {!isAdmin ? (
          <p className="mt-2 text-xs text-rose-600">You are signed in as {actor.role} — only Admin can assign. Switch role in the header.</p>
        ) : null}
        <button
          className="btn-ghost mt-3 !px-0 text-xs"
          onClick={() => {
            toast('info', 'Tip: switch to a Technician role in the header to complete the job.');
          }}
        >
          How does the technician get this?
        </button>
      </Modal>
    </div>
  );
}
