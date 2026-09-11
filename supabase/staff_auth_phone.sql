-- Technicians without an email address.
--
-- Not every field technician has (or wants) a Google account, so joining must
-- also work with a phone number alone. Firebase's anonymous sign-in gives the
-- device an account, the admin-issued key is still what authorises them, and the
-- phone number is recorded as their identity for the office.
--
-- Honest limitation, stated in the README: a real SMS one-time code needs a paid
-- SMS provider (Firebase Phone Auth on Blaze, or Twilio), so this path does not
-- send a code to the technician — the admin hands them the joining key instead,
-- through WhatsApp, SMS or email, one of which they always have.
--
-- Applied on top of staff_auth.sql + staff_auth_harden.sql. Safe to re-run.
alter table staff_accounts add column if not exists phone text;
alter table staff_accounts add column if not exists auth_provider text not null default 'google';

-- The claim function now records how the person got in, and their number.
drop function if exists claim_join_key(text, text, text, text, text);

create or replace function claim_join_key(
    p_code text,
    p_uid text,
    p_email text,
    p_display_name text,
    p_technician text,
    p_phone text default null,
    p_provider text default 'google'
)
returns table (ok boolean, reason text, role text, technician_name text)
language plpgsql
security definer
as $$
declare
  k join_keys%rowtype;
  h text;
begin
  h := encode(digest(upper(trim(p_code)), 'sha256'), 'hex');
  select * into k from join_keys where code_hash = h for update;
  if not found then
    return query select false, 'That access key was not found. Check with your admin.'::text, null::text, null::text;
    return;
  end if;
  if k.revoked_at is not null then
    return query select false, 'That access key has been revoked. Ask your admin for a new one.'::text, null::text, null::text;
    return;
  end if;
  if k.used_at is not null then
    return query select false, 'That access key has already been used. Ask your admin for a new key.'::text, null::text, null::text;
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

  update join_keys set used_at = now(), used_by_uid = p_uid, used_by_email = p_email where code_hash = h;

  insert into staff_accounts (uid, email, display_name, role, technician_name, phone, auth_provider)
  values (p_uid, p_email, p_display_name, k.role, coalesce(k.technician_name, p_technician), p_phone, coalesce(p_provider, 'google'))
  on conflict (uid) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        role = excluded.role,
        technician_name = excluded.technician_name,
        phone = coalesce(excluded.phone, staff_accounts.phone),
        auth_provider = excluded.auth_provider,
        last_seen_at = now();

  return query select true, 'Welcome aboard.'::text, k.role, coalesce(k.technician_name, p_technician);
end $$;
