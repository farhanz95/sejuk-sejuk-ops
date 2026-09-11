/**
 * POST /api/extract-document — Advanced AI challenge: document understanding.
 *
 * Takes the text of a document (a quotation, invoice, WhatsApp order message or
 * work order — PDFs are converted to text in the browser) and returns the order
 * fields it contains. The model may only produce the JSON shape below; every
 * value is then validated by normalizeFields(), so a wrong guess becomes a
 * missing field rather than a wrong order.
 *
 * No AI key at all? extractFieldsHeuristically() reads the same document with
 * rules, so the feature still works (and the UI labels which path ran).
 *
 * Env: AI_API_KEY / AI_BASE_URL / AI_MODEL (the same vars as /api/ai-query).
 */
import { describeExtraction, extractFieldsHeuristically, FIELD_LABELS, mergeExtractions, normalizeFields, type ExtractedFields } from '../src/lib/doc-fields';
import { SERVICE_TYPES } from '../src/lib/types';

type Json = Record<string, unknown>;

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function llmConfig(): { key: string; baseUrl: string; model: string } | null {
  const key = env('AI_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY');
  if (!key) return null;
  return {
    key,
    baseUrl: env('AI_BASE_URL', 'OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
    model: env('AI_MODEL', 'OPENAI_MODEL') ?? 'gpt-4o-mini',
  };
}

/** The JSON contract handed to the model. */
export function extractionSchema() {
  return {
    type: 'object',
    properties: {
      customer_name: { type: ['string', 'null'], description: 'Customer / client name exactly as written' },
      phone: { type: ['string', 'null'], description: 'Contact phone number as written, digits and dashes only' },
      address: { type: ['string', 'null'], description: 'Service address (street, area, city)' },
      service_type: {
        type: ['string', 'null'],
        enum: [...SERVICE_TYPES, null],
        description: 'One of the listed service types, or null if the document does not make it clear',
      },
      problem_description: { type: ['string', 'null'], description: 'What is wrong / what work is requested' },
      quoted_price: { type: ['number', 'null'], description: 'Quoted or total amount in RM as a number, no currency symbol' },
      date: { type: ['string', 'null'], description: 'Requested or issued date as YYYY-MM-DD' },
      admin_notes: { type: ['string', 'null'], description: 'Anything else worth telling the technician (access, timing, remarks)' },
    },
    required: [
      'customer_name',
      'phone',
      'address',
      'service_type',
      'problem_description',
      'quoted_price',
      'date',
      'admin_notes',
    ],
    additionalProperties: false,
  };
}

export const EXTRACTION_SYSTEM_PROMPT =
  'You extract service-order fields from Malaysian air-conditioner service documents (quotations, invoices, ' +
  'WhatsApp order messages, work orders). Return ONLY the JSON object matching the schema. ' +
  'Use null for anything the document does not state — never guess a phone number, a price or a date. ' +
  'Amounts are Malaysian Ringgit: return the number without "RM". ' +
  `service_type must be exactly one of: ${SERVICE_TYPES.join(', ')}.`;

async function extractWithLlm(cfg: { key: string; baseUrl: string; model: string }, text: string): Promise<Json | null> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_completion_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: `Document:\n"""\n${text.slice(0, 12000)}\n"""` },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content) as Json;
  } catch {
    // Some models wrap the object in prose or fences; take the outermost braces.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Json;
    } catch {
      return null;
    }
  }
}

export default async function handler(
  req: { method?: string; body?: { text?: string; filename?: string } },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader?: (name: string, value: string) => void;
  },
): Promise<void> {
  // CORS for the Firebase-hosted copy of the app (see server/ai-query.ts): without it the
  // document reader fell back to the local rules there and a reviewer saw "read by: local
  // rules" no matter how good the paste was.
  res.setHeader?.('Access-Control-Allow-Origin', '*');
  res.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader?.('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.status(204).json({});
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  const text = (req.body?.text ?? '').trim();
  if (text.length < 12) {
    res.status(400).json({ error: 'Paste the document text (at least a line or two).' });
    return;
  }

  const cfg = llmConfig();
  let raw: Json | null = null;
  let extractor: 'llm' | 'heuristic' | 'llm+heuristic' = 'heuristic';

  if (cfg) {
    try {
      raw = await extractWithLlm(cfg, text);
      if (raw) extractor = 'llm';
    } catch {
      raw = null;
    }
  }

  let fields: ExtractedFields;
  let missing: (keyof ExtractedFields)[];

  const rules = extractFieldsHeuristically(text);

  if (raw) {
    ({ fields, missing } = normalizeFields(raw as Partial<Record<keyof ExtractedFields, unknown>>));
    if (Object.values(fields).every((v) => v === null)) {
      // the model produced nothing usable — the rules alone
      ({ fields, missing } = rules);
      extractor = 'heuristic';
    } else {
      // model first, rules for whatever it dropped
      const merged = mergeExtractions(fields, rules.fields);
      fields = merged.fields;
      missing = (Object.keys(fields) as (keyof ExtractedFields)[]).filter((k) => fields[k] === null);
      if (merged.filled.length) {
        extractor = 'llm+heuristic';
      }
    }
  } else {
    ({ fields, missing } = rules);
  }

  res.status(200).json({
    extractor,
    filled_by_rules: extractor === 'llm+heuristic' ? 'the rules path covered fields the model left empty' : null,
    fields,
    missing,
    missing_labels: missing.map((m) => FIELD_LABELS[m]),
    summary: describeExtraction(fields, missing),
    chars_read: text.length,
    filename: req.body?.filename ?? null,
  });
}
