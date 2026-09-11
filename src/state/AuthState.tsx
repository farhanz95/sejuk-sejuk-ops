import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured, googleProvider, supabase, supabaseConfigured } from '../lib/firebase';
import { normalisePhone } from '../lib/domain';
import type { Role, Technician } from '../lib/types';

/**
 * Staff identity — whitelist, not keys.
 *
 * The admin registers an email address and/or a phone number in **Staff access**;
 * that registration is the invitation. Two ways in:
 *
 *  * **Login using email** — Google. The account is tied to the person on first
 *    sign-in, so it is one tap afterwards. An email nobody registered is refused.
 *  * **Login using phone number** — the first time, the person chooses a 4-digit
 *    PIN; after that it is number + PIN. No email needed. Five wrong PINs locks
 *    that number for 15 minutes (in the database, not the browser).
 *
 * Both paths are decided by the database (`staff_login_google` /
 * `staff_login_phone`), so revoking somebody takes effect immediately.
 */
export interface StaffProfile {
  uid: string;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
  role: Role;
  technician_name: string | null;
  phone: string | null;
  auth_provider: 'google' | 'phone' | 'anonymous';
  created_at: string;
  last_seen_at: string;
}

/** One row of the admin's whitelist. */
export interface DirectoryEntry {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  role: Role;
  technician_name: string | null;
  pin_set_at: string | null;
  locked_until: string | null;
  revoked_at: string | null;
  last_login_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PhoneStatus {
  found: boolean;
  needsPin: boolean;
  revoked: boolean;
  locked: boolean;
  displayName: string | null;
  role: Role | null;
}

export interface LoginResult {
  ok: boolean;
  reason: string;
}

interface AuthValue {
  authReady: boolean;
  configured: boolean;
  user: User | null;
  profile: StaffProfile | null;
  loadingProfile: boolean;
  signInWithGoogle: () => Promise<LoginResult>;
  phoneStatus: (phone: string) => Promise<PhoneStatus>;
  setPhonePin: (phone: string, pin: string) => Promise<LoginResult>;
  signInWithPhone: (phone: string, pin: string) => Promise<LoginResult>;
  signOutStaff: () => Promise<void>;
  // Admin
  listDirectory: () => Promise<DirectoryEntry[]>;
  addPerson: (input: {
    email?: string;
    phone?: string;
    displayName: string;
    role: Role;
    technician: Technician | '';
  }) => Promise<DirectoryEntry>;
  revokePerson: (id: string, revoked: boolean) => Promise<void>;
  deletePerson: (id: string) => Promise<void>;
  resetPin: (id: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function profileFor(user: User): Promise<StaffProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('staff_accounts').select('*').eq('uid', user.uid).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const seen = new Date(data.last_seen_at ?? 0).getTime();
  if (Date.now() - seen > 6 * 60 * 60 * 1000) {
    void supabase.from('staff_accounts').update({ last_seen_at: new Date().toISOString() }).eq('uid', user.uid);
  }
  return data as StaffProfile;
}

/** PostgREST says this when the SQL has not been run in the project yet. */
function setupHint(message: string): string {
  if (/could not find the function|PGRST202|does not exist/i.test(message)) {
    return 'Staff setup is not finished on the server yet — run supabase/staff_directory.sql in Supabase (see README).';
  }
  return message;
}

/** One row back from the login functions (PostgREST returns an array for a set). */
function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
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
        setProfile(null);
      } finally {
        setLoadingProfile(false);
      }
    });
  }, []);

  const signInWithGoogle = useCallback<AuthValue['signInWithGoogle']>(async () => {
    if (!firebaseAuth || !supabase) return { ok: false, reason: 'Sign-in is not configured in this build.' };
    const provider = googleProvider();
    let credential;
    try {
      credential = await signInWithPopup(firebaseAuth, provider);
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (code.includes('popup-blocked') || code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
        await signInWithRedirect(firebaseAuth, provider);
        return { ok: true, reason: '' };
      }
      return { ok: false, reason: err instanceof Error ? err.message : 'Google sign-in failed.' };
    }

    const gUser = credential.user;
    const { data, error } = await supabase.rpc('staff_login_google', {
      p_uid: gUser.uid,
      p_email: gUser.email,
      p_display_name: gUser.displayName,
    });
    if (error) {
      await signOut(firebaseAuth);
      return { ok: false, reason: setupHint(error.message) };
    }
    const row = firstRow<{ ok: boolean; reason: string }>(data);
    if (!row?.ok) {
      // Not on the whitelist (or revoked): do not leave a half-signed-in session.
      await signOut(firebaseAuth);
      return { ok: false, reason: row?.reason ?? 'That account is not registered.' };
    }
    setProfile(await profileFor(gUser));
    return { ok: true, reason: '' };
  }, []);

  const phoneStatus = useCallback<AuthValue['phoneStatus']>(async (phone) => {
    const empty: PhoneStatus = { found: false, needsPin: false, revoked: false, locked: false, displayName: null, role: null };
    if (!supabase || !phone.trim()) return empty;
    const { data, error } = await supabase.rpc('staff_phone_status', { p_phone: normalisePhone(phone) });
    if (error) return empty;
    const row = firstRow<{
      found: boolean;
      needs_pin: boolean;
      revoked: boolean;
      locked: boolean;
      display_name: string | null;
      role: Role | null;
    }>(data);
    if (!row) return empty;
    return {
      found: row.found,
      needsPin: row.needs_pin,
      revoked: row.revoked,
      locked: row.locked,
      displayName: row.display_name,
      role: row.role,
    };
  }, []);

  const setPhonePin = useCallback<AuthValue['setPhonePin']>(async (phone, pin) => {
    if (!supabase) return { ok: false, reason: 'Sign-in is not configured in this build.' };
    const { data, error } = await supabase.rpc('staff_set_phone_pin', { p_phone: normalisePhone(phone), p_pin: pin });
    if (error) return { ok: false, reason: setupHint(error.message) };
    const row = firstRow<{ ok: boolean; reason: string }>(data);
    return { ok: Boolean(row?.ok), reason: row?.reason ?? '' };
  }, []);

  const signInWithPhone = useCallback<AuthValue['signInWithPhone']>(
    async (phone, pin) => {
      if (!firebaseAuth || !supabase) return { ok: false, reason: 'Sign-in is not configured in this build.' };
      // The device needs an identity of its own for the session; the PIN is what
      // actually authorises it, and it works again on any device.
      let current = firebaseAuth.currentUser;
      if (!current) {
        try {
          current = (await signInAnonymously(firebaseAuth)).user;
        } catch (err) {
          return { ok: false, reason: err instanceof Error ? err.message : 'Could not start the session.' };
        }
      }
      const { data, error } = await supabase.rpc('staff_login_phone', {
        p_phone: normalisePhone(phone),
        p_pin: pin,
        p_uid: current.uid,
      });
      if (error) return { ok: false, reason: setupHint(error.message) };
      const row = firstRow<{ ok: boolean; reason: string }>(data);
      if (!row?.ok) return { ok: false, reason: row?.reason ?? 'That number and PIN did not match.' };
      setProfile(await profileFor(current));
      return { ok: true, reason: '' };
    },
    [],
  );

  const signOutStaff = useCallback(async () => {
    if (!firebaseAuth) return;
    await signOut(firebaseAuth);
    setProfile(null);
  }, []);

  const listDirectory = useCallback(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('staff_directory')
      .select('id, email, phone, display_name, role, technician_name, pin_set_at, locked_until, revoked_at, last_login_at, created_by, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DirectoryEntry[];
  }, []);

  const addPerson = useCallback<AuthValue['addPerson']>(
    async ({ email, phone, displayName, role, technician }) => {
      if (!supabase) throw new Error('Supabase is not configured in this build.');
      const { data, error } = await supabase
        .from('staff_directory')
        .insert({
          email: email?.trim().toLowerCase() || null,
          phone: phone ? normalisePhone(phone) : null,
          display_name: displayName.trim() || null,
          role,
          technician_name: role === 'Technician' ? technician || null : null,
          created_by: profile?.display_name ?? profile?.email ?? 'admin',
        })
        .select()
        .single();
      if (error) throw error;
      return data as DirectoryEntry;
    },
    [profile],
  );

  const revokePerson = useCallback(async (id: string, revoked: boolean) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('staff_directory')
      .update({ revoked_at: revoked ? new Date().toISOString() : null })
      .eq('id', id);
    if (error) throw error;
  }, []);

  const deletePerson = useCallback(async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from('staff_directory').delete().eq('id', id);
    if (error) throw error;
  }, []);

  const resetPin = useCallback(async (id: string) => {
    if (!supabase) return;
    // Clearing the PIN sends the person back to "choose a PIN" on their next login.
    const { error } = await supabase
      .from('staff_directory')
      .update({ pin_hash: null, pin_set_at: null, failed_attempts: 0, locked_until: null })
      .eq('id', id);
    if (error) throw error;
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      authReady,
      configured: firebaseConfigured && supabaseConfigured,
      user,
      profile,
      loadingProfile,
      signInWithGoogle,
      phoneStatus,
      setPhonePin,
      signInWithPhone,
      signOutStaff,
      listDirectory,
      addPerson,
      revokePerson,
      deletePerson,
      resetPin,
    }),
    [authReady, user, profile, loadingProfile, signInWithGoogle, phoneStatus, setPhonePin, signInWithPhone, signOutStaff, listDirectory, addPerson, revokePerson, deletePerson, resetPin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
