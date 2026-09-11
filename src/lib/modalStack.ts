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
/**
 * Releases of our own history entries fire `popstate` too. Without this counter the
 * handler treated that as "the user pressed back" and closed the next modal down —
 * so with two dialogs open (the order form and the document reader inside it),
 * a state change in the lower one would shut the upper one. Any release we perform
 * ourselves increments this, and the next event is ignored.
 */
let selfReleases = 0;

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', () => {
    // Was that event our own cleanup walking an entry off? Then it is not a back
    // gesture and no dialog should close.
    if (selfReleases > 0) {
      selfReleases -= 1;
      return;
    }
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
    // Take our own history entry back off. The popstate this fires is accounted for
    // by `selfReleases`, so it can never close a dialog that is still on screen.
    try {
      selfReleases += 1;
      history.back();
    } catch {
      selfReleases -= 1;
    }
  };
}

/** How many modals are currently open — handy for tests. */
export function openModalCount(): number {
  return stack.length;
}
