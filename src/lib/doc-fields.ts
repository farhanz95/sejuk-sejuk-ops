/**
 * Document understanding: turn a pasted/uploaded document (quote, invoice,
 * WhatsApp order message, work order) into order fields.
 *
 * The LLM does the reading, but everything it returns passes through
 * `normalizeFields()` here: the model is never trusted to invent a service type
 * the app does not have, a phone number that is not a phone number, or a price
 * that is not a number. Whatever fails validation is reported as `missing`
 * instead of being silently guessed.
 *
 * `extractFieldsHeuristically()` is the no-AI-key path (and the browser fallback
 * on static hosting), so the feature is demonstrable even without a model.
 */
import { SERVICE_TYPES, type ServiceType } from './types';

export interface ExtractedFields {
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  service_type: ServiceType | null;
  problem_description: string | null;
  quoted_price: number | null;
  /** ISO date (YYYY-MM-DD) parsed from the document, if one is stated. */
  date: string | null;
  admin_notes: string | null;
}

export const EMPTY_FIELDS: ExtractedFields = {
  customer_name: null,
  phone: null,
  address: null,
  service_type: null,
  problem_description: null,
  quoted_price: null,
  date: null,
  admin_notes: null,
};

export const FIELD_LABELS: Record<keyof ExtractedFields, string> = {
  customer_name: 'Customer name',
  phone: 'Phone',
  address: 'Address',
  service_type: 'Service type',
  problem_description: 'Problem / job description',
  quoted_price: 'Quoted price',
  date: 'Date',
  admin_notes: 'Notes',
};

/* ------------------------------------------------------------- normalise --- */

/** Keep only values we can defend; anything else becomes null and is reported. */
export function normalizeFields(raw: Partial<Record<keyof ExtractedFields, unknown>>): { fields: ExtractedFields; missing: (keyof ExtractedFields)[] } {
  const fields: ExtractedFields = { ...EMPTY_FIELDS };

  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t || /^(null|n\/?a|unknown|none|-)$/i.test(t)) return null;
    return t.slice(0, 300);
  };

  fields.customer_name = str(raw.customer_name);
  fields.address = str(raw.address);
  fields.problem_description = str(raw.problem_description);
  fields.admin_notes = str(raw.admin_notes);

  // phone: must look like a Malaysian phone number once stripped
  const phone = str(raw.phone);
  if (phone) {
    const digits = phone.replace(/[^0-9]/g, '');
    fields.phone = digits.length >= 9 && digits.length <= 13 ? phone : null;
  }

  // service type: must be one of ours (tolerate case/spacing)
  const service = str(raw.service_type);
  if (service) {
    const match = SERVICE_TYPES.find((s) => s.toLowerCase() === service.toLowerCase())
      ?? SERVICE_TYPES.find((s) => service.toLowerCase().includes(s.toLowerCase().split(' ')[0]));
    fields.service_type = match ?? null;
  }

  // price: accept "RM 1,250.50", "1250.5", "180"
  const priceRaw = raw.quoted_price;
  if (typeof priceRaw === 'number' && Number.isFinite(priceRaw) && priceRaw >= 0) {
    fields.quoted_price = Math.round(priceRaw * 100) / 100;
  } else if (typeof priceRaw === 'string') {
    const cleaned = priceRaw.replace(/[^0-9.]/g, '');
    const n = Number(cleaned);
    if (cleaned && Number.isFinite(n) && n >= 0) fields.quoted_price = Math.round(n * 100) / 100;
  }

  // date: must parse, and must not be absurd
  const dateRaw = str(raw.date);
  if (dateRaw) {
    const parsed = parseLooseDate(dateRaw);
    if (parsed) fields.date = parsed;
  }

  const missing = (Object.keys(fields) as (keyof ExtractedFields)[]).filter((k) => fields[k] === null);
  return { fields, missing };
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
  // Malay abbreviations, common in local paperwork
  ogos: 8, ogo: 8, okt: 10, dis: 12, mac: 3, mei: 5,
};

/** Accepts 2026-09-12, 12/09/2026 (day-first, MY convention), 12 Sep 2026, 12 September 2026. */
export function parseLooseDate(input: string): string | null {
  const s = input.trim();

  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoOrNull(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) {
    // Malaysian paperwork is day-first; if day > 12 the ambiguity resolves itself
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a > 12 ? isoOrNull(Number(m[3]), b, a) : isoOrNull(Number(m[3]), b, a);
  }

  m = s.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return isoOrNull(Number(m[3]), month, Number(m[1]));
  }

  m = s.match(/\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return isoOrNull(Number(m[3]), month, Number(m[2]));
  }
  return null;
}

