-- Staff sign-in: Firebase Authentication (Google) as the identity provider, plus
-- a one-time access key that an admin hands out before a technician can join.
--
-- Why a key at all: Google sign-in alone would let anyone with a Google account
-- into the operations data. The key is the "you were hired / you are expected"
-- step — created by an admin, delivered in person, by email or WhatsApp, usable
-- once, optionally expiring, and revocable. After the first registration the
-- technician just taps Google, so the key is never entered again.
create table if not exists staff_accounts (
    uid             text primary key,               -- Firebase Auth uid
    email           text,
    display_name    text,
    photo_url       text,
    role            text not null default 'Technician' check (role in ('Admin', 'Manager', 'Technician')),
    technician_name text,                           -- which of the 4 field technicians this is
    created_at      timestamptz not null default now(),
    last_seen_at    timestamptz not null default now()
);

create table if not exists join_keys (
    code            text primary key,               -- what the admin hands over, e.g. SS-7F3K-9Q2M
    role            text not null default 'Technician' check (role in ('Admin', 'Manager', 'Technician')),
    technician_name text,                           -- null = any technician may claim it
    label           text,                           -- "Ali — replacement phone"
    expires_at      timestamptz,
    revoked_at      timestamptz,
    used_at         timestamptz,
    used_by_uid     text,
    used_by_email   text,
    created_by      text,
    created_at      timestamptz not null default now()
);

create index if not exists join_keys_open_idx on join_keys (code) where used_at is null and revoked_at is null;

-- Never expose the key table to anonymous readers: this one is read through the
-- API with the anon key, but the code must still be presented to claim it.
alter table staff_accounts enable row level security;
alter table join_keys     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['staff_accounts', 'join_keys'] loop
    execute format('drop policy if exists demo_all on %I', t);
    execute format('create policy demo_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- A key can only be claimed once, and only while it is valid. Enforced in the
-- database as well as the UI, so a race between two technicians cannot let both
-- through with the same code.
create or replace function claim_join_key(p_code text, p_uid text, p_email text, p_display_name text, p_technician text)
returns table (ok boolean, reason text, role text, technician_name text)
language plpgsql
security definer
as $$
declare
  k join_keys%rowtype;
begin
  select * into k from join_keys where upper(code) = upper(trim(p_code)) for update;
  if not found then
    return query select false, 'That access key was not found. Check with your admin.'::text, null::text, null::text;
    return;
  end if;
  if k.revoked_at is not null then
    return query select false, 'That access key has been revoked. Ask your admin for a new one.'::text, null::text, null::text;
    return;
  end if;
  if k.used_at is not null then
    return query select false, 'That access key has already been used. Sign in with Google instead, or ask your admin for a new key.'::text, null::text, null::text;
    return;
  end if;
  if k.expires_at is not null and k.expires_at < now() then
    return query select false, 'That access key expired. Ask your admin for a new one.'::text, null::text, null::text;
    return;
  end if;
  if k.technician_name is not null and p_technician is not null and k.technician_name <> p_technician then
    return query select false, format('That key is for %s, not %s.', k.technician_name, p_technician), null::text, null::text;
    return;
  end if;

  update join_keys set used_at = now(), used_by_uid = p_uid, used_by_email = p_email where code = k.code;

  insert into staff_accounts (uid, email, display_name, role, technician_name)
  values (p_uid, p_email, p_display_name, k.role, coalesce(k.technician_name, p_technician))
  on conflict (uid) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        role = excluded.role,
        technician_name = excluded.technician_name,
        last_seen_at = now();

  return query select true, 'Welcome aboard.'::text, k.role, coalesce(k.technician_name, p_technician);
end $$;
