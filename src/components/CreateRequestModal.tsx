import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { DataService } from '../services/dataService';
import type { HelpRequest } from '../types';
import { X, IndianRupee, Sparkles, AlertCircle } from 'lucide-react';

interface CreateRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newReq: HelpRequest) => void;
  onRequireAuth: () => void;
}

export const CreateRequestModal: React.FC<CreateRequestModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onRequireAuth
}) => {
  const { currentUser } = useAuth();
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState('');
  const [budgetInr, setBudgetInr] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentUser) {
      onRequireAuth();
      return;
    }

    const trimmedDesc = description.trim();
    if (trimmedDesc.length < 5) {
      setError('Description must be at least 5 characters.');
      return;
    }

    const parsedBudget = budgetInr ? parseFloat(budgetInr) : undefined;
    if (parsedBudget !== undefined && (isNaN(parsedBudget) || parsedBudget < 0)) {
      setError('Budget must be a positive number.');
      return;
    }

    setLoading(true);
    try {
      const created = await DataService.createRequest(currentUser.id, {
        description: trimmedDesc,
        details: details.trim() || undefined,
        budget_inr: parsedBudget
      });
      setDescription('');
      setDetails('');
      setBudgetInr('');
      onSuccess(created);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to post request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const applyTemplate = (d: string, det: string, b: string) => {
    setDescription(d);
    setDetails(det);
    setBudgetInr(b);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-spider-elevated rounded-3xl shadow-spider-lg border border-spider-border p-6 sm:p-7 animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-spider-border">
          <div>
            <h2 className="text-xl font-black text-spider-text">Post a Help Request</h2>
            <p className="text-xs text-spider-muted mt-0.5">Describe what you need — set a fair ₹ budget</p>
          </div>
          <button onClick={onClose} title="Close form" aria-label="Close form" className="p-2 rounded-xl text-spider-muted hover:text-spider-text hover:bg-spider-surface transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick templates */}
        <div className="mt-4">
          <p className="text-[10px] font-bold text-spider-muted uppercase tracking-wider mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-spider-primary" />
            Quick Examples
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: '🛠 Furniture Assembly', desc: 'Help assemble an IKEA desk in HSR Layout', det: 'Have all parts ready. Need an extra pair of hands for about 1 hour.', b: '600' },
              { label: '🐍 Python Tutoring', desc: 'Need 1-on-1 tutoring on Python Pandas & Data Wrangling', det: '90 minutes — dataframe grouping and messy CSV timestamps.', b: '1200' },
              { label: '🐱 Cat Sitting', desc: 'Cat sitting for weekend (2 visits/day)', det: 'Friendly indoor cat in Koramangala. Feed at 9 AM and 7 PM.', b: '1500' },
            ].map(t => (
              <button
                key={t.label}
                type="button"
                onClick={() => applyTemplate(t.desc, t.det, t.b)}
                title="Fill the form with this example"
                className="text-[11px] px-3 py-1.5 rounded-xl bg-spider-surface hover:bg-spider-border text-spider-muted hover:text-spider-text border border-spider-border transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-spider-text">What do you need help with? <span className="text-red-400">*</span></label>
              <span className="text-[10px] text-spider-muted">{description.length}/1000</span>
            </div>
            <textarea
              required rows={2} maxLength={1000}
              placeholder="e.g. Need someone to move my couch down 3 floors in Indiranagar"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field text-sm resize-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-spider-text">Details / Location / Timing <span className="text-spider-muted font-normal">(optional)</span></label>
              <span className="text-[10px] text-spider-muted">{details.length}/5000</span>
            </div>
            <textarea
              rows={3} maxLength={5000}
              placeholder="Specific requirements, area, preferred time..."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="input-field text-sm resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-spider-text block mb-1.5">
              Budget in ₹ <span className="text-spider-muted font-normal">(leave blank if negotiable)</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-spider-primary">
                <IndianRupee className="w-4 h-4 stroke-[2.5]" />
              </div>
              <input
                type="number" min="0" step="50"
                placeholder="e.g. 800"
                value={budgetInr}
                onChange={(e) => setBudgetInr(e.target.value)}
                className="input-field pl-9 text-sm"
              />
            </div>
          </div>

          <div className="pt-1 text-[11px] text-spider-muted">
            Posting as: <strong className="text-spider-text">{currentUser ? `${currentUser.name} (@${currentUser.username})` : 'Not signed in'}</strong>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-spider-border">
            <button type="button" onClick={onClose} title="Discard this request" className="btn-outline py-2 px-4 text-xs">Cancel</button>
            <button
              type="submit"
              disabled={loading || description.trim().length < 5}
              title="Publish this help request"
              className="btn-primary py-2 px-5 text-xs font-black"
            >
              {loading ? 'Posting...' : 'Post Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
