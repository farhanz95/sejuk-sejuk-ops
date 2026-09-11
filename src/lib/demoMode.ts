/**
 * Demo mode — the review/offline path with no account.
 *
 * It has to be explicitly entered (the sign-in screen offers it) and, just as
 * importantly, explicitly left: it used to be a one-way door, because the flag
 * lives in localStorage and the sign-in screen was never shown again. The header
 * now carries an "Exit demo" action whenever the flag is set.
 */
export const DEMO_FLAG = 'ss_demo_mode';

export function isDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG) === '1';
  } catch {
    return false;
  }
}

export function enterDemoMode(): void {
  try {
    localStorage.setItem(DEMO_FLAG, '1');
  } catch {
    /* private mode: the app still works, it just will not remember */
  }
}

/** Leave demo mode and return to the sign-in screen. */
export function exitDemoMode(): void {
  try {
    localStorage.removeItem(DEMO_FLAG);
  } catch {
    /* ignore */
  }
  // A reload is deliberate: it drops the demo actor and the seeded dataset from
  // memory, so nothing from the demo session leaks into a real sign-in.
  window.location.assign('/');
}
