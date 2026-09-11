import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { MAX_ATTACHMENTS, amountProblem, computeFinalAmount, money, validateCompletion } from '../lib/domain';
import type { PaymentMethod } from '../lib/types';
import { Card, ConfirmPanel, EmptyState, Field, Modal, MoneyInput, MoneyText, SectionTitle, StatCard, StatusPill, TimeText } from '../components/ui';
import { DemoFillButton } from '../components/DemoFillButton';
import { SupabaseRepo } from '../lib/repo';

const METHODS: PaymentMethod[] = ['Cash', 'Bank Transfer', 'DuitNow QR', 'Card'];

interface PendingFile {
  name: string;
  mime: string;
  size: number;
  url: string;
}

export default function TechJobs() {
  const { orderNo } = useParams();
  const navigate = useNavigate();
  const { data, actor, completeJob, startJob, repo, markSent } = useApp();

  const [openNo, setOpenNo] = useState<string | null>(orderNo ?? null);
  const [workDone, setWorkDone] = useState('');
  const [extra, setExtra] = useState('0');
  const [remarks, setRemarks] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [doneNo, setDoneNo] = useState<string | null>(null);
  // The report is written in the field, often one-handed — so the last tap asks
  // "are you sure?" before anything is submitted, and a validation failure is
  // shown next to the button that was pressed instead of at the top of a sheet
  // the technician has already scrolled past.
  const [confirming, setConfirming] = useState(false);
  // Starting a job is a one-tap, one-time action from the road — ask first, in
  // case the wrong card was tapped.
  const [confirmStart, setConfirmStart] = useState<string | null>(null);
  const workDoneRef = useRef<HTMLTextAreaElement>(null);

  // Work log: what a technician actually opens this screen to see. Search covers
  // the four things they look up in the field — order id, customer, address, date
  // — plus phone and the assigned technician.
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'To do' | 'Done' | 'All'>('To do');
  const [when, setWhen] = useState<'All' | 'Today' | 'This week' | 'This month'>('All');

  const myJobs = useMemo(() => {
    const name = actor.name.toLowerCase();
    return data.orders
      .filter((o) => (o.assigned_technician ?? '').toLowerCase() === name)
      .sort((a, b) => {
        const rank = (s: string) => (s === 'Assigned' || s === 'In Progress' ? 0 : s === 'Job Done' ? 1 : 2);
        return rank(a.status) - rank(b.status) || +new Date(b.created_at) - +new Date(a.created_at);
      });
  }, [data.orders, actor.name]);

  /** The date that matters for a given job: when it finished, else last touched. */
  const activityDate = (order: (typeof data.orders)[number]) => {
    const report = data.reports.find((r) => r.order_no === order.order_no);
    return new Date(report?.completed_at ?? order.updated_at ?? order.created_at);
  };

  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const workLog = useMemo(() => {
    const now = new Date();
    const today = dayStart(now);
    const weekAgo = today - 7 * 86400000;
    const monthAgo = today - 30 * 86400000;
    const open = myJobs.filter((o) => o.status === 'Assigned' || o.status === 'In Progress');
    const finished = myJobs.filter((o) => data.reports.some((r) => r.order_no === o.order_no));
    const doneSince = (cutoff: number) =>
      finished.filter((o) => +activityDate(o) >= cutoff);
    const waitingDays = open.length
      ? Math.max(
          ...open.map((o) =>
            Math.floor((dayStart(now) - dayStart(new Date(o.created_at))) / 86400000),
          ),
        )
      : 0;
    const weekDone = doneSince(weekAgo);
    return {
      open,
      openCount: open.length,
      inProgress: myJobs.filter((o) => o.status === 'In Progress').length,
      doneToday: doneSince(today).length,
      doneWeek: weekDone.length,
      billedWeek: weekDone.reduce((sum, o) => {
        const report = data.reports.find((r) => r.order_no === o.order_no);
        return sum + (report?.final_amount ?? o.quoted_price);
      }, 0),
      waitingDays,
      unread: data.orders.filter(
        (o) =>
          (o.assigned_technician ?? '').toLowerCase() === actor.name.toLowerCase() &&
          (o.status === 'Assigned' || o.status === 'In Progress'),
      ).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myJobs, data.reports]);

  const visibleJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const today = dayStart(now);
    const cutoff =
      when === 'Today' ? today : when === 'This week' ? today - 7 * 86400000 : when === 'This month' ? today - 30 * 86400000 : null;

    return myJobs.filter((o) => {
      const report = data.reports.find((r) => r.order_no === o.order_no);
      const date = activityDate(o);
      const isDone = Boolean(report);

      if (scope === 'To do' && isDone) return false;
      if (scope === 'Done' && !isDone) return false;
      if (cutoff !== null && dayStart(date) < cutoff) return false;

      if (!q) return true;
      // Dates are searchable as typed in the portal (10 Sep 2026) and in the
      // numeric forms a technician might punch in (10/9, 2026-09-10).
      const d = date;
      const stamp = [
        d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        d.toISOString().slice(0, 10),
        `${d.getDate()}/${d.getMonth() + 1}`,
        `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      ].join(' ');
      return [o.order_no, o.customer_name, o.address, o.phone, o.problem_description, o.assigned_technician ?? '', o.status, stamp]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [myJobs, data.reports, query, scope, when]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // Inline complaints so the field itself explains the refusal.
  const extraIssue = amountProblem(extra, { label: 'Extra charges' });
  const paidIssue = paid === '' ? null : amountProblem(paid, { label: 'Payment amount' });

  const openOrder = openNo ? data.orders.find((o) => o.order_no === openNo) : undefined;
  const openReport = openNo ? data.reports.find((r) => r.order_no === openNo) : undefined;
  const due = openOrder ? computeFinalAmount(openOrder.quoted_price, Number(extra || 0)) : 0;

  const reset = () => {
    setConfirming(false);
    setWorkDone('');
    setExtra('0');
    setRemarks('');
    setFiles([]);
    setPaid('');
    setMethod('Cash');
    setErrors([]);
    setDoneNo(null);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    if (files.length + incoming.length > MAX_ATTACHMENTS) {
      setErrors([`Maximum ${MAX_ATTACHMENTS} files per job.`]);
      return;
    }
    const mapped: PendingFile[] = [];
    for (const f of incoming) {
      if (repo instanceof SupabaseRepo && openNo) {
        try {
          mapped.push(await repo.upload(f, openNo));
          continue;
        } catch {
          /* fall through to a local preview */
        }
      }
      mapped.push({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size, url: URL.createObjectURL(f) });
    }
    setFiles((prev) => [...prev, ...mapped]);
    setErrors([]);
  };

  /** One tap fills the report with plausible field data — for testing the flow
   *  without typing a whole report on a phone. */
  const fillSample = () => {
    const sampleExtra = 25;
    setWorkDone('Chemical cleaned the indoor unit, topped up gas, tested cooling for 15 minutes.');
    setExtra(String(sampleExtra));
    setRemarks('Customer asked for a reminder in 6 months. Filter was dusty.');
    setPaid(String(computeFinalAmount(openOrder?.quoted_price ?? 0, sampleExtra)));
    setMethod('Cash');
    setErrors([]);
  };

  /** Step 1: check the form. If it is wrong, say so where the technician is
   *  looking (next to the button) and jump to the field that needs attention. */
  const submit = () => {
    if (!openOrder) return;
    const found = validateCompletion(
      {
        work_done: workDone,
        extra_charges: extra,
        remarks,
        technician_name: actor.name,
        attachmentCount: files.length,
        payment_amount: paid === '' ? null : paid,
        payment_method: paid === '' ? null : method,
      },
      openOrder.quoted_price,
    );
    setErrors(found);
    if (found.length) {
      workDoneRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      workDoneRef.current?.focus();
      return;
    }
    setConfirming(true);
  };

  /** Step 2: the confirmed submit. */
  const confirmSubmit = async () => {
    if (!openOrder) return;
    setBusy(true);
    setErrors([]);
    const result = await completeJob(openOrder.order_no, {
      work_done: workDone.trim(),
      extra_charges: Number(extra || 0),
      remarks: remarks.trim(),
      technician_name: actor.name,
      payment_amount: paid === '' ? null : Number(paid),
      payment_method: paid === '' ? null : method,
      attachments: files,
    });
    setBusy(false);
    if (result) {
      setDoneNo(openOrder.order_no);
      setConfirming(false);
      return;
    }
    // Never leave the technician staring at a button that did nothing: keep the
    // form, reopen it, and explain.
    setConfirming(false);
    setErrors(['This job could not be saved. Check your connection and try again — nothing was submitted.']);
  };

  const notification = doneNo ? data.notifications.find((n) => n.order_no === doneNo) : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">My jobs</h1>
        <p className="text-sm text-slate-500">
          Module 2 — signed in as technician <strong>{actor.name}</strong>. Large buttons, minimal typing, built for one-handed field use.
        </p>
      </div>

      {/* Work log — what this screen is opened for: how much is still on me, how
          long one has been sitting, and what today has produced. */}
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard
          label="To do"
          value={String(workLog.openCount)}
          sub={workLog.inProgress ? `${workLog.inProgress} in progress` : 'assigned, not started'}
          tone={workLog.openCount > 0 ? 'warn' : 'default'}
        />
        <StatCard
          label="Waiting longest"
          value={workLog.waitingDays <= 0 ? 'new' : `${workLog.waitingDays}d`}
          sub="oldest job still open"
        />
        <StatCard label="Done today" value={String(workLog.doneToday)} sub="with a report" />
        <StatCard label="Done this week" value={String(workLog.doneWeek)} sub={money(workLog.billedWeek)} />
      </div>

      <Card className="mb-3 p-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input
            className="input !pl-9"
            placeholder="Search order ID, customer, address, phone, date…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(['To do', 'Done', 'All'] as const).map((s2) => (
            <button
              key={s2}
              className={`chip border ${scope === s2 ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}
              onClick={() => setScope(s2)}
            >
              {s2} · {s2 === 'To do' ? workLog.openCount : s2 === 'Done' ? myJobs.length - workLog.openCount : myJobs.length}
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

      {myJobs.length === 0 ? (
        <EmptyState
          icon="🔧"
          title={`No jobs assigned to ${actor.name}`}
          hint="Switch to the Admin role in the header, create an order and assign it to this technician."
        />
      ) : visibleJobs.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No job matches that"
          hint="Try the order ID (SS-2026-…), the customer's name or address, or switch the date filter back to Any date."
        />
      ) : (
        <div className="space-y-3">
          {visibleJobs.map((o) => {
            const report = data.reports.find((r) => r.order_no === o.order_no);
            const actionable = (o.status === 'Assigned' || o.status === 'In Progress') && o.assigned_technician?.toLowerCase() === actor.name.toLowerCase();
            return (
              <Card key={o.order_no} className="overflow-hidden">
                <div className="p-4">
                  {/* Phone: order + status on the first line with the amount, then the
                      customer, address and problem across the full card width. */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-800">{o.order_no}</span>
                      <StatusPill status={o.status} />
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-semibold text-slate-800">
                        <MoneyText value={o.quoted_price} />
                      </div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">{o.service_type}</div>
                    </div>
                  </div>
                  <div className="mt-2 truncate text-sm font-medium text-slate-700">{o.customer_name}</div>
                  <div className="line-clamp-2 text-xs text-slate-500">{o.address}</div>
                  <div className="mt-1 line-clamp-2 text-sm text-slate-600">{o.problem_description}</div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 p-3">
                  <a className="btn-secondary !py-2" href={`tel:${o.phone}`}>
                    📞 Call
                  </a>
                  <a
                    className="btn-secondary !py-2"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`}
                  >
                    🗺️ Directions
                  </a>
                  {actionable ? (
                    <>
                      {o.status === 'Assigned' ? (
                        <button
                          className="btn-secondary !py-2"
                          title="Tell the office you have arrived and started work"
                          onClick={() => setConfirmStart(o.order_no)}
                        >
                          ▶ Start job
                        </button>
                      ) : null}
                      <button
                        className="btn-primary !py-2 md:ml-auto"
                        onClick={() => {
                          reset();
                          setOpenNo(o.order_no);
                        }}
                      >
                        ✔ Complete job
                      </button>
                    </>
                  ) : report ? (
                    <button className="btn-secondary ml-auto !py-2" onClick={() => navigate(`/orders/${o.order_no}`)}>
                      View report
                    </button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!confirmStart}
        title="Start this job?"
        onClose={() => setConfirmStart(null)}
      >
        {(() => {
          const order = data.orders.find((o) => o.order_no === confirmStart);
          if (!order) return null;
          return (
            <ConfirmPanel
              icon="▶️"
              title="Start this job now?"
              description="The office will see that you have arrived and started work. Do this only when you are actually on site."
              rows={[
                { label: 'Order', value: <strong className="text-slate-800">{order.order_no}</strong> },
                { label: 'Customer', value: order.customer_name },
                { label: 'Address', value: order.address },
                { label: 'Service', value: order.service_type },
                { label: 'Problem', value: order.problem_description },
              ]}
              confirmLabel="Yes, start job"
              cancelLabel="Not now"
              busy={busy}
              tone="good"
              onConfirm={async () => {
                setBusy(true);
                await startJob(order.order_no);
                setBusy(false);
                setConfirmStart(null);
              }}
              onCancel={() => setConfirmStart(null)}
            />
          );
        })()}
      </Modal>

      <Modal
        open={!!openOrder}
        title={confirming ? 'Confirm completion' : doneNo ? `Job ${doneNo} completed` : `Complete ${openOrder?.order_no ?? ''}`}
        onClose={() => {
          setOpenNo(null);
          reset();
          if (orderNo) navigate('/jobs');
        }}
        wide
      >
        {openOrder && confirming ? (
          <ConfirmPanel
            icon="✅"
            title="Mark this job as done?"
            description="The office sees it as finished and the WhatsApp message for the customer is prepared. You can still change it from the office afterwards."
            rows={[
              { label: 'Order', value: <strong className="text-slate-800">{openOrder.order_no}</strong> },
              { label: 'Customer', value: openOrder.customer_name },
              { label: 'Work done', value: workDone.trim() || '—' },
              { label: 'Final amount', value: <strong className="text-slate-900"><MoneyText value={due} /></strong> },
              { label: 'Payment', value: paid === '' ? 'Not paid yet' : <><MoneyText value={Number(paid)} /> · {method}</> },
              { label: 'Evidence', value: files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'no photos attached' },
            ]}
            confirmLabel="Yes, mark it as done"
            cancelLabel="Back to the form"
            busy={busy}
            onConfirm={() => void confirmSubmit()}
            onCancel={() => setConfirming(false)}
          />
        ) : openOrder && doneNo ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              <div className="font-semibold">Job marked as done ✅</div>
              <p className="text-sm">The customer WhatsApp message has been prepared automatically (Module 3).</p>
            </div>
            {notification ? (
              <>
                <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{notification.message}</pre>
                <div className="flex flex-wrap gap-2">
                  <a
                    className="btn-primary"
                    href={notification.deep_link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => void markSent(notification.order_no)}
                  >
                    Send on WhatsApp →
                  </a>
                  <button className="btn-secondary" onClick={() => void markSent(notification.order_no)}>
                    Mark as sent
                  </button>
                </div>
              </>
            ) : null}

            <button
              className="btn-ghost"
              onClick={() => {
                setOpenNo(null);
                reset();
              }}
            >
              Back to my jobs
            </button>
          </div>
        ) : openOrder ? (
          <>
            <Card className="mb-3 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-700">
                {openOrder.order_no} · {openOrder.customer_name}
              </div>
              <div className="text-xs text-slate-500">{openOrder.address}</div>
            </Card>

            <Field label="Order ID">
              <input className="input" value={openOrder.order_no} disabled />
            </Field>

            <Field label="Work done" hint="Short and specific — what did you actually do?">
              <textarea
                ref={workDoneRef}
                className="input"
                rows={3}
                value={workDone}
                onChange={(e) => setWorkDone(e.target.value)}
                placeholder="Chemical cleaned indoor unit, topped up gas, tested cooling…"
              />
            </Field>

            <div className="grid gap-x-4 md:grid-cols-2">
              <Field
                label="Extra charges (RM)"
                hint={extraIssue ?? 'Parts, gas, additional units — leave 0 if there were none'}
              >
                <MoneyInput
                  value={extra}
                  onChange={setExtra}
                  invalid={!!extraIssue}
                  prefix="RM"
                  ariaLabel="Extra charges in ringgit"
                />
              </Field>
              <Field label="Final amount (auto)">
                <input className="input font-semibold" value={money(due)} disabled />
              </Field>
            </div>

            <Field label={`Photos / video / PDF (max ${MAX_ATTACHMENTS})`} hint={`${files.length}/${MAX_ATTACHMENTS} attached${repo instanceof SupabaseRepo ? ' — uploaded to Supabase Storage' : ' — kept in this browser (demo mode)'}`}>
              <input
                className="input !py-2"
                type="file"
                accept="image/*,video/*,application/pdf"
                multiple
                onChange={(e) => void addFiles(e.target.files)}
              />
            </Field>
            {files.length ? (
              <div className="mb-3 grid grid-cols-3 gap-2">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="relative overflow-hidden rounded-xl border border-slate-200">
                    {f.mime.startsWith('image/') ? (
                      <img src={f.url} alt={f.name} className="h-20 w-full object-cover" />
                    ) : (
                      <div className="grid h-20 place-items-center bg-slate-50 text-[11px] text-slate-500">{f.mime.split('/')[1]?.toUpperCase() ?? 'FILE'}</div>
                    )}
                    <button
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-xs text-rose-600 shadow"
                      onClick={() => setFiles((prev) => prev.filter((_, n) => n !== i))}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <Field label="Remarks">
              <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Customer satisfied, advised next service in 6 months" />
            </Field>

            <SectionTitle>Payment received (optional bonus)</SectionTitle>
            <div className="grid gap-x-4 md:grid-cols-2">
              <Field label="Payment amount (RM)" hint={paidIssue ?? undefined}>
                <MoneyInput
                  value={paid}
                  onChange={setPaid}
                  invalid={!!paidIssue}
                  prefix="RM"
                  defaultValue=""
                  placeholder="leave empty if unpaid"
                  ariaLabel="Payment received in ringgit"
                />
              </Field>
              <Field label="Payment method">
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={paid === ''}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {paid !== '' ? (
              <button className="btn-ghost !px-0 text-xs" onClick={() => setPaid(String(due))}>
                Fill with the final amount ({money(due)})
              </button>
            ) : null}

            {errors.length ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              >
                <div className="font-semibold">Not saved yet — please fix this:</div>
                <ul className="mt-1 list-inside list-disc">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <button className="btn-primary" disabled={busy} onClick={submit}>
                {busy ? 'Saving…' : 'Mark job as done'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setOpenNo(null);
                  reset();
                }}
              >
                Cancel
              </button>
              <span className="ml-auto text-xs text-slate-500">
                Signed by {actor.name} · <TimeText iso={new Date().toISOString()} withDate={false} />
              </span>
            </div>
            <DemoFillButton onFill={fillSample} label="Fill this report with sample data" />

          </>
        ) : (
          <EmptyState icon="🔍" title="Job not found" />
        )}
      </Modal>
    </div>
  );
}
