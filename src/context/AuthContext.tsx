import React, { createContext, useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile as updateFirebaseProfile } from 'firebase/auth';
import type { Profile } from '../types';
import { DataService } from '../services/dataService';
import { auth, firestore, isFirebaseConfigured, setRememberMePreference } from '../lib/firebase';

export interface SignupProfile {
  name: string;
  date_of_birth: string;
}

interface AuthContextType {
  currentUser: Profile | null;
  isFirebase: boolean;
  demoAuthEnabled: boolean;
  loading: boolean;
  signInWithEmail: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  signUpWithEmail: (email: string, password: string, profile: SignupProfile, rememberMe: boolean) => Promise<boolean>;
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
  const isFirebase = isFirebaseConfigured();
  const demoAuthEnabled = import.meta.env.DEV && !isFirebase;

  useEffect(() => {
    let active = true;
    if (isFirebase && auth) {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          if (active) setCurrentUser(null);
          if (active) setLoading(false);
          return;
        }
        try {
          const profile = await DataService.getProfileById(user.uid);
          if (active) setCurrentUser(profile);
        } catch (error) {
          console.error('Failed to load signed-in Firebase profile:', error);
          if (active) setCurrentUser(null);
        } finally {
          if (active) setLoading(false);
        }
      });

      return () => {
        active = false;
        unsubscribe();
      };
    }

    setCurrentUser(DataService.getCurrentUser());
    setLoading(false);
    return () => {
      active = false;
    };
  }, [isFirebase]);

  const syncSignedInUser = async (userId: string): Promise<Profile> => {
    const profile = await DataService.getProfileById(userId);
    if (!profile) {
      if (auth?.currentUser) await firebaseSignOut(auth);
      throw new Error('No profile is registered for this account. Contact support.');
    }
    setCurrentUser(profile);
    return profile;
  };

  const signInWithEmail = async (email: string, password: string, rememberMe: boolean): Promise<void> => {
    const normalizedEmail = email.trim().toLowerCase();
    await setRememberMePreference(rememberMe);

    if (demoAuthEnabled) {
      if (!await DataService.verifyLocalEmailPassword(normalizedEmail, password)) {
        throw new Error('Incorrect email or password.');
      }
      const profile = DataService.getLocalProfileByEmail(normalizedEmail);
      if (!profile) throw new Error('The local account profile could not be found.');
      DataService.setLocalActiveUser(profile.id);
      setCurrentUser(profile);
      return;
    }
    if (!auth) throw new Error('Email sign-in requires a configured Firebase project.');

    const { user } = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    if (!user.emailVerified) {
      try {
        await sendEmailVerification(user, { url: window.location.origin });
      } finally {
        await firebaseSignOut(auth);
      }
      throw new Error('Confirm your email with the verification link we sent before signing in.');
    }
    await syncSignedInUser(user.uid);
  };

  const signUpWithEmail = async (
    email: string,
    password: string,
    signupProfile: SignupProfile,
    rememberMe: boolean
  ): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase();
    validateProfile(signupProfile);
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    await setRememberMePreference(rememberMe);

    const profileData = {
      name: signupProfile.name.trim(),
      username: createUsername(signupProfile.name),
      mobile_number: '',
      date_of_birth: signupProfile.date_of_birth
    };

    if (demoAuthEnabled) {
      if (DataService.getLocalProfileByEmail(normalizedEmail)) {
        throw new Error('An account already exists for this email.');
      }
      const profile = await DataService.saveProfile({
        id: crypto.randomUUID(),
        ...profileData,
        email: normalizedEmail,
        created_at: new Date().toISOString()
      });
      await DataService.saveLocalEmailPassword(normalizedEmail, password);
      setCurrentUser(profile);
      return true;
    }
    if (!auth || !firestore) throw new Error('Email sign-up requires a configured Firebase project.');

    const { user } = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    try {
      await updateFirebaseProfile(user, { displayName: profileData.name });
      await DataService.saveProfile({
        id: user.uid,
        ...profileData,
        email: user.email || normalizedEmail,
        created_at: user.metadata.creationTime || new Date().toISOString()
      });
      await sendEmailVerification(user, { url: window.location.origin });
      await firebaseSignOut(auth);
    } catch (error) {
      await firebaseSignOut(auth);
      throw error;
    }
    return false;
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
    if (normalizedData.mobile_number && !/^[0-9+ -]{8,15}$/.test(normalizedData.mobile_number)) {
      throw new Error('Enter a valid mobile number.');
    }

    const savedProfile = await DataService.saveProfile({ ...currentUser, ...normalizedData });
    setCurrentUser(savedProfile);
  };

  const signOut = async () => {
    if (isFirebase && auth) {
      await firebaseSignOut(auth);
    } else {
      DataService.clearActiveUser();
    }
    setCurrentUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isFirebase,
        demoAuthEnabled,
        loading,
        signInWithEmail,
        signUpWithEmail,
        updateProfile,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
