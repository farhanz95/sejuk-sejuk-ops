# Sejuk Sejuk Service — Operations System + AI Challenge

Internal operations system for an air-conditioner service company (5 branches, 40+ field teams):
order intake → technician assignment → field completion → WhatsApp notification → manager review → KPI,
plus an **AI operations query window** that answers manager questions from controlled, pre-aggregated queries.

Built for the *Programmer Assessment – Operations System + AI Challenge* (9–12 Sep 2026).

- **Live demo:** <https://sejuk-sejuk-ops.web.app> — opens straight into seeded demo data, no setup, no login required
  (Firebase Hosting. On a static-only host there is no serverless function, so the AI window answers from the same controlled
  queries in the browser and labels the answer `source: browser`; on Vercel the same questions go through `/api/ai-query`,
  i.e. the server-side planner — see §5.)
- **Repo:** <https://github.com/farhanz95/sejuk-sejuk-ops>
- **Stack:** React 18 + TypeScript + Vite + Tailwind CSS 4 · Supabase (Postgres + Storage) · Vercel serverless function for the AI · `node:test` for unit tests

---

## 1. What is implemented

| Brief | Status | Where |
| --- | --- | --- |
| **Module 1 — Admin Portal · order submission** | ✅ | `src/pages/AdminOrders.tsx`, `src/pages/OrderDetail.tsx` |
| **Module 2 — Technician Portal · service job** | ✅ mobile-first | `src/pages/TechJobs.tsx` |
| **Module 3 — WhatsApp notification on Job Done** | ✅ | `src/lib/domain.ts` (`whatsAppMessage`, `waDeepLink`), `src/pages/OrderDetail.tsx`, `src/pages/Activity.tsx` |
| **Bonus — KPI dashboard** (jobs, total amount, postpone/reschedule) | ✅ week/month/today views, leaderboard, charts | `src/pages/Dashboard.tsx` |
| **AI Module — operations query window** | ✅ | `src/pages/AiQuery.tsx` + `api/ai-query.ts` |
| **Advanced AI — workflow supervisor** (amount ≫ quote, job done with no photos) | ✅ | `src/lib/domain.ts` (`supervisorFlags`), surfaced on the dashboard + review queue |
| Advanced AI — document understanding, operational insight | ⛔ not implemented | explained in §7 |
| **Self-assessment README** | ✅ | §9 below |

Workflow implemented exactly as specified: `New → Assigned → In Progress → Job Done → Reviewed → Closed`, with
assignment/start/reschedule/completion/review/close all writing an **audit event** (`order_events`), so every key
action is traceable.

Business rules enforced in code (and unit-tested):

- only **Admin** can assign a technician;
- only the **assigned** technician can mark the job done (another technician is refused);
- only a **Manager** can review/close;
- **final amount = quoted + extra**, always auto-calculated — never typed by hand;
- max **6 files** (photo/video/PDF) per completed job;
- payment (optional bonus) can never exceed the final amount.

---

## 2. Running it

### Option A — zero setup (demo mode)

```bash
npm install
npm run dev        # http://localhost:5173
```

With no environment variables the app runs on a **deterministic seeded dataset** (45 orders, 40 completed jobs,
252 events, 40 notifications across the last 14 days) stored in `localStorage`. Every screen, rule, KPI and the AI
query window work exactly as in cloud mode — the header shows a `demo data` badge, and a `reset` button restores
the seed. This is what makes the live demo clickable without creating any account.

### Option B — Supabase (cloud database + file storage)

```bash
cp .env.example .env      # then fill in the values
```

1. Create a project at supabase.com.
2. In the SQL editor run **`supabase/schema.sql`**, then **`supabase/seed.sql`**
   (the seed file is generated from the same dataset as demo mode: `npm run seed:sql`).
3. Put the project URL + anon key in `.env` as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   (and the server-side copies `SUPABASE_URL` / `SUPABASE_ANON_KEY` for the AI endpoint).
4. `npm run dev` — the badge flips to `supabase`, data is read/written in Postgres and job files go to
   Supabase Storage (bucket `job-files`).

### Option C — deploy

```bash
npx vercel            # Vercel: static build + api/ai-query.ts as a serverless function
```

