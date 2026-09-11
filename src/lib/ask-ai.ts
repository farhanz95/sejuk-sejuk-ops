/**
 * One place that asks the operations assistant a question.
 *
 * Order of preference:
 *   1. the serverless endpoint (LLM planner + LLM phrasing, reads Supabase itself)
 *   2. if that host has no endpoint (static hosting) or it errors → the same
 *      controlled catalog, run in the browser, with the reason in plain words
 *
 * Used by the AI query window and by the dashboard's "operational insight" card,
 * so both behave identically whichever host they are on.
 */
import { findQuery, QUERY_CATALOG } from './analytics';
import { describeEndpointFailure, heuristicAnswer, matchIntent } from './ai-fallback';
import type { OpsData } from './types';

export interface AiResponse {
  answer?: string;
  query_used?: string;
  args_used?: Record<string, unknown>;
  planner?: 'llm' | 'heuristic';
  phrasing?: 'llm' | 'template';
  data_source?: string;
  rows?: unknown;
  error?: string;
}

export interface AskResult {
  response: AiResponse;
  /** Set when the answer came from the browser instead of the endpoint. */
  endpointDown?: string;
}

/**
 * Where the AI endpoint lives.
 *
 * On Vercel the API is part of the same deployment, so a relative path is right. Firebase
 * Hosting is static — it answers /api/ai-query with index.html, which the client read as "no
 * endpoint" and fell back to the in-browser answer. A static host therefore calls the Vercel
 * deployment, which sends CORS headers for exactly this case.
 *
 * `VITE_AI_ENDPOINT` overrides both, for a different API host.
 */
const STATIC_HOST_API = 'https://sejuk-sejuk-ops-five.vercel.app/api/ai-query';

export function apiEndpoint(): string {
  const override = import.meta.env.VITE_AI_ENDPOINT;
  if (override) return override;
  if (typeof window === 'undefined') return '/api/ai-query';
  // Any host that can run the API keeps it same-origin (no CORS round-trip).
  return /(^|\.)vercel\.app$/.test(window.location.hostname) ? '/api/ai-query' : STATIC_HOST_API;
}

export async function askAi(question: string, data: OpsData, mode: 'supabase' | 'demo'): Promise<AskResult> {
  try {
    const res = await fetch(apiEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Demo mode has no database behind the endpoint, so the seeded dataset
      // travels with the request; with Supabase configured the server reads it.
      body: JSON.stringify(mode === 'demo' ? { question, snapshot: data } : { question }),
    });
    const json = (await res.json()) as AiResponse;
    if (!res.ok || json.error) {
      const reason = json.error ?? `HTTP ${res.status}`;
      return { response: answerInBrowser(question, data, reason), endpointDown: reason };
    }
    return { response: json };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { response: answerInBrowser(question, data, reason), endpointDown: reason };
  }
}

/** Run the same controlled queries locally and phrase them with the template. */
export function answerInBrowser(question: string, data: OpsData, note?: string): AiResponse {
  const choice = matchIntent(question);
  const query = findQuery(choice.name) ?? findQuery('business_overview')!;
  let rows: unknown;
  try {
    rows = query.run(data, choice.args, new Date());
  } catch (err) {
    rows = { error: err instanceof Error ? err.message : String(err) };
  }
  const because = describeEndpointFailure(note);
  return {
    answer:
      heuristicAnswer(question, query.name, rows) +
      (note ? `\n\n_Answered in the browser from the same controlled query (${because}), so the figures are identical to the server path._` : ''),
    query_used: query.name,
    args_used: choice.args,
    planner: 'heuristic',
    phrasing: 'template',
    data_source: 'browser',
    rows,
  };
}

/**
 * Questions the assistant is expected to handle, surfaced in the UI so a
 * reviewer does not have to guess. Kept next to the catalog they exercise.
 */
export const SUGGESTED_QUESTIONS = [
  'What jobs did technician Ali complete last week?',
  'Which technician completed the most jobs this week?',
  'How many jobs were completed today?',
  'How much did we bill this week and what is still outstanding?',
  'Which jobs have been open for more than 3 days?',
  // advanced challenge: operational insight
  'Which technician might be overloaded this week?',
  'Is the workload balanced across the team?',
  // advanced challenge: workflow supervisor
  'Any suspicious jobs this month?',
  'Berapa banyak job siap minggu ini?',
];

export function catalogNames(): string[] {
  return QUERY_CATALOG.map((q) => q.name);
}
