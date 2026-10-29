import React, { useState } from 'react';
import { AlertTriangle, LocateFixed, MapPin, Timer, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DataService } from '../services/dataService';
import type { HelpRequest } from '../types';

interface EmergencyHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (request: HelpRequest) => void;
  onRequireAuth: () => void;
}

export const EmergencyHelpModal: React.FC<EmergencyHelpModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onRequireAuth
}) => {
  const { currentUser } = useAuth();
  const [description, setDescription] = useState('');
  const [area, setArea] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!currentUser) {
      onRequireAuth();
      return;
    }

    const task = description.trim();
    const location = area.trim();
    if (task.length < 5) {
      setError('Describe the practical help you need (at least 5 characters).');
      return;
    }
    if (!location) {
      setError('Add your area or a nearby landmark so community members can find you.');
      return;
    }

    setLoading(true);
    try {
      const request = await DataService.createRequest(currentUser.id, {
        description: task,
        details: `Area / landmark: ${location}`,
        is_emergency: true,
        expires_at: new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
      });
      setDescription('');
      setArea('');
      onSuccess(request);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not alert the community. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUseCurrentLocation = () => {
    setError('');
    if (!navigator.geolocation) {
      setError('Current location is not supported by this browser. Enter your area or a nearby landmark instead.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setArea(`Current location (approx.): ${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`);
        setLocating(false);
      },
      (locationError) => {
        const message = locationError.code === locationError.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access in your browser or enter your area manually.'
          : locationError.code === locationError.TIMEOUT
            ? 'Could not get your location in time. Please try again or enter your area manually.'
            : 'Could not determine your location. Please try again or enter your area manually.';
        setError(message);
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="emergency-help-title"
        className="relative my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-rose-200 bg-white p-6 shadow-spider-lg sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close emergency help"
          className="absolute right-4 top-4 rounded-full p-2 text-spider-muted transition-colors hover:bg-spider-bg hover:text-spider-text"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-start gap-3 border-b border-spider-border pb-4 pr-8">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h2 id="emergency-help-title" className="text-xl font-black text-spider-text">Get urgent practical help</h2>
            <p className="mt-1 text-xs text-spider-muted">Alert the Spider community for a limited time. This is not a normal marketplace post.</p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <Timer className="mt-0.5 h-4 w-4 shrink-0" />
          <p>For immediate danger or a medical emergency, contact your local emergency services. This alert reaches people currently using Spider only.</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

          <div>
            <label htmlFor="emergency-task" className="mb-1.5 block text-xs font-bold text-spider-text">
              What practical help do you need right now?
            </label>
            <textarea
              id="emergency-task"
              required
              maxLength={1000}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="For example: I need help changing a flat tyre in the parking area."
              className="input-field resize-none text-sm"
            />
          </div>

          <div>
            <label htmlFor="emergency-area" className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-spider-text">
              <MapPin className="h-3.5 w-3.5 text-rose-600" />
              Your area or nearby landmark
            </label>
            <input
              id="emergency-area"
              required
              maxLength={160}
              value={area}
              onChange={(event) => setArea(event.target.value)}
              placeholder="For example: Indiranagar, near 100 Feet Road"
              className="input-field text-sm"
            />
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={locating}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-spider-border px-3 py-2 text-xs font-bold text-spider-text transition-colors hover:border-rose-300 hover:text-rose-700 disabled:cursor-wait disabled:opacity-60"
            >
              <LocateFixed className="h-3.5 w-3.5" />
              {locating ? 'Getting location...' : 'Use current location'}
            </button>
            <p className="mt-1 text-[11px] text-spider-muted">Your current location is rounded to approximately 100 metres and included in the alert. You can edit it or enter an area manually.</p>
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-bold text-spider-text">How long should this alert stay live?</legend>
            <div className="grid grid-cols-3 gap-2">
              {[10, 20, 30].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={durationMinutes === minutes}
                  onClick={() => setDurationMinutes(minutes)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${
                    durationMinutes === minutes
                      ? 'border-rose-500 bg-rose-50 text-rose-700 ring-2 ring-rose-200'
                      : 'border-spider-border bg-white text-spider-muted hover:border-rose-300 hover:text-spider-text'
                  }`}
                >
                  <span>{minutes} {minutes === 1 ? 'minute' : 'minutes'}</span>
                  <span className="mt-1 block text-xs font-black">₹{minutes * 5}</span>
                  {minutes === 20 && <span className="mt-0.5 block text-[10px] font-semibold">Default</span>}
                </button>
              ))}
            </div>
          </fieldset>

          <p className="text-[11px] text-spider-muted">
            Alerting as: <strong className="text-spider-text">{currentUser ? `${currentUser.name} (@${currentUser.username})` : 'Not signed in'}</strong>
          </p>

          <div className="flex justify-end gap-3 border-t border-spider-border pt-4">
            <button type="button" onClick={onClose} className="btn-outline px-4 py-2 text-xs">Cancel</button>
            <button
              type="submit"
              disabled={loading || description.trim().length < 5 || !area.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-black text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AlertTriangle className="h-4 w-4" />
              {loading ? 'Alerting...' : 'Alert community'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