Set these Vercel env vars (Project → Settings → Environment Variables) for the cloud + AI mode:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | browser → Supabase |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | server-side reads for the AI endpoint |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | any OpenAI-compatible provider (OpenAI, DeepSeek, Groq, OpenRouter, local llama.cpp…) |

### Tests

```bash
npm test           # 47 tests: business rules, aggregations, AI planner, API handler, workflow, UI render
npm run seed:sql   # regenerate supabase/seed.sql from src/lib/seed.ts
```

---

## 3. Architecture

```
                       ┌──────────────────────────── React (Vite + Tailwind) ───────────────────────────┐
  Admin  ───────────►  │  AdminOrders / OrderDetail     TechJobs (mobile-first)      ManagerReview     │
  Technician ───────►  │        │                              │                             │         │
  Manager ──────────►  │        └──────────► AppState (workflow rules + mutations) ◄────────┘         │
                       └───────────────────────────────┬───────────────────────────────────────────────┘
                                                       │  OpsRepo interface  (src/lib/repo.ts)
                                        ┌──────────────┴───────────────┐
                                        │                              │
                               mode = "supabase"                mode = "demo"
                          SupabaseRepo (Postgres + Storage)   DemoRepo (seeded localStorage)
                                        │
                                        │  same tables / same column names
                                        ▼
                       ┌──────────────────────── Postgres (Supabase) ────────────────────────┐
                       │ orders · service_reports · attachments · order_events · notifications│
                       └─────────────────────────────────────────────────────────────────────┘
                                        ▲
                                        │  server-side reads only
                       ┌────────────────┴────────────────────────────────────────────────────┐
   browser  ──POST──►  │  /api/ai-query  (Vercel function, Node)                          │
                       │  1. load rows (Supabase or the demo snapshot)                    │
                       │  2. LLM picks ONE function from QUERY_CATALOG (tool calling)     │
                       │  3. that function computes the aggregates in code                │
                       │  4. LLM phrases the answer from the returned rows                │
                       └──────────────────────────────────────────────────────────────────┘
```

**Layering.** The UI never talks to Supabase directly: it talks to an `OpsRepo` interface with two
implementations (cloud and seeded demo). The same domain rules (`src/lib/domain.ts`) and aggregations
(`src/lib/analytics.ts`) are shared by the UI, the tests and the AI endpoint — one source of truth for
"what counts as a completed job" or "how the leaderboard is ranked".

### Data model

| Table | Grain | Notes |
| --- | --- | --- |
| `orders` | one service order | keyed by human-readable `order_no` (`SS-2026-0007`) because that is what staff say on the phone; `status` is a checked enum |
| `service_reports` | one completion per order (`unique(order_no)`) | `final_amount` stored explicitly (computed in the app as quoted + extra) so reporting never re-derives it |
| `attachments` | N per report (≤ 6 enforced in the app) | name, mime, size, URL (Supabase Storage) |
| `order_events` | append-only audit log | `created/assigned/started/completed/rescheduled/reviewed/closed/notified/payment_recorded` |
| `notifications` | one active per order (`unique(order_no)`) | message + `wa.me` deep link + `prepared`/`sent` status; re-completing replaces it rather than messaging the customer twice |

---

## 4. Architecture decisions (and why)

1. **Two data backends behind one interface.** The reviewer must be able to click through the whole workflow
   before creating a Supabase project, so `DemoRepo` (seed → localStorage) mirrors `SupabaseRepo` table-for-table.
   Nothing in the UI knows which one is active.
2. **Money and status transitions live in pure functions.** `computeFinalAmount`, `canMarkDone`, `canReview`,
   `validateCompletion`, `supervisorFlags` are framework-free, so they are unit-tested and *reused by the AI
   endpoint* — the assistant cannot quote a rule the UI does not enforce.
3. **Aggregations in code, never in the model.** The AI receives pre-computed rows. Sums, averages and rankings
   come from `technicianLeaderboard` / `revenueSummary` / etc., so a wrong answer is a logic bug you can test —
   not a hallucination you cannot reproduce.
4. **`order_no` as primary key, UUIDs elsewhere.** Staff-facing identifiers are typed into WhatsApp and the phone;
   internal rows use UUIDs. `service_reports` is 1:1 with orders, hence `unique(order_no)` + upsert instead of a
   lookup table.