function isoOrNull(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. 31 Feb
  return dt.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------- heuristic --- */

const SERVICE_HINTS: [RegExp, ServiceType][] = [
  [/\b(gas|refill|top ?up|isi gas)\b/i, 'Gas Refill'],
  [/\b(install|installation|pasang|new unit|unit baru)\b/i, 'Installation'],
  [/\b(repair|fix|baiki|rosak|not cold|tidak sejuk|no cold|compressor|capacitor|motor|leak|bocor)\b/i, 'Repair'],
  [/\b(service|cleaning|cuci|chemical|servis|maintenance)\b/i, 'Cleaning'],
  [/\b(inspect|inspection|check|periksa|survey)\b/i, 'Inspection'],
];

/**
 * Paperwork writes "Address: No. 12, Jalan ..." — the label must not end up in
 * the value (caught by a test: the address came back as "Address: No. 12, ...").
 * Note "No." is deliberately NOT a label here: it is part of the address.
 */
const FIELD_LABEL_PREFIX =
  /^\s*(?:address|alamat|customer(?:\s+name)?|client|nama(?:\s+pelanggan)?|phone|no\.?\s?tel|tel|telefon|hp|mobile|issue|problem|masalah|service|servis|total|jumlah|amount|harga|date|tarikh|notes?|remarks?|catatan|kepada|to|quotation|invoice)\s*[:\-]\s*/i;

export function stripFieldLabel(line: string): string {
  return line.replace(FIELD_LABEL_PREFIX, '').trim();
}

/**
 * Reads the shapes actually found in local service paperwork. Deliberately
 * conservative: a null is better than a wrong field, because the admin reviews
 * the result before it becomes an order.
 */
export function extractFieldsHeuristically(text: string): { fields: ExtractedFields; missing: (keyof ExtractedFields)[] } {
  const raw: Partial<Record<keyof ExtractedFields, unknown>> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flat = lines.join('\n');

  // phone: 01x-xxxxxxx, +60 1x, 0x-xxxxxxx
  const phone = flat.match(/(?:\+?60|0)\s?1\d[\s-]?\d{3,4}[\s-]?\d{4}\b/) ?? flat.match(/\b0\d{1,3}[\s-]?\d{3,4}[\s-]?\d{4}\b/);
  if (phone) raw.phone = phone[0];

  // price: prefer an explicit RM / MYR marker, then a "Total" line, then any decimal
  const withMarker = flat.match(/(?:RM|MYR)\s?([0-9][0-9,]*\.?[0-9]{0,2})/i);
  if (withMarker) raw.quoted_price = withMarker[1];
  else {
    const totalLine = lines.find((l) => /\b(total|jumlah|amount|harga|quotation|quote)\b/i.test(l));
    const onTotalLine = totalLine?.match(/([0-9][0-9,]*\.?[0-9]{0,2})/);
    if (onTotalLine) raw.quoted_price = onTotalLine[1];
  }

  // date: any parseable date, preferring a line that labels it
  const labelledDate = lines.find((l) => /\b(date|tarikh|when|slot)\b/i.test(l)) ?? flat;
  const parsedDate = parseLooseDate(labelledDate) ?? parseLooseDate(flat);
  if (parsedDate) raw.date = parsedDate;

  // customer: labelled line, else fall back to a name-looking labelled value
  for (const line of lines) {
    const m = line.match(/^\s*(?:customer|client|customer name|nama|nama pelanggan|kepada|to)\s*[:\-]\s*(.+)$/i);
    if (m && m[1].trim().length >= 3) {
      raw.customer_name = m[1].replace(/\s{2,}.*$/, '').trim();
      break;
    }
  }
  if (!raw.customer_name) {
    // "Ahmad Zaki 012-3456789" on one line
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+){1,3})\s+(?:\+?60|0)1\d/);
      if (m) {
        raw.customer_name = m[1].trim();
        break;
      }
    }
  }

  // address: a line that looks like a Malaysian address
  const addressLine = lines.find((l) => /\b(jalan|jln|lorong|taman|kg|kampung|no\.?\s?\d+|blok|block|pangsapuri|apartment|condo|residensi|persiaran)\b/i.test(l) && l.length >= 12);
  if (addressLine) raw.address = stripFieldLabel(addressLine);

  // Service type, strongest signal first:
  //  1. an explicit labelled line ("Service: cleaning", "Jenis: cuci") — what the
  //     paperwork actually states,
  //  2. otherwise the problem wording ("not cold" → Repair).
  // Caught by a test: the quotation said "Service: cleaning" but the phrase
  // "not cold" in the issue line won, booking a cleaning job as a repair.
  const labelledService = lines
    .map((l) => l.match(/^\s*(?:service|servis|jenis|work|kerja)\s*[:\-]\s*(.+)$/i)?.[1]?.trim())
    .find(Boolean);
  if (labelledService) {
    const match = SERVICE_TYPES.find((t) => t.toLowerCase() === labelledService.toLowerCase())
      ?? SERVICE_TYPES.find((t) => labelledService.toLowerCase().includes(t.toLowerCase().split(' ')[0]));
    if (match) raw.service_type = match;
  }
  if (!raw.service_type) {
    const serviceHit = SERVICE_HINTS.find(([re]) => re.test(flat));
    if (serviceHit) raw.service_type = serviceHit[1];
  }

  // Problem description: the line describing the fault or the requested work.
  // Letterheads were being picked up ("SEJUK SEJUK SERVICE SDN BHD" matched the
  // word "service"), so header-looking lines are excluded and the wording is
  // matched on the fault itself, not on the word "service".
  const isHeaderish = (l: string) =>
    /^[A-Z0-9 &.,'()\/\-]{12,}$/.test(l) ||
    /\b(sdn\.?\s?bhd|bhd|enterprise|trading|quotation|quote|invoice|resit|receipt|no\.\s?qt|tel|fax|email)\b/i.test(l);
  const faultish =
    /\b(air ?cond|aircond|compressor|remote|blow|drip|leak|bocor|not cold|tak sejuk|tidak sejuk|no cold|bunyi|noise|vibrat|jam|bantut|smell|bau|water|titisan|insulation|pipe|paip|capacitor|motor|fan|gas)\b/i;
  const probLine =
    lines.find((l) => l !== addressLine && !isHeaderish(l) && faultish.test(l)) ??
    lines.find((l) => l !== addressLine && !isHeaderish(l) && l.length > 20);
  if (probLine) raw.problem_description = stripFieldLabel(probLine);

  // notes: anything explicitly labelled as note/remark, else a short doc type line
  const noteLine = lines.find((l) => /^\s*(?:notes?|remarks?|catatan)\s*[:\-]\s*(.+)$/i.test(l));
  if (noteLine) raw.admin_notes = noteLine.replace(/^\s*(?:notes?|remarks?|catatan)\s*[:\-]\s*/i, '').trim();

  return normalizeFields(raw);
}

