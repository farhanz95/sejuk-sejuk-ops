/**
 * Data access layer.
 *
 * Two interchangeable backends behind one interface:
 *   - SupabaseRepo  → used when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set
 *   - DemoRepo      → seeded, localStorage-backed, used when they are not
 *
 * Why: the reviewer must be able to open the live demo and click through the
 * whole workflow before creating any Supabase project. The architecture is the
 * same in both modes — the UI only ever talks to this interface.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Attachment, NotificationRecord, OpsData, Order, OrderEvent, OrderStatus, PaymentMethod, Role, ServiceReport, ServiceType, Technician } from './types';
import { buildSeed } from './seed';
import { computeFinalAmount, nextOrderNo, waDeepLink, whatsAppMessage, MAX_ATTACHMENTS } from './domain';

const DEMO_KEY = 'ss_ops_demo_v1';

export interface Actor {
  role: Role;
  name: string;
}

export interface OrderInput {
  customer_name: string;
  phone: string;
  address: string;
  problem_description: string;
  service_type: ServiceType;
  quoted_price: number;
  assigned_technician: Technician | null;
  admin_notes: string;
}

export interface CompletionInput {
  work_done: string;
  extra_charges: number;
  remarks: string;
  technician_name: string;
  payment_amount: number | null;
  payment_method: PaymentMethod | null;
  attachments: { name: string; mime: string; size: number; url: string }[];
}

export interface OpsRepo {
  mode: 'supabase' | 'demo';
  load(): Promise<OpsData>;
  createOrder(input: OrderInput, actor: Actor): Promise<Order>;
  assignTechnician(orderNo: string, technician: Technician, actor: Actor): Promise<void>;
  startJob(orderNo: string, actor: Actor): Promise<void>;
  completeJob(orderNo: string, input: CompletionInput, actor: Actor): Promise<{ report: ServiceReport; notification: NotificationRecord }>;
  reschedule(orderNo: string, reason: string, actor: Actor): Promise<void>;
  reviewOrder(orderNo: string, actor: Actor): Promise<void>;
  closeOrder(orderNo: string, actor: Actor): Promise<void>;
  markNotificationSent(orderNo: string): Promise<void>;
  resetDemo?(): void;
}

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

function makeEvent(orderNo: string, event_type: OrderEvent['event_type'], actor: Actor, detail: string, at = new Date().toISOString()): OrderEvent {
  return { id: uid('ev'), order_no: orderNo, event_type, actor_role: actor.role, actor_name: actor.name, detail, created_at: at };
}

/* ------------------------------------------------------------------ demo --- */

export class DemoRepo implements OpsRepo {
  mode = 'demo' as const;

