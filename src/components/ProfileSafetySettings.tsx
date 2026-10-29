import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bell, BellOff, LocateFixed, Save } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { isFirebaseConfigured } from '../lib/firebase';
import {
  DEFAULT_SAFETY_ALERT_PREFERENCES,
  disableNearbySafetyAlerts,
  enableNearbySafetyAlerts,
  getSafetyAlertPreferences,
  isSafetyPushEnrolled,
  refreshNearbySafetyLocation,
  saveSafetyAlertPreferences,
  type SafetyAlertPreferences
} from '../services/safetyAlertService';

const DISTANCE_OPTIONS = [
  { meters: 500, label: '500 m' },
  { meters: 1000, label: '1 km' },
  { meters: 2000, label: '2 km' },
  { meters: 5000, label: '5 km' },
  { meters: 10000, label: '10 km' },
  { meters: 25000, label: '25 km' },
  { meters: 50000, label: '50 km' }
];

export const ProfileSafetySettings: React.FC = () => {
  const { showToast } = useToast();
  const [preferences, setPreferences] = useState<SafetyAlertPreferences>(DEFAULT_SAFETY_ALERT_PREFERENCES);
  const [enrolled, setEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const backendConfigured = isFirebaseConfigured();

  useEffect(() => {
    let active = true;
    Promise.all([getSafetyAlertPreferences(), isSafetyPushEnrolled()])
      .then(([savedPreferences, isEnrolled]) => {
        if (!active) return;
        setPreferences(savedPreferences);
        setEnrolled(isEnrolled);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load safety preferences.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const runAction = async (action: () => Promise<void>, successMessage: string) => {
    setBusy(true);
    setError('');
    try {
      await action();
      showToast(successMessage, 'success');
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Safety settings could not be updated.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => runAction(
    () => saveSafetyAlertPreferences(preferences),
    'SOS delivery preferences saved.'
  );

  const handleEnable = () => runAction(async () => {
    await enableNearbySafetyAlerts();
    setEnrolled(true);
  }, 'Nearby SOS push alerts are enabled on this browser.');

  const handleDisable = () => runAction(async () => {
    await disableNearbySafetyAlerts();
    setEnrolled(false);
  }, 'Nearby SOS push alerts are disabled on this browser.');

  const handleRefreshLocation = () => runAction(
    refreshNearbySafetyLocation,
    'Your approximate recipient location was updated.'
  );

  return (
    <section aria-labelledby="profile-safety-heading" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
        <div>
          <h3 id="profile-safety-heading" className="text-sm font-extrabold text-rose-800">Safety & SOS alerts</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-spider-muted">
            Choose the maximum distance and number of nearby people to notify when you trigger SOS. Delivery is limited to opted-in users and is not guaranteed.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-spider-text">
          Search radius
          <select
            aria-label="SOS recipient search radius"
            className="mt-1 w-full rounded-lg border border-spider-border bg-white px-3 py-2 text-sm font-medium"
            value={preferences.radiusMeters}
            disabled={loading || busy}
            onChange={(event) => setPreferences({ ...preferences, radiusMeters: Number(event.target.value) })}
          >
            {DISTANCE_OPTIONS.map((option) => (
              <option key={option.meters} value={option.meters}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-spider-text">
          Maximum people to notify
          <select
            aria-label="Maximum SOS push recipients"
            className="mt-1 w-full rounded-lg border border-spider-border bg-white px-3 py-2 text-sm font-medium"
            value={preferences.recipientLimit}
            disabled={loading || busy}
            onChange={(event) => setPreferences({ ...preferences, recipientLimit: Number(event.target.value) })}
          >
            {[1, 5, 10, 15, 20, 25].map((count) => (
              <option key={count} value={count}>{count} {count === 1 ? 'person' : 'people'}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-spider-primary px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {busy ? 'Saving...' : 'Save preferences'}
        </button>
        {enrolled ? (
          <>
            <button type="button" onClick={handleRefreshLocation} disabled={loading || busy} className="inline-flex items-center gap-1.5 rounded-lg border border-spider-border bg-white px-3 py-2 text-xs font-bold text-spider-text disabled:opacity-50">
              <LocateFixed className="h-3.5 w-3.5" />
              Update location
            </button>
            <button type="button" onClick={handleDisable} disabled={loading || busy} className="inline-flex items-center gap-1.5 rounded-lg border border-spider-border bg-white px-3 py-2 text-xs font-bold text-spider-text disabled:opacity-50">
              <BellOff className="h-3.5 w-3.5" />
              Disable alerts
            </button>
          </>
        ) : (
          <button type="button" onClick={handleEnable} disabled={loading || busy || !backendConfigured} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">
            <Bell className="h-3.5 w-3.5" />
            Enable nearby alerts
          </button>
        )}
      </div>
      {loading && <p className="mt-2 text-[11px] text-spider-muted">Loading safety settings...</p>}
      {error && <p role="alert" className="mt-2 text-[11px] font-medium text-red-700">{error}</p>}
      {!backendConfigured && <p className="mt-2 text-[11px] font-medium text-amber-800">Push alerts require Firebase Cloud Functions and Firebase Cloud Messaging setup. Preferences are saved on this browser in demo mode.</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-spider-muted">
        Enabling alerts stores your approximate location on this browser until you disable them. Your selected radius and limit apply only to SOS alerts you send.
      </p>
    </section>
  );
};
