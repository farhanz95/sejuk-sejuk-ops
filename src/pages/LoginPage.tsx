import { useState } from 'react';
import { useAuth } from '../state/AuthState';
import { enterDemoMode } from '../lib/demoMode';
import { phoneProblem } from '../lib/domain';

/**
 * The way in.
 *
 * Two choices, exactly as the office thinks about it: **email** (Google, tied to
 * the person on first use) or **phone number** (a 4-digit PIN, for technicians
 * without an email). Nothing else — no access keys, no join codes.
 *
 * Both paths are gated by the admin's whitelist (Staff access), and the sentence
 * at the top says so, because that is the one thing a new person needs to know:
 * "make sure your admin has registered you".
 */
export default function LoginPage() {
  const { signInWithGoogle, phoneStatus, setPhonePin, signInWithPhone, configured } = useAuth();

  const [mode, setMode] = useState<'choose' | 'phone'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // phone path
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [stage, setStage] = useState<'number' | 'choose-pin' | 'enter-pin'>('number');

  const startDemo = () => {
    enterDemoMode();
    window.location.assign('/');
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const submitPhone = () =>
    withBusy(async () => {
      const issue = phoneProblem(phone);
      if (issue) {
        setError(issue);
        return;
      }
      const status = await phoneStatus(phone);
      if (!status.found) {
        setError('That number is not registered yet. Ask your admin to add it, or sign in with your email.');
        return;
      }
      if (status.revoked) {
        setError('This account has been revoked. Ask your admin.');
        return;
      }
      if (status.locked) {
        setError('Too many wrong PINs — this number is locked for 15 minutes.');
        return;
      }
      setPin('');
      setPinConfirm('');
      setStage(status.needsPin ? 'choose-pin' : 'enter-pin');
    });

  const submitNewPin = () =>
    withBusy(async () => {
      if (!/^\d{4}$/.test(pin)) {
        setError('Choose exactly 4 digits.');
        return;
      }
      if (pin !== pinConfirm) {
        setError('The two PINs do not match.');
        return;
      }
      const saved = await setPhonePin(phone, pin);
      if (!saved.ok) {
        setError(saved.reason);
        return;
      }
      const logged = await signInWithPhone(phone, pin);
      if (!logged.ok) setError(logged.reason);
    });

  const submitExistingPin = () =>
    withBusy(async () => {
      if (!/^\d{4}$/.test(pin)) {
        setError('Enter your 4-digit PIN.');
        return;
      }
      const logged = await signInWithPhone(phone, pin);
      if (!logged.ok) setError(logged.reason);
    });

  return (
    <div className="mx-auto flex min-h-[85vh] w-full max-w-md flex-col justify-center px-5 py-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-3xl text-white shadow-md">❄️</span>
        <h1 className="mt-4 text-2xl font-bold text-slate-800">Sejuk Sejuk Service</h1>
        <p className="mt-1 text-sm text-slate-500">
          Operations portal — order intake, technician jobs, WhatsApp updates, KPI dashboard.
        </p>
      </div>

      {mode === 'choose' ? (
        <div className="card space-y-3 p-5">
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs text-brand-800">
            <strong>First login:</strong> your email or phone number must be registered by your admin.
          </div>

          <button
            className="btn-primary w-full"
            disabled={busy}
            onClick={() =>
              withBusy(async () => {
                if (!configured) {
                  setError('Sign-in is not configured in this build — use demo mode below.');
                  return;
                }
                const res = await signInWithGoogle();
                if (!res.ok) setError(res.reason);
              })
            }
          >
            {busy ? 'Opening Google…' : '📧 Login using email'}
          </button>

          <button className="btn-secondary w-full" onClick={() => setMode('phone')}>
            📱 Login using phone number
          </button>

          {!configured ? (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              Firebase/Supabase are not configured in this build, so sign-in is unavailable. Use demo mode below.
            </p>
          ) : null}
          {error ? <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p> : null}
        </div>
      ) : (
        <div className="card space-y-3 p-5">
          {/* A small way back — the phone form is a step, not a dead end. */}
          <button
            className="btn-ghost !px-0 !py-0 text-xs"
            onClick={() => {
              setMode('choose');
              setStage('number');
              setError(null);
            }}
          >
            ← Back
          </button>

          <h2 className="text-base font-bold text-slate-800">
            {stage === 'number' ? 'Login using phone number' : stage === 'choose-pin' ? 'Choose your 4-digit PIN' : 'Enter your PIN'}
          </h2>
          <p className="text-xs text-slate-500">
            {stage === 'number'
              ? 'The number your admin registered for you.'
              : stage === 'choose-pin'
                ? 'You will use this PIN with your number each time you sign in.'
                : `Signing in as ${phone}.`}
          </p>

          {stage === 'number' ? (
            <>
              <input
                className="input"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="012-345 6789"
                autoFocus
              />
              <button className="btn-primary w-full" disabled={busy} onClick={() => void submitPhone()}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </>
          ) : null}

          {stage === 'choose-pin' ? (
            <>
              <input
                className="input text-center text-2xl tracking-[0.5em]"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                autoFocus
              />
              <input
                className="input text-center text-2xl tracking-[0.5em]"
                inputMode="numeric"
                maxLength={4}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="repeat"
              />
              <button className="btn-primary w-full" disabled={busy} onClick={() => void submitNewPin()}>
                {busy ? 'Saving…' : 'Save PIN and sign in'}
              </button>
            </>
          ) : null}

          {stage === 'enter-pin' ? (
            <>
              <input
                className="input text-center text-2xl tracking-[0.5em]"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitExistingPin();
                }}
              />
              <button className="btn-primary w-full" disabled={busy} onClick={() => void submitExistingPin()}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                className="btn-ghost w-full text-xs"
                onClick={() => {
                  setStage('number');
                  setError(null);
                }}
              >
                Use a different number
              </button>
            </>
          ) : null}

          {error ? <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p> : null}
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4 text-center">
        <div className="text-sm font-semibold text-slate-700">Reviewing this build?</div>
        <p className="mt-1 text-xs text-slate-500">
          Demo mode uses the seeded dataset in the browser — no account needed. Switch between Admin, Manager and
          Technician from the header menu.
        </p>
        <button className="btn-secondary mt-3 w-full" onClick={startDemo}>
          Continue in demo mode
        </button>
      </div>
    </div>
  );
}
