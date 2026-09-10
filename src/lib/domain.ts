/**
 * Pure business rules. No React, no Supabase — so they can be unit-tested and
 * reused by the serverless AI function (which must respect the same rules when
 * it answers questions about the data).
 */
import type { Order, OrderStatus, Role, ServiceReport, Technician } from './types';
import { TECHNICIANS } from './types';

export const STATUS_FLOW: OrderStatus[] = ['New', 'Assigned', 'In Progress', 'Job Done', 'Reviewed', 'Closed'];

/** The brief allows max 6 files per completed job (photo / video / PDF). */
export const MAX_ATTACHMENTS = 6;

export function statusIndex(status: OrderStatus): number {
  return STATUS_FLOW.indexOf(status);
}

/** Orders may only move forward one step at a time through the flow. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return statusIndex(to) === statusIndex(from) + 1;
}

/** Only Admin assigns technicians — "Only Admin can assign technicians". */
export function canAssign(role: Role): boolean {
  return role === 'Admin';
}

/** Only the assigned technician may complete the job. */
export function canMarkDone(role: Role, actorName: string, order: Order): boolean {
  if (role !== 'Technician') return false;
  if (!order.assigned_technician) return false;
  return order.assigned_technician.toLowerCase() === actorName.trim().toLowerCase();
}

/** Managers review completed jobs. */
export function canReview(role: Role): boolean {
  return role === 'Manager';
}

/**
 * Final amount is ALWAYS derived, never entered by hand — the brief lists it as
 * "auto-calculated" on the technician form.
 */
export function computeFinalAmount(quotedPrice: number, extraCharges: number): number {
  const quoted = Number.isFinite(quotedPrice) ? quotedPrice : 0;
  const extra = Number.isFinite(extraCharges) ? extraCharges : 0;
  return round2(quoted + extra);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function money(n: number): string {
  return 'RM ' + round2(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Auto-generated order number: SS-2026-0007 */
export function nextOrderNo(existing: string[], year = new Date().getFullYear()): string {
  const prefix = `SS-${year}-`;
  const highest = existing
    .filter((n) => typeof n === 'string' && n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => Math.max(max, n), 0);
  return prefix + String(highest + 1).padStart(4, '0');
}

export interface OrderDraft {
  customer_name: string;
  phone: string;
  address: string;
  problem_description: string;
  service_type: string;
  quoted_price: number | string;
  assigned_technician: string;
  admin_notes: string;
}

export function validateOrderDraft(d: OrderDraft): string[] {
  const errors: string[] = [];
  if (!d.customer_name?.trim()) errors.push('Customer name is required.');
  if (!d.phone?.trim()) errors.push('Phone is required.');
  if (!/^[0-9+\-\s()]{7,}$/.test(d.phone?.trim() ?? '')) errors.push('Phone looks invalid.');
  if (!d.address?.trim()) errors.push('Address is required.');
  if (!d.problem_description?.trim()) errors.push('Problem description is required.');
  if (!d.service_type?.trim()) errors.push('Service type is required.');
  const price = typeof d.quoted_price === 'string' ? Number(d.quoted_price) : d.quoted_price;
  if (!Number.isFinite(price) || price < 0) errors.push('Quoted price must be a number of 0 or more.');
  if (d.assigned_technician && !TECHNICIANS.includes(d.assigned_technician as Technician)) {
    errors.push('Assigned technician must be one of the 4 field teams.');
  }
  return errors;
}

export interface CompletionDraft {
  work_done: string;
  extra_charges: number | string;
  remarks: string;
  technician_name: string;
  attachmentCount: number;
  payment_amount?: number | string | null;
  payment_method?: string | null;
}

export function validateCompletion(d: CompletionDraft, quotedPrice: number): string[] {
  const errors: string[] = [];
  if (!d.work_done?.trim() || d.work_done.trim().length < 3) errors.push('Describe the work done.');
  const extra = typeof d.extra_charges === 'string' ? Number(d.extra_charges || 0) : d.extra_charges;
  if (!Number.isFinite(extra) || extra < 0) errors.push('Extra charges must be 0 or more.');
  if (d.attachmentCount > MAX_ATTACHMENTS) errors.push(`Maximum ${MAX_ATTACHMENTS} files per job.`);
  if (d.payment_amount !== null && d.payment_amount !== undefined && d.payment_amount !== '') {
    const paid = Number(d.payment_amount);
    const due = computeFinalAmount(quotedPrice, extra);
    if (!Number.isFinite(paid) || paid < 0) errors.push('Payment amount must be 0 or more.');
    else if (paid > due + 0.001) errors.push(`Payment cannot exceed the final amount (${money(due)}).`);
    if (!d.payment_method) errors.push('Choose a payment method.');
  }
  return errors;
}

/**
 * WhatsApp notification triggered when a job reaches "Job Done" (Module 3).
 * A wa.me deep link is used, so no WhatsApp Business API is required — see the
 * README for why that is a deliberate, explained limitation.
 */
export function whatsAppMessage(order: Order, technicianName: string, completedAt: string): string {
  const when = new Date(completedAt).toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    `Hi ${order.customer_name},\n\n` +
    `Job ${order.order_no} has been completed by Technician ${technicianName} at ${when}.\n` +
    `Please check and leave feedback.\n\nThank you!`
  );
}

/** Normalise a Malaysian phone number for wa.me (60xxxxxxxxx, no + or spaces). */
export function waNumber(phone: string): string {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return '6' + digits;
  return digits;
}

export function waDeepLink(phone: string, message: string): string {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(message)}`;
}

/** A completion is flagged by the AI workflow supervisor when the bill balloons. */
export function overQuoteRatio(order: Order, report: ServiceReport): number {
  if (!order.quoted_price) return report.extra_charges > 0 ? Infinity : 1;
  return round2(report.final_amount / order.quoted_price);
}

export function supervisorFlags(order: Order, report: ServiceReport, threshold = 1.5): string[] {
  const flags: string[] = [];
  const ratio = overQuoteRatio(order, report);
  if (ratio >= threshold) {
    flags.push(
      `Final amount ${money(report.final_amount)} is ${ratio === Infinity ? 'far' : ratio.toFixed(1) + 'x'} above the quoted ${money(order.quoted_price)}.`,
    );
  }
  if (!report.attachments || report.attachments.length === 0) {
    flags.push('Job marked done with no photo/video/PDF evidence attached.');
  }
  if (report.payment_amount !== null && report.payment_amount !== undefined && report.payment_amount <= 0) {
    flags.push('Payment recorded as zero.');
  }
  return flags;
}
