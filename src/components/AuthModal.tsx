import React, { useEffect, useState } from 'react';
import { AlertCircle, AtSign, CalendarDays, CheckCircle2, LockKeyhole, Smartphone, UserRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'signup' | 'signin';
}

const getMaxDobDate = () => {
  const today = new Date();
  return new Date(today.getFullYear() - 13, today.getMonth(), today.getDate()).toISOString().split('T')[0];
};

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  defaultMode = 'signin'
}) => {
  const {
    signInWithEmail,
    signInAsDemoAccount,
    signUpWithEmail,
    demoAccounts,
    demoAuthEnabled
  } = useAuth();
  const { showToast } = useToast();
  const [mode, setMode] = useState<'signup' | 'signin'>(defaultMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setMode(defaultMode);
    setTermsAccepted(false);
    setPassword('');
    setError('');
  }, [defaultMode, isOpen]);

  if (!isOpen) return null;
  const inputClassName = 'w-full rounded-xl border border-spider-border bg-white px-3 py-2.5 text-sm text-spider-text placeholder:text-spider-muted/70 focus:border-spider-primary focus:outline-none focus:ring-2 focus:ring-spider-primary/20';

  const changeMode = (nextMode: 'signup' | 'signin') => {
    setMode(nextMode);
    setTermsAccepted(false);
    setPassword('');
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const signedIn = await signUpWithEmail(email, password, {
          name,
          mobile_number: mobileNumber,
          date_of_birth: dateOfBirth
        }, rememberMe);
        showToast(
          signedIn
            ? demoAuthEnabled ? 'Local demo account created.' : 'Account created successfully.'
            : 'Account created. Check your email to confirm it, then sign in.',
          'success'
        );
      } else {
        await signInWithEmail(email, password, rememberMe);
        showToast(demoAuthEnabled ? 'Signed in to your local demo account.' : 'Signed in successfully.', 'success');
      }
      onClose();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Could not authenticate.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoSignIn = async (profileId: string, profileName: string) => {
    setError('');
    setLoading(true);
    try {
      await signInAsDemoAccount(profileId);
      showToast(`Viewing Hanuman as ${profileName}.`, 'success');
      onClose();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Could not open this demo account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-spider-text/40 p-4 backdrop-blur-xs">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        className="relative my-auto w-full max-w-md rounded-3xl border border-spider-border bg-white p-6 shadow-spider-lg sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          title="Close sign-in"
          aria-label="Close sign-in"
          className="absolute right-4 top-4 rounded-full p-1.5 text-spider-muted transition-colors hover:bg-spider-lavender hover:text-spider-text"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="border-b border-spider-border/60 pb-4 pr-8">
          <h2 id="auth-title" className="text-xl font-extrabold text-spider-text">
            {mode === 'signup' ? 'Create your account' : 'Sign in to Hanuman'}
          </h2>
          <p className="mt-1 text-xs text-spider-muted">
            {demoAuthEnabled
              ? 'Local demo access with an email and password.'
              : 'Sign in securely with your email and password.'}
          </p>
        </div>

        <div className="mt-4 flex rounded-xl border border-spider-border/60 bg-spider-soft p-1" role="tablist" aria-label="Account access">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => changeMode('signin')}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${mode === 'signin' ? 'bg-spider-primary text-black shadow-sm' : 'text-spider-muted hover:bg-white/70'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => changeMode('signup')}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${mode === 'signup' ? 'bg-spider-primary text-black shadow-sm' : 'text-spider-muted hover:bg-white/70'}`}
            >
              Sign Up
            </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <>
              {demoAuthEnabled && mode === 'signin' && (
                <section className="rounded-xl border border-spider-border bg-spider-soft/60 p-3">
                  <div className="mb-2">
                    <h3 className="text-xs font-bold text-spider-text">Try a demo account</h3>
                    <p className="mt-0.5 text-[11px] text-spider-muted">Choose a sample profile to explore the marketplace.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {demoAccounts.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        disabled={loading}
                        onClick={() => void handleDemoSignIn(account.id, account.name)}
                        className="rounded-lg border border-spider-border bg-white px-2.5 py-2 text-left transition-colors hover:border-spider-primary/60 hover:bg-spider-primary/5 disabled:opacity-50"
                      >
                        <span className="block truncate text-xs font-bold text-spider-text">{account.name}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-spider-muted">@{account.username}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {mode === 'signup' && (
                <>
                  <label className="block text-xs font-bold text-spider-text">
                    Full name
                    <span className="relative mt-1.5 block">
                      <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                      <input type="text" required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" className={`${inputClassName} pl-9`} />
                    </span>
                  </label>
                  <label className="block text-xs font-bold text-spider-text">
                    Mobile number
                    <span className="relative mt-1.5 block">
                      <Smartphone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                      <input type="tel" required minLength={8} maxLength={15} pattern="[0-9+ -]{8,15}" autoComplete="tel" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} placeholder="+91 98765 43210" className={`${inputClassName} pl-9`} />
                    </span>
                  </label>
                  <label className="block text-xs font-bold text-spider-text">
                    Date of birth
                    <span className="relative mt-1.5 block">
                      <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                      <input type="date" required max={getMaxDobDate()} autoComplete="bday" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} className={`${inputClassName} pl-9`} />
                    </span>
                  </label>
                </>
              )}

              <label className="block text-xs font-bold text-spider-text">
                Email address
                <span className="relative mt-1.5 block">
                  <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                  <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className={`${inputClassName} pl-9`} />
                </span>
              </label>
              <label className="block text-xs font-bold text-spider-text">
                Password
                <span className="relative mt-1.5 block">
                  <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                  <input type="password" required minLength={mode === 'signup' ? 8 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} className={`${inputClassName} pl-9`} />
                </span>
              </label>
              {mode === 'signin' && (
                <label className="flex items-center gap-2 pt-1 text-xs text-spider-text">
                  <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="h-4 w-4 rounded border-spider-border accent-spider-primary" />
                  Remember me on this device
                </label>
              )}
              {mode === 'signup' && (
                <>
                  <label className="flex items-start gap-2 pt-1 text-xs leading-relaxed text-spider-text">
                    <input type="checkbox" required checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-spider-border accent-spider-primary" />
                    <span>I agree to the terms and conditions.</span>
                  </label>
                  <p className="text-[11px] leading-relaxed text-spider-muted">
                    {demoAuthEnabled
                      ? 'You must be at least 13 years old. Demo account details are saved only in this browser.'
                      : 'You must be at least 13 years old. You may need to confirm your email before signing in.'}
                  </p>
                </>
              )}
              <button type="submit" disabled={loading} className="w-full btn-primary py-2.5 text-sm font-bold disabled:opacity-50">
                {loading ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
          </>
        </form>

        <div className="mt-4 flex items-center justify-center gap-1.5 border-t border-spider-border/60 pt-4 text-[11px] text-spider-muted">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          Your email is private; connected users can call by username.
        </div>
      </section>
    </div>
  );
};
