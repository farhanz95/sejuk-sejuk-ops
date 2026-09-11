-- Harden the access keys: store a HASH of the key, never the key itself.
--
-- Why: the REST endpoint is reachable with the public anon key, so storing the
-- code in plain text meant anyone could list the unused keys and join with one.
-- A one-way hash makes a leaked row useless — the code only exists on the admin's
-- screen (once, when it is created) and in the technician's message.
--
-- Applied on top of staff_auth.sql. Safe to re-run.
create extension if not exists pgcrypto;

alter table join_keys add column if not exists code_hash text;

-- Carry over any keys that were created before this change (plain text → hash).
update join_keys
   set code_hash = encode(digest(upper(trim(code)), 'sha256'), 'hex')
 where code_hash is null;

alter table join_keys drop constraint if exists join_keys_pkey;
alter table join_keys alter column code drop not null;
alter table join_keys alter column code_hash set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'join_keys_code_hash_key') then
    alter table join_keys add constraint join_keys_code_hash_key unique (code_hash);
  end if;
end $$;

-- The code column is no longer used at all: drop it so it cannot leak again.
alter table join_keys drop column if exists code;

create index if not exists join_keys_hash_idx on join_keys (code_hash) where used_at is null and revoked_at is null;

-- Claim by hash. Same rules as before: one use, no revoke, no expiry, right team.
create or replace function claim_join_key(p_code text, p_uid text, p_email text, p_display_name text, p_technician text)
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

  update join_keys set used_at = now(), used_by_uid = p_uid, used_by_email = p_email where code_hash = h;

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
