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
  if (d.customer_name && d.customer_name.trim().length > 80) errors.push('Customer name is too long.');
  const phoneIssue = phoneProblem(d.phone ?? '');
  if (phoneIssue) errors.push(phoneIssue);
  if (!d.address?.trim()) errors.push('Address is required.');
  if (d.address && d.address.trim().length > 200) errors.push('Address is too long.');
  if (!d.problem_description?.trim()) errors.push('Problem description is required.');
  if (!d.service_type?.trim()) errors.push('Service type is required.');
  const priceIssue = amountProblem(d.quoted_price ?? '', { label: 'Quoted price', required: true });
  if (priceIssue) errors.push(priceIssue);
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

/**
 * Malaysian mobile/landline numbers, however they were typed:
 * 0123456789, 012-345 6789, +60 12-345 6789, 60123456789.
 *
 * Returns the reason it does not look like a phone number, or null when it is
 * fine — callers show the returned string beside the field.
 */
export function phoneProblem(raw: string): string | null {
  const value = (raw ?? '').trim();
  if (!value) return 'Enter a phone number.';
  const digits = value.replace(/[^0-9]/g, '');
  if (/[A-Za-z]/.test(value)) return 'A phone number cannot contain letters.';
  if (digits.length < 9) return 'That looks short — a Malaysian number has at least 9 digits.';
  if (digits.length > 13) return 'That looks too long for a phone number.';
  // +60 / 60 prefixes are the country code: 60123456789 and +60 12-345 6789 are
  // both 0123456789 written differently, so put the local 0 back.
  const local = digits.startsWith('60') ? (digits.startsWith('600') ? digits : `0${digits.slice(2)}`) : digits;
  if (!local.startsWith('0')) return 'Start with 0 (or +60) — e.g. 012-345 6789.';
  if (local.length < 9 || local.length > 11) return 'A Malaysian number is 9-11 digits after the leading 0.';
  if (!/^0[1-9]/.test(local)) return 'The second digit cannot be 0 — e.g. 012-345 6789.';
  return null;
}

/** Canonical form for storage: 0123456789 (the 60 prefix dropped). */
/**
 * Live formatting for a Malaysian phone number as it is typed: `012-345 6789`.
 *
 * Grouped the way people here write them — mobile numbers are 3-3-4 (`012-345 6789`),
 * landlines 2-4-4 (`03-1234 5678`) — and `+60`/`60` is folded back to a leading `0` so
 * a pasted international number looks local again. Anything that is not a digit is
 * dropped, so a pasted `+60 12-345 6789` becomes `012-345 6789` rather than garbled.
 *
 * Returns partial groups while the person is still typing (`012`, `012-3`), which is
 * what makes the field feel responsive rather than reformatting under the cursor.
 */
export function formatPhoneInput(raw: string): string {
  let digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('60')) digits = `0${digits.slice(2)}`;
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  const landline = digits[1] !== '1'; // 03/04/05/… versus 01x
  if (landline) {
    if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2, 6)} ${digits.slice(6)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)} ${digits.slice(6, 10)}`;
  }
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)} ${digits.slice(6, 11)}`;
}

export function normalisePhone(raw: string): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  return digits.startsWith('60') ? `0${digits.slice(2)}` : digits;
}

/** A money field: a real number, not negative, not silly, at most 2 decimals. */
export function amountProblem(raw: string | number, opts: { label?: string; max?: number; required?: boolean } = {}): string | null {
  const label = opts.label ?? 'Amount';
  const max = opts.max ?? 100000;
  const text = typeof raw === 'number' ? String(raw) : (raw ?? '').trim();
  if (text === '') return opts.required ? `${label} is required.` : null;
  if (!/^-?\d*(\.\d+)?$/.test(text)) return `${label} must be a number, without spaces or letters.`;
  const value = Number(text);
  if (!Number.isFinite(value)) return `${label} must be a number.`;
  if (value < 0) return `${label} cannot be negative.`;
  if (value > max) return `${label} looks too large — check for a typo (max ${max}).`;
  if (/\.\d{3,}/.test(text)) return `${label} can have at most 2 decimal places.`;
  return null;
}

export function validateCompletion(d: CompletionDraft, quotedPrice: number): string[] {
  const errors: string[] = [];
  if (!d.work_done?.trim() || d.work_done.trim().length < 3) errors.push('Describe the work done.');
  const extraProblem = amountProblem(d.extra_charges ?? 0, { label: 'Extra charges' });
  if (extraProblem) errors.push(extraProblem);
  const extra = typeof d.extra_charges === 'string' ? Number(d.extra_charges || 0) : d.extra_charges;
  if (d.attachmentCount > MAX_ATTACHMENTS) errors.push(`Maximum ${MAX_ATTACHMENTS} files per job.`);
  if (d.payment_amount !== null && d.payment_amount !== undefined && d.payment_amount !== '') {
    const paid = Number(d.payment_amount);
    const due = computeFinalAmount(quotedPrice, extra);
    const paidProblem = amountProblem(d.payment_amount as string | number, { label: 'Payment amount' });
    if (paidProblem) errors.push(paidProblem);
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
