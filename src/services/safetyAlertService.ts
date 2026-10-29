import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

export interface SafetyAlertPreferences {
  radiusMeters: number;
  recipientLimit: number;
}

interface SafetyAlertResponse {
  saved?: boolean;
  removed?: boolean;
  requestId?: string;
  recipients?: number;
  recipientLimit?: number;
  radiusMeters?: number;
}

export const DEFAULT_SAFETY_ALERT_PREFERENCES: SafetyAlertPreferences = {
  radiusMeters: 5000,
  recipientLimit: 25
};

const PREFERENCES_KEY = 'spider_safety_alert_preferences';

const getLocalPreferences = (): SafetyAlertPreferences => {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (!saved) return DEFAULT_SAFETY_ALERT_PREFERENCES;
    const preferences = JSON.parse(saved) as Partial<SafetyAlertPreferences>;
    return {
      radiusMeters: preferences.radiusMeters ?? DEFAULT_SAFETY_ALERT_PREFERENCES.radiusMeters,
      recipientLimit: preferences.recipientLimit ?? DEFAULT_SAFETY_ALERT_PREFERENCES.recipientLimit
    };
  } catch (error) {
    console.error('Could not read local SOS preferences.', error);
    return DEFAULT_SAFETY_ALERT_PREFERENCES;
  }
};

const callSafetyAlert = async (
  payload: Record<string, unknown>
): Promise<SafetyAlertResponse> => {
  if (!functions) throw new Error('SOS features require a configured Firebase project and deployed Cloud Functions.');
  const response = await httpsCallable<Record<string, unknown>, SafetyAlertResponse>(functions, 'safetyAlert')(payload);
  return response.data;
};

const getApproximateLocation = async (): Promise<{ latitude: number; longitude: number }> => {
  if (!navigator.geolocation) throw new Error('Location is not available in this browser.');
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 60000
    });
  });
  return {
    latitude: Number(position.coords.latitude.toFixed(3)),
    longitude: Number(position.coords.longitude.toFixed(3))
  };
};

const decodeVapidKey = (key: string): ArrayBuffer => {
  const padded = key + '='.repeat((4 - key.length % 4) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  new Uint8Array(buffer).set(Array.from(raw, (character) => character.charCodeAt(0)));
  return buffer;
};

export const getSafetyAlertPreferences = async (): Promise<SafetyAlertPreferences> => {
  if (!functions) return getLocalPreferences();
  const preferences = await callSafetyAlert({ action: 'get-preferences' });
  if (
    typeof preferences.radiusMeters !== 'number' ||
    typeof preferences.recipientLimit !== 'number'
  ) throw new Error('Firebase returned invalid SOS preferences.');
  return { radiusMeters: preferences.radiusMeters, recipientLimit: preferences.recipientLimit };
};

export const saveSafetyAlertPreferences = async (preferences: SafetyAlertPreferences): Promise<void> => {
  if (
    !Number.isInteger(preferences.radiusMeters) ||
    preferences.radiusMeters < 500 ||
    preferences.radiusMeters > 50000 ||
    !Number.isInteger(preferences.recipientLimit) ||
    preferences.recipientLimit < 1 ||
    preferences.recipientLimit > 25
  ) throw new Error('Choose a radius between 500 m and 50 km and a recipient limit from 1 to 25.');

  if (!functions) {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      return;
    } catch (error) {
      console.error('Could not save local SOS preferences.', error);
      throw new Error('Could not save SOS preferences in this browser.');
    }
  }
  const result = await callSafetyAlert({ action: 'save-preferences', ...preferences });
  if (result.saved !== true) throw new Error('Firebase did not confirm the SOS preferences update.');
};

export const isSafetyPushEnrolled = async (): Promise<boolean> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.getRegistration('/safety-push-sw.js');
  if (!registration) return false;
  return Boolean(await registration.pushManager.getSubscription());
};

export const enableNearbySafetyAlerts = async (): Promise<void> => {
  if (!functions) throw new Error('Nearby SOS alerts require Firebase Cloud Functions to be configured and deployed.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Push alerts are not supported in this browser.');
  }
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) throw new Error('Set VITE_VAPID_PUBLIC_KEY to the Firebase push VAPID public key.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow browser notifications to enable nearby SOS alerts.');
  const registration = await navigator.serviceWorker.register('/safety-push-sw.js');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(vapidPublicKey)
  });
  const location = await getApproximateLocation();
  const result = await callSafetyAlert({
    action: 'subscribe',
    subscription: subscription.toJSON(),
    ...location
  });
  if (result.saved !== true) throw new Error('Firebase did not confirm this browser subscription.');
};

export const refreshNearbySafetyLocation = async (): Promise<void> => {
  if (!functions) throw new Error('Nearby SOS alerts require Firebase Cloud Functions to be configured and deployed.');
  const registration = await navigator.serviceWorker.getRegistration('/safety-push-sw.js');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) throw new Error('Enable nearby alerts on this browser before refreshing its location.');
  const location = await getApproximateLocation();
  const result = await callSafetyAlert({
    action: 'update-location',
    endpoint: subscription.endpoint,
    ...location
  });
  if (result.saved !== true) throw new Error('Firebase did not confirm the location update.');
};

export const disableNearbySafetyAlerts = async (): Promise<void> => {
  const registration = await navigator.serviceWorker.getRegistration('/safety-push-sw.js');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  if (functions) {
    const result = await callSafetyAlert({ action: 'unsubscribe', endpoint: subscription.endpoint });
    if (result.removed !== true) throw new Error('Firebase did not confirm the alert subscription removal.');
  }
  await subscription.unsubscribe();
};

export const triggerSafetySOS = async (
  locationAddress: string
): Promise<{ recipients: number }> => {
  const location = await getApproximateLocation();
  const result = await callSafetyAlert({ action: 'trigger', locationAddress, ...location });
  if (typeof result.recipients !== 'number') throw new Error('Firebase returned an invalid SOS delivery result.');
  return { recipients: result.recipients };
};