5. **Audit table instead of denormalised "last updated by" columns.** The brief asks for traceability, and the
   Activity screen is the proof: who did what, when, on which order.
6. **A determined "Job Done" trigger, not a manual button.** The WhatsApp message is created by the same repo call
   that flips the status, so the notification cannot be forgotten — Module 3's trigger condition is structural.
7. **Tailwind utility-first, no component library.** The technician screens need big targets and minimal chrome;
   a shared `card / btn / input / chip` vocabulary in `src/index.css` keeps the two very different contexts
   (desktop admin, one-handed field use) visually consistent.

---

## 5. How the AI is integrated

Expected flow from the brief — *question → interpret → retrieve → format* — implemented literally:

1. **The browser posts the question** to `/api/ai-query` (with the seeded dataset attached only in demo mode).
2. **The endpoint loads data**: from Supabase when server env vars exist and RLS allows it, otherwise from the
   snapshot supplied by the demo build.
3. **The model plans, it does not query.** It receives the `QUERY_CATALOG` as tool/function definitions and must
   choose exactly one (`tool_choice: required`). The catalog is seven narrow functions:
   `jobs_by_technician`, `technician_leaderboard`, `jobs_completed_today`, `revenue_summary`, `stalled_jobs`,
   `supervisor_alerts`, `business_overview`. Arguments are a technician name and a period preset — nothing more.
4. **The aggregates are computed by that function** (SQL/JS), not by the model.
5. **The model phrases the answer** using only the returned rows, and is instructed to say so plainly when the rows
   are empty, to answer in the questioner's language (English or Malay), and never to invent jobs, amounts or
   technicians.
6. **No AI key? Still works.** A deterministic intent matcher maps the documented example questions onto the same
   catalog and the answer is templated from the real numbers. The UI labels which path was used
   (`planner: llm | heuristic`, `answer: llm | template`, `source: supabase | snapshot`) so nothing is hidden.

The AI window shows the controlled query used, its arguments and the raw aggregated rows under the answer —
so a manager can audit how the answer was produced.

**Question types supported:** jobs by technician (period), technician ranking / top performer (period), jobs
completed today, billed vs collected vs outstanding (period), jobs open longer than N days, anomaly/supervisor
alerts, general operations overview. Periods: today / this week / last week / last 7 days / this month / last
month / all time.

