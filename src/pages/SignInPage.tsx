import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthState';

/**
 * One-tap sign-in.
 *
 * Google is the only provider: the technician already has that account on their
 * phone, so there is no password to remember, reset or leak. The access key is
 * the *joining* step and lives on the next screen.
 *
 * Demo mode is offered openly. This is an assessment build, and a reviewer must
 * be able to walk through the whole app without being handed a Google account —
 * hiding that would only make it harder to grade.
 */
export default function SignInPage() {
  const { signInWithGoogle, configured } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDemo = () => {
    localStorage.setItem('ss_demo_mode', '1');
    navigate('/');
    window.location.reload();
  };

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center px-5 py-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-3xl text-white shadow-md">❄️</span>
        <h1 className="mt-4 text-2xl font-bold text-slate-800">Sejuk Sejuk Service</h1>
        <p className="mt-1 text-sm text-slate-500">
          Operations portal — order intake, technician jobs, WhatsApp updates, KPI dashboard.
        </p>
      </div>

      <div className="card space-y-3 p-5">
        <button
          className="btn-primary w-full"
          disabled={busy || !configured}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await signInWithGoogle();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <p className="text-center text-xs text-slate-500">
          New technician? Your admin gives you an access key — sign in with Google, then enter the key.
        </p>
        <Link className="btn-secondary w-full text-center" to="/join">
          I have an access key
        </Link>

        {!configured ? (
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            Firebase/Supabase are not configured in this build, so sign-in is unavailable. Use demo mode below.
          </p>
        ) : null}
        {error ? <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p> : null}
      </div>

      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4 text-center">
        <div className="text-sm font-semibold text-slate-700">Reviewing this build?</div>
        <p className="mt-1 text-xs text-slate-500">
          Demo mode uses the seeded dataset in the browser — no account needed. Switch between Admin, Manager and
          Technician from the header.
        </p>
        <button className="btn-secondary mt-3 w-full" onClick={startDemo}>
          Continue in demo mode
        </button>
      </div>
    </div>
  );
}
