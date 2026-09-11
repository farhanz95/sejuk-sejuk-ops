-- Admin control over the phone PIN.
--
-- Until now the admin could only RESET a PIN (clear it, so the person chose a new one
-- themselves on their next sign-in). There was no way to hand somebody a PIN, which is
-- what an office actually needs when a technician cannot get through the first-time
-- "choose your PIN" step, or asks for it to be changed.
--
--   staff_admin_set_pin(phone, pin)  -> set or change the PIN for a registered number
--   staff_admin_reset_pin(phone)     -> forget it, so the person chooses a new one
--
-- Both clear the wrong-PIN lockout as a side effect: an admin stepping in is exactly the
-- case where somebody is locked out.
--
-- Honest limitation, stated here and in the README: these run with the anon key, like the
-- rest of this assessment build, so anyone who can call the API can call them. Real
-- deployments would put them behind an authenticated admin role (Supabase auth + a
-- policy that checks it) — the app already decides who sees the Staff access screen, but
-- that is a UI gate, not a server-side one.
create extension if not exists pgcrypto;

create or replace function staff_admin_set_pin(p_phone text, p_pin text)
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
    return query select false, 'No registered number matches that.'::text;
    return;
  end if;
  if r.revoked_at is not null then
    return query select false, 'This account is revoked — allow it again first.'::text;
    return;
  end if;
  -- same salt+hash as staff_set_phone_pin / staff_login_phone (sha256(phone:pin))
  update staff_directory
     set pin_hash = encode(digest(p || ':' || p_pin, 'sha256'), 'hex'),
         pin_set_at = now(),
         failed_attempts = 0,
         locked_until = null
   where id = r.id;
  return query select true, 'PIN saved — give it to them in person or over the phone.'::text;
end $$;

create or replace function staff_admin_reset_pin(p_phone text)
returns table (ok boolean, reason text)
language plpgsql security definer as $$
declare
  p text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if p like '60%' then p := '0' || substr(p, 3); end if;
  update staff_directory
     set pin_hash = null, pin_set_at = null, failed_attempts = 0, locked_until = null
   where phone = p;
  return query select true, 'PIN cleared — they choose a new one at their next sign-in.'::text;
end $$;

-- The admin list also wants to see who is currently locked out, so the screen can offer
-- "clear lockout" as one obvious action rather than an invisible wait.
create or replace function staff_admin_clear_lockout(p_phone text)
returns table (ok boolean, reason text)
language plpgsql security definer as $$
declare
  p text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if p like '60%' then p := '0' || substr(p, 3); end if;
  update staff_directory set failed_attempts = 0, locked_until = null where phone = p;
  return query select true, 'Lockout cleared.'::text;
end $$;