**Advanced challenge — AI Workflow Supervisor:** implemented as explainable rules (`supervisorFlags`) that flag
`final_amount ≥ 1.5 × quoted_price` and "job done with no photo/video/PDF evidence", surfaced on the dashboard and
in the manager review queue, and answerable through the `supervisor_alerts` query ("Any suspicious jobs this
month?"). The flags are rule-based on purpose: an alert that decides money matters should be reproducible.

---

## 6. Security & access

Authentication is the **mock login / role switch** the brief allows (header selector: Admin, 4 named technicians,
Manager). The role switch is real for the workflow: switching to another technician makes their job un-completable
by you, and switching away from Admin removes the assign action. Server-side policies in
`supabase/schema.sql` deliberately allow anon read/write for the demo (with a commented example of the role-checked
policy you would use with Supabase Auth), and the AI endpoint keeps its key server-side.

To productionise: Supabase Auth + a `staff(user_id, role)` table, RLS policies per role, `service_role` key only in
server functions, signed Storage URLs, and an `updated_by` column alongside the audit log.

---

## 7. Limitations (stated honestly)

- **WhatsApp is a deep link, not an automated send.** Marking a job done generates the exact message and a
  `wa.me/<number>?text=…` link that the technician/admin taps (and can mark as sent). Genuinely automated
  delivery needs the WhatsApp Business Cloud API with a verified sender — a paid, credentialled setup that the
  brief accepts ("e.g. a deep-link URL with a pre-filled message").
- **The AI answers only what the catalog can express.** Ad-hoc questions ("show me all jobs in Cheras with
  unpaid balances over RM 200") are routed to the overview and answered with a limitation note rather than
  improvised SQL. Extending the system means adding a query to the catalog — a deliberate choice, trade-off
  discussed in §4.3.
- **No AI key → templated phrasing.** Correct numbers, generic wording. Adding a key switches the planner and the
  phraser to the model without code changes.
- **Demo mode is browser-local.** Data lives in `localStorage` and uploaded files stay object URLs for that
  session, so the demo does not persist across devices; it also sends the seeded snapshot to the API because
  there is no database behind it. Cloud mode removes both caveats.
- **No file-type/size validation beyond the 6-file cap and the `accept` filter** — a production system would
  validate MIME types and sizes server-side (Supabase Storage policies).
- **The AI query endpoint is unauthenticated** (mock login can't be trusted server-side): it is read-only and
  rate-limitable, but a real deployment would verify a Supabase JWT before answering.
- **Advanced AI challenges beyond the workflow supervisor are not implemented:** document understanding
  (extracting customer/service/amount/date from an uploaded PDF) and operational insight commentary would be the
  natural next additions to the catalog.
- **No offline queue for field use.** Technicians in a dead zone lose an in-progress form; a production build
  would add a service worker + background sync.

---

## 8. Tests

`npm test` → **47 passing** (`node:test` + `tsx`):

- `tests/domain.test.ts` — order-number generation, quoted+extra maths, the three permission rules (including
  "another technician is refused"), draft/completion validation, the 6-file cap, the payment ceiling, the exact
  WhatsApp template + `wa.me` normalisation, supervisor flags.
- `tests/analytics.test.ts` — seed determinism, totals agreeing with the raw rows, leaderboard ordering,
  "today" boundary handling, revenue identity (collected + outstanding = billed), stalled-job selection, and
  that every catalog query runs, is described, and refuses unknown technicians instead of inventing rows.
- `tests/ai-query.test.ts` — every question advertised in the UI maps to the intended controlled query, argument
  extraction (technician/period/days), and that no question can produce an out-of-catalog query.
- `tests/api-handler.test.ts` — the **real serverless handler** with mock req/res: 400s, 405, snapshot mode,
  leaderboard/finance/anomaly answers, unknown question degrading to the overview, and that no SQL leaks into
  an answer.
- `tests/ui-render.test.ts` — mounts the **real React app in jsdom** and clicks it: landing → role switch →
  order list → the New order dialog (auto-generated number previewed), the technician queue, the dashboard
  (KPI figures + all four technicians), the AI window's supported-query and limitation panels, and the activity
  log. This is the layer a build cannot verify — bad hooks or a crash on first paint show up here.
- `tests/workflow.test.ts` — the full journey against the **real `DemoRepo`** the UI uses (localStorage
  polyfilled): auto-generated order number, `New` → `Assigned` → `In Progress` → `Job Done` → `Reviewed` →
  `Closed`, the audit trail containing every expected event, the notification being produced *by* the status
  change, one report + one notification per order even after re-completion, the 6-file cap enforced at the data
  layer, and the "another technician cannot complete your job" rule.

---

## 9. Self-assessment

- **Easiest:** Module 1. A form, a generated ID and a write — the interesting part is where it lands in the data
  model (order number as the primary key, status defaulted from whether a technician was chosen).
- **Hardest:** making the AI answer *trustworthy* rather than impressive. The first instinct — hand the model the
  database and let it write SQL — fails the brief's stated requirement and produces unverifiable money figures.
  Designing the controlled-query catalog (and the two-stage plan-then-phrase flow) took longer than the UI, and
  the tests are the payoff: a wrong number is now a failing test, not a mystery.
- **What I would improve in a real production system:** real auth + role-checked RLS; WhatsApp Business API with
  delivery webhooks; push notifications to the technician app; offline-first field forms with background sync;
  storage policies for file type/size; a per-branch dimension on every screen (5 branches are in the brief but
  not in the data model); and a scheduled job that materialises daily KPI snapshots instead of aggregating live.
- **How I used AI tools while building this:** I used an AI coding agent for scaffolding and for the boilerplate
  of the Tailwind screens, and used it as a reviewer for the workflow rules and the query catalog, but wrote the
  data model, the aggregation layer and the AI endpoint contracts myself and pinned them with tests (the agent's
  first version of the intent matcher mis-routed "who billed the most" to a revenue summary and "over the quoted
  price" to the overview — both were caught by the tests in §8, not by reading the code). Two AI-generated pieces
  were rejected outright: raw-SQL generation for the assistant, and a "smart" anomaly score without an explanation.
