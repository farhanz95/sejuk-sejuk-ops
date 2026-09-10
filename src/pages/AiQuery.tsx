import { useMemo, useState } from 'react';
import { useApp } from '../state/AppState';
import { QUERY_CATALOG, findQuery } from '../lib/analytics';
import { heuristicAnswer, matchIntent } from '../lib/ai-fallback';
import type { OpsData } from '../lib/types';
import { Card, EmptyState, SectionTitle } from '../components/ui';

interface AiResponse {
  answer?: string;
  query_used?: string;
  args_used?: Record<string, unknown>;
  planner?: 'llm' | 'heuristic';
  phrasing?: 'llm' | 'template';
  data_source?: string;
  rows?: unknown;
  error?: string;
}

const SUGGESTIONS = [
  'What jobs did technician Ali complete last week?',
  'Which technician completed the most jobs this week?',
  'How many jobs were completed today?',
  'How much did we bill this week and what is still outstanding?',
  'Which jobs have been open for more than 3 days?',
  'Any suspicious jobs this month?',
  'Berapa banyak job siap minggu ini?',
];


/**
 * Last-resort answer path: the same controlled queries, run in the browser.
 * Used when /api/ai-query is unavailable (static hosting, offline). Answers are
 * labelled `source: browser` so a reviewer can tell where they came from.
 */
function answerInBrowser(question: string, data: OpsData, note?: string): AiResponse {
  const choice = matchIntent(question);
  const query = findQuery(choice.name) ?? findQuery('business_overview')!;
  let rows: unknown;
  try {
    rows = query.run(data, choice.args, new Date());
  } catch (err) {
    rows = { error: err instanceof Error ? err.message : String(err) };
  }
  return {
    answer:
      heuristicAnswer(question, query.name, rows) +
      (note ? `\n\n_(the AI endpoint was unavailable — answered locally from the same controlled query: ${note})_` : ''),
    query_used: query.name,
    args_used: choice.args,
    planner: 'heuristic',
    phrasing: 'template',
    data_source: 'browser',
    rows,
  };
}

export default function AiQuery() {
  const { data, mode, actor } = useApp();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<AiResponse | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  const [showRows, setShowRows] = useState(false);

  const examples = useMemo(() => QUERY_CATALOG.flatMap((q) => q.examples).slice(0, 8), []);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setResponse(null);
    setShowRows(false);
    try {
      const res = await fetch('/api/ai-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // In demo mode the seeded dataset is sent along because there is no
        // server-side database; with Supabase configured the API reads it itself.
        body: JSON.stringify(mode === 'demo' ? { question: text, snapshot: data } : { question: text }),
      });
      const json = (await res.json()) as AiResponse;
      if (!res.ok || json.error) {
        // The endpoint answered with an error (or a static host has no API at
        // all) — answer from the same controlled catalog in the browser instead
        // of showing the user a dead end.
        setResponse(answerInBrowser(text, data, json.error));
      } else {
        setResponse(json);
      }
      setAsked((prev) => [text, ...prev.filter((x) => x !== text)].slice(0, 6));
    } catch (err) {
      setResponse(answerInBrowser(text, data, err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">AI operations query window</h1>
        <p className="text-sm text-slate-500">
          Ask about jobs, technicians, revenue or anomalies. The assistant may only call controlled, pre-aggregated queries — it never
          sees the raw database and never writes SQL.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            className="input md:flex-1"
            placeholder="e.g. What jobs did technician Ali complete last week?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ask(question);
            }}
          />
          <button className="btn-primary md:w-40" disabled={busy || !question.trim()} onClick={() => void ask(question)}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="chip border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              onClick={() => {
                setQuestion(s);
                void ask(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      {response?.error ? (
        <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">⚠ {response.error}</Card>
      ) : null}

      {response && !response.error ? (
        <Card className="p-5">
          <SectionTitle
            right={
              <span className="flex flex-wrap gap-1.5 text-xs">
                <span className={`chip ${response.planner === 'llm' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                  planner: {response.planner}
                </span>
                <span className={`chip ${response.phrasing === 'llm' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                  answer: {response.phrasing}
                </span>
                <span className="chip bg-slate-100 text-slate-600">source: {response.data_source}</span>
              </span>
            }
          >
            Answer
          </SectionTitle>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{response.answer}</p>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <div>
              <strong>Controlled query used:</strong> <code>{response.query_used}</code>
            </div>
            <div>
              <strong>Arguments:</strong> <code>{JSON.stringify(response.args_used ?? {})}</code>
            </div>
            <button className="btn-ghost mt-2 !px-0 text-xs" onClick={() => setShowRows((v) => !v)}>
              {showRows ? 'Hide' : 'Show'} aggregated rows
            </button>
            {showRows ? <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-white p-2">{JSON.stringify(response.rows, null, 2)}</pre> : null}
          </div>
        </Card>
      ) : null}

      {asked.length ? (
        <Card className="p-4">
          <SectionTitle>Recent questions</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {asked.map((q) => (
              <button key={q} className="chip border border-slate-200 bg-white text-slate-600" onClick={() => void ask(q)}>
                {q}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>What can be asked</SectionTitle>
          <ul className="space-y-2 text-sm text-slate-600">
            {QUERY_CATALOG.map((q) => (
              <li key={q.name}>
                <div className="font-semibold text-slate-800">{q.name}</div>
                <div className="text-xs text-slate-500">{q.description}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle>Limitations (by design)</SectionTitle>
          <ul className="list-inside list-disc space-y-1.5 text-sm text-slate-600">
            <li>The assistant can only answer questions that map to one of the controlled queries above — free-form SQL, ad-hoc filters and “why” questions are refused rather than guessed.</li>
            <li>Aggregations are computed in code (SQL/JS), not by the model, so money figures cannot be hallucinated.</li>
            <li>Without an AI key the same catalog is driven by a deterministic intent matcher, so answers stay correct but phrasing is templated.</li>
            <li>Data is limited to service operations: jobs, technicians, revenue, reschedules, alerts.</li>
            <li>In demo mode the seeded dataset is sent with the request; with Supabase configured the server reads the database directly and nothing is sent from the browser.</li>
            <li>If the serverless endpoint is unreachable (static-only hosting), the browser runs the same controlled queries and labels the answer <code>source: browser</code>.</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Signed in as {actor.role}. {examples.length} example questions are recognised out of the box.
          </p>
        </Card>
      </div>

      {!response && !busy ? (
        <EmptyState icon="🤖" title="Ask a question to begin" hint="Try: “Which technician completed the most jobs this week?”" />
      ) : null}
    </div>
  );
}
