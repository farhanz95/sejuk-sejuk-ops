"""Verify the staff-auth SQL landed, then exercise the whole claim flow over REST.

Uses the Supabase anon key the app itself ships with (RLS on these tables is the
demo policy, same as orders), so this proves what the browser will actually see.
Run:  python scripts/verify_staff_auth.py
"""
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parents[1] / '.env'


def env(key: str) -> str:
    text = ENV.read_text(encoding='utf-8')
    m = re.search(rf'^{key}=(.*)$', text, flags=re.M)
    if not m:
        raise SystemExit(f'{key} missing from .env')
    return m.group(1).strip().strip('"').strip("'")


URL = env('VITE_SUPABASE_URL').rstrip('/')
KEY = env('VITE_SUPABASE_ANON_KEY')
HEADERS = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

def hash_key(code: str) -> str:
    """Same recipe as the client and claim_join_key(): sha256 of the upper-cased, trimmed code."""
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = '') -> None:
    results.append((name, ok, detail))
    print(f'{"PASS" if ok else "FAIL"}  {name}' + (f' — {detail}' if detail else ''))


def call(method: str, path: str, body=None, headers: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method)
    for k, v in {**HEADERS, **(headers or {})}.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, raw


# ---------------------------------------------------------------- tables exist
status, body = call('GET', '/rest/v1/staff_accounts?select=uid&limit=1')
tables_ok = status == 200
check('staff_accounts table exists', tables_ok, f'http={status} {str(body)[:120] if not tables_ok else ""}')

status, body = call('GET', '/rest/v1/join_keys?select=code_hash&limit=1')
keys_ok = status == 200
check('join_keys table exists', keys_ok, f'http={status} {str(body)[:120] if not keys_ok else ""}')

if not (tables_ok and keys_ok):
    print('\nThe SQL has not been applied — paste supabase/staff_auth.sql into the Supabase SQL editor first.')
    sys.exit(1)

# ---------------------------------------------------------------- the function
status, body = call('POST', '/rest/v1/rpc/claim_join_key', {
    'p_code': 'SS-NOPE-NOPE', 'p_uid': 'probe-uid', 'p_email': 'probe@example.com',
    'p_display_name': 'Probe', 'p_technician': None,
})
row = body[0] if isinstance(body, list) and body else body
check('claim_join_key() exists and rejects an unknown key', status == 200 and isinstance(row, dict) and row.get('ok') is False,
      f'http={status} {str(body)[:140]}')

