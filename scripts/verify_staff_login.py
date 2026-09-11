"""End-to-end check of the phone sign-in path against the live Supabase project.

Why this exists: the first version of `staff_set_phone_pin` stored the result of a
COMPARISON function instead of the hash, so `pin_hash` held the text 'true' and every
correct PIN was refused at login. The unit tests cannot see that — they never touch
the database — so this script exercises the real functions.

It creates nothing permanent: the probe session row is deleted and the test PIN is
cleared afterwards. Run it after any change to the staff SQL:

    python scripts/verify_staff_login.py
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = (ROOT / '.env').read_text(encoding='utf-8')
URL = re.search(r'VITE_SUPABASE_URL=(\S+)', ENV).group(1).strip()
KEY = re.search(r'VITE_SUPABASE_ANON_KEY=(\S+)', ENV).group(1).strip()
HEADERS = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

TEST_PHONE = '0123456789'  # the seeded test technician
PROBE_UID = 'verify-staff-login-probe'
PIN = '4321'

results: list[tuple[str, bool, str]] = []


def rpc(name: str, payload: dict):
    req = urllib.request.Request(f'{URL}/rest/v1/rpc/{name}', data=json.dumps(payload).encode(), headers=HEADERS, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        return {'http_error': exc.code, 'body': exc.read().decode()[:300]}


def one(value):
    return value[0] if isinstance(value, list) and value else value


def check(label: str, ok: bool, detail: str = '') -> None:
    results.append((label, bool(ok), detail or ('ok' if ok else 'FAILED')))


def directory_rows() -> list[dict]:
    req = urllib.request.Request(f'{URL}/rest/v1/staff_directory?select=id,role,phone,email,pin_hash&order=created_at', headers=HEADERS)
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode())


def patch_phone(phone: str, payload: dict) -> None:
    req = urllib.request.Request(f'{URL}/rest/v1/staff_directory?phone=eq.{phone}', data=json.dumps(payload).encode(), headers=HEADERS, method='PATCH')
    urllib.request.urlopen(req, timeout=30).read()


def cleanup() -> None:
    req = urllib.request.Request(f'{URL}/rest/v1/staff_accounts?uid=eq.{PROBE_UID}', headers=HEADERS, method='DELETE')
    urllib.request.urlopen(req, timeout=30).read()
    patch_phone(TEST_PHONE, {'pin_hash': None, 'pin_set_at': None, 'failed_attempts': 0, 'locked_until': None})


def main() -> int:
    row = next((r for r in directory_rows() if r.get('phone') == TEST_PHONE), None)
    if not row:
        print(f'No whitelist row for {TEST_PHONE} — add the test technician first.')
        return 2

    patch_phone(TEST_PHONE, {'pin_hash': None, 'pin_set_at': None, 'failed_attempts': 0, 'locked_until': None})
    cleanup()

    # 1. before a PIN exists the screen must offer "choose a PIN"
    st = one(rpc('staff_phone_status', {'p_phone': TEST_PHONE}))
    check('a registered number is found', st.get('found') is True)
    check('and asked to choose a PIN first', st.get('needs_pin') is True)

    # 2. formatting is not a way to get in, or to be locked out
    spaced = one(rpc('staff_phone_status', {'p_phone': '012-345 6789'}))
    check('the same number in any format matches', spaced.get('found') is True)

    # 3. a bad PIN is rejected with a sentence, not a crash
    weak = one(rpc('staff_set_phone_pin', {'p_phone': TEST_PHONE, 'p_pin': '12'}))
    check('a short PIN is refused', weak.get('ok') is False, str(weak.get('reason')))

    # 4. setting the PIN stores a hash — this is the check that catches the real bug
    saved = one(rpc('staff_set_phone_pin', {'p_phone': TEST_PHONE, 'p_pin': PIN}))
    check('the PIN is accepted', saved.get('ok') is True, str(saved.get('reason')))
    stored = next((r['pin_hash'] for r in directory_rows() if r.get('phone') == TEST_PHONE), None)
    check('and stored as a sha256 hash, not a flag', bool(stored) and re.fullmatch(r'[0-9a-f]{64}', stored or '') is not None, f'pin_hash={stored!r}')

    st = one(rpc('staff_phone_status', {'p_phone': TEST_PHONE}))
    check('afterwards the number wants the PIN, not a new one', st.get('needs_pin') is False)

    # 5. a wrong PIN is refused …
    wrong = one(rpc('staff_login_phone', {'p_phone': TEST_PHONE, 'p_pin': '0000', 'p_uid': PROBE_UID}))
    check('a wrong PIN is refused', wrong.get('ok') is False, str(wrong.get('reason')))

    # 6. … and the right one signs the person in, with their role and team
    good = one(rpc('staff_login_phone', {'p_phone': TEST_PHONE, 'p_pin': PIN, 'p_uid': PROBE_UID}))
    check('the correct PIN signs in', good.get('ok') is True, str(good.get('reason')))
    check('and reports the right role', good.get('role') == row.get('role'), f"role={good.get('role')!r}")

    # 7. five wrong tries lock the number (in the database, not the browser)
    for _ in range(5):
        one(rpc('staff_login_phone', {'p_phone': TEST_PHONE, 'p_pin': '0000', 'p_uid': PROBE_UID}))
    locked = one(rpc('staff_login_phone', {'p_phone': TEST_PHONE, 'p_pin': PIN, 'p_uid': PROBE_UID}))
    check('five wrong PINs lock the number', locked.get('ok') is False and 'Too many' in str(locked.get('reason')), str(locked.get('reason')))
    st = one(rpc('staff_phone_status', {'p_phone': TEST_PHONE}))
    check('and the screen can say it is locked', st.get('locked') is True)

    # 8. an admin reset clears the PIN so the person chooses a new one
    patch_phone(TEST_PHONE, {'pin_hash': None, 'pin_set_at': None, 'failed_attempts': 0, 'locked_until': None})
    st = one(rpc('staff_phone_status', {'p_phone': TEST_PHONE}))
    check('after an admin reset a new PIN is requested', st.get('needs_pin') is True and st.get('locked') is False)

    cleanup()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f'\n{"PASS" if passed == len(results) else "FAIL"}  {passed}/{len(results)} checks\n')
    for label, ok, detail in results:
        print(f'  {"PASS" if ok else "FAIL"}  {label}' + ('' if ok else f'  -> {detail}'))
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
