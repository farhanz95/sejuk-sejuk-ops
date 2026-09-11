/**
 * Role-based routing.
 *
 * Each role sees the screens it actually works in — a technician gets their own
 * job queue and their own history, not the company's revenue, the KPI
 * leaderboard of their colleagues, or an assistant that can answer questions
 * about everyone's jobs. Typing a URL directly is blocked here too, so hiding a
 * tab is never the only defence.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../state/AppState';
import type { Role } from '../lib/types';

/** Screens a role may open, mirroring the navigation it is shown. */
export const ROLE_SCREENS: Record<Role, string[]> = {
  Technician: ['/jobs', '/my-activity'],
  Admin: ['/orders', '/dashboard', '/ai', '/activity', '/staff'],
  Manager: ['/review', '/orders', '/dashboard', '/ai', '/activity'],
};

export function homeForRole(role: Role): string {
  if (role === 'Technician') return '/jobs';
  if (role === 'Manager') return '/review';
  return '/orders';
}

export function canOpen(role: Role, pathname: string): boolean {
  const allowed = ROLE_SCREENS[role] ?? [];
  return allowed.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Wraps a screen; sends the user to their own home screen instead of a 403 wall. */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { actor } = useApp();
  const location = useLocation();
  if (!roles.includes(actor.role) || !canOpen(actor.role, location.pathname)) {
    return <Navigate to={homeForRole(actor.role)} replace />;
  }
  return <>{children}</>;
}