/**
 * Fill the gaps the model left.
 *
 * Measured on the deployed endpoint: asked to read a quotation containing
 * "Issue: …", "Total: RM 320.00" and "Notes: …", the free-tier model returned
 * customer/phone/address/service/date and null for the other three. The rules
 * path reads those reliably, so the two are combined — the model leads (it
 * understands phrasing), the rules cover the fields it drops, and the UI reports
 * which combination produced the result.
 */
export function mergeExtractions(
  primary: ExtractedFields,
  fallback: ExtractedFields,
): { fields: ExtractedFields; filled: (keyof ExtractedFields)[] } {
  const fields: ExtractedFields = { ...primary };
  const filled: (keyof ExtractedFields)[] = [];
  for (const key of Object.keys(primary) as (keyof ExtractedFields)[]) {
    if (fields[key] === null && fallback[key] !== null) {
      // @ts-expect-error the key is the same on both sides, so the value type matches
      fields[key] = fallback[key];
      filled.push(key);
    }
  }
  return { fields, filled };
}

/** A compact, deterministic summary of the extraction, for the UI and the audit. */
export function describeExtraction(fields: ExtractedFields, missing: (keyof ExtractedFields)[]): string {
  const found = (Object.keys(fields) as (keyof ExtractedFields)[]).filter((k) => fields[k] !== null);
  if (!found.length) return 'Nothing usable was found in that document — fill the form manually or paste clearer text.';
  const parts = [`Read ${found.length} field(s): ${found.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}.`];
  if (missing.length) parts.push(`Not stated: ${missing.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}.`);
  return parts.join(' ');
}