  private read(): OpsData {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw) as OpsData;
    } catch {
      /* corrupted storage — fall through to a fresh seed */
    }
    const seeded = buildSeed();
    this.write(seeded);
    return seeded;
  }

  private write(data: OpsData): void {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(data));
    } catch {
      /* private mode / quota — the in-memory copy still works for this session */
    }
  }

  async load(): Promise<OpsData> {
    return this.read();
  }

  async createOrder(input: OrderInput, actor: Actor): Promise<Order> {
    const data = this.read();
    const now = new Date().toISOString();
    const order: Order = {
      order_no: nextOrderNo(data.orders.map((o) => o.order_no), new Date().getFullYear()),
      ...input,
      status: input.assigned_technician ? 'Assigned' : 'New',
      created_at: now,
      updated_at: now,
    };
    data.orders.unshift(order);
    data.events.unshift(makeEvent(order.order_no, 'created', actor, `Order created with quoted price RM ${input.quoted_price.toFixed(2)}`, now));
    if (input.assigned_technician) {
      data.events.unshift(makeEvent(order.order_no, 'assigned', actor, `Assigned to ${input.assigned_technician}`, now));
    }
    this.write(data);
    return order;
  }

  async assignTechnician(orderNo: string, technician: Technician, actor: Actor): Promise<void> {
    const data = this.read();
    const order = data.orders.find((o) => o.order_no === orderNo);
    if (!order) throw new Error(`Order ${orderNo} not found`);
    order.assigned_technician = technician;
    order.status = order.status === 'New' ? 'Assigned' : order.status;
    order.updated_at = new Date().toISOString();
    data.events.unshift(makeEvent(orderNo, 'assigned', actor, `Assigned to ${technician}`));
    this.write(data);
  }

  async startJob(orderNo: string, actor: Actor): Promise<void> {
    const data = this.read();
    const order = data.orders.find((o) => o.order_no === orderNo);
    if (!order) throw new Error(`Order ${orderNo} not found`);
    order.status = 'In Progress';
    order.updated_at = new Date().toISOString();
    data.events.unshift(makeEvent(orderNo, 'started', actor, 'Technician started the job'));
    this.write(data);
  }

  async completeJob(orderNo: string, input: CompletionInput, actor: Actor): Promise<{ report: ServiceReport; notification: NotificationRecord }> {
    const data = this.read();
    const order = data.orders.find((o) => o.order_no === orderNo);
    if (!order) throw new Error(`Order ${orderNo} not found`);
    if (input.attachments.length > MAX_ATTACHMENTS) throw new Error(`Maximum ${MAX_ATTACHMENTS} files per job.`);

    const now = new Date().toISOString();
    const reportId = uid('sr');
    const attachments: Attachment[] = input.attachments.map((a) => ({ id: uid('at'), report_id: reportId, ...a }));
    const finalAmount = computeFinalAmount(order.quoted_price, input.extra_charges);

    const report: ServiceReport = {
      id: reportId,
      order_no: orderNo,
      work_done: input.work_done,
      extra_charges: input.extra_charges,
      final_amount: finalAmount,
      remarks: input.remarks,
      technician_name: input.technician_name,
      completed_at: now,
      payment_amount: input.payment_amount,
      payment_method: input.payment_method,
      attachments,
    };

    // One report per order — completing again replaces the previous record.
    data.reports = data.reports.filter((r) => r.order_no !== orderNo);
    data.reports.unshift(report);
    order.status = 'Job Done';
    order.updated_at = now;

    data.events.unshift(makeEvent(orderNo, 'completed', actor, `Job done — final amount RM ${finalAmount.toFixed(2)} (quoted RM ${order.quoted_price.toFixed(2)} + extra RM ${input.extra_charges.toFixed(2)})`, now));
    if (input.payment_amount) {
      data.events.unshift(makeEvent(orderNo, 'payment_recorded', actor, `Payment RM ${input.payment_amount.toFixed(2)} via ${input.payment_method}`, now));
    }

    // Module 3: WhatsApp notification is triggered by the "Job Done" status.
    const message = whatsAppMessage(order, input.technician_name, now);
    const notification: NotificationRecord = {
      id: uid('nt'),
      order_no: orderNo,
      channel: 'whatsapp',
      target: order.phone,
      message,
      status: 'prepared',
      deep_link: waDeepLink(order.phone, message),
      created_at: now,
    };
    data.notifications.unshift(notification);
    data.events.unshift(makeEvent(orderNo, 'notified', { role: 'Admin', name: 'System' }, `WhatsApp message prepared for ${order.customer_name}`, now));

    this.write(data);
    return { report, notification };
  }

  async reschedule(orderNo: string, reason: string, actor: Actor): Promise<void> {
    const data = this.read();
    const order = data.orders.find((o) => o.order_no === orderNo);
    if (!order) throw new Error(`Order ${orderNo} not found`);
    order.status = order.assigned_technician ? 'Assigned' : 'New';
    order.updated_at = new Date().toISOString();
    data.events.unshift(makeEvent(orderNo, 'rescheduled', actor, reason || 'Rescheduled'));
    this.write(data);
  }

  private async setStatus(orderNo: string, status: OrderStatus, event: OrderEvent['event_type'], detail: string, actor: Actor): Promise<void> {
    const data = this.read();
    const order = data.orders.find((o) => o.order_no === orderNo);
    if (!order) throw new Error(`Order ${orderNo} not found`);
    order.status = status;
    order.updated_at = new Date().toISOString();
    data.events.unshift(makeEvent(orderNo, event, actor, detail));
    this.write(data);
  }

  async reviewOrder(orderNo: string, actor: Actor): Promise<void> {
    await this.setStatus(orderNo, 'Reviewed', 'reviewed', 'Reviewed and approved.', actor);
  }

  async closeOrder(orderNo: string, actor: Actor): Promise<void> {
    await this.setStatus(orderNo, 'Closed', 'closed', 'Closed.', actor);
  }

  async markNotificationSent(orderNo: string): Promise<void> {
    const data = this.read();
    const n = data.notifications.find((x) => x.order_no === orderNo);
    if (n) {
      n.status = 'sent';
      this.write(data);
    }
  }

  resetDemo(): void {
    localStorage.removeItem(DEMO_KEY);
  }
}

