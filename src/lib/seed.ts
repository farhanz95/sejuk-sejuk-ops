/**
 * Deterministic demo dataset.
 *
 * Two reasons this exists:
 *  1. The AI query window and the KPI dashboard are meaningless on an empty
 *     database — a reviewer opening the live demo must be able to ask
 *     "which technician completed the most jobs this week?" and get a real
 *     answer on the first click.
 *  2. It is generated from a fixed seed, so tests and screenshots are stable.
 *
 * The same rows are inserted by supabase/seed.sql for the cloud deployment.
 */
import type { Attachment, NotificationRecord, Order, OrderEvent, OrderStatus, ServiceReport, Technician, ServiceType, PaymentMethod } from './types';
import { TECHNICIANS, SERVICE_TYPES } from './types';
import { computeFinalAmount, nextOrderNo, waDeepLink, whatsAppMessage } from './domain';

/** Mulberry32 — tiny deterministic PRNG (no dependency, stable across runs). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTOMERS = [
  ['Ahmad Zaki', '012-3456789', 'No. 12, Jalan Sejuk, Shah Alam'],
  ['Siti Nurhaliza', '013-7788990', 'B-3-2 Pangsapuri Melati, Klang'],
  ['Lim Chee Keong', '016-2233445', '88 Jalan Bayan, Petaling Jaya'],
  ['Rajesh Kumar', '017-5566778', 'No. 5, Lorong Aman, Subang Jaya'],
  ['Tan Wei Ling', '019-3344556', '22 Jalan Indah, Cheras'],
  ['Faridah Hassan', '011-22334455', 'No. 9, Jalan Damai, Ampang'],
  ['Kumaravel S.', '012-9988776', '15 Jalan Perdana, Kajang'],
  ['Nurul Aina', '018-7766554', 'A-12-3 Residensi Harmoni, Puchong'],
  ['Wong Kah Meng', '016-1122334', '77 Jalan Utama, Kepong'],
  ['Syafiq Rahman', '014-8899001', 'No. 3, Jalan Bukit, Gombak'],
] as const;

const PROBLEMS = [
  'Aircond not cold, likely needs gas top-up',
  'Water dripping from indoor unit',
  'Loud noise from outdoor compressor',
  'New unit installation for master bedroom',
  'Routine service for 3 units, office floor 2',
  'Remote not responding, unit beeping',
  'Indoor unit leaking into ceiling',
  'Compressor trips the breaker after 10 minutes',
  'Bad smell when unit runs',
  'Annual chemical cleaning for 2 units',
] as const;

const WORK_DONE = [
  'Dismantled and chemically cleaned indoor + outdoor unit, replaced dirty filter, gas pressure checked.',
  'Replaced faulty capacitor, topped up R32 gas, tested cooling for 20 minutes.',
  'Cleared blocked drain pipe, flushed drainage tray, sealed minor leak at joint.',
  'Installed new 1.5HP unit, ran new copper piping, vacuumed system, tested operation.',
  'Serviced 3 units: coil cleaning, filter wash, gas pressure check, drain flush.',
  'Replaced remote control receiver board and tested all modes.',
  'Repaired condensate leak, added insulation wrap along the drain route.',
  'Replaced compressor start relay, verified amp draw is within spec.',
  'Deep cleaned blower wheel and evaporator coil, applied antibacterial treatment.',
] as const;

const REMARKS = [
  'Customer satisfied, advised next service in 6 months.',
  'Ladder access needed, work completed safely.',
  'Customer asked for quotation for a second unit.',
  'Unit is old (2014); advised replacement if issue returns.',
  '',
] as const;

/** Statuses for jobs already in the past — the flow is not always completed. */
function historicalStatus(rand: () => number, daysAgo: number): OrderStatus {
  const r = rand();
  if (daysAgo <= 1) return r < 0.35 ? 'Job Done' : r < 0.5 ? 'Reviewed' : r < 0.6 ? 'In Progress' : r < 0.7 ? 'Assigned' : r < 0.8 ? 'Closed' : 'Job Done';
  if (r < 0.42) return 'Closed';
  if (r < 0.62) return 'Reviewed';
  if (r < 0.88) return 'Job Done';
  if (r < 0.94) return 'In Progress';
  return 'Assigned';
}

