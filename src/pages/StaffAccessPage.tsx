import { useCallback, useEffect, useState } from 'react';
import { useAuth, type DirectoryEntry } from '../state/AuthState';
import { TECHNICIANS, type Role, type Technician } from '../lib/types';
import { formatPhoneInput, phoneProblem } from '../lib/domain';
import { Card, EmptyState, Field, SectionTitle } from '../components/ui';
import { isDemoMode } from '../lib/demoMode';

/**
 * Demo mode runs on the seeded dataset with no account, so it must not write to
 * the real whitelist — a reviewer poking at the screen would otherwise add rows to
 * the live table. The screen still shows what the feature looks like, on sample
 * entries, and says so.
 */
const SAMPLE_PEOPLE: DirectoryEntry[] = [
  {
    id: 'demo-1',
    email: 'ali@sejuksejuk.example',
    phone: '0123456789',
    display_name: 'Ali bin Ahmad',
    role: 'Technician',
    technician_name: 'Ali',
    pin_set_at: '2026-09-10T09:12:00Z',
    locked_until: null,
    revoked_at: null,
    last_login_at: '2026-09-11T08:02:00Z',
    created_by: 'admin',
    created_at: '2026-09-09T02:00:00Z',
  },
  {
    id: 'demo-2',
    email: null,
    phone: '0198765432',
    display_name: 'Suresh a/l Kumar',
    role: 'Technician',
    technician_name: 'John',
    pin_set_at: null,
    locked_until: null,
    revoked_at: null,
    last_login_at: null,
    created_by: 'admin',
    created_at: '2026-09-10T04:30:00Z',
  },
  {
    id: 'demo-3',
    email: 'manager@sejuksejuk.example',
    phone: null,
    display_name: 'Noraini binti Hassan',
    role: 'Manager',
    technician_name: null,
    pin_set_at: null,
    locked_until: null,
    revoked_at: '2026-09-11T01:00:00Z',
    last_login_at: '2026-09-08T06:45:00Z',
    created_by: 'admin',
    created_at: '2026-09-05T01:00:00Z',
  },
];

/**
 * Admin → Staff access (the whitelist).
 *
 * Adding somebody here IS their invitation: their email (Google) and/or phone
 * number (4-digit PIN) is what lets them in. No keys to hand out, nothing to
 * lose, and revoking is one switch — the login functions check this table every
 * time, so a revoked person is refused on their next attempt.
 */