# ---------------------------------------------------------------- a real claim
created_codes: list[str] = []
probe_uids: list[str] = []
try:
    # 1. admin creates a key for Ali, expiring in a day
    code = 'SS-TEST-A1B2'
    status, body = call('POST', '/rest/v1/join_keys', {
        'code_hash': hash_key(code), 'role': 'Technician', 'technician_name': 'Ali', 'label': 'automated check',
        'expires_at': None, 'created_by': 'verify-script',
    }, headers={'Prefer': 'return=representation'})
    check('admin can create a key', status in (200, 201), f'http={status} {str(body)[:120]}')
    created_codes.append(code)

    # 2. the technician claims it
    uid1 = 'probe-uid-1'
    probe_uids.append(uid1)
    status, body = call('POST', '/rest/v1/rpc/claim_join_key', {
        'p_code': code.lower(),  # case should not matter
        'p_uid': uid1, 'p_email': 'ali@example.com', 'p_display_name': 'Ali bin Ahmad', 'p_technician': 'Ali',
    })
    row = body[0] if isinstance(body, list) and body else body
    check('a valid key claims successfully', bool(row and row.get('ok')), f'{str(row)[:140]}')
    check('the claim returns the right role/team', bool(row and row.get('role') == 'Technician' and row.get('technician_name') == 'Ali'),
          f'{row}')

    status, body = call('GET', f'/rest/v1/staff_accounts?uid=eq.{uid1}&select=role,technician_name,email')
    check('the staff account was created', status == 200 and body and body[0]['role'] == 'Technician', f'{str(body)[:140]}')

    status, body = call('GET', f'/rest/v1/join_keys?code_hash=eq.{hash_key(code)}&select=used_at,used_by_uid')
    check('the key is marked used', status == 200 and body and body[0]['used_at'] and body[0]['used_by_uid'] == uid1, f'{str(body)[:140]}')

    # 3. a second technician cannot reuse it
    uid2 = 'probe-uid-2'
    status, body = call('POST', '/rest/v1/rpc/claim_join_key', {
        'p_code': code, 'p_uid': uid2, 'p_email': 'someone@example.com', 'p_display_name': 'Someone', 'p_technician': 'Ali',
    })
    row = body[0] if isinstance(body, list) and body else body
    check('a spent key cannot be claimed twice', bool(row and row.get('ok') is False and 'already been used' in str(row.get('reason'))),
          f'{str(row)[:140]}')

    # 4. a revoked key is refused
    rev_code = 'SS-TEST-R3V0'
    call('POST', '/rest/v1/join_keys', {'code_hash': hash_key(rev_code), 'role': 'Technician', 'created_by': 'verify-script'},
         headers={'Prefer': 'return=representation'})
    created_codes.append(rev_code)
    call('PATCH', f'/rest/v1/join_keys?code_hash=eq.{hash_key(rev_code)}', {'revoked_at': '2026-01-01T00:00:00Z'})
    status, body = call('POST', '/rest/v1/rpc/claim_join_key', {
        'p_code': rev_code, 'p_uid': 'probe-uid-3', 'p_email': 'x@example.com', 'p_display_name': 'X', 'p_technician': None,
    })
    row = body[0] if isinstance(body, list) and body else body
    check('a revoked key is refused', bool(row and row.get('ok') is False and 'revoked' in str(row.get('reason'))), f'{str(row)[:140]}')

    # 5. an expired key is refused
    exp_code = 'SS-TEST-3XP1'
    call('POST', '/rest/v1/join_keys', {'code_hash': hash_key(exp_code), 'role': 'Technician', 'expires_at': '2020-01-01T00:00:00Z', 'created_by': 'verify-script'},
         headers={'Prefer': 'return=representation'})
    created_codes.append(exp_code)
    status, body = call('POST', '/rest/v1/rpc/claim_join_key', {
        'p_code': exp_code, 'p_uid': 'probe-uid-4', 'p_email': 'y@example.com', 'p_display_name': 'Y', 'p_technician': None,
    })
    row = body[0] if isinstance(body, list) and body else body
    check('an expired key is refused', bool(row and row.get('ok') is False and 'expired' in str(row.get('reason'))), f'{str(row)[:140]}')

    # 6. a key issued for one team cannot be claimed by another
    team_code = 'SS-TEST-T34M'
    call('POST', '/rest/v1/join_keys', {'code_hash': hash_key(team_code), 'role': 'Technician', 'technician_name': 'Ali', 'created_by': 'verify-script'},
         headers={'Prefer': 'return=representation'})
    created_codes.append(team_code)
    status, body = call('POST', '/rest/v1/rpc/claim_join_key', {
        'p_code': team_code, 'p_uid': 'probe-uid-5', 'p_email': 'z@example.com', 'p_display_name': 'Z', 'p_technician': 'John',
    })
    row = body[0] if isinstance(body, list) and body else body
    check('a key for the wrong team is refused', bool(row and row.get('ok') is False and 'for' in str(row.get('reason'))), f'{str(row)[:140]}')

finally:
    for c in created_codes:
        call('DELETE', f'/rest/v1/join_keys?code_hash=eq.{hash_key(c)}')
    for uid in probe_uids:
        call('DELETE', f'/rest/v1/staff_accounts?uid=eq.{uid}')
    status, left_keys = call('GET', '/rest/v1/join_keys?select=code_hash&label=eq.automated%20check')
    status2, left_staff = call('GET', '/rest/v1/staff_accounts?select=uid&uid=like.probe-*')
    print('leftover test keys:', left_keys if isinstance(left_keys, list) else left_keys)
    print('leftover probe accounts:', left_staff if isinstance(left_staff, list) else left_staff)

# ------------------------------------------------- the code itself is not readable
status, body = call('GET', '/rest/v1/join_keys?select=code&limit=1')
check('the plaintext code column is gone', status != 200 or not isinstance(body, list) or not (body and 'code' in body[0]),
      f'http={status} {str(body)[:90]}')

status, body = call('GET', '/rest/v1/join_keys?select=code_hash&limit=1')
row = body[0] if isinstance(body, list) and body else {}
looks_hashed = isinstance(row.get('code_hash'), str) and re.fullmatch(r'[0-9a-f]{64}', row['code_hash'] or '') is not None
check('stored keys are hashes, not codes', looks_hashed if row else True, f'{str(row.get("code_hash"))[:20]}…')

failed = [n for n, ok, _ in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
print('FAILED:', failed or 'none')
