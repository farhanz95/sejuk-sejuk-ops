-- Staff access by whitelist: the admin registers an email address and/or a phone
-- number, and that IS the invitation. No access keys to hand out.
--
-- Why the change: a key had to be delivered, could be lost, and could only be
-- used once — extra machinery for something the office already knows (who works
-- here). The admin adds the person once; the person signs in.
--
--   * email   → "Login using email" (Google). The Google account is tied to the
--               person on first sign-in, so it is one tap afterwards.
--   * phone   → "Login using phone number". The first time, the person chooses a
--               4-digit PIN; after that it is number + PIN. No email needed, and
--               the office can reset the PIN if it is forgotten.
--
-- Both paths check the whitelist, so a Google account nobody registered cannot
-- read operations data, and a revoked person is refused immediately.
--
-- Supersedes the join_keys flow (staff_auth*.sql). Safe to re-run.
create extension if not exists pgcrypto;

create table if not exists staff_directory (
    id              uuid primary key default gen_random_uuid(),
    email           text,                                   -- lower-cased on write
    phone           text,                                   -- normalised 0xxxxxxxxx
    display_name    text,
    role            text not null default 'Technician' check (role in ('Admin', 'Manager', 'Technician')),
    technician_name text,                                   -- required when role = Technician
    -- 4-digit PIN for the phone path: never stored in the clear.
    pin_hash        text,
    pin_set_at      timestamptz,
    failed_attempts int not null default 0,
    locked_until    timestamptz,
    revoked_at      timestamptz,
    created_by      text,
    created_at      timestamptz not null default now(),
    last_login_at   timestamptz
);

create unique index if not exists staff_directory_email_key on staff_directory (lower(email)) where email is not null;
create unique index if not exists staff_directory_phone_key on staff_directory (phone) where phone is not null;

alter table staff_directory enable row level security;
do $$
begin
  drop policy if exists demo_all on staff_directory;
  create policy demo_all on staff_directory for all using (true) with check (true);
end $$;

-- The PIN hash is salted with the phone number, so two people who pick 1234 do
-- not share a hash. Never exposed: the client never reads pin_hash (the admin UI
-- selects the columns it needs).
create or replace function staff_pin_ok(p_phone text, p_pin text, p_hash text)
returns boolean language sql immutable as $$
  select p_hash = encode(digest(coalesce(p_phone, '') || ':' || coalesce(p_pin, ''), 'sha256'), 'hex')
$$;

/** What the phone-number screen needs to know before showing a PIN field. */
create or replace function staff_phone_status(p_phone text)
returns table (found boolean, needs_pin boolean, revoked boolean, locked boolean, display_name text, role text)
language plpgsql security definer as $$
declare
  r staff_directory%rowtype;
  p text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if p like '60%' then p := '0' || substr(p, 3); end if;
  select * into r from staff_directory where phone = p limit 1;
  if not found then
    return query select false, false, false, false, null::text, null::text;
    return;
  end if;
  return query select
    true,
    r.pin_hash is null,
    r.revoked_at is not null,
    (r.locked_until is not null and r.locked_until > now()),
    r.display_name,
    r.role;
end $$;

/** First time on the phone path: the person picks their own 4-digit PIN. */
create or replace function staff_set_phone_pin(p_phone text, p_pin text)
returns table (ok boolean, reason text)
language plpgsql security definer as $$
declare
  r staff_directory%rowtype;
  p text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if p like '60%' then p := '0' || substr(p, 3); end if;
  if p_pin !~ '^[0-9]{4}$' then
    return query select false, 'The PIN must be exactly 4 digits.'::text;
    return;
  end if;
  select * into r from staff_directory where phone = p for update;
  if not found then
    return query select false, 'That number is not registered. Ask your admin to add you.'::text;
    return;
  end if;
  if r.revoked_at is not null then
    return query select false, 'This account has been revoked. Ask your admin.'::text;
    return;
  end if;
  if r.pin_hash is not null then
    return query select false, 'A PIN is already set for this number. Enter it, or ask your admin to reset it.'::text;
    return;
  end if;
  -- Store the hash itself. (An earlier version wrapped this in staff_pin_ok(),
  -- which COMPARES, so the column ended up holding the text 'true' and every
  -- correct PIN was then refused — caught by scripts/verify_staff_login.py.)
  update staff_directory set pin_hash = encode(digest(p || ':' || p_pin, 'sha256'), 'hex'),
                            pin_set_at = now(), failed_attempts = 0
   where id = r.id;
  return query select true, 'PIN saved.'::text;
