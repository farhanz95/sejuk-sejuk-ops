/**
 * POST /api/ai-query — the AI Operations Query Window backend.
 *
 * Flow (matches the brief's expected system flow):
 *   user question → pick a CONTROLLED query → database retrieves the rows →
 *   AI formats the answer
 *
 * The model never sees the database and never writes SQL. It may only choose
 * one function from the catalog in src/lib/analytics.ts and supply its narrow
 * arguments; the rows are fetched by that function and handed back for
 * formatting. When no AI key is configured the same catalog is driven by a
 * deterministic intent matcher, so the demo still answers real questions.
 *
 * Env (all optional — the function degrades gracefully):
 *   SUPABASE_URL / VITE_SUPABASE_URL + SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 *   AI_API_KEY (or OPENAI_API_KEY), AI_BASE_URL, AI_MODEL
 */
import { createClient } from '@supabase/supabase-js';
import { QUERY_CATALOG, findQuery } from '../src/lib/analytics';
import { TECHNICIAN_NAMES, heuristicAnswer, matchIntent, type QueryChoice } from '../src/lib/ai-fallback';
import type { OpsData, Order, OrderEvent, PaymentMethod, Role, ServiceReport, Technician } from '../src/lib/types';

type Json = Record<string, unknown>;

interface Body {
  question?: string;
  /** Demo mode only: the browser sends the seeded dataset because there is no database. */
  snapshot?: OpsData;
  now?: string;
}

type LlmChoice = QueryChoice;

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/* ------------------------------------------------------------ data load --- */

async function loadFromSupabase(): Promise<OpsData | null> {
  const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!url || !key) return null;

  const client = createClient(url, key, { auth: { persistSession: false } });
  const [orders, reports, events, notifications, attachments] = await Promise.all([
    client.from('orders').select('*'),
    client.from('service_reports').select('*'),
    client.from('order_events').select('*').limit(2000),
    client.from('notifications').select('*'),
    client.from('attachments').select('*'),
  ]);
  const err = [orders, reports, events, notifications, attachments].find((r) => r.error)?.error;
  if (err) throw new Error(`Supabase: ${err.message}`);

  const byReport = new Map<string, ServiceReport['attachments']>();
  for (const a of attachments.data ?? []) {
    const list = byReport.get(String(a.report_id)) ?? [];
    list.push({
      id: String(a.id),
      report_id: String(a.report_id),
      name: String(a.name ?? ''),
      mime: String(a.mime ?? ''),
      size: Number(a.size ?? 0),
      url: String(a.url ?? ''),
    });
    byReport.set(String(a.report_id), list);
  }

  return {
    orders: (orders.data ?? []).map(
      (r: Json): Order => ({
        order_no: String(r.order_no),
        customer_name: String(r.customer_name ?? ''),
        phone: String(r.phone ?? ''),
        address: String(r.address ?? ''),
        problem_description: String(r.problem_description ?? ''),
        service_type: String(r.service_type ?? 'Cleaning') as Order['service_type'],
        quoted_price: Number(r.quoted_price ?? 0),
        assigned_technician: (r.assigned_technician as Technician) ?? null,
        status: String(r.status ?? 'New') as Order['status'],
        admin_notes: String(r.admin_notes ?? ''),
        created_at: String(r.created_at),
        updated_at: String(r.updated_at ?? r.created_at),
      }),
    ),
    reports: (reports.data ?? []).map(
      (r: Json): ServiceReport => ({
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
        attachments: byReport.get(String(r.id)) ?? [],
      }),
    ),
    events: (events.data ?? []).map(
      (e: Json): OrderEvent => ({
        id: String(e.id),
        order_no: String(e.order_no),
        event_type: String(e.event_type) as OrderEvent['event_type'],
        actor_role: String(e.actor_role ?? 'System') as Role | 'System',
        actor_name: String(e.actor_name ?? ''),
        detail: String(e.detail ?? ''),
        created_at: String(e.created_at),
      }),
    ),
    notifications: (notifications.data ?? []).map((n: Json) => ({
      id: String(n.id),
      order_no: String(n.order_no),
      channel: 'whatsapp' as const,
      target: String(n.target ?? ''),
      message: String(n.message ?? ''),
      status: (String(n.status ?? 'prepared') as 'prepared' | 'sent'),
      deep_link: String(n.deep_link ?? ''),
      created_at: String(n.created_at),
    })),
  };
}

