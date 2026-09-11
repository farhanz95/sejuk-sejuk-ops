/**
 * Modal back-button handling (same behaviour as DuitBox).
 *
 * Android's back button is a *history* gesture, and a modal is not a route — so
 * without this, pressing back with a dialog open leaves the app (or jumps to
 * wherever you came from) instead of closing the dialog. Here each open modal
 * pushes a history entry; pressing back pops that entry and closes the top-most
 * modal, so back always means "one level up from what you see".
 *
 * Closing a modal with a button (rather than back) walks the entry off again, so
 * the history never grows stale — the invariant is: open modals == pushed entries.
 */
type Closer = () => void;

const stack: Closer[] = [];
let listening = false;

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', () => {
    // Back was pressed: close one modal and stop there (the router may also see
    // this event, but the URL has not changed, so no navigation happens).
    const close = stack.pop();
    if (close) close();
  });
}

/** Called by Modal while it is open. Returns the cleanup used when it closes. */
export function registerModal(close: Closer): () => void {
  if (typeof window === 'undefined') return () => {};
  ensureListener();
  stack.push(close);
  try {
    history.pushState({ ssModal: stack.length }, '');
  } catch {
    /* history is unavailable (very old browser) — the modal still works by button */
  }

  let released = false;
  return () => {
    if (released) return; // React can run cleanup twice under StrictMode
    released = true;
    const index = stack.lastIndexOf(close);
    if (index === -1) return; // already closed by the back gesture
    stack.splice(index, 1);
    // Take our own history entry back off, without triggering the popstate
    // handler above (it would close the next modal down).
    try {
      history.back();
    } catch {
      /* ignore */
    }
  };
}

/** How many modals are currently open — handy for tests. */
export function openModalCount(): number {
  return stack.length;
}