export interface SeedOptions {
  /** 0 = fully random-looking but still deterministic; default 20260909. */
  seed?: number;
  days?: number;
  ordersPerDay?: number;
  /** Anchor "today" so tests do not drift. Defaults to the assessment window. */
  today?: Date;
}

export function buildSeed(opts: SeedOptions = {}): {
  orders: Order[];
  reports: ServiceReport[];
  events: OrderEvent[];
  notifications: NotificationRecord[];
} {
  const rand = prng(opts.seed ?? 20260909);
  const days = opts.days ?? 14;
  const perDay = opts.ordersPerDay ?? 3;
  const today = opts.today ?? new Date('2026-09-12T09:00:00+08:00');

  const orders: Order[] = [];
  const reports: ServiceReport[] = [];
  const events: OrderEvent[] = [];
  const notifications: NotificationRecord[] = [];

  const iso = (d: Date) => d.toISOString();
  const at = (daysAgo: number, hour: number, minute = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  let seq = 0;
  for (let daysAgo = days; daysAgo >= 0; daysAgo--) {
    for (let i = 0; i < perDay; i++) {
      seq++;
      const [customer, phone, address] = CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)];
      const problem = PROBLEMS[Math.floor(rand() * PROBLEMS.length)];
      const service = SERVICE_TYPES[Math.floor(rand() * SERVICE_TYPES.length)];
      const quoted = [80, 120, 150, 180, 220, 260, 320, 450, 680][Math.floor(rand() * 9)];
      const orderNo = nextOrderNo(orders.map((o) => o.order_no), 2026);
      const createdAt = at(daysAgo, 9 + Math.floor(rand() * 4), Math.floor(rand() * 60));
      const status = historicalStatus(rand, daysAgo);
      const assigned: Technician | null = status === 'New' ? null : TECHNICIANS[Math.floor(rand() * TECHNICIANS.length)];

      const order: Order = {
        order_no: orderNo,
        customer_name: customer,
        phone,
        address,
        problem_description: problem,
        service_type: service,
        quoted_price: quoted,
        assigned_technician: assigned,
        status,
        admin_notes: rand() < 0.3 ? 'Customer prefers morning slot.' : '',
        created_at: iso(createdAt),
        updated_at: iso(createdAt),
      };

      events.push({
        id: `ev-${seq}-1`,
        order_no: orderNo,
        event_type: 'created',
        actor_role: 'Admin',
        actor_name: 'Admin (desk)',
        detail: `Order created with quoted price RM ${quoted.toFixed(2)}`,
        created_at: iso(createdAt),
      });

      if (assigned) {
        const assignedAt = at(daysAgo, Math.min(23, createdAt.getHours() + 1));
        events.push({
          id: `ev-${seq}-2`,
          order_no: orderNo,
          event_type: 'assigned',
          actor_role: 'Admin',
          actor_name: 'Admin (desk)',
          detail: `Assigned to ${assigned}`,
          created_at: iso(assignedAt),
        });
      }

      // Jobs that reached "Job Done" or beyond have a service report.
      if (['Job Done', 'Reviewed', 'Closed'].includes(status) && assigned) {
        const extra = rand() < 0.35 ? [0, 15, 25, 40, 60, 90, 120][Math.floor(rand() * 7)] : 0;
        const completedAt = at(daysAgo, 11 + Math.floor(rand() * 6), Math.floor(rand() * 60));
        const attachmentCount = rand() < 0.15 ? 0 : 1 + Math.floor(rand() * 3);
        const attachments: Attachment[] = Array.from({ length: attachmentCount }).map((_, n) => ({
          id: `at-${seq}-${n}`,
          report_id: `sr-${seq}`,
          name: `job-${orderNo}-${n + 1}.jpg`,
          mime: 'image/jpeg',
          size: 180_000 + n * 12_000,
          url: '',
        }));
        const paid = rand() < 0.7;
        const report: ServiceReport = {
          id: `sr-${seq}`,
          order_no: orderNo,
          work_done: WORK_DONE[Math.floor(rand() * WORK_DONE.length)],
          extra_charges: extra,
          final_amount: computeFinalAmount(quoted, extra),
          remarks: REMARKS[Math.floor(rand() * REMARKS.length)],
          technician_name: assigned,
          completed_at: iso(completedAt),
          payment_amount: paid ? computeFinalAmount(quoted, extra) : null,
          payment_method: paid ? (['Cash', 'Bank Transfer', 'DuitNow QR'] as PaymentMethod[])[Math.floor(rand() * 3)] : null,
          attachments,
        };
        reports.push(report);

        events.push({
          id: `ev-${seq}-3`,
          order_no: orderNo,
          event_type: 'completed',
          actor_role: 'Technician',
          actor_name: assigned,
          detail: `Job done — final amount RM ${report.final_amount.toFixed(2)} (quoted RM ${quoted.toFixed(2)} + extra RM ${extra.toFixed(2)})`,
          created_at: iso(completedAt),
        });

        // Module 3: the WhatsApp trigger fires on "Job Done".
        const message = whatsAppMessage(order, assigned, iso(completedAt));
        notifications.push({
          id: `nt-${seq}`,
          order_no: orderNo,
          channel: 'whatsapp',
          target: phone,
          message,
          status: 'prepared',
          deep_link: waDeepLink(phone, message),
          created_at: iso(new Date(completedAt.getTime() + 60_000)),
        });
        events.push({
          id: `ev-${seq}-4`,
          order_no: orderNo,
          event_type: 'notified',
          actor_role: 'System',
          actor_name: 'Notifier',
          detail: `WhatsApp message prepared for ${customer}`,
          created_at: iso(new Date(completedAt.getTime() + 60_000)),
        });

        if (report.payment_amount) {
          events.push({
            id: `ev-${seq}-5`,
            order_no: orderNo,
            event_type: 'payment_recorded',
            actor_role: 'Technician',
            actor_name: assigned,
            detail: `Payment RM ${report.payment_amount.toFixed(2)} via ${report.payment_method}`,
            created_at: iso(new Date(completedAt.getTime() + 120_000)),
          });
        }

        if (status === 'Reviewed' || status === 'Closed') {
          const reviewedAt = at(Math.max(0, daysAgo - 1), 10, 30);
          events.push({
            id: `ev-${seq}-6`,
            order_no: orderNo,
            event_type: 'reviewed',
            actor_role: 'Manager',
            actor_name: 'Manager',
            detail: 'Reviewed and approved.',
            created_at: iso(reviewedAt),
          });
          if (status === 'Closed') {
            events.push({
              id: `ev-${seq}-7`,
              order_no: orderNo,
              event_type: 'closed',
              actor_role: 'Manager',
              actor_name: 'Manager',
              detail: 'Closed.',
              created_at: iso(new Date(reviewedAt.getTime() + 3600_000)),
            });
          }
        }
      }

      // Some jobs were postponed — the KPI module explicitly tracks this.
      if (rand() < 0.12 && assigned) {
        events.push({
          id: `ev-${seq}-8`,
          order_no: orderNo,
          event_type: 'rescheduled',
          actor_role: 'Admin',
          actor_name: 'Admin (desk)',
          detail: 'Customer not available — rescheduled.',
          created_at: iso(at(daysAgo, 14)),
        });
      }

      orders.push(order);
    }
  }

  return { orders, reports, events, notifications };
}
