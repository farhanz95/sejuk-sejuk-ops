import { useEffect, useState } from 'react';

/**
 * "Install app" — one tap to put the portal on the phone's home screen.
 *
 * Android/Chrome fires `beforeinstallprompt`; we hold that event and replay it
 * when the user taps. iOS never fires it, so Safari users get the two-step
 * instruction instead (Share → Add to Home Screen), which is the only way Apple
 * allows. Nothing is shown once the app is already running installed.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent) && !('MSStream' in window);
}

export function InstallAppButton({ className = '' }: { className?: string }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's own mini-infobar; we offer our own button
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || dismissed) return null;

  const ios = isIos();
  if (!promptEvent && !ios) return null; // nothing to offer on a desktop Firefox, say

  return (
    <>
      <button
        type="button"
        className={`btn-secondary !py-2 text-xs ${className}`}
        title="Install this portal on your phone"
        onClick={async () => {
          if (promptEvent) {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            if (choice.outcome === 'accepted') setInstalled(true);
            else setDismissed(true);
            setPromptEvent(null);
            return;
          }
          setShowIosHelp(true);
        }}
      >
        ⬇ Install app
      </button>

      {showIosHelp ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm md:items-center">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-800">Install on iPhone</h3>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-600">
              <li>
                Tap the <strong>Share</strong> button in Safari (the square with an arrow).
              </li>
              <li>
                Choose <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong>Add</strong> — the ❄️ Sejuk Sejuk icon appears like an app.
              </li>
            </ol>
            <button className="btn-primary mt-4 w-full" onClick={() => setShowIosHelp(false)}>
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
