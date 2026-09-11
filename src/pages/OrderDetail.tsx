import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppState';
import { TECHNICIANS, type Technician } from '../lib/types';
import { canAssign, canMarkDone, canReview, money, overQuoteRatio } from '../lib/domain';
import { Card, EmptyState, Field, Modal, MoneyText, SectionTitle, StatusPill, TimeText } from '../components/ui';

export default function OrderDetail() {
  const { orderNo = '' } = useParams();
  const navigate = useNavigate();
  const { order, reportFor, data, actor, assignTechnician, startJob, reschedule, review, close, markSent, mode } = useApp();
  const [assignOpen, setAssignOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reason, setReason] = useState('');

  const o = order(orderNo);
  if (!o) {
    return <EmptyState icon="🔍" title={`Order ${orderNo} not found`} hint="It may have been reset. Go back to the orders list." />;
  }
  const report = reportFor(orderNo);
  const events = data.events.filter((e) => e.order_no === orderNo).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const notification = data.notifications.find((n) => n.order_no === orderNo);
  const ratio = report ? overQuoteRatio(o, report) : null;

  const canComplete = canMarkDone(actor.role, actor.name, o);
  const mayAssign = canAssign(actor.role);
  const mayReview = canReview(actor.role);

  return (
    <div className="space-y-4">
      <button
        className="btn-ghost !px-0 text-sm"
        onClick={() => {
          // If this page was opened directly (a shared link), there is nothing to
          // go "back" to inside the app — so land on the list for this role
          // instead of throwing the user out of the portal.
          const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
          if (idx > 0) navigate(-1);
          else navigate(actor.role === 'Technician' ? '/jobs' : '/orders');
        }}
      >
        ← Back
      </button>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800">{o.order_no}</h1>
              <StatusPill status={o.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Created <TimeText iso={o.created_at} /> · {o.service_type}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-500">Quoted</div>
            <div className="text-lg font-bold text-slate-800">
              <MoneyText value={o.quoted_price} />
            </div>
            {report ? (
              <div className="mt-1 text-sm text-emerald-700">
                Final <strong>{money(report.final_amount)}</strong>
                {ratio && ratio >= 1.5 ? <span className="ml-1 chip bg-amber-100 text-amber-800">⚠ {ratio === Infinity ? '>>' : ratio.toFixed(1) + '×'} quote</span> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <div className="label">Customer</div>
            <div className="text-slate-700">{o.customer_name}</div>
            <a className="text-brand-700 hover:underline" href={`tel:${o.phone}`}>
              {o.phone}
            </a>
            <div className="mt-1 text-slate-500">{o.address}</div>
          </div>
          <div>
            <div className="label">Problem</div>
            <div className="text-slate-700">{o.problem_description}</div>
            {o.admin_notes ? <div className="mt-1 text-xs text-slate-500">Admin note: {o.admin_notes}</div> : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {mayAssign ? (
            <button className="btn-secondary" onClick={() => setAssignOpen(true)}>
              {o.assigned_technician ? `Reassign (${o.assigned_technician})` : 'Assign technician'}
            </button>
          ) : (
            <span className="chip bg-slate-100 text-slate-600">👷 {o.assigned_technician ?? 'unassigned'}</span>
          )}

          {canComplete && o.status === 'Assigned' ? (
            <button className="btn-secondary" onClick={() => void startJob(o.order_no)}>
              ▶ Start job
            </button>
          ) : null}

          {canComplete && (o.status === 'Assigned' || o.status === 'In Progress') ? (
            <button className="btn-primary" onClick={() => navigate(`/jobs/${o.order_no}`)}>
              Complete this job
            </button>
          ) : null}

          {(o.status === 'Assigned' || o.status === 'In Progress') && (mayAssign || canComplete) ? (
            <button className="btn-secondary" onClick={() => setRescheduleOpen(true)}>
              Reschedule / postpone
            </button>
          ) : null}

          {o.status === 'Job Done' && mayReview ? (
            <button className="btn-primary" onClick={() => void review(o.order_no)}>
              ✅ Mark reviewed
            </button>
          ) : null}

          {o.status === 'Reviewed' && mayReview ? (
            <button className="btn-secondary" onClick={() => void close(o.order_no)}>
              Close order
            </button>
          ) : null}

          {actor.role === 'Technician' && !canComplete ? (
            <span className="chip bg-amber-50 text-amber-800">Signed in as {actor.name} — this job belongs to {o.assigned_technician ?? 'nobody yet'}</span>
          ) : null}
        </div>
      </Card>

      {notification ? (
        <Card className="p-5">
          <SectionTitle right={<span className={`chip ${notification.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{notification.status}</span>}>
            WhatsApp notification (Module 3)
          </SectionTitle>
          <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{notification.message}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className="btn-primary"
              href={notification.deep_link}
              target="_blank"
              rel="noreferrer"
              onClick={() => void markSent(notification.order_no)}
            >
              Open in WhatsApp → {notification.target}
            </a>
            {notification.status !== 'sent' ? (
              <button className="btn-secondary" onClick={() => void markSent(notification.order_no)}>
                Mark as sent
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Triggered automatically by the <strong>Job Done</strong> status. A <code>wa.me</code> deep link is used, so no WhatsApp Business
            API is required (see README → limitations).
          </p>
        </Card>
      ) : null}

      {report ? (
        <Card className="p-5">
          <SectionTitle>Service report</SectionTitle>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="label">Work done</div>
              <p className="text-slate-700">{report.work_done}</p>
              {report.remarks ? <p className="mt-2 text-slate-500">Remarks: {report.remarks}</p> : null}
            </div>
            <div className="space-y-1 text-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-500">Technician</span>
                <span>{report.technician_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Completed</span>
                <span>
                  <TimeText iso={report.completed_at} />
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Extra charges</span>
                <MoneyText value={report.extra_charges} />
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-slate-500">Final amount</span>
                <MoneyText value={report.final_amount} />
              </div>
              {report.payment_amount !== null ? (
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment received</span>
                  <span>
                    <MoneyText value={report.payment_amount} /> · {report.payment_method}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Payment</span>
                  <span>not collected on site</span>
                </div>
              )}
            </div>
          </div>

          {report.attachments.length ? (
            <>
              <div className="label mt-4">Evidence ({report.attachments.length})</div>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                {report.attachments.map((a) =>
                  a.url && a.mime.startsWith('image/') ? (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-slate-200">
                      <img src={a.url} alt={a.name} className="h-20 w-full object-cover" />
                    </a>
                  ) : (
                    <div key={a.id} className="flex h-20 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-[11px] text-slate-500">
                      {a.mime.split('/')[1]?.toUpperCase() ?? 'FILE'}
                    </div>
                  ),
                )}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-amber-700">⚠ No photo/video/PDF evidence attached — flagged by the AI workflow supervisor.</p>
          )}
        </Card>
      ) : null}

      <Card className="p-5">
        <SectionTitle right={mode === 'demo' ? <span className="text-xs text-slate-400">stored in this browser</span> : undefined}>Order timeline (traceability)</SectionTitle>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No events yet.</p>
        ) : (
          <ol className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-400" />
                <div>
                  <div className="text-sm text-slate-700">{e.detail}</div>
                  <div className="text-xs text-slate-400">
                    {e.event_type} · {e.actor_role} {e.actor_name ? `(${e.actor_name})` : ''} · <TimeText iso={e.created_at} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Modal open={assignOpen} title={`Assign ${o.order_no}`} onClose={() => setAssignOpen(false)}>
        <div className="grid grid-cols-2 gap-2">
          {TECHNICIANS.map((t) => (
            <button
              key={t}
              className="btn-secondary"
              onClick={async () => {
                await assignTechnician(o.order_no, t as Technician);
                setAssignOpen(false);
              }}
            >
              👷 {t}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={rescheduleOpen} title={`Reschedule ${o.order_no}`} onClose={() => setRescheduleOpen(false)}>
        <Field label="Reason" hint="Logged in the timeline and counted in the KPI dashboard.">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer not available" />
        </Field>
        <button
          className="btn-primary"
          onClick={async () => {
            await reschedule(o.order_no, reason);
            setReason('');
            setRescheduleOpen(false);
          }}
        >
          Confirm reschedule
        </button>
      </Modal>
    </div>
  );
}
