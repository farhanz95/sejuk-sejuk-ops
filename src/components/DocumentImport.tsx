import { useState } from 'react';
import { describeExtraction, EMPTY_FIELDS, extractFieldsHeuristically, FIELD_LABELS, type ExtractedFields } from '../lib/doc-fields';
import { apiEndpoint } from '../lib/ask-ai';
import { Card, Field, Modal } from './ui';

interface Result {
  extractor: 'llm' | 'heuristic' | 'llm+heuristic';
  fields: ExtractedFields;
  missing: (keyof ExtractedFields)[];
  summary: string;
  filename?: string | null;
  note?: string;
}

/**
 * "Pull fields from a document" — the administrative shortcut for the paperwork
 * that arrives as a WhatsApp message, a quotation PDF or a work order.
 *
 * PDF text is extracted in the browser (pdfjs), so the file itself is never
 * uploaded anywhere; only the text is sent for reading. If the /api endpoint is
 * not available (static hosting), the same rules run locally and the card says so.
 */
export default function DocumentImport({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (fields: ExtractedFields) => void;
}) {
  const [text, setText] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** PDF → plain text, entirely client-side. */
  async function pdfToText(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default as unknown as string;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let out = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      out += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n';
    }
    return out;
  }

  async function handleFiles(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setFilename(file.name);
    setReading(null);
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      setReading('Reading the PDF…');
      try {
        const extracted = await pdfToText(file);
        setText(extracted);
        setReading(`Read ${extracted.length} characters from ${file.name}`);
      } catch (err) {
        setReading(null);
        setError(
          `Could not read that PDF (${err instanceof Error ? err.message : String(err)}). Paste the text instead — the reader works on text either way.`,
        );
      }
    } else {
      const asText = await file.text();
      setText(asText);
      setReading(`Loaded ${file.name}`);
    }
  }

  async function read() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(apiEndpoint().replace(/ai-query$/, 'extract-document'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, filename }),
      });
      if (!res.ok) throw new Error(`endpoint returned ${res.status}`);
      const json = (await res.json()) as Result;
      setResult(json);
    } catch (err) {
      // No endpoint on this host (or it failed): the identical rules run here.
      const { fields, missing } = extractFieldsHeuristically(text);
      setResult({
        extractor: 'heuristic',
        fields,
        missing,
        summary: describeExtraction(fields, missing),
        note: `Read in the browser with the same rules (${err instanceof Error ? err.message : String(err)}) — no document text left this device.`,
      });
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    setText('');
    setFilename(null);
    setResult(null);
    setError(null);
    setReading(null);
  };

  return (
    <Modal open={open} title="Pull fields from a document" onClose={() => { reset(); onClose(); }} wide>
      <p className="mb-3 text-sm text-slate-600">
        Drop in a quotation, invoice, work order or the customer's WhatsApp message. The reader pulls out the fields an
        order needs — you review them before anything is saved. PDFs are converted to text in this browser; only the
        text is sent for reading.
      </p>

      <Field label="Document file" hint=".pdf · .txt · .md — a photographed document cannot be read (no vision model is configured)">
        <input className="input !py-2" type="file" accept=".pdf,.txt,.md,.csv,application/pdf,text/plain" onChange={(e) => void handleFiles(e.target.files)} />
      </Field>
      {reading ? <p className="mb-3 text-xs text-emerald-700">{reading}</p> : null}

      <Field label="…or paste the text" hint="Works with anything the office already has on screen">
        <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Quotation — Sejuk Sejuk Service\nCustomer: Ahmad Zaki, 012-3456789\nNo. 12, Jalan Sejuk, Shah Alam\nAircond not cold, water dripping from indoor unit\nService: cleaning\nTotal: RM 180\nDate: 12/09/2026'} />
      </Field>

      {error ? <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy || text.trim().length < 12} onClick={() => void read()}>
          {busy ? 'Reading…' : 'Read document'}
        </button>
        <button className="btn-ghost" onClick={reset}>
          Clear
        </button>
        {text.trim().length > 0 ? <span className="text-xs text-slate-500">{text.trim().length} characters ready</span> : null}
      </div>

      {result ? (
        <Card className="mt-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800">What was found</div>
            <span className={`chip ${result.extractor === 'heuristic' ? 'bg-slate-100 text-slate-600' : 'bg-violet-50 text-violet-700'}`}>
              read by:{' '}
              {result.extractor === 'llm' ? 'AI model' : result.extractor === 'llm+heuristic' ? 'AI model + local rules' : 'local rules'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{result.summary}</p>
          {result.note ? <p className="mt-1 text-xs text-amber-700">{result.note}</p> : null}

          <dl className="mt-3 divide-y divide-slate-100 text-sm">
            {(Object.keys(FIELD_LABELS) as (keyof ExtractedFields)[]).map((key) => {
              const value = result.fields[key];
              return (
                <div key={key} className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-slate-500">{FIELD_LABELS[key]}</dt>
                  <dd className={value === null ? 'text-slate-400' : 'text-right font-medium text-slate-800'}>
                    {value === null ? 'not stated' : String(value)}
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                onApply({ ...EMPTY_FIELDS, ...result.fields });
                reset();
                onClose();
              }}
            >
              Use these fields
            </button>
            <button className="btn-ghost" onClick={reset}>
              Try another document
            </button>
          </div>
        </Card>
      ) : null}
    </Modal>
  );
}
