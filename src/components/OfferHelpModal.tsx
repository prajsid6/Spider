import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { DataService } from '../services/dataService';
import type { HelpRequest, HelpOffer } from '../types';
import { X, IndianRupee, ShieldCheck, AlertCircle, MapPin, Video } from 'lucide-react';

interface OfferHelpModalProps {
  request: HelpRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newOffer: HelpOffer) => void;
  onRequireAuth: () => void;
}

interface InnerProps {
  request: HelpRequest;
  onClose: () => void;
  onSuccess: (newOffer: HelpOffer) => void;
  onRequireAuth: () => void;
}

const OfferHelpModalInner: React.FC<InnerProps> = ({
  request,
  onClose,
  onSuccess,
  onRequireAuth
}) => {
  const { currentUser } = useAuth();
  const [message, setMessage] = useState('');
  const [priceInr, setPriceInr] = useState<string>(
    request.budget_inr != null ? request.budget_inr.toString() : ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentUser) {
      onRequireAuth();
      return;
    }

    if (currentUser.id === request.requester_id) {
      setError('You cannot submit an offer on your own request.');
      return;
    }

    const trimmedMsg = message.trim();
    if (trimmedMsg.length < 3) {
      setError('Please provide a message of at least 3 characters explaining how you can help.');
      return;
    }

    const parsedPrice = priceInr ? parseFloat(priceInr) : undefined;
    if (parsedPrice !== undefined && (isNaN(parsedPrice) || parsedPrice < 0)) {
      setError('Proposed price must be a valid non-negative number.');
      return;
    }

    setLoading(true);
    try {
      const offer = await DataService.createOffer(currentUser.id, {
        request_id: request.id,
        message: trimmedMsg,
        proposed_price_inr: parsedPrice
      });
      onSuccess(offer);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit offer. You might have already submitted one.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-spider-text/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-spider-lg border border-spider-border p-6 sm:p-7 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-spider-border/60">
          <div>
            <h2 className="text-xl font-extrabold text-spider-text">
              Offer Your Help
            </h2>
            <p className="text-xs text-spider-muted mt-0.5">
              {request.is_emergency
                ? 'Reply quickly with how and when you can help. Your price is optional.'
                : 'Pitch your skills, availability, and proposed price.'}
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close form"
            aria-label="Close form"
            className="p-1.5 rounded-full text-spider-muted hover:text-spider-text hover:bg-spider-lavender transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Target Request Summary */}
        <div className="mt-4 p-3.5 rounded-2xl bg-spider-soft border border-spider-border/70">
          <p className="text-[11px] font-bold text-spider-muted uppercase tracking-wider mb-1">
            Request:
          </p>
          <p className="text-xs font-bold text-spider-text line-clamp-2">
            {request.description}
          </p>
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-spider-muted">
            {request.connection_mode === 'in_person' ? <MapPin className="h-3 w-3" /> : <Video className="h-3 w-3" />}
            {request.connection_mode === 'in_person' ? 'Meet in person' : 'Virtual · In-app call'}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-spider-muted">
              By @{request.requester?.username || 'user'}
            </span>
            <span className="font-extrabold text-spider-deep flex items-center">
              Budget: <IndianRupee className="w-3 h-3 ml-1 stroke-[2.5]" />
              {request.budget_inr != null ? Number(request.budget_inr).toLocaleString('en-IN') : 'Negotiable'}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-spider-text block mb-1.5">
              Your Proposed Price in INR (₹)
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-spider-primary">
                <IndianRupee className="w-4 h-4 stroke-[2.5]" />
              </div>
              <input
                type="number"
                min="0"
                step="50"
                placeholder="e.g. 1000"
                value={priceInr}
                onChange={(e) => setPriceInr(e.target.value)}
                className="input-field pl-9 text-sm"
              />
            </div>
            <p className="text-[11px] text-spider-muted mt-1">
              You can accept their budget or propose a custom rate based on effort.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-spider-text">
                Your Message / Availability <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-spider-muted">
                {message.length}/2000
              </span>
            </div>
            <textarea
              required
              rows={3}
              maxLength={2000}
              placeholder="e.g. Hi! I live nearby and have experience with this. I can come over tomorrow at 10 AM..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="input-field text-sm"
            />
          </div>

          {/* Privacy Note */}
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            <span>
              <strong>Privacy Guaranteed:</strong> Your mobile number stays private. Once your offer is accepted, you can call the requester in Hanuman using usernames.
            </span>
          </div>

          {/* Actions */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-spider-border/50">
            <button
              type="button"
              onClick={onClose}
              title="Discard this offer"
              className="btn-outline py-2 px-4 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || message.trim().length < 3}
              title="Send your offer to the requester"
              className="btn-primary py-2 px-5 text-xs font-bold shadow-spider-sm"
            >
              {loading ? 'Submitting...' : 'Send Help Offer'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};

export const OfferHelpModal: React.FC<OfferHelpModalProps> = ({
  request,
  isOpen,
  onClose,
  onSuccess,
  onRequireAuth
}) => {
  if (!isOpen || !request) return null;
  return (
    <OfferHelpModalInner
      key={request.id}
      request={request}
      onClose={onClose}
      onSuccess={onSuccess}
      onRequireAuth={onRequireAuth}
    />
  );
};
