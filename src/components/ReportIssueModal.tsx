import React, { useState } from 'react';
import { Bug, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { submitIssueReport } from '../services/issueReportService';

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ isOpen, onClose }) => {
  const { showToast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await submitIssueReport({ title, description });
      setTitle('');
      setDescription('');
      showToast('Thanks! Your issue report has been submitted.', 'success');
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit your issue report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-issue-title"
        className="relative my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl border border-spider-border bg-white p-4 shadow-spider-lg sm:p-6"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close issue report"
          className="absolute right-4 top-4 rounded-full p-2 text-spider-muted transition-colors hover:bg-spider-bg hover:text-spider-text disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3 border-b border-spider-border pb-4 pr-8">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
            <Bug className="h-5 w-5" />
          </span>
          <div>
            <h2 id="report-issue-title" className="text-lg font-black text-spider-text">Report an issue</h2>
            <p className="text-xs text-spider-muted">Tell us what went wrong so we can investigate.</p>
          </div>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-3">
          <label htmlFor="issue-title" className="block text-xs font-bold text-spider-text">
            Short summary
            <input
              id="issue-title"
              required
              minLength={5}
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="For example: I can’t submit an offer"
              className="input-field mt-1.5 text-sm"
            />
          </label>
          <label htmlFor="issue-description" className="block text-xs font-bold text-spider-text">
            What happened?
            <textarea
              id="issue-description"
              required
              minLength={10}
              maxLength={2000}
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Include what you tried and what you expected to happen. Please don’t include passwords or sensitive information."
              className="input-field mt-1.5 resize-y text-sm"
            />
          </label>
          <p className="text-right text-[11px] text-spider-muted">{description.length}/2000</p>
          {error && <p role="alert" className="text-xs font-medium text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-spider-border pt-4">
            <button type="button" onClick={onClose} disabled={submitting} className="btn-outline px-4 py-2 text-xs">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || title.trim().length < 5 || description.trim().length < 10}
              className="btn-primary px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit report'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