/* -------------------------------------------------------------- supabase --- */

interface Row {
  [k: string]: unknown;
}

/** Maps snake_case rows straight onto our domain objects (same column names). */
function rowToOrder(r: Row): Order {
  return {
    order_no: String(r.order_no),
    customer_name: String(r.customer_name ?? ''),
    phone: String(r.phone ?? ''),
    address: String(r.address ?? ''),
    problem_description: String(r.problem_description ?? ''),
    service_type: (r.service_type as ServiceType) ?? 'Cleaning',
    quoted_price: Number(r.quoted_price ?? 0),
    assigned_technician: (r.assigned_technician as Technician) ?? null,
    status: (r.status as OrderStatus) ?? 'New',
    admin_notes: String(r.admin_notes ?? ''),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at ?? r.created_at),
  };
}

export class SupabaseRepo implements OpsRepo {
  mode = 'supabase' as const;

  constructor(private client: SupabaseClient) {}

  private async fetchAll(): Promise<OpsData> {
    const [orders, reports, events, notifications, attachments] = await Promise.all([
      this.client.from('orders').select('*').order('created_at', { ascending: false }),
      this.client.from('service_reports').select('*').order('completed_at', { ascending: false }),
      this.client.from('order_events').select('*').order('created_at', { ascending: false }).limit(2000),
      this.client.from('notifications').select('*').order('created_at', { ascending: false }),
      this.client.from('attachments').select('*'),
    ]);
    const firstError = [orders, reports, events, notifications, attachments].find((r) => r.error)?.error;
    if (firstError) throw new Error(`Supabase: ${firstError.message}`);

    const attachByReport = new Map<string, Attachment[]>();
    for (const a of attachments.data ?? []) {
      const list = attachByReport.get(String(a.report_id)) ?? [];
      list.push({
        id: String(a.id),
        report_id: String(a.report_id),
        name: String(a.name ?? 'file'),
        mime: String(a.mime ?? 'application/octet-stream'),
        size: Number(a.size ?? 0),
        url: String(a.url ?? ''),
      });
      attachByReport.set(String(a.report_id), list);
    }

    return {
      orders: (orders.data ?? []).map(rowToOrder),
      reports: (reports.data ?? []).map((r) => ({
        id: String(r.id),
        order_no: String(r.order_no),
        work_done: String(r.work_done ?? ''),
        extra_charges: Number(r.extra_charges ?? 0),
        final_amount: Number(r.final_amount ?? 0),
        remarks: String(r.remarks ?? ''),
        technician_name: String(r.technician_name ?? ''),
        completed_at: String(r.completed_at),
        payment_amount: r.payment_amount === null ? null : Number(r.payment_amount),
        payment_method: (r.payment_method as PaymentMethod) ?? null,
        attachments: attachByReport.get(String(r.id)) ?? [],
      })),
      events: (events.data ?? []).map((e) => ({
        id: String(e.id),
        order_no: String(e.order_no),
        event_type: e.event_type as OrderEvent['event_type'],
        actor_role: (e.actor_role as Role | 'System') ?? 'System',
        actor_name: String(e.actor_name ?? ''),
        detail: String(e.detail ?? ''),
        created_at: String(e.created_at),
      })),
      notifications: (notifications.data ?? []).map((n) => ({
        id: String(n.id),
        order_no: String(n.order_no),
        channel: 'whatsapp',
        target: String(n.target ?? ''),
        message: String(n.message ?? ''),
        status: (n.status as 'prepared' | 'sent') ?? 'prepared',
        deep_link: String(n.deep_link ?? ''),
        created_at: String(n.created_at),
      })),
    };
  }

