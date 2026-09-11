import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp, ROLE_OPTIONS } from '../state/AppState';
import { InstallAppButton } from './InstallAppButton';
import { useAuth } from '../state/AuthState';
import { isDemoMode, exitDemoMode } from '../lib/demoMode';
import { TECHNICIANS } from '../lib/types';
import { Toasts } from './ui';
import { homeForRole } from './RequireRole';
import type { Role } from '../lib/types';

const ROLE_ICON = { Admin: '🗂️', Technician: '🔧', Manager: '📊' } as const;

export default function Layout() {
  const { actor, setActor, resetActor, mode, data, resetDemo, authManaged } = useApp();
  const auth = useAuth();
  const navigate = useNavigate();
  // On a phone the header only has room for the essentials; the role switch and
  // the demo controls live behind this one button instead of stacking four rows.
  const [menuOpen, setMenuOpen] = useState(false);

  // Least privilege: a technician works in their own queue and their own
  // history. Company-wide KPIs, the query assistant and the audit log of
  // everyone's orders are management screens (Admin/Manager).
  const nav =
    actor.role === 'Technician'
      ? [
          { to: '/jobs', label: 'My Jobs', icon: '🔧' },
          { to: '/my-activity', label: 'My Activity', icon: '🕘' },
        ]
      : actor.role === 'Manager'
        ? [
            { to: '/review', label: 'Review', icon: '✅' },
            { to: '/orders', label: 'Orders', icon: '🧾' },
            { to: '/dashboard', label: 'Dashboard', icon: '📈' },
            { to: '/ai', label: 'AI Query', icon: '🤖' },
            { to: '/activity', label: 'Activity', icon: '🕘' },
          ]
        : [
            { to: '/orders', label: 'Orders', icon: '🧾' },
            { to: '/dashboard', label: 'Dashboard', icon: '📈' },
            { to: '/ai', label: 'AI Query', icon: '🤖' },
            { to: '/activity', label: 'Activity', icon: '🕘' },
            // Only offered where staff accounts exist — a demo session has no keys to manage.
            ...(auth.configured ? [{ to: '/access-keys', label: 'Access keys', icon: '🔑' }] : []),
          ];

  return (
    <div className="min-h-full pb-24 md:pb-10">
      {/* Opaque on phones (a translucent header let the cards underneath show
          through, which read as a rendering bug); frosted glass is kept on
          desktop where there is room for it to look deliberate. */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white md:bg-white/90 md:backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-left"
            title="Sejuk Sejuk Service"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg text-white shadow-sm">❄️</span>
            <span>
              <span className="block text-sm font-bold leading-tight text-slate-800">Sejuk Sejuk Service</span>
              <span className="block text-[11px] leading-tight text-slate-500">Operations Portal</span>
            </span>
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <InstallAppButton />
            {/* The "supabase" / "demo data" chip was removed: the storage backend
                is our concern, not the user's, and it told a technician nothing
                about their day. Each screen now shows its own work summary
                instead (see TechJobs' work log). */}

            {/* A signed-in staff account shows their identity instead of the mock
                role switch: switching roles is a demo affordance, and it must not
                be a way around the role rules for a real user. */}
            {authManaged ? (
              <span className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5">
                {auth.user?.photoURL ? (
                  <img src={auth.user.photoURL} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                    {(auth.profile?.display_name ?? auth.profile?.email ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="hidden text-xs leading-tight sm:block">
                  <span className="block font-semibold text-slate-700">{auth.profile?.display_name ?? auth.profile?.email}</span>
                  <span className="block text-slate-500">
                    {actor.role}
                    {auth.profile?.technician_name ? ` · ${auth.profile.technician_name}` : ''}
                  </span>
                </span>
                <button className="btn-ghost !px-1.5 !py-1 text-xs" onClick={() => void auth.signOutStaff()}>
                  Sign out
                </button>
              </span>
            ) : (
            <>
            <select
              className="input !hidden !w-auto !py-2 md:!block"
              value={`${actor.role}:${actor.name}`}
              onChange={(e) => {
                const [role, name] = e.target.value.split(':');
                setActor({ role: role as typeof actor.role, name });
                navigate(homeForRole(role as Role));
              }}
              title="Mock login — switch role to simulate a user"
            >
              {ROLE_OPTIONS.filter((r) => r.role !== 'Technician').map((r) => (
                <option key={r.role} value={`${r.role}:${r.label}`}>
                  {ROLE_ICON[r.role]} {r.label}
                </option>
              ))}
              {TECHNICIANS.map((t) => (
                <option key={t} value={`Technician:${t}`}>
                  🔧 Technician — {t}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="hidden rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:inline-block"
              title="Sign out of the mock login"
              onClick={() => {
                resetActor();
                navigate('/');
              }}
            >
              switch role
            </button>
            </>
            )}

            {/* Phone: one button reveals the role switch and demo controls, so the
                header stays compact instead of stacking four rows over the cards. */}
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-600 md:hidden"
              aria-label="Account and demo options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋯
            </button>
            {isDemoMode() || mode === 'demo' ? (
              <span className="hidden items-center gap-0.5 rounded-xl border border-amber-200 bg-amber-50/70 px-1.5 py-1 md:flex">
                <span className="chip bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800" title="You are exploring a seeded dataset in this browser, with no account.">
                  demo
                </span>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                  title="Reset the seeded demo dataset"
                  onClick={() => void resetDemo()}
                >
                  reset
                </button>
                {/* Leaving demo used to be impossible — the flag hid the sign-in
                    screen for good. One tap now returns there. */}
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                  title="Leave demo mode and go back to the sign-in screen"
                  onClick={() => exitDemoMode()}
                >
                  exit demo
                </button>
              </span>
            ) : null}
          </div>
        </div>

        <nav className="mx-auto hidden max-w-6xl gap-1 px-4 pb-2 md:flex">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              <span className="mr-1">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {menuOpen ? (
        <div className="mx-4 mt-2 space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg md:hidden">
          {!authManaged ? (
            <>
              <button className="btn-secondary w-full !py-2 text-xs"
                onClick={() => setMenuOpen(false)}
              >
                You are signed in as {actor.name} · {actor.role}
              </button>
              <select
                className="input !py-2 text-sm"
                value={`${actor.role}:${actor.name}`}
                onChange={(e) => {
                  const [role, name] = e.target.value.split(':');
                  setActor({ role: role as typeof actor.role, name });
                  setMenuOpen(false);
                  navigate(homeForRole(role as Role));
                }}
              >
                {ROLE_OPTIONS.filter((r) => r.role !== 'Technician').map((r) => (
                  <option key={r.role} value={`${r.role}:${r.label}`}>
                    {ROLE_ICON[r.role]} {r.label}
                  </option>
                ))}
                {TECHNICIANS.map((t) => (
                  <option key={t} value={`Technician:${t}`}>
                    🔧 Technician — {t}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost !py-2 text-xs"
                  onClick={() => {
                    setMenuOpen(false);
                    resetActor();
                    navigate('/');
                  }}
                >
                  switch role
                </button>
                {isDemoMode() || mode === 'demo' ? (
                  <>
                    <button className="btn-ghost !py-2 text-xs" onClick={() => void resetDemo()}>
                      reset demo data
                    </button>
                    <button className="btn-ghost !py-2 text-xs" onClick={() => exitDemoMode()}>
                      exit demo mode
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <button className="btn-secondary w-full !py-2 text-xs" onClick={() => void auth.signOutStaff()}>
              Sign out of {auth.profile?.display_name ?? auth.profile?.email}
            </button>
          )}
        </div>
      ) : null}

      <main className="mx-auto max-w-6xl px-4 py-5">
        <Outlet />
      </main>

      {/* Mobile: bottom tab bar — thumb-reachable for technicians in the field. */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className={`grid ${nav.length >= 4 ? 'grid-cols-4' : nav.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {nav.slice(0, nav.length >= 4 ? 4 : nav.length).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition ${
                  isActive ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* A colour shift alone was too subtle on a phone, so the active
                      tab also gets a marker bar and a filled icon pill. */}
                  <span
                    aria-hidden
                    className={`absolute inset-x-4 top-0 h-0.5 rounded-full ${isActive ? 'bg-brand-600' : 'bg-transparent'}`}
                  />
                  <span
                    className={`grid h-6 w-10 place-items-center rounded-full text-lg leading-none transition ${
                      isActive ? 'bg-brand-100' : ''
                    }`}
                  >
                    {n.icon}
                  </span>
                  <span className={isActive ? 'font-bold' : ''}>{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <Toasts />
    </div>
  );
}
