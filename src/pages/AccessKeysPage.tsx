import { useCallback, useEffect, useState } from 'react';
import { useAuth, type JoinKey, type StaffProfile } from '../state/AuthState';
import { TECHNICIANS, type Role, type Technician } from '../lib/types';
import { Card, EmptyState, Field, SectionTitle, StatusPill } from '../components/ui';

/**
 * Admin → Access keys.
 *
 * The key is how a technician gets in the first time: an admin creates it for a
 * named team, hands it over in person / email / WhatsApp, and it is spent the
 * moment it is used. Afterwards the technician signs in with Google alone — so a
 * lost phone does not mean a lost account, and there is no shared password to
 * circulate. Revoked and expired keys stay listed so the office can see history.
 */
function keyState(key: JoinKey): { label: string; tone: 'open' | 'used' | 'dead' } {
  if (key.revoked_at) return { label: 'Revoked', tone: 'dead' };
  if (key.used_at) return { label: `Used ${new Date(key.used_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, tone: 'used' };
  if (key.expires_at && new Date(key.expires_at) < new Date()) return { label: 'Expired', tone: 'dead' };
  return { label: 'Ready to use', tone: 'open' };
}

const TONE_CLASS = {
  open: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  used: 'bg-slate-100 text-slate-600 border-slate-200',
  dead: 'bg-rose-50 text-rose-700 border-rose-200',
} as const;

export default function AccessKeysPage() {
  const { configured, listKeys, createKey, revokeKey, deleteKey, listStaff } = useAuth();
  const [keys, setKeys] = useState<JoinKey[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [role, setRole] = useState<Role>('Technician');
  const [technician, setTechnician] = useState<Technician | ''>('');
  const [label, setLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<JoinKey | null>(null);
  const [copied, setCopied] = useState(false);
  // Who the key is going to: a phone number (WhatsApp/SMS) or an email address.
  const [recipient, setRecipient] = useState('');

  const refresh = useCallback(async () => {
    try {
      setKeys(await listKeys());
      setStaff(await listStaff());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the keys.');
    }
  }, [listKeys, listStaff]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!configured) {
    return (
      <EmptyState
        icon="🔑"
        title="Sign-in is not configured in this build"
        hint="Set the Firebase and Supabase environment variables to manage staff access keys."
      />
    );
  }

  /** The message a technician receives — the same text for WhatsApp, SMS or email. */
  const messageFor = (key: JoinKey) =>
    `Sejuk Sejuk Service portal — your one-time access key is ${key.code ?? '________________'}\n\n` +
    `1. Open ${typeof window !== 'undefined' ? window.location.origin : 'the portal'}\n` +
    `2. Tap "I have an access key" (or "No email? Continue with your phone number")\n` +
    `3. Enter the code (team: ${key.technician_name ?? 'any'}), then your name and phone number\n` +
    (key.expires_at ? `Please do this before ${new Date(key.expires_at).toLocaleDateString('en-GB')} — the key expires.\n` : '') +
    `After this once, the portal remembers this phone.`;

  const digitsOnly = recipient.replace(/[^0-9+]/g, '').replace(/^\+/, '');
  const whatsappHref = (key: JoinKey) =>
    `https://wa.me/${digitsOnly}?text=${encodeURIComponent(messageFor(key))}`;
  // sms: works on both iOS and Android; the body separator differs, so offer both.
  const smsHref = (key: JoinKey) =>
    /iPhone|iPad|iPod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')
      ? `sms:${digitsOnly}&body=${encodeURIComponent(messageFor(key))}`
      : `sms:${digitsOnly}?body=${encodeURIComponent(messageFor(key))}`;
  const mailHref = (key: JoinKey) =>
    `mailto:${recipient}?subject=${encodeURIComponent('Sejuk Sejuk Service — your access key')}&body=${encodeURIComponent(messageFor(key))}`;
  const looksLikeEmail = recipient.includes('@');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Access keys</h1>
        <p className="text-sm text-slate-500">
          A key lets one technician join the portal (they sign in with Google, then enter the key). It is used once — after
          that, Google alone signs them in. Revoke or expire keys you no longer want accepted.
        </p>
      </div>

      <Card className="space-y-1 p-4">
        <SectionTitle>Create a key</SectionTitle>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Role">
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="Technician">Technician</option>
              <option value="Manager">Manager</option>
              <option value="Admin">Admin</option>
            </select>
          </Field>
          <Field label="Field team" hint="Blank = any team may claim it">
            <select
              className="input"
              value={technician}
              disabled={role !== 'Technician'}
              onChange={(e) => setTechnician(e.target.value as Technician | '')}
            >
              <option value="">— any —</option>
              {TECHNICIANS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note" hint="For your own record, e.g. “new phone”">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Replacement phone" />
          </Field>
          <Field label="Expires in (days)" hint="Blank or 0 = never expires">
            <input className="input" inputMode="numeric" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
          </Field>
          <Field
            label="Send the key to"
            hint="Phone number for WhatsApp/SMS, or an email address — for a technician with no email, their phone"
          >
            <input
              className="input"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="012-345 6789 or name@example.com"
            />
          </Field>
        </div>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const created = await createKey({
                role,
                technician,
                label,
                expiresInDays: expiresInDays.trim() === '' ? null : Number(expiresInDays),
              });
              setFresh(created);
              setLabel('');
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not create the key.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Creating…' : 'Create key'}
        </button>
        {error ? <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      </Card>

      {fresh?.code ? (
        <Card className="space-y-2 border-emerald-200 bg-emerald-50/60 p-4">
          <div className="text-sm font-semibold text-emerald-800">Key created — hand this to the technician</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-3 py-2 font-mono text-lg tracking-wider text-slate-800">{fresh.code}</code>
            <button
              className="btn-secondary !py-2 text-xs"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fresh.code ?? '');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            {looksLikeEmail ? (
              <a className="btn-secondary !py-2 text-xs" href={mailHref(fresh)}>
                ✉️ Send by email
              </a>
            ) : (
              <>
                <a className="btn-secondary !py-2 text-xs" target="_blank" rel="noreferrer" href={whatsappHref(fresh)}>
                  💬 WhatsApp
                </a>
                <a className="btn-secondary !py-2 text-xs" href={smsHref(fresh)}>
                  📱 SMS
                </a>
              </>
            )}
            <button className="btn-ghost !py-2 text-xs" onClick={() => setFresh(null)}>
              Hide
            </button>
          </div>
          <p className="text-xs text-emerald-800">
            {fresh.role}
            {fresh.technician_name ? ` · ${fresh.technician_name}` : ''} ·{' '}
            {fresh.expires_at ? `expires ${new Date(fresh.expires_at).toLocaleDateString('en-GB')}` : 'no expiry'}
          </p>
          <p className="text-xs font-medium text-emerald-900">
            Copy or send it now — the portal keeps only a one-way hash, so this code cannot be shown again. Create a new key
            if it is lost.
          </p>
          <p className="text-xs text-emerald-800">
            A technician without an email can still join: they tap “No email? Continue with your phone number”, then enter
            this key.
          </p>
        </Card>
      ) : null}

      <div className="space-y-2">
        <SectionTitle right={<span className="chip bg-slate-100 text-slate-600">{keys.length}</span>}>Keys</SectionTitle>
        {keys.length === 0 ? (
          <EmptyState icon="🔑" title="No keys yet" hint="Create one above before a new technician starts." />
        ) : (
          keys.map((key) => {
            const state = keyState(key);
            return (
              <Card key={key.code_hash} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The code itself is not stored (only its hash), so an existing
                        key shows its identity claim instead of the secret. */}
                    <span className="font-mono text-sm text-slate-700">
                      {key.technician_name ? `key · ${key.technician_name}` : 'key · any team'}
                    </span>
                    <span className="text-[11px] text-slate-400">#{key.code_hash.slice(0, 6)}</span>
                    <span className={`chip border ${TONE_CLASS[state.tone]}`}>{state.label}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {key.role}
                    {key.technician_name ? ` · ${key.technician_name}` : ' · any team'}
                    {key.label ? ` · ${key.label}` : ''}
                    {key.created_by ? ` · by ${key.created_by}` : ''}
                    {key.expires_at ? ` · expires ${new Date(key.expires_at).toLocaleDateString('en-GB')}` : ''}
                    {key.used_by_email ? ` · by ${key.used_by_email}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {recipient ? (
                    looksLikeEmail ? (
                      <a className="btn-secondary !py-1.5 text-xs" href={mailHref(key)}>
                        ✉️ Email
                      </a>
                    ) : (
                      <>
                        <a className="btn-secondary !py-1.5 text-xs" target="_blank" rel="noreferrer" href={whatsappHref(key)}>
                          💬 WhatsApp
                        </a>
                        <a className="btn-secondary !py-1.5 text-xs" href={smsHref(key)}>
                          📱 SMS
                        </a>
                      </>
                    )
                  ) : null}
                  {!key.revoked_at && !key.used_at ? (
                    <button className="btn-secondary !py-1.5 text-xs" onClick={() => void revokeKey(key.code_hash).then(refresh)}>
                      Revoke
                    </button>
                  ) : (
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => void deleteKey(key.code_hash).then(refresh)}>
                      Delete
                    </button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      <div className="space-y-2">
        <SectionTitle right={<span className="chip bg-slate-100 text-slate-600">{staff.length}</span>}>Registered staff</SectionTitle>
        {staff.length === 0 ? (
          <EmptyState icon="👷" title="Nobody has joined yet" hint="Accounts appear here the moment a key is claimed." />
        ) : (
          staff.map((person) => (
            <Card key={person.uid} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  {person.display_name ?? person.email}
                  <span className="chip bg-slate-100 text-slate-600">{person.role}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {person.email}
                  {person.technician_name ? ` · ${person.technician_name}` : ''} · joined{' '}
                  {new Date(person.created_at).toLocaleDateString('en-GB')}
                </div>
              </div>
              {person.technician_name ? <StatusPill status={person.technician_name === 'Ali' ? 'Assigned' : 'Reviewed'} /> : null}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
