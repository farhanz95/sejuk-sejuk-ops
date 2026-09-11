import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp, ROLE_OPTIONS } from '../state/AppState';
import { InstallAppButton } from './InstallAppButton';
import { useAuth } from '../state/AuthState';
import { TECHNICIANS } from '../lib/types';
import { Toasts } from './ui';
import { homeForRole } from './RequireRole';
import type { Role } from '../lib/types';

const ROLE_ICON = { Admin: '🗂️', Technician: '🔧', Manager: '📊' } as const;

export default function Layout() {
  const { actor, setActor, resetActor, mode, data, resetDemo, authManaged } = useApp();
  const auth = useAuth();
  const navigate = useNavigate();

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
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
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
              className="input !w-auto !py-2"
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
              className="btn-ghost !px-2 !py-2 text-xs"
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

            {mode === 'demo' ? (
              <button type="button" className="btn-ghost !px-2 !py-2 text-xs" title="Reset the seeded demo dataset" onClick={() => void resetDemo()}>
                reset
              </button>
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
                `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${isActive ? 'text-brand-700' : 'text-slate-500'}`
              }
            >
              <span className="text-lg leading-none">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Toasts />
    </div>
  );
}
