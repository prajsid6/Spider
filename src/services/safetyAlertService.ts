import { supabase } from '../lib/supabase';

const LOCAL_PREFERENCES_KEY = 'spider_safety_alert_preferences';
const SAFETY_PUSH_SW_URL = `${import.meta.env.BASE_URL}safety-push-sw.js`;
const APP_BASE_URL = new URL(import.meta.env.BASE_URL, window.location.origin).toString();

export interface SafetyPushEnrollment {
  enrolled: boolean;
}

export interface SafetyAlertPreferences {
  radiusMeters: number;
  recipientLimit: number;
}

export const DEFAULT_SAFETY_ALERT_PREFERENCES: SafetyAlertPreferences = {
  radiusMeters: 5000,
  recipientLimit: 25
};

const getSupabaseClient = () => {
  if (!supabase) {
    throw new Error('Nearby SOS alerts require a configured Supabase project and a signed-in account.');
  }
  return supabase;
};

const getApproximateLocation = async (): Promise<{ latitude: number; longitude: number }> => {
  if (!navigator.geolocation) {
    throw new Error('Location is not supported by this browser.');
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        reject(new Error(error.code === error.PERMISSION_DENIED
          ? 'Location permission is needed for nearby SOS alerts.'
          : 'Could not get your location. Please try again.'));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });

  return {
    latitude: Number(position.coords.latitude.toFixed(3)),
    longitude: Number(position.coords.longitude.toFixed(3))
  };
};

const decodeVapidKey = (value: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return new Uint8Array(bytes);
};

const invokeSafetyFunction = async <T>(body: Record<string, unknown>): Promise<T> => {
  const client = getSupabaseClient();
  const { data, error } = await client.functions.invoke<T>('safety-alert', { body });
  if (error) throw new Error(error.message || 'The safety alert service could not complete this request.');
  if (!data) throw new Error('The safety alert service returned no confirmation.');
  return data;
};

export const getSafetyAlertPreferences = async (): Promise<SafetyAlertPreferences> => {
  if (!supabase) {
    try {
      const saved = localStorage.getItem(LOCAL_PREFERENCES_KEY);
      return saved ? { ...DEFAULT_SAFETY_ALERT_PREFERENCES, ...JSON.parse(saved) } : DEFAULT_SAFETY_ALERT_PREFERENCES;
    } catch (error) {
      console.error('Could not read local SOS preferences.', error);
      return DEFAULT_SAFETY_ALERT_PREFERENCES;
    }
  }
  const result = await invokeSafetyFunction<{ radiusMeters: number; recipientLimit: number }>({
    action: 'get-preferences'
  });
  return result;
};

export const saveSafetyAlertPreferences = async (preferences: SafetyAlertPreferences): Promise<void> => {
  if (!Number.isInteger(preferences.radiusMeters) || preferences.radiusMeters < 500 || preferences.radiusMeters > 50000) {
    throw new Error('Choose a search radius between 500 metres and 50 kilometres.');
  }
  if (!Number.isInteger(preferences.recipientLimit) || preferences.recipientLimit < 1 || preferences.recipientLimit > 25) {
    throw new Error('Choose between 1 and 25 people to notify.');
  }
  if (!supabase) {
    localStorage.setItem(LOCAL_PREFERENCES_KEY, JSON.stringify(preferences));
    return;
  }
  await invokeSafetyFunction<{ saved: boolean }>({
    action: 'save-preferences',
    radiusMeters: preferences.radiusMeters,
    recipientLimit: preferences.recipientLimit
  });
};

export const enableNearbySafetyAlerts = async (): Promise<void> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Push alerts are not supported by this browser. Try an up-to-date browser on HTTPS.');
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    throw new Error('Nearby alerts are not configured yet. Add the VAPID public key and deploy the safety-alert function.');
  }

  const location = await getApproximateLocation();
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow browser notifications to receive nearby SOS alerts.');

  const registration = await navigator.serviceWorker.register(SAFETY_PUSH_SW_URL, {
    scope: import.meta.env.BASE_URL
  });
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(vapidPublicKey)
  });

  await invokeSafetyFunction({
    action: 'subscribe',
    subscription: subscription.toJSON(),
    ...location
  });
};

export const disableNearbySafetyAlerts = async (): Promise<void> => {
  const registration = await navigator.serviceWorker.getRegistration(APP_BASE_URL);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await invokeSafetyFunction({
    action: 'unsubscribe',
    endpoint: subscription.endpoint
  });
  await subscription.unsubscribe();
};

export const refreshNearbySafetyLocation = async (): Promise<void> => {
  const registration = await navigator.serviceWorker.getRegistration(APP_BASE_URL);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) throw new Error('Enable nearby safety alerts on this browser first.');

  const location = await getApproximateLocation();
  await invokeSafetyFunction({
    action: 'update-location',
    endpoint: subscription.endpoint,
    ...location
  });
};

export const triggerSafetySOS = async (locationAddress: string): Promise<{ recipients: number }> => {
  const sanitizedAddress = locationAddress.trim().replace(/\s+/g, ' ');
  if (sanitizedAddress.length < 3 || sanitizedAddress.length > 160) {
    throw new Error('Enter an address or nearby landmark between 3 and 160 characters.');
  }
  const location = await getApproximateLocation();
  return invokeSafetyFunction<{ recipients: number }>({
    action: 'trigger',
    locationAddress: sanitizedAddress,
    ...location
  });
};

export const isSafetyPushEnrolled = async (): Promise<boolean> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.getRegistration(APP_BASE_URL);
  return Boolean(await registration?.pushManager.getSubscription());
};
