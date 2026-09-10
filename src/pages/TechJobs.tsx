import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { MAX_ATTACHMENTS, computeFinalAmount, money, validateCompletion } from '../lib/domain';
import type { PaymentMethod } from '../lib/types';
import { Card, EmptyState, Field, Modal, MoneyText, SectionTitle, StatusPill, TimeText } from '../components/ui';
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

  const myJobs = useMemo(() => {
    const name = actor.name.toLowerCase();
    return data.orders
      .filter((o) => (o.assigned_technician ?? '').toLowerCase() === name)
      .sort((a, b) => {
        const rank = (s: string) => (s === 'Assigned' || s === 'In Progress' ? 0 : s === 'Job Done' ? 1 : 2);
        return rank(a.status) - rank(b.status) || +new Date(b.created_at) - +new Date(a.created_at);
      });
  }, [data.orders, actor.name]);

  const openOrder = openNo ? data.orders.find((o) => o.order_no === openNo) : undefined;
  const openReport = openNo ? data.reports.find((r) => r.order_no === openNo) : undefined;
  const due = openOrder ? computeFinalAmount(openOrder.quoted_price, Number(extra || 0)) : 0;

  const reset = () => {
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

  const submit = async () => {
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
    if (found.length) return;

    setBusy(true);
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
    }
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

      {myJobs.length === 0 ? (
        <EmptyState
          icon="🔧"
          title={`No jobs assigned to ${actor.name}`}
          hint="Switch to the Admin role in the header, create an order and assign it to this technician."
        />
      ) : (
        <div className="space-y-3">
          {myJobs.map((o) => {
            const report = data.reports.find((r) => r.order_no === o.order_no);
            const actionable = (o.status === 'Assigned' || o.status === 'In Progress') && o.assigned_technician?.toLowerCase() === actor.name.toLowerCase();
            return (
              <Card key={o.order_no} className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-2 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">{o.order_no}</span>
                      <StatusPill status={o.status} />
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-700">{o.customer_name}</div>
                    <div className="text-xs text-slate-500">{o.address}</div>
                    <div className="mt-1 text-sm text-slate-600">{o.problem_description}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Quoted</div>
                    <div className="font-semibold text-slate-800">
                      <MoneyText value={o.quoted_price} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{o.service_type}</div>
                  </div>
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
                          onClick={() => void startJob(o.order_no)}
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
        open={!!openOrder}
        title={doneNo ? `Job ${doneNo} completed` : `Complete ${openOrder?.order_no ?? ''}`}
        onClose={() => {
          setOpenNo(null);
          reset();
          if (orderNo) navigate('/jobs');
        }}
        wide
      >
        {openOrder && doneNo ? (
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

            {errors.length ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <ul className="list-inside list-disc">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Field label="Order ID">
              <input className="input" value={openOrder.order_no} disabled />
            </Field>

            <Field label="Work done" hint="Short and specific — what did you actually do?">
              <textarea className="input" rows={3} value={workDone} onChange={(e) => setWorkDone(e.target.value)} placeholder="Chemical cleaned indoor unit, topped up gas, tested cooling…" />
            </Field>

            <div className="grid gap-x-4 md:grid-cols-2">
              <Field label="Extra charges (RM)" hint="Parts, gas, additional units">
                <input className="input" type="number" min={0} step="0.01" value={extra} onChange={(e) => setExtra(e.target.value)} />
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
              <Field label="Payment amount (RM)">
                <input className="input" type="number" min={0} step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="leave empty if unpaid" />
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

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
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
          </>
        ) : (
          <EmptyState icon="🔍" title="Job not found" />
        )}
      </Modal>
    </div>
  );
}
