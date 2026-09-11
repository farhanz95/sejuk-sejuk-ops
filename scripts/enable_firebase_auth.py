"""Enable Google sign-in and the portal's domains via the Identity Toolkit API.

Uses the firebase-tools CLI's own refresh token; nothing is printed.
Run:  python scripts/enable_firebase_auth.py
"""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = 'lifehack-681b1'
# firebase-tools' public OAuth client (the same one the CLI itself uses)
CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'
DOMAINS = [
    'localhost',
    'sejuk-sejuk-ops.web.app',
    'sejuk-sejuk-ops-five.vercel.app',
    'lifehack-681b1.firebaseapp.com',
]


def configstore_paths() -> list[Path]:
    home = Path(os.environ.get('USERPROFILE') or Path.home())
    appdata = Path(os.environ.get('APPDATA', home / 'AppData/Roaming'))
    return [
        appdata / 'configstore' / 'firebase-tools.json',
        home / '.config' / 'configstore' / 'firebase-tools.json',
        home / '.config' / 'firebase-tools.json',
    ]


def refresh_token() -> str:
    for path in configstore_paths():
        if path.exists():
            data = json.loads(path.read_text(encoding='utf-8'))
            token = (data.get('tokens') or {}).get('refresh_token')
            if token:
                return token
    raise SystemExit('firebase-tools refresh token not found — run `firebase login` first')


def access_token() -> str:
    body = urllib.parse.urlencode(
        {
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET,
            'refresh_token': refresh_token(),
            'grant_type': 'refresh_token',
        }
    ).encode()
    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=body)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())['access_token']


def call(method: str, path: str, token: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request('https://identitytoolkit.googleapis.com/admin/v2/' + path, data=data, method=method)
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return resp.status, json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b'{}')


def main() -> None:
    token = access_token()
    print('token acquired')

    status, cfg = call('GET', f'projects/{PROJECT}/defaultSupportedIdpConfigs/idp.google.com', token)
    print(f'google idp config read: http={status} enabled={cfg.get("enabled")}')

    status, out = call(
        'PATCH',
        f'projects/{PROJECT}/defaultSupportedIdpConfigs/idp.google.com?updateMask=enabled',
        token,
        {'enabled': True},
    )
    print(f'google sign-in enabled: http={status} enabled={out.get("enabled")}')

    status, main_cfg = call('GET', f'projects/{PROJECT}/config', token)
    existing = main_cfg.get('authorizedDomains') or []
    merged = sorted(set(existing) | set(DOMAINS))
    status, out = call('PATCH', f'projects/{PROJECT}/config?updateMask=authorizedDomains', token, {'authorizedDomains': merged})
    print(f'authorized domains: http={status} -> {out.get("authorizedDomains")}')


if __name__ == '__main__':
    import urllib.parse  # noqa: E402  (used by access_token)

    main()