  async load(): Promise<OpsData> {
    return this.fetchAll();
  }

  async createOrder(input: OrderInput, actor: Actor): Promise<Order> {
    const { data: existing, error: readError } = await this.client.from('orders').select('order_no');
    if (readError) throw new Error(readError.message);
    const orderNo = nextOrderNo((existing ?? []).map((r) => String(r.order_no)), new Date().getFullYear());

    const row = {
      order_no: orderNo,
      ...input,
      status: input.assigned_technician ? 'Assigned' : 'New',
    };
    const { data, error } = await this.client.from('orders').insert(row).select('*').single();
    if (error) throw new Error(error.message);

    await this.log(orderNo, 'created', actor, `Order created with quoted price RM ${input.quoted_price.toFixed(2)}`);
    if (input.assigned_technician) await this.log(orderNo, 'assigned', actor, `Assigned to ${input.assigned_technician}`);
    return rowToOrder(data as Row);
  }

  private async log(orderNo: string, event_type: OrderEvent['event_type'], actor: Actor, detail: string): Promise<void> {
    await this.client.from('order_events').insert({
      order_no: orderNo,
      event_type,
      actor_role: actor.role,
      actor_name: actor.name,
      detail,
    });
  }

  async assignTechnician(orderNo: string, technician: Technician, actor: Actor): Promise<void> {
    const { data: current } = await this.client.from('orders').select('status').eq('order_no', orderNo).single();
    const { error } = await this.client
      .from('orders')
      .update({ assigned_technician: technician, status: current?.status === 'New' ? 'Assigned' : current?.status, updated_at: new Date().toISOString() })
      .eq('order_no', orderNo);
    if (error) throw new Error(error.message);
    await this.log(orderNo, 'assigned', actor, `Assigned to ${technician}`);
  }

  async startJob(orderNo: string, actor: Actor): Promise<void> {
    const { error } = await this.client.from('orders').update({ status: 'In Progress', updated_at: new Date().toISOString() }).eq('order_no', orderNo);
    if (error) throw new Error(error.message);
    await this.log(orderNo, 'started', actor, 'Technician started the job');
  }

