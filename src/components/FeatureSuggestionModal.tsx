import React, { useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { submitFeatureSuggestion } from '../services/featureSuggestionService';

interface FeatureSuggestionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FeatureSuggestionModal: React.FC<FeatureSuggestionModalProps> = ({ isOpen, onClose }) => {
  const { showToast } = useToast();
  const [suggestion, setSuggestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await submitFeatureSuggestion(suggestion);
      setSuggestion('');
      showToast('Thanks! Your feature suggestion has been submitted.', 'success');
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit your suggestion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="feature-suggestion-title"
        className="relative my-auto w-full max-w-lg rounded-3xl border border-spider-border bg-white p-6 shadow-spider-lg"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close feature suggestion"
          className="absolute right-4 top-4 rounded-full p-2 text-spider-muted transition-colors hover:bg-spider-bg hover:text-spider-text"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3 border-b border-spider-border pb-4 pr-8">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-spider-primary/15 text-spider-primary">
            <Lightbulb className="h-5 w-5" />
          </span>
          <div>
            <h2 id="feature-suggestion-title" className="text-lg font-black text-spider-text">Suggest a feature</h2>
            <p className="text-xs text-spider-muted">Tell us what would make Hanuman more useful.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="mt-4">
          <label htmlFor="feature-suggestion" className="mb-1.5 block text-xs font-bold text-spider-text">
            Your suggestion
          </label>
          <textarea
            id="feature-suggestion"
            required
            minLength={10}
            maxLength={2000}
            rows={5}
            value={suggestion}
            onChange={(event) => setSuggestion(event.target.value)}
            placeholder="Describe the feature and how it would help..."
            className="input-field resize-y text-sm"
          />
          <p className="mt-1 text-right text-[11px] text-spider-muted">{suggestion.length}/2000</p>
          {error && <p role="alert" className="mt-2 text-xs font-medium text-rose-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2 border-t border-spider-border pt-4">
            <button type="button" onClick={onClose} disabled={submitting} className="btn-outline px-4 py-2 text-xs">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || suggestion.trim().length < 10}
              className="btn-primary px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit suggestion'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
