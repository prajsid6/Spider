import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AtSign, CalendarDays, Clock3, Phone, UserRound, X, Pencil, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Profile } from '../types';
import { ProfileSafetySettings } from './ProfileSafetySettings';

interface AccountDetailsModalProps {
  profile: Profile;
  onClose: () => void;
}

const formatDate = (date: string) => {
  const parsedDate = new Date(date);
  return Number.isNaN(parsedDate.getTime())
    ? 'Not available'
    : parsedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

export const AccountDetailsModal: React.FC<AccountDetailsModalProps> = ({ profile, onClose }) => {
  const { updateProfile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    name: profile.name,
    username: profile.username,
    mobile_number: profile.mobile_number,
    date_of_birth: profile.date_of_birth
  });

  const cancelEditing = () => {
    setForm({
      name: profile.name,
      username: profile.username,
      mobile_number: profile.mobile_number,
      date_of_birth: profile.date_of_birth
    });
    setError('');
    setIsEditing(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setIsSaving(true);
    try {
      await updateProfile(form);
      setIsEditing(false);
      setNotice('Account details updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update account details.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClassName = 'mt-1 w-full rounded-lg border border-spider-border bg-white px-3 py-2 text-sm text-spider-text focus:border-spider-primary focus:outline-none focus:ring-2 focus:ring-spider-primary/20';

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-details-title"
        className="relative my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-spider-border bg-white p-6 shadow-spider-lg"
      >
        <button
          type="button"
          onClick={onClose}
          title="Close account details"
          aria-label="Close account details"
          className="absolute right-4 top-4 rounded-full p-2 text-spider-muted transition-colors hover:bg-spider-bg hover:text-spider-text"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 border-b border-spider-border/70 pb-4 pr-8">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-spider-primary text-lg font-black text-black"
            style={profile.avatar_color ? { backgroundColor: profile.avatar_color } : undefined}
          >
            {profile.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 id="account-details-title" className="text-lg font-extrabold text-spider-text">Account details</h2>
            <p className="text-xs text-spider-muted">Your private profile information</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <dl className="mt-4 space-y-3">
            <div className="flex items-start gap-3 rounded-xl bg-spider-bg px-3.5 py-3">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-spider-muted" />
              <div className="min-w-0 flex-1">
                <dt className="text-[11px] font-semibold text-spider-muted">Full name</dt>
                {isEditing ? (
                  <input aria-label="Full name" autoComplete="name" className={inputClassName} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                ) : <dd className="mt-0.5 text-sm font-semibold text-spider-text">{profile.name}</dd>}
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-spider-bg px-3.5 py-3">
              <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-spider-muted" />
              <div className="min-w-0 flex-1">
                <dt className="text-[11px] font-semibold text-spider-muted">Username</dt>
                {isEditing ? (
                  <input aria-label="Username" autoComplete="username" className={inputClassName} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.replace(/^@/, '') })} />
                ) : <dd className="mt-0.5 text-sm font-semibold text-spider-text">@{profile.username}</dd>}
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-spider-bg px-3.5 py-3">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-spider-muted" />
              <div className="min-w-0 flex-1">
                <dt className="text-[11px] font-semibold text-spider-muted">Mobile number</dt>
                {isEditing ? (
                  <input type="tel" aria-label="Mobile number" autoComplete="tel" className={inputClassName} value={form.mobile_number} onChange={(event) => setForm({ ...form, mobile_number: event.target.value })} />
                ) : <dd className="mt-0.5 text-sm font-semibold text-spider-text">{profile.mobile_number}</dd>}
                <dd className="mt-0.5 text-[11px] text-spider-muted">Used for sign-in only; never shared with other users.</dd>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-spider-bg px-3.5 py-3">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-spider-muted" />
              <div className="min-w-0 flex-1">
                <dt className="text-[11px] font-semibold text-spider-muted">Date of birth</dt>
                {isEditing ? (
                  <input type="date" aria-label="Date of birth" autoComplete="bday" className={inputClassName} value={form.date_of_birth} onChange={(event) => setForm({ ...form, date_of_birth: event.target.value })} />
                ) : <dd className="mt-0.5 text-sm font-semibold text-spider-text">{formatDate(profile.date_of_birth)}</dd>}
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-spider-bg px-3.5 py-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-spider-muted" />
              <div>
                <dt className="text-[11px] font-semibold text-spider-muted">Member since</dt>
                <dd className="mt-0.5 text-sm font-semibold text-spider-text">{formatDate(profile.created_at)}</dd>
              </div>
            </div>
          </dl>

          {error && <p role="alert" className="mt-3 text-xs font-medium text-red-600">{error}</p>}
          {notice && <p role="status" className="mt-3 text-xs font-medium text-emerald-700">{notice}</p>}

          <div className="mt-5 flex justify-end gap-2">
            {isEditing ? (
              <>
                <button type="button" onClick={cancelEditing} disabled={isSaving} className="rounded-xl border border-spider-border px-4 py-2 text-sm font-semibold text-spider-muted transition-colors hover:bg-spider-bg disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSaving} className="flex items-center gap-2 rounded-xl bg-spider-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
                  <Check className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save changes'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => { setNotice(''); setIsEditing(true); }} className="flex items-center gap-2 rounded-xl bg-spider-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90">
                <Pencil className="h-4 w-4" />
                Edit details
              </button>
            )}
          </div>
        </form>
        <ProfileSafetySettings />
      </section>
    </div>,
    document.body
  );
};