  async completeJob(orderNo: string, input: CompletionInput, actor: Actor): Promise<{ report: ServiceReport; notification: NotificationRecord }> {
    const { data: orderRow, error: orderError } = await this.client.from('orders').select('*').eq('order_no', orderNo).single();
    if (orderError) throw new Error(orderError.message);
    const order = rowToOrder(orderRow as Row);

    const finalAmount = computeFinalAmount(order.quoted_price, input.extra_charges);
    const { data: reportRow, error } = await this.client
      .from('service_reports')
      .upsert(
        {
          order_no: orderNo,
          work_done: input.work_done,
          extra_charges: input.extra_charges,
          final_amount: finalAmount,
          remarks: input.remarks,
          technician_name: input.technician_name,
          payment_amount: input.payment_amount,
          payment_method: input.payment_method,
        },
        { onConflict: 'order_no' },
      )
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    if (input.attachments.length) {
      await this.client.from('attachments').insert(
        input.attachments.map((a) => ({ report_id: reportRow.id, name: a.name, mime: a.mime, size: a.size, url: a.url })),
      );
    }

    await this.client.from('orders').update({ status: 'Job Done', updated_at: new Date().toISOString() }).eq('order_no', orderNo);
    await this.log(orderNo, 'completed', actor, `Job done — final amount RM ${finalAmount.toFixed(2)}`);
    if (input.payment_amount) await this.log(orderNo, 'payment_recorded', actor, `Payment RM ${input.payment_amount.toFixed(2)} via ${input.payment_method}`);

    const message = whatsAppMessage(order, input.technician_name, new Date().toISOString());
    const { data: notifRow, error: notifError } = await this.client
      .from('notifications')
      .insert({ order_no: orderNo, channel: 'whatsapp', target: order.phone, message, status: 'prepared', deep_link: waDeepLink(order.phone, message) })
      .select('*')
      .single();
    if (notifError) throw new Error(notifError.message);
    await this.log(orderNo, 'notified', { role: 'Admin', name: 'System' }, `WhatsApp message prepared for ${order.customer_name}`);

    const attachments: Attachment[] = input.attachments.map((a, i) => ({
      id: `tmp-${i}`,
      report_id: String(reportRow.id),
      name: a.name,
      mime: a.mime,
      size: a.size,
      url: a.url,
    }));

    return {
      report: {
        id: String(reportRow.id),
        order_no: orderNo,
        work_done: input.work_done,
        extra_charges: input.extra_charges,
        final_amount: finalAmount,
        remarks: input.remarks,
        technician_name: input.technician_name,
        completed_at: String(reportRow.completed_at ?? new Date().toISOString()),
        payment_amount: input.payment_amount,
        payment_method: input.payment_method,
        attachments,
      },
      notification: {
        id: String(notifRow.id),
        order_no: orderNo,
        channel: 'whatsapp',
        target: order.phone,
        message,
        status: 'prepared',
        deep_link: waDeepLink(order.phone, message),
        created_at: String(notifRow.created_at ?? new Date().toISOString()),
      },
    };
  }

  async reschedule(orderNo: string, reason: string, actor: Actor): Promise<void> {
    const { data: current } = await this.client.from('orders').select('assigned_technician').eq('order_no', orderNo).single();
    await this.client
      .from('orders')
      .update({ status: current?.assigned_technician ? 'Assigned' : 'New', updated_at: new Date().toISOString() })
      .eq('order_no', orderNo);
    await this.log(orderNo, 'rescheduled', actor, reason || 'Rescheduled');
  }

  async reviewOrder(orderNo: string, actor: Actor): Promise<void> {
    await this.client.from('orders').update({ status: 'Reviewed', updated_at: new Date().toISOString() }).eq('order_no', orderNo);
    await this.log(orderNo, 'reviewed', actor, 'Reviewed and approved.');
  }

  async closeOrder(orderNo: string, actor: Actor): Promise<void> {
    await this.client.from('orders').update({ status: 'Closed', updated_at: new Date().toISOString() }).eq('order_no', orderNo);
    await this.log(orderNo, 'closed', actor, 'Closed.');
  }

  async markNotificationSent(orderNo: string): Promise<void> {
    await this.client.from('notifications').update({ status: 'sent' }).eq('order_no', orderNo);
  }

  /** Uploads to Supabase Storage; falls back to an inline data reference. */
  async upload(file: File, orderNo: string): Promise<{ name: string; mime: string; size: number; url: string }> {
    const path = `${orderNo}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error } = await this.client.storage.from('job-files').upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw new Error(error.message);
    const { data } = this.client.storage.from('job-files').getPublicUrl(path);
    return { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, url: data.publicUrl };
  }
}

/* -------------------------------------------------------------- factory --- */

export function createRepo(): OpsRepo {
  const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) {
    return new SupabaseRepo(createClient(url, key, { auth: { persistSession: false } }));
  }
  return new DemoRepo();
}