export default function StaffAccessPage() {
  const { configured, listDirectory, addPerson, revokePerson, deletePerson, resetPin, adminSetPin, adminClearLockout } = useAuth();
  // Which person's PIN panel is open, and the two typed values for it.
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [people, setPeople] = useState<DirectoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // the add form
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('Technician');
  const [technician, setTechnician] = useState<Technician | ''>('');

  const demo = isDemoMode();

  const refresh = useCallback(async () => {
    if (demo) {
      setPeople(SAMPLE_PEOPLE);
      return;
    }
    try {
      setPeople(await listDirectory());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the staff list.');
    }
  }, [demo, listDirectory]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!configured && !demo) {
    return (
      <EmptyState
        icon="👥"
        title="Sign-in is not configured in this build"
        hint="Set the Firebase and Supabase environment variables to manage who may sign in."
      />
    );
  }

  const phoneIssue = phone.trim() ? phoneProblem(phone) : null;
  const canAdd = Boolean((email.trim().includes('@') || (phone.trim() && !phoneIssue)) && displayName.trim());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Staff access</h1>
        <p className="text-sm text-slate-500">
          Who may sign in. Add an email (they sign in with Google) and/or a phone number (they sign in with a 4-digit PIN
          they choose the first time). Anyone not listed here is refused, and revoking takes effect on their next sign-in.
        </p>
      </div>

      {demo ? (
        <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>Demo mode:</strong> this is sample data, and nothing here is saved — the live list is stored in
          Supabase. In the real build, adding a person is what lets them sign in.
        </p>
      ) : null}

      <Card className="space-y-1 p-4">
        <SectionTitle>Add a person</SectionTitle>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Email (Google login)" hint="Leave blank if they have no email">
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </Field>
          <Field label="Phone number (PIN login)" hint={phoneIssue ?? 'e.g. 012-345 6789'}>
            <input
              className={`input ${phoneIssue ? '!border-rose-300 !bg-rose-50' : ''}`}
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="012-345 6789"
            />
          </Field>
          <Field label="Name">
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Ali bin Ahmad" />
          </Field>
          <Field label="Role">
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="Technician">Technician</option>
              <option value="Manager">Manager</option>
              <option value="Admin">Admin</option>
            </select>
          </Field>
          {role === 'Technician' ? (
            <Field label="Field team" hint="Which of the four teams this is">
              <select className="input" value={technician} onChange={(e) => setTechnician(e.target.value as Technician | '')}>
                <option value="">— choose —</option>
                {TECHNICIANS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        <button
          className={`btn-primary ${demo ? 'opacity-60' : ''}`}
          disabled={busy || !canAdd}
          onClick={async () => {
            if (demo) {
              setError('Demo mode does not save anything — this list is read-only here.');
              return;
            }
            setBusy(true);
            setError(null);
            setFlash(null);
            try {
              const created = await addPerson({ email, phone, displayName, role, technician });
              setFlash(`${created.display_name} can now sign in${created.email ? ` with ${created.email}` : ''}${created.phone ? ` (PIN, ${created.phone})` : ''}.`);
              setEmail('');
              setPhone('');
              setDisplayName('');
              setTechnician('');
              await refresh();
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Could not add this person.';
              setError(/duplicate|unique/i.test(message) ? 'That email or phone number is already on the list.' : message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Adding…' : 'Add to the list'}
        </button>
        {flash ? <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{flash}</p> : null}
        {error ? <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      </Card>

      <div className="space-y-2">
        <SectionTitle right={<span className="chip bg-slate-100 text-slate-600">{people.length}</span>}>Registered</SectionTitle>
        {people.length === 0 ? (
          <EmptyState icon="👥" title="Nobody on the list yet" hint="Add your first technician above — they can then sign in." />
        ) : (
          people.map((person) => {
            const revoked = Boolean(person.revoked_at);
            const locked = person.locked_until ? new Date(person.locked_until) > new Date() : false;
            const hasPhone = Boolean(person.phone);
            const panelOpen = pinFor === person.id;
            return (
              <Card key={person.id} className={`p-3 ${revoked ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{person.display_name ?? person.email ?? person.phone}</span>
                      <span className="chip bg-slate-100 text-slate-600">{person.role}</span>
                      {person.technician_name ? <span className="chip bg-slate-100 text-slate-600">👷 {person.technician_name}</span> : null}
                      {revoked ? <span className="chip border border-rose-200 bg-rose-50 text-rose-700">revoked</span> : null}
                      {locked ? <span className="chip border border-amber-200 bg-amber-50 text-amber-800">PIN locked</span> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {person.email ? `📧 ${person.email}` : '📧 no email'}
                      {hasPhone ? ` · 📱 ${person.phone}` : ' · 📱 no number'}
                      {hasPhone ? (person.pin_set_at ? ' · PIN set' : ' · PIN not set yet') : ' · PIN not applicable'}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {hasPhone ? (
                    <button
                      className="btn-secondary !py-1.5 text-xs"
                      onClick={() => {
                        setPinFor(panelOpen ? null : person.id);
                        setPin('');
                        setPinAgain('');
                        setError(null);
                        setFlash(null);
                      }}
                    >
                      {panelOpen ? 'Close PIN' : person.pin_set_at ? '🔑 Change PIN' : '🔑 Set a PIN'}
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-400">Add a phone number to give this person a PIN.</span>
                  )}
                  {hasPhone && person.pin_set_at ? (
                    <button
                      className="btn-ghost !py-1.5 text-xs"
                      title="Forget the PIN so the person chooses a new one at next sign-in"
                      onClick={() => (demo ? setError('Demo mode does not save anything.') : void resetPin(person.id).then(refresh))}
                    >
                      Forget PIN
                    </button>
                  ) : null}
                  {hasPhone && locked ? (
                    <button
                      className="btn-ghost !py-1.5 text-xs"
                      title="Clear the 15-minute wrong-PIN lockout now"
                      onClick={() =>
                        demo
                          ? setError('Demo mode does not save anything.')
                          : void adminClearLockout(person.phone!).then((res) => {
                              if (!res.ok) setError(res.reason);
                              else {
                                setFlash(res.reason);
                                void refresh();
                              }
                            })
                      }
                    >
                      Clear lockout
                    </button>
                  ) : null}
                  <button
                    className="btn-secondary !py-1.5 text-xs"
                    onClick={() => (demo ? setError('Demo mode does not save anything.') : void revokePerson(person.id, !revoked).then(refresh))}
                  >
                    {revoked ? '✅ Allow access again' : '🚫 Revoke access'}
                  </button>
                  <button
                    className="btn-ghost !py-1.5 text-xs"
                    onClick={() => (demo ? setError('Demo mode does not save anything.') : void deletePerson(person.id).then(refresh))}
                  >
                    Remove
                  </button>
                </div>

                {/* The PIN panel: set or change it right here. This is what the office
                    needs when somebody cannot get through the first-time "choose your
                    own PIN" step, or asks for the PIN to be changed. */}
                {panelOpen && hasPhone ? (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-700">
                      {person.pin_set_at ? 'New PIN' : 'First PIN'} for {person.phone}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Four digits. Give it to {person.display_name ?? 'them'} in person or over the phone — they sign in with
                      the number and this PIN.
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="input w-24 text-center text-lg tracking-[0.4em]"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="••••"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      />
                      <input
                        className="input w-24 text-center text-lg tracking-[0.4em]"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="again"
                        value={pinAgain}
                        onChange={(e) => setPinAgain(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      />
                      <button
                        className="btn-primary !py-1.5 text-xs"
                        disabled={!demo && (pin.length !== 4 || pin !== pinAgain)}
                        onClick={async () => {
                          if (demo) {
                            setError('Demo mode does not save anything.');
                            return;
                          }
                          const res = await adminSetPin(person.phone!, pin);
                          if (!res.ok) {
                            setError(res.reason);
                            return;
                          }
                          setFlash(`${person.display_name ?? person.phone}: ${res.reason}`);
                          setPinFor(null);
                          setPin('');
                          setPinAgain('');
                          await refresh();
                        }}
                      >
                        Save PIN
                      </button>
                      <span className="text-[11px] text-slate-500">
                        {pin.length === 4 && pin === pinAgain ? 'ready' : 'type the same 4 digits twice'}
                      </span>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
