import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthState';
import { TECHNICIANS, type Technician } from '../lib/types';
import { Card, EmptyState, Field } from '../components/ui';

/**
 * The one-time join step.
 *
 * The admin creates a key for a named technician and hands it over in person, by
 * email or WhatsApp. The technician signs in with Google and enters that key —
 * so a random Google account cannot read the operations data. The key is spent at
 * this moment; from then on Google alone signs them in, because Google keeps the
 * account on the phone.
 */
export default function JoinWithKeyPage() {
  const { user, profile, claimKey, signInWithGoogle, signOutStaff, configured } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [technician, setTechnician] = useState<Technician | ''>('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; reason: string } | null>(null);

  if (!configured) {
    return <EmptyState icon="🔑" title="Sign-in is not configured" hint="This build has no Firebase/Supabase configuration." />;
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 px-5 py-8">
        <Card className="space-y-3 p-5">
          <h1 className="text-lg font-bold text-slate-800">Join with an access key</h1>
          <p className="text-sm text-slate-500">
            First, sign in with Google — that becomes your permanent login. You will enter the key your admin gave you
            right after.
          </p>
          <button className="btn-primary w-full" onClick={() => void signInWithGoogle()}>
            Continue with Google
          </button>
        </Card>
      </div>
    );
  }

  if (profile) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 px-5 py-8">
        <Card className="space-y-2 p-5">
          <h1 className="text-lg font-bold text-slate-800">You are already registered</h1>
          <p className="text-sm text-slate-500">
            Signed in as <strong>{profile.display_name ?? profile.email}</strong> ({profile.role}
            {profile.technician_name ? ` · ${profile.technician_name}` : ''}).
          </p>
          <button className="btn-primary w-full" onClick={() => navigate('/')}>
            Go to the portal
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-5 py-8">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Enter your access key</h1>
        <p className="text-sm text-slate-500">
          Signed in as <strong>{user.email}</strong>. This is the key your admin gave you — it works once.
        </p>
      </div>

      {result && !result.ok ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{result.reason}</div> : null}

      <Card className="space-y-1 p-4">
        <Field label="Access key" hint="Looks like SS-7F3K-9Q2M — capitals and dashes are not fussy">
          <input
            className="input font-mono tracking-wider"
            value={code}
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="SS-XXXX-XXXX"
          />
        </Field>
        <Field label="Your name" hint="As the office should see it on jobs">
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Ali bin Ahmad"
          />
        </Field>
        <Field label="Which field team are you?" hint="Match the name the admin assigned you">
          <select className="input" value={technician} onChange={(e) => setTechnician(e.target.value as Technician | '')}>
            <option value="">— choose —</option>
            {TECHNICIANS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <button
          className="btn-primary mt-1 w-full"
          disabled={busy || code.trim().length < 6}
          onClick={async () => {
            setBusy(true);
            const res = await claimKey({ code, technician, displayName });
            setBusy(false);
            setResult(res);
            if (res.ok) navigate('/');
          }}
        >
          {busy ? 'Checking…' : 'Join'}
        </button>
      </Card>

      <button className="btn-ghost w-full text-xs" onClick={() => void signOutStaff()}>
        Sign out
      </button>
    </div>
  );
}