end $$;

/** Everyday phone login: number + PIN, with a lockout after repeated misses. */
create or replace function staff_login_phone(p_phone text, p_pin text, p_uid text)
returns table (ok boolean, reason text, role text, technician_name text, display_name text)
language plpgsql security definer as $$
declare
  r staff_directory%rowtype;
  p text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  expected text;
begin
  if p like '60%' then p := '0' || substr(p, 3); end if;
  select * into r from staff_directory where phone = p for update;
  if not found then
    return query select false, 'That number is not registered. Ask your admin to add you.'::text, null::text, null::text, null::text;
    return;
  end if;
  if r.revoked_at is not null then
    return query select false, 'This account has been revoked. Ask your admin.'::text, null::text, null::text, null::text;
    return;
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return query select false, format('Too many wrong PINs. Try again after %s.', to_char(r.locked_until, 'HH24:MI')), null::text, null::text, null::text;
    return;
  end if;
  if r.pin_hash is null then
    return query select false, 'No PIN set for this number yet — choose one first.'::text, null::text, null::text, null::text;
    return;
  end if;

  expected := encode(digest(p || ':' || coalesce(p_pin, ''), 'sha256'), 'hex');
  if r.pin_hash <> expected then
    update staff_directory
       set failed_attempts = r.failed_attempts + 1,
           locked_until = case when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else r.locked_until end
     where id = r.id;
    return query select false, 'That PIN is not right.'::text, null::text, null::text, null::text;
    return;
  end if;

  update staff_directory set failed_attempts = 0, locked_until = null, last_login_at = now() where id = r.id;

  insert into staff_accounts (uid, email, display_name, role, technician_name, phone, auth_provider)
  values (p_uid, r.email, coalesce(r.display_name, r.phone), r.role, r.technician_name, r.phone, 'phone')
  on conflict (uid) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        technician_name = excluded.technician_name,
        phone = excluded.phone,
        auth_provider = 'phone',
        last_seen_at = now();

  return query select true, 'Welcome back.'::text, r.role, r.technician_name, coalesce(r.display_name, r.phone);
end $$;

/** Google login: allowed only when the email is on the whitelist. */
create or replace function staff_login_google(p_uid text, p_email text, p_display_name text)
returns table (ok boolean, reason text, role text, technician_name text, display_name text)
language plpgsql security definer as $$
declare
  r staff_directory%rowtype;
begin
  select * into r from staff_directory where lower(email) = lower(coalesce(p_email, '')) limit 1;
  if not found then
    return query select false,
      'That email is not registered. Ask your admin to add it, or sign in with your phone number.'::text,
      null::text, null::text, null::text;
    return;
  end if;
  if r.revoked_at is not null then
    return query select false, 'This account has been revoked. Ask your admin.'::text, null::text, null::text, null::text;
    return;
  end if;

  update staff_directory set last_login_at = now() where id = r.id;

  insert into staff_accounts (uid, email, display_name, role, technician_name, phone, auth_provider)
  values (p_uid, lower(p_email), coalesce(r.display_name, p_display_name, p_email), r.role, r.technician_name, r.phone, 'google')
  on conflict (uid) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        role = excluded.role,
        technician_name = excluded.technician_name,
        phone = coalesce(excluded.phone, staff_accounts.phone),
        auth_provider = 'google',
        last_seen_at = now();

  return query select true, 'Welcome back.'::text, r.role, r.technician_name, coalesce(r.display_name, p_display_name, p_email);
end $$;
