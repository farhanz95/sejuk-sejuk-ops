import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured, googleProvider, supabase, supabaseConfigured } from '../lib/firebase';
import type { Role, Technician } from '../lib/types';

/**
 * Staff identity.
 *
 * Two ways in, deliberately:
 *  1. **Google sign-in** (real use). First time, the technician also needs an
 *     access key an admin created for them — that is what stops any Google
 *     account from reading the operations data. The key is used once; afterwards
 *     Google alone is enough, because Google remembers the account on the phone.
 *  2. **Demo mode** (reviewers, training, offline). The role switch stays, so the
 *     app can be explored without a Firebase account — this is stated on the
 *     sign-in screen rather than hidden.
 */
export interface StaffProfile {
  uid: string;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
  role: Role;
  technician_name: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface JoinKey {
  /** sha256 of the code — what the database stores (the code itself is never kept) */
  code_hash: string;
  /** present ONLY on the response that created the key: the one chance to copy it */
  code?: string;
  role: Role;
  technician_name: string | null;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  used_at: string | null;
  used_by_email: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ClaimResult {
  ok: boolean;
  reason: string;
  role?: Role;
  technician_name?: string | null;
}

interface AuthValue {
  /** true when a Firebase project is configured in this build */
  authReady: boolean;
  configured: boolean;
  user: User | null;
  profile: StaffProfile | null;
  loadingProfile: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutStaff: () => Promise<void>;
  /** First-time join: claims an admin-issued key and records the account. */
  claimKey: (input: { code: string; technician: Technician | ''; displayName: string }) => Promise<ClaimResult>;
  /** Admin: manage the keys. */
  listKeys: () => Promise<JoinKey[]>;
  createKey: (input: { role: Role; technician: Technician | ''; label: string; expiresInDays: number | null }) => Promise<JoinKey>;
  revokeKey: (codeHash: string) => Promise<void>;
  deleteKey: (codeHash: string) => Promise<void>;
  listStaff: () => Promise<StaffProfile[]>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * The database only ever stores this hash, so a leaked table row is useless: the
 * code exists on the admin's screen (once) and in the technician's message.
 * Uppercased and trimmed, matching claim_join_key().
 */
export async function hashKey(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code.trim().toUpperCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Keys look like SS-7F3K-9Q2M: unambiguous to read out over the phone. */
export function generateKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const block = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `SS-${block()}-${block()}`;
}

async function profileFor(user: User): Promise<StaffProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('staff_accounts').select('*').eq('uid', user.uid).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Keep "last seen" roughly current without a write on every render.
  const seen = new Date(data.last_seen_at ?? 0).getTime();
  if (Date.now() - seen > 6 * 60 * 60 * 1000) {
    void supabase.from('staff_accounts').update({ last_seen_at: new Date().toISOString() }).eq('uid', user.uid);
  }
  return data as StaffProfile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, async (next) => {
      setUser(next);
      setAuthReady(true);
      if (!next) {
        setProfile(null);
        return;
      }
      setLoadingProfile(true);
      try {
        setProfile(await profileFor(next));
      } catch {
        setProfile(null); // no row yet → the UI sends them to the key step
      } finally {
        setLoadingProfile(false);
      }
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!firebaseAuth) throw new Error('Firebase is not configured in this build.');
    const provider = googleProvider();
    try {
      await signInWithPopup(firebaseAuth, provider);
    } catch (err) {
      // Popups are blocked in some in-app browsers (WhatsApp/Instagram); fall back
      // to a full-page redirect rather than leaving the technician stuck.
      const code = (err as { code?: string }).code ?? '';
      if (code.includes('popup-blocked') || code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
        await signInWithRedirect(firebaseAuth, provider);
        return;
      }
      throw err;
    }
  }, []);

  const signOutStaff = useCallback(async () => {
    if (!firebaseAuth) return;
    await signOut(firebaseAuth);
    setProfile(null);
  }, []);

  const claimKey = useCallback<AuthValue['claimKey']>(
    async ({ code, technician, displayName }) => {
      if (!supabase || !user) return { ok: false, reason: 'Sign in with Google first, then enter the key.' };
      const { data, error } = await supabase.rpc('claim_join_key', {
        p_code: code.trim().toUpperCase(),
        p_uid: user.uid,
        p_email: user.email,
        p_display_name: displayName || user.displayName || '',
        p_technician: technician || null,
      });
      if (error) return { ok: false, reason: error.message };
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.ok) return { ok: false, reason: row?.reason ?? 'That key could not be used.' };
      setProfile(await profileFor(user));
      return { ok: true, reason: row.reason, role: row.role, technician_name: row.technician_name };
    },
    [user],
  );

  const listKeys = useCallback(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('join_keys')
      .select('code_hash, role, technician_name, label, expires_at, revoked_at, used_at, used_by_email, created_by, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as JoinKey[];
  }, []);

  const createKey = useCallback<AuthValue['createKey']>(
    async ({ role, technician, label, expiresInDays }) => {
      if (!supabase) throw new Error('Supabase is not configured in this build.');
      const code = generateKey();
      const code_hash = await hashKey(code);
      const expires_at =
        expiresInDays && expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null;
      const { data, error } = await supabase
        .from('join_keys')
        .insert({
          code_hash,
          role,
          technician_name: technician || null,
          label: label || null,
          expires_at,
          created_by: profile?.display_name ?? profile?.email ?? 'admin',
        })
        .select()
        .single();
      if (error) throw error;
      // Hand the plain code back once, for this screen only.
      return { ...(data as JoinKey), code };
    },
    [profile],
  );

  const revokeKey = useCallback(async (code_hash: string) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('join_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('code_hash', code_hash);
    if (error) throw error;
  }, []);

  const deleteKey = useCallback(async (code_hash: string) => {
    if (!supabase) return;
    const { error } = await supabase.from('join_keys').delete().eq('code_hash', code_hash);
    if (error) throw error;
  }, []);

  const listStaff = useCallback(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from('staff_accounts').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as StaffProfile[];
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    setProfile(await profileFor(user));
  }, [user]);

  const value = useMemo<AuthValue>(
    () => ({
      authReady,
      configured: firebaseConfigured && supabaseConfigured,
      user,
      profile,
      loadingProfile,
      signInWithGoogle,
      signOutStaff,
      claimKey,
      listKeys,
      createKey,
      revokeKey,
      deleteKey,
      listStaff,
      refreshProfile,
    }),
    [authReady, user, profile, loadingProfile, signInWithGoogle, signOutStaff, claimKey, listKeys, createKey, revokeKey, deleteKey, listStaff, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
