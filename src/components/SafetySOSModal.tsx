import React, { useState } from 'react';
import { AlertTriangle, MapPin, X } from 'lucide-react';

interface SafetySOSModalProps {
  isOpen: boolean;
  isSending: boolean;
  onClose: () => void;
  onSubmit: (locationAddress: string) => Promise<void>;
}

export const SafetySOSModal: React.FC<SafetySOSModalProps> = ({
  isOpen,
  isSending,
  onClose,
  onSubmit
}) => {
  const [locationAddress, setLocationAddress] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = locationAddress.trim().replace(/\s+/g, ' ');
    if (address.length < 3) {
      setError('Enter an address, area, or nearby landmark so people can find you.');
      return;
    }

    setError('');
    try {
      await onSubmit(address);
      setLocationAddress('');
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not send the SOS. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-sos-title"
        className="relative my-auto w-full max-w-md rounded-3xl border border-rose-200 bg-white p-6 shadow-spider-lg"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={isSending}
          aria-label="Close SOS"
          className="absolute right-4 top-4 rounded-full p-2 text-spider-muted transition-colors hover:bg-spider-bg hover:text-spider-text disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-start gap-3 border-b border-spider-border pb-4 pr-8">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h2 id="safety-sos-title" className="text-xl font-black text-spider-text">Send a safety SOS</h2>
            <p className="mt-1 text-xs text-spider-muted">Nearby opted-in people will receive your location.</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          For immediate danger or a medical emergency, contact your local emergency services. This SOS uses your current approximate location to find recipients and shares the address you enter below with them.
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 space-y-4">
          <label htmlFor="safety-sos-address" className="block text-xs font-bold text-spider-text">
            <span className="mb-1.5 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-rose-600" />
              Address, area, or nearby landmark
            </span>
            <input
              id="safety-sos-address"
              type="text"
              required
              minLength={3}
              maxLength={160}
              autoComplete="street-address"
              value={locationAddress}
              onChange={(event) => setLocationAddress(event.target.value)}
              placeholder="For example: Indiranagar, near 100 Feet Road"
              className="input-field text-sm"
              disabled={isSending}
            />
          </label>

          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-spider-border/60 pt-4">
            <button type="button" onClick={onClose} disabled={isSending} className="btn-outline px-4 py-2 text-xs font-bold disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={isSending || locationAddress.trim().length < 3} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-50">
              <AlertTriangle className="h-3.5 w-3.5" />
              {isSending ? 'Sending SOS...' : 'Send SOS'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