/* ------------------------------------------------------------------- LLM --- */

interface LlmConfig {
  key: string;
  baseUrl: string;
  model: string;
}

function llmConfig(): LlmConfig | null {
  const key = env('AI_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY');
  if (!key) return null;
  return {
    key,
    baseUrl: env('AI_BASE_URL', 'OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
    model: env('AI_MODEL', 'OPENAI_MODEL') ?? 'gpt-4o-mini',
  };
}

/** Ask the model to pick exactly one controlled query. */
async function chooseQueryWithLlm(cfg: LlmConfig, question: string): Promise<LlmChoice | null> {
  const tools = QUERY_CATALOG.map((q) => ({
    type: 'function' as const,
    function: {
      name: q.name,
      description: q.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(q.params.map((p) => [p.name, { type: p.type, description: p.description }])),
        required: q.params.filter((p) => p.required).map((p) => p.name),
        additionalProperties: false,
      },
    },
  }));

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are the query planner for an air-conditioner service operations system. ' +
            'Choose exactly ONE function to answer the question. Never invent data. ' +
            `Known technicians: ${TECHNICIAN_NAMES.join(', ')}. ` +
            'If the question is outside service operations (jobs, technicians, revenue, reschedules, alerts), ' +
            'call business_overview and let the final answer explain the limitation.',
        },
        { role: 'user', content: question },
      ],
      tools,
      tool_choice: 'required',
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };
  const call = json.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call?.name) return null;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || '{}');
  } catch {
    args = {};
  }
  return { name: call.name, args };
}

/** Ask the model to phrase the already-retrieved rows as an answer. */
async function phraseAnswerWithLlm(cfg: LlmConfig, question: string, queryName: string, data: unknown): Promise<string | null> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You answer operational questions for an air-conditioner service company using ONLY the JSON rows provided. ' +
            'Be concise and specific: quote order numbers, technicians and RM amounts. ' +
            'If the rows are empty or an error field is present, say so plainly and suggest a narrower question. ' +
            'Never invent jobs, amounts or technicians. Answer in the same language as the question (English or Malay).',
        },
        { role: 'user', content: `Question: ${question}\n\nQuery used: ${queryName}\n\nRows (JSON):\n${JSON.stringify(data).slice(0, 12000)}` },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() || null;
}

/* ---------------------------------------------------------------- handler --- */

export default async function handler(req: { method?: string; body?: Body }, res: {
  status: (code: number) => { json: (body: unknown) => void };
}): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  const question = (req.body?.question ?? '').trim();
  if (!question) {
    res.status(400).json({ error: 'Ask a question.' });
    return;
  }

  const now = req.body?.now ? new Date(req.body.now) : new Date();

  let data: OpsData | null = null;
  let source: 'supabase' | 'snapshot' = 'snapshot';
  try {
    data = await loadFromSupabase();
    if (data) source = 'supabase';
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!data) {
    data = req.body?.snapshot ?? null;
  }
  if (!data) {
    res.status(400).json({
      error: 'No data source. Set SUPABASE_URL + SUPABASE_ANON_KEY on the server, or use the built-in demo dataset.',
    });
    return;
  }

  const cfg = llmConfig();
  let choice: LlmChoice | null = null;
  let planner: 'llm' | 'heuristic' = 'heuristic';
  if (cfg) {
    try {
      choice = await chooseQueryWithLlm(cfg, question);
      if (choice) planner = 'llm';
    } catch {
      choice = null;
    }
  }
  if (!choice) choice = matchIntent(question);

  const query = findQuery(choice.name) ?? findQuery('business_overview')!;
  let result: unknown;
  try {
    result = query.run(data, choice.args ?? {}, now);
  } catch (err) {
    result = { error: err instanceof Error ? err.message : String(err) };
  }

  let answer: string | null = null;
  let phrasing: 'llm' | 'template' = 'template';
  if (cfg) {
    try {
      answer = await phraseAnswerWithLlm(cfg, question, query.name, result);
      if (answer) phrasing = 'llm';
    } catch {
      answer = null;
    }
  }
  if (!answer) answer = heuristicAnswer(question, query.name, result);

  res.status(200).json({
    answer,
    query_used: query.name,
    args_used: choice.args ?? {},
    planner,
    phrasing,
    data_source: source,
    rows: result,
  });
}
