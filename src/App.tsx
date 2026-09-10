import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import { useApp, ROLE_OPTIONS } from './state/AppState';
import { homeForRole } from './components/RequireRole';
import { TECHNICIANS } from './lib/types';
import { Card, EmptyState } from './components/ui';
import AdminOrders from './pages/AdminOrders';
import OrderDetail from './pages/OrderDetail';
import TechJobs from './pages/TechJobs';
import ManagerReview from './pages/ManagerReview';
import Dashboard from './pages/Dashboard';
import AiQuery from './pages/AiQuery';
import Activity from './pages/Activity';
import MyActivity from './pages/MyActivity';
import { RequireRole } from './components/RequireRole';

function Landing() {
  const { actor, setActor, mode, ready, data } = useApp();
  const navigate = useNavigate();

  const start = (role: 'Admin' | 'Technician' | 'Manager', name: string) => {
    setActor({ role, name });
    navigate(homeForRole(role));
  };

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-8 text-white">
          <div className="text-xs font-semibold uppercase tracking-widest text-brand-100">Programmer assessment</div>
          <h1 className="mt-1 text-2xl font-bold md:text-3xl">Air-conditioner service operations, end to end</h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-50">
            Order intake → technician assignment → field completion → WhatsApp notification → manager review → KPI. Plus an AI
            operations query window that answers questions from controlled, pre-aggregated queries.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="chip bg-white/15 text-white">React + Tailwind</span>
            <span className="chip bg-white/15 text-white">Supabase (or seeded demo data)</span>
            <span className="chip bg-white/15 text-white">Serverless AI query API</span>
            <span className="chip bg-white/15 text-white">{ready ? `${data.orders.length} seeded orders` : 'loading…'}</span>
          </div>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Pick a role to start (mock login)</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {ROLE_OPTIONS.map((r) => (
            <Card key={r.role} className="flex flex-col p-5">
              <div className="text-2xl">{r.role === 'Admin' ? '🗂️' : r.role === 'Technician' ? '🔧' : '📊'}</div>
              <div className="mt-2 font-bold text-slate-800">{r.label}</div>
              <p className="mt-1 flex-1 text-sm text-slate-500">{r.hint}</p>
              {r.role === 'Technician' ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {TECHNICIANS.map((t) => (
                    <button key={t} className="btn-secondary !px-2" onClick={() => start('Technician', t)}>
                      {t}
                    </button>
                  ))}
                </div>
              ) : (
                <button className="btn-primary mt-3" onClick={() => start(r.role, r.label)}>
                  Continue as {r.label}
                </button>
              )}
            </Card>
          ))}
        </div>
      </div>

      {mode === 'demo' ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Demo mode:</strong> no Supabase environment variables were found, so the app is running on a deterministic seeded
          dataset stored in your browser. Every screen, rule and the AI query API work exactly as in cloud mode — see the README for
          the two-line switch to Supabase.
        </Card>
      ) : null}

      <Card className="p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Currently signed in as</h2>
        <p className="mt-1 text-slate-700">
          {actor.name} · <span className="font-semibold">{actor.role}</span>
        </p>
        <p className="mt-1 text-sm text-slate-500">Switch roles any time from the header selector.</p>
      </Card>
    </div>
  );
}

function NotFound() {
  return <EmptyState icon="🧭" title="Page not found" hint="Use the tabs above to get back to an operations screen." />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />

        {/* Technician: own queue and own history only */}
        <Route path="jobs" element={<RequireRole roles={['Technician']}><TechJobs /></RequireRole>} />
        <Route path="jobs/:orderNo" element={<RequireRole roles={['Technician']}><TechJobs /></RequireRole>} />
        <Route path="my-activity" element={<RequireRole roles={['Technician']}><MyActivity /></RequireRole>} />

        {/* Admin: order intake and assignment */}
        <Route path="orders" element={<RequireRole roles={['Admin', 'Manager']}><AdminOrders /></RequireRole>} />
        <Route path="orders/:orderNo" element={<RequireRole roles={['Admin', 'Manager', 'Technician']}><OrderDetail /></RequireRole>} />

        {/* Manager: review queue */}
        <Route path="review" element={<RequireRole roles={['Manager']}><ManagerReview /></RequireRole>} />

        {/* Management screens — not shown to technicians */}
        <Route path="dashboard" element={<RequireRole roles={['Admin', 'Manager']}><Dashboard /></RequireRole>} />
        <Route path="ai" element={<RequireRole roles={['Admin', 'Manager']}><AiQuery /></RequireRole>} />
        <Route path="activity" element={<RequireRole roles={['Admin', 'Manager']}><Activity /></RequireRole>} />

        <Route path="*" element={<NotFound />} />
        <Route path="home" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
