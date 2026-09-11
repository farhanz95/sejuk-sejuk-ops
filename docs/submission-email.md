Subject: Programmer assessment submission — Sejuk Sejuk Service operations portal

Dear [Name],

The assessment build is ready to review. It is an air-conditioner service operations
portal that covers the full job lifecycle — order intake, technician assignment, field
completion, WhatsApp notification, manager review and KPI reporting — plus an AI
operations query window.

Live build
  https://sejuk-sejuk-ops-five.vercel.app
  https://sejuk-sejuk-ops.web.app
Source
  https://github.com/farhanz95/sejuk-sejuk-ops

Trying it takes two clicks: open either link and choose "Continue in demo mode". That
runs on a seeded dataset of ~46 orders, so there is nothing to set up. Switch between
the three roles from the header menu to see the whole workflow:

* Admin — create an order (or read one from a quotation document), assign a technician
* Technician — my jobs, start a job, complete it with the auto-filled report, send the
  WhatsApp summary
* Manager — the review queue (over-quote and anomaly flags), then the KPI dashboard and
  the AI query window

What is implemented

* One workflow, enforced in code: New → Assigned → In Progress → Job Done → Reviewed →
  Closed. Illegal jumps are refused by the same rules the tests run against, and every
  transition is written to an audit trail.
* Order intake with document understanding: paste or upload a quotation and the fields
  are read out of it — customer, phone, address, service type, problem, price — then
  applied to the form for review before saving.
* Technician work log: what is unassigned, what is in progress, what is waiting on the
  manager, and how long the oldest open job has been waiting, with search by order
  number, customer, technician, address and date.
* WhatsApp notification: the completion message and WhatsApp deep link are generated
  from the report itself, so the office does not retype anything.
* Manager review with flags: jobs completed over the quoted price, and other anomalies,
  each linked to the evidence.
* KPI dashboard: throughput, average job value, collected versus outstanding, per-team
  breakdown, and per-technician figures — computed in code, not by the model.
* Anomalies: repeat failures at the same address, unusually large extra charges, jobs
  sitting too long.
* AI query window: questions in plain English are answered from a fixed set of
  pre-aggregated queries. The model chooses which query to run and phrases the answer;
  it never sees the database and never writes SQL. Every answer shows the query it used
  and the rows behind it, and the figures in the sentence are computed in code, so a
  wrong-looking number can be traced to the row that produced it.
* Role-based access: a technician sees their own queue and history only — not company
  revenue, not their colleagues' jobs, not the AI assistant. Routes are guarded, not
  just hidden.
* Sign-in for staff: Google for those with an email, or a phone number with a 4-digit
  PIN for technicians who do not have one. The admin registers who may sign in, and
  revoking somebody takes effect on their next sign-in. PINs are stored hashed, and five
  wrong attempts lock a number for 15 minutes.
* Installable as an app (PWA), Malay/English UI, responsive from a 414px phone to a
  desktop, and it opens offline.

Quality, from the checks I run against the live build

* 125 automated tests covering the business rules, the AI answer path and the UI.
* 8/8 end-to-end smoke test on the deployed build: create an order → read a document →
  technician starts it → completes it → WhatsApp message → manager approves → AI answer,
  with 0 console errors.
* 13/13 sign-in checks against the live database: unregistered email refused, wrong PIN
  refused, correct PIN accepted, lockout after five attempts, admin PIN reset.

Limitations, stated plainly

* The AI runs on a free-tier model and falls back to local rules if the endpoint is
  unavailable — so the demo keeps working, but the wording is simpler when it does. The
  numbers themselves are the same, because they never come from the model.
* Document reading handles text and text-based PDFs. A photographed document cannot be
  read: no vision model is configured.
* The 4-digit PIN is basic protection, not an SMS one-time code — real OTP delivery
  needs a paid provider. The lockout after five attempts is the actual control.
* Demo mode keeps its data in the browser, so nothing you do there touches the database.
  Sign in as staff and your changes are stored in Supabase.

If you would like to look at it as a signed-in user rather than in demo mode, send me the
email address you want to use and I will add it to the staff list — it is a whitelist, so
an address has to be registered before it can sign in. Technicians can also sign in with
a phone number and a PIN if that is easier.

Happy to walk through any part of it, including the design decisions and what I would do
next with more time.

Kind regards,
Mohd Farhan Ramli
farhanz95@gmail.com
+6 019 382 4192
