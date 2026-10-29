import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const AUTH_STORAGE_KEY = supabaseUrl
  ? `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  : 'spider-auth-token';
const REMEMBER_ME_KEY = 'spider_auth_remember_me';

const authStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const rememberMe = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
    if (rememberMe) return localStorage.getItem(key);

    const sessionValue = sessionStorage.getItem(key);
    if (sessionValue) return sessionValue;

    // Move existing Supabase local-storage sessions to session storage by default.
    const previousValue = localStorage.getItem(key);
    if (previousValue) {
      sessionStorage.setItem(key, previousValue);
      localStorage.removeItem(key);
    }
    return previousValue;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (localStorage.getItem(REMEMBER_ME_KEY) === 'true') {
      localStorage.setItem(key, value);
    } else {
      sessionStorage.setItem(key, value);
      localStorage.removeItem(key);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    if (key === AUTH_STORAGE_KEY) localStorage.removeItem(REMEMBER_ME_KEY);
  }
};

export const setRememberMePreference = (rememberMe: boolean): void => {
  const existingSession = localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY);
  localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? 'true' : 'false');
  if (!existingSession) return;

  if (rememberMe) {
    localStorage.setItem(AUTH_STORAGE_KEY, existingSession);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } else {
    sessionStorage.setItem(AUTH_STORAGE_KEY, existingSession);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
};

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://') &&
    supabaseAnonKey.length > 20
  );
};

export const supabase = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: authStorage,
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;
