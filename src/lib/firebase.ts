import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

/**
 * Firebase Authentication (Google) + the Supabase client used for the staff
 * tables.
 *
 * Sign-in is Google-only on purpose: the technician already has a Google account
 * on their phone, so after the first registration it is one tap — no password to
 * remember in the field, and nothing for us to store or leak. The access key is
 * only the *joining* step (see AuthState), which is why the key table never
 * travels to the browser except to claim a key.
 *
 * Both configs are public by design (a Firebase web config and a Supabase anon
 * key are shipped in every browser bundle); the data is protected by RLS and by
 * Firebase's domain allow-list.
 */
/**
 * Vite injects `import.meta.env` at build time, but the Node test runner never
 * defines it — and it only rewrites the LITERAL `import.meta.env`, not a dynamic
 * `env[key]` lookup. That mistake shipped a build with an empty Firebase config
 * (sign-in silently disabled) while every local test still passed, because tests
 * have no env either. So: one literal read, guarded for Node.
 */
const viteEnv = (typeof import.meta.env === 'undefined' ? undefined : import.meta.env) as
  | Record<string, string | undefined>
  | undefined;

const firebaseConfig = {
  apiKey: viteEnv?.VITE_FIREBASE_API_KEY,
  authDomain: viteEnv?.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: viteEnv?.VITE_FIREBASE_PROJECT_ID,
  appId: viteEnv?.VITE_FIREBASE_APP_ID,
  messagingSenderId: viteEnv?.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig as Record<string, string>);
  auth = getAuth(app);
  // Keep the account on this device: the technician should not have to sign in
  // again every morning.
  auth.useDeviceLanguage();
}

export const firebaseAuth = auth;

export function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

const supabaseUrl = viteEnv?.VITE_SUPABASE_URL;
const supabaseAnon = viteEnv?.VITE_SUPABASE_ANON_KEY;

/** Shared Supabase client for the staff/key tables (null in demo mode). */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnon ? createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } }) : null;

export const supabaseConfigured = Boolean(supabase);
