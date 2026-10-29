import React, { createContext, useEffect, useState } from 'react';
import type { Profile } from '../types';
import { DataService } from '../services/dataService';
import { isSupabaseConfigured, setRememberMePreference, supabase } from '../lib/supabase';
import { normalizePhoneNumber } from '../lib/phone';

export interface SignupProfile {
  name: string;
  mobile_number: string;
  date_of_birth: string;
}

interface AuthContextType {
  currentUser: Profile | null;
  isSupabase: boolean;
  demoAuthEnabled: boolean;
  loading: boolean;
  requestPhoneOtp: (phone: string, rememberMe: boolean, profile?: SignupProfile) => Promise<string>;
  verifyPhoneOtp: (phone: string, token: string, rememberMe: boolean, profile?: SignupProfile) => Promise<void>;
  continueWithoutOtp: (phone: string, profile?: SignupProfile) => Promise<void>;
  updateProfile: (data: {
    name: string;
    username: string;
    mobile_number: string;
    date_of_birth: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
export { useAuth } from './useAuth';

const validateProfile = (profile: SignupProfile): void => {
  const name = profile.name.trim();
  if (name.length < 2 || name.length > 100) {
    throw new Error('Full name must be between 2 and 100 characters.');
  }

  const birthDate = new Date(`${profile.date_of_birth}T00:00:00`);
  if (!profile.date_of_birth || Number.isNaN(birthDate.getTime())) {
    throw new Error('Enter a valid date of birth.');
  }
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) age -= 1;
  if (age < 13) throw new Error('You must be at least 13 years old to use Spider.');
  if (age > 120) throw new Error('Enter a valid date of birth.');
};

const createUsername = (name: string): string => {
  const nameSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'member';
  return `${nameSlug}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const isSupabase = isSupabaseConfigured();
  const demoAuthEnabled = import.meta.env.DEV && !isSupabase;

  useEffect(() => {
    let active = true;
    const syncUser = async (userId: string | null) => {
      if (!userId) {
        if (active) setCurrentUser(null);
        return;
      }
      try {
        const profile = await DataService.getProfileById(userId);
        if (active) setCurrentUser(profile);
      } catch (error) {
        console.error('Failed to load signed-in profile:', error);
        if (active) setCurrentUser(null);
      }
    };

    if (isSupabase && supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN') return;
        void syncUser(session?.user.id || null);
      });
      void supabase.auth.getSession()
        .then(({ data, error }) => {
          if (error) throw error;
          return syncUser(data.session?.user.id || null);
        })
        .catch((error: unknown) => {
          console.error('Could not restore the authentication session:', error);
          if (active) setCurrentUser(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
    }

    setCurrentUser(DataService.getCurrentUser());
    setLoading(false);
    return () => {
      active = false;
    };
  }, [isSupabase]);

  const requestPhoneOtp = async (phone: string, rememberMe: boolean, profile?: SignupProfile): Promise<string> => {
    if (!supabase) {
      throw new Error('Phone OTP sign-in requires a configured Supabase project with SMS authentication enabled.');
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    if (profile) validateProfile({ ...profile, mobile_number: normalizedPhone });
    setRememberMePreference(rememberMe);

    const { error } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: {
        shouldCreateUser: Boolean(profile),
        ...(profile
          ? {
              data: {
                name: profile.name.trim(),
                username: createUsername(profile.name),
                mobile_number: normalizedPhone,
                date_of_birth: profile.date_of_birth
              }
            }
          : {})
      }
    });
    if (error) throw error;
    return normalizedPhone;
  };

  const verifyPhoneOtp = async (
    phone: string,
    token: string,
    rememberMe: boolean,
    signupProfile?: SignupProfile
  ): Promise<void> => {
    if (!supabase) {
      throw new Error('Phone OTP sign-in requires a configured Supabase project with SMS authentication enabled.');
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    setRememberMePreference(rememberMe);
    const { data, error } = await supabase.auth.verifyOtp({
      phone: normalizedPhone,
      token: token.trim(),
      type: 'sms'
    });
    if (error) throw error;
    if (!data.user) throw new Error('OTP verification did not return an authenticated account.');

    let profile = await DataService.getProfileById(data.user.id);
    if (!profile && signupProfile) {
      validateProfile({ ...signupProfile, mobile_number: normalizedPhone });
      profile = await DataService.saveProfile({
        id: data.user.id,
        name: signupProfile.name.trim(),
        username: createUsername(signupProfile.name),
        mobile_number: normalizedPhone,
        date_of_birth: signupProfile.date_of_birth,
        created_at: data.user.created_at || new Date().toISOString()
      });
    }

    if (!profile) {
      await supabase.auth.signOut();
      throw new Error('No profile is registered for this phone number. Create an account first.');
    }
    setCurrentUser(profile);
  };

  const continueWithoutOtp = async (phone: string, signupProfile?: SignupProfile): Promise<void> => {
    if (!demoAuthEnabled || isSupabase) {
      throw new Error('OTP can only be skipped in local development demo mode.');
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    if (signupProfile) {
      validateProfile({ ...signupProfile, mobile_number: normalizedPhone });
      const profile = await DataService.saveProfile({
        id: crypto.randomUUID(),
        name: signupProfile.name.trim(),
        username: createUsername(signupProfile.name),
        mobile_number: normalizedPhone,
        date_of_birth: signupProfile.date_of_birth,
        created_at: new Date().toISOString()
      });
      setCurrentUser(profile);
      return;
    }

    const profile = DataService.getLocalProfileByPhone(normalizedPhone);
    if (!profile) throw new Error('No local demo account exists for this number. Choose Sign Up to create one.');
    DataService.setLocalActiveUser(profile.id);
    setCurrentUser(profile);
  };

  const updateProfile = async (data: {
    name: string;
    username: string;
    mobile_number: string;
    date_of_birth: string;
  }) => {
    if (!currentUser) throw new Error('You must be signed in to update your profile.');

    const normalizedData = {
      ...data,
      name: data.name.trim(),
      username: data.username.trim().toLowerCase(),
      mobile_number: data.mobile_number.trim()
    };
    validateProfile({ ...normalizedData });
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(normalizedData.username)) {
      throw new Error('Username must be 3 to 30 letters, numbers, or underscores.');
    }
    if (!/^[0-9+ -]{8,15}$/.test(normalizedData.mobile_number)) {
      throw new Error('Enter a valid mobile number.');
    }

    const savedProfile = await DataService.saveProfile({ ...currentUser, ...normalizedData });
    setCurrentUser(savedProfile);
  };

  const signOut = async () => {
    if (isSupabase && supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } else {
      DataService.clearActiveUser();
    }
    setCurrentUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isSupabase,
        demoAuthEnabled,
        loading,
        requestPhoneOtp,
        verifyPhoneOtp,
        continueWithoutOtp,
        updateProfile,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
