import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, LockKeyhole, Phone, UserRound, X } from 'lucide-react';
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
  const { requestPhoneOtp, verifyPhoneOtp, continueWithoutOtp, demoAuthEnabled } = useAuth();
  const { showToast } = useToast();
  const [mode, setMode] = useState<'signup' | 'signin'>(defaultMode);
  const [name, setName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [otp, setOtp] = useState('');
  const [pendingPhone, setPendingPhone] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setMode(defaultMode);
    setTermsAccepted(false);
    setPendingPhone('');
    setOtp('');
    setError('');
  }, [defaultMode, isOpen]);

  if (!isOpen) return null;

  const changeMode = (nextMode: 'signup' | 'signin') => {
    setMode(nextMode);
    setTermsAccepted(false);
    setPendingPhone('');
    setOtp('');
    setError('');
  };

  const sendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const profile = mode === 'signup'
        ? { name, mobile_number: mobileNumber, date_of_birth: dateOfBirth }
        : undefined;
      if (demoAuthEnabled) {
        await continueWithoutOtp(mobileNumber, profile);
        showToast(mode === 'signup' ? 'Local demo account created.' : 'Signed in to your local demo account.', 'success');
        setPendingPhone('');
        onClose();
        return;
      }
      const normalizedPhone = await requestPhoneOtp(mobileNumber, rememberMe, profile);
      setMobileNumber(normalizedPhone);
      setPendingPhone(normalizedPhone);
      showToast(`A verification code was sent to ${normalizedPhone}.`, 'success');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendOtp();
  };

  const handleVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const profile = mode === 'signup'
        ? { name, mobile_number: pendingPhone, date_of_birth: dateOfBirth }
        : undefined;
      await verifyPhoneOtp(pendingPhone, otp, rememberMe, profile);
      showToast(mode === 'signup' ? 'Account created successfully.' : 'Signed in successfully.', 'success');
      setOtp('');
      setPendingPhone('');
      onClose();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Could not verify the code.');
    } finally {
      setLoading(false);
    }
  };

  const inputClassName = 'w-full rounded-xl border border-spider-border bg-white px-3 py-2.5 text-sm text-spider-text placeholder:text-spider-muted/70 focus:border-spider-primary focus:outline-none focus:ring-2 focus:ring-spider-primary/20';

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
            {mode === 'signup' ? 'Create your account' : 'Sign in to Spider'}
          </h2>
          <p className="mt-1 text-xs text-spider-muted">
            {pendingPhone
              ? `Enter the code sent to ${pendingPhone}.`
              : demoAuthEnabled
                ? 'Local development demo access; no SMS code is sent.'
                : 'Use your mobile number and a one-time verification code.'}
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

        {!pendingPhone ? (
          <form onSubmit={handleSendOtp} className="mt-4 space-y-3.5">
            {mode === 'signup' && (
              <>
                <label className="block text-xs font-bold text-spider-text">
                  Full name
                  <span className="relative mt-1.5 block">
                    <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={100}
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your full name"
                      className={`${inputClassName} pl-9`}
                    />
                  </span>
                </label>
                <label className="block text-xs font-bold text-spider-text">
                  Date of birth
                  <span className="relative mt-1.5 block">
                    <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                    <input
                      type="date"
                      required
                      max={getMaxDobDate()}
                      autoComplete="bday"
                      value={dateOfBirth}
                      onChange={(event) => setDateOfBirth(event.target.value)}
                      className={`${inputClassName} pl-9`}
                    />
                  </span>
                </label>
              </>
            )}

            <label className="block text-xs font-bold text-spider-text">
              Mobile number
              <span className="relative mt-1.5 block">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                <input
                  type="tel"
                  required
                  autoComplete="tel"
                  value={mobileNumber}
                  onChange={(event) => setMobileNumber(event.target.value)}
                  placeholder="+91 9876543210"
                  className={`${inputClassName} pl-9`}
                />
              </span>
            </label>
            {mode === 'signin' && (
              <label className="flex items-center gap-2 pt-1 text-xs text-spider-text">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-4 w-4 rounded border-spider-border accent-spider-primary"
                />
                Remember me on this device
              </label>
            )}
            {mode === 'signup' && (
              <>
                <label className="flex items-start gap-2 pt-1 text-xs leading-relaxed text-spider-text">
                  <input
                    type="checkbox"
                    required
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-spider-border accent-spider-primary"
                  />
                  <span>I agree to the terms and conditions.</span>
                </label>
                <p className="text-[11px] leading-relaxed text-spider-muted">
                  {demoAuthEnabled
                    ? 'You must be at least 13 years old. This demo account is saved only in this browser.'
                    : 'You must be at least 13 years old. We’ll send an SMS code to verify your mobile number.'}
                </p>
              </>
            )}
            <button type="submit" disabled={loading} className="w-full btn-primary py-2.5 text-sm font-bold disabled:opacity-50">
              {loading
                ? demoAuthEnabled ? 'Continuing...' : 'Sending code...'
                : demoAuthEnabled
                  ? mode === 'signup' ? 'Create demo account' : 'Continue without OTP'
                  : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="mt-4 space-y-4">
            <label className="block text-xs font-bold text-spider-text">
              One-time password
              <span className="relative mt-1.5 block">
                <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{4,8}"
                  maxLength={8}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                  placeholder="Enter verification code"
                  className={`${inputClassName} pl-9 tracking-[0.3em]`}
                />
              </span>
            </label>
            <button type="submit" disabled={loading || otp.length < 4} className="w-full btn-primary py-2.5 text-sm font-bold disabled:opacity-50">
              {loading ? 'Verifying...' : mode === 'signup' ? 'Verify & Create Account' : 'Verify & Sign In'}
            </button>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setPendingPhone('');
                  setOtp('');
                  setError('');
                }}
                className="font-semibold text-spider-muted hover:text-spider-text disabled:opacity-50"
              >
                Change details
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void sendOtp()}
                className="font-semibold text-spider-primary hover:underline disabled:opacity-50"
              >
                Resend code
              </button>
            </div>
          </form>
        )}

        <div className="mt-4 flex items-center justify-center gap-1.5 border-t border-spider-border/60 pt-4 text-[11px] text-spider-muted">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          Your mobile number stays private; connected users can call by username.
        </div>
      </section>
    </div>
  );
};
