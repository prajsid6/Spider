import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, LoaderCircle, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  buyMarketplaceSubscription,
  getMarketplaceSubscriptionStatus,
  type MarketplaceSubscriptionStatus
} from '../services/marketplaceSubscriptionService';

export const MarketplaceSubscriptionGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, demoAuthEnabled, isFirebase, signOut } = useAuth();
  const [status, setStatus] = useState<MarketplaceSubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStatus(await getMarketplaceSubscriptionStatus());
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not verify your subscription.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setStatus(null);
    setError('');
    setNotice('');
    if (!currentUser || !isFirebase || demoAuthEnabled) return;
    void refreshStatus();
  }, [currentUser?.id, demoAuthEnabled, isFirebase, refreshStatus]);

  const handleSubscribe = async () => {
    setCheckoutLoading(true);
    setError('');
    setNotice('');
    try {
      const checkoutStatus = await buyMarketplaceSubscription();
      setStatus(checkoutStatus);
      if (checkoutStatus.active) {
        setNotice('Subscription active. You now have access to the marketplace.');
      } else {
        setNotice('Razorpay received your authorization. Waiting for the subscription to activate; refresh status in a moment.');
      }
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Could not start the subscription checkout.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const requiresSubscription = Boolean(currentUser && isFirebase && !demoAuthEnabled);
  const subscriptionActive = status?.active === true;

  return (
    <>
      {children}
      {requiresSubscription && (loading || !subscriptionActive) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="marketplace-subscription-title"
            className="my-auto w-full max-w-md rounded-3xl border border-spider-border bg-white p-6 shadow-spider-lg sm:p-8"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-spider-primary/15 text-spider-deep">
              {loading ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <CreditCard className="h-6 w-6" />}
            </div>
            <h2 id="marketplace-subscription-title" className="mt-4 text-xl font-black text-spider-text">
              {loading ? 'Checking your subscription' : 'Marketplace subscription required'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-spider-muted">
              {loading
                ? 'Verifying your Razorpay subscription securely.'
                : 'Subscribe to use Hanuman as a requester or helper. The same plan covers every marketplace action.'}
            </p>
            {!loading && (
              <>
                <div className="mt-5 rounded-2xl border border-spider-border bg-spider-bg p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-bold text-spider-text">Hanuman Marketplace</span>
                    <span className="text-2xl font-black text-spider-deep">₹100<span className="text-xs font-semibold text-spider-muted"> / month</span></span>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-spider-muted">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Recurring monthly billing. Cancel any time.
                  </p>
                </div>
                {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
                {notice && <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{notice}</p>}
                <button
                  type="button"
                  onClick={() => void handleSubscribe()}
                  disabled={checkoutLoading}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-spider-primary px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {checkoutLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {checkoutLoading ? 'Opening secure checkout...' : 'Subscribe with Razorpay'}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  disabled={checkoutLoading || loading}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-spider-border px-4 py-2.5 text-xs font-bold text-spider-text disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh subscription status
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void signOut().catch((signOutError: unknown) => {
                      setError(signOutError instanceof Error ? signOutError.message : 'Could not sign out.');
                    });
                  }}
                  disabled={checkoutLoading}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-spider-muted hover:bg-spider-bg disabled:opacity-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
};
