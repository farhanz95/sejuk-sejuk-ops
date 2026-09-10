-- Sejuk Sejuk Service — operations schema (Supabase / Postgres)
-- Run in the Supabase SQL editor, then run seed.sql for demo data.
--
-- Design notes
--  * orders is keyed by the human-readable order_no (auto-generated SS-2026-000N)
--    because technicians and admins refer to orders by that number on the phone.
--  * service_reports is 1:1 with orders (one completion record per job), which is
--    why order_no carries a UNIQUE constraint instead of a separate id lookup.
--  * money is numeric(10,2) — never float — so totals stay exact.
--  * order_events is the traceability log the brief asks for ("key actions
--    should be traceable"); every status change writes a row here.

create table if not exists orders (
  order_no            text primary key,
  customer_name       text not null,
  phone               text not null,
  address             text not null,
  problem_description text not null,
  service_type        text not null check (service_type in ('Installation','Cleaning','Repair','Gas Refill','Inspection')),
  quoted_price        numeric(10,2) not null default 0 check (quoted_price >= 0),
  assigned_technician text check (assigned_technician in ('Ali','John','Bala','Yusoff')),
  status              text not null default 'New'
                        check (status in ('New','Assigned','In Progress','Job Done','Reviewed','Closed')),
  admin_notes         text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists service_reports (
  id              uuid primary key default gen_random_uuid(),
  order_no        text not null unique references orders(order_no) on delete cascade,
  work_done       text not null,
  extra_charges   numeric(10,2) not null default 0 check (extra_charges >= 0),
  -- Stored explicitly (calculated in the app as quoted + extra) so reporting and
  -- the AI queries never have to re-derive it from two tables.
  final_amount    numeric(10,2) not null check (final_amount >= 0),
  remarks         text not null default '',
  technician_name text not null,
  completed_at    timestamptz not null default now(),
  payment_amount  numeric(10,2) check (payment_amount >= 0),
  payment_method  text check (payment_method in ('Cash','Bank Transfer','DuitNow QR','Card'))
);

create table if not exists attachments (
  id        uuid primary key default gen_random_uuid(),
  report_id uuid not null references service_reports(id) on delete cascade,
  name      text not null,
  mime      text not null default '',
  size      bigint not null default 0,
  url       text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists order_events (
  id         uuid primary key default gen_random_uuid(),
  order_no   text not null references orders(order_no) on delete cascade,
  event_type text not null
               check (event_type in ('created','assigned','started','completed','rescheduled','reviewed','closed','notified','payment_recorded')),
  actor_role text not null,
  actor_name text not null default '',
  detail     text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  order_no   text not null references orders(order_no) on delete cascade,
  channel    text not null default 'whatsapp',
  target     text not null,
  message    text not null,
  status     text not null default 'prepared' check (status in ('prepared','sent')),
  deep_link  text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists orders_status_idx on orders (status);
create index if not exists orders_technician_idx on orders (assigned_technician);
create index if not exists orders_created_idx on orders (created_at desc);
create index if not exists service_reports_completed_idx on service_reports (completed_at desc);
create index if not exists service_reports_technician_idx on service_reports (technician_name);
create index if not exists order_events_order_idx on order_events (order_no, created_at desc);

-- One report per order is enforced above; this keeps the upsert in the app honest.
create unique index if not exists service_reports_order_unique on service_reports (order_no);

-- One active WhatsApp notification per order: re-completing a job replaces the
-- previous message instead of sending the customer a second one.
create unique index if not exists notifications_order_unique on notifications (order_no);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- This is a demonstration system with a mock login, so the policies below let
-- the anon key read and write. That is a deliberate, documented trade-off for
-- the assessment (see README → Security). In production you would:
--   1. turn on real Supabase Auth,
--   2. replace "true" with role checks such as
--        using ( exists (select 1 from staff where staff.id = auth.uid() and staff.role = 'Admin') )
--   3. make the AI endpoint use the service role key server-side only.
-- ---------------------------------------------------------------------------
alter table orders          enable row level security;
alter table service_reports enable row level security;
alter table attachments     enable row level security;
alter table order_events    enable row level security;
alter table notifications   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['orders','service_reports','attachments','order_events','notifications']
  loop
    execute format('drop policy if exists demo_all on %I', t);
    execute format('create policy demo_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- Storage bucket for job photos / video / PDF (max 6 per job, enforced in the app).
insert into storage.buckets (id, name, public)
values ('job-files', 'job-files', true)
on conflict (id) do nothing;
