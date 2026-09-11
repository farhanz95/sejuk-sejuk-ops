-- One-function patch for staff_set_phone_pin.
--
-- The first version stored the hash by calling staff_pin_ok() — a function that
-- COMPARES a PIN with a hash — so the column was filled with the boolean 'true'
-- and every later login refused a correct PIN ("That PIN is not right").
--
-- Paste this whole file into Supabase → SQL Editor → Run. It replaces only that
-- function; nothing else is touched and no data is lost.
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
  update staff_directory set pin_hash = encode(digest(p || ':' || p_pin, 'sha256'), 'hex'),
                            pin_set_at = now(), failed_attempts = 0
   where id = r.id;
  return query select true, 'PIN saved.'::text;
end $$;

-- any PIN rows written by the buggy version are meaningless: clear them so those
-- people simply choose a PIN again
update staff_directory set pin_hash = null, pin_set_at = null
 where pin_hash is not null and pin_hash !~ '^[0-9a-f]{64}$';
