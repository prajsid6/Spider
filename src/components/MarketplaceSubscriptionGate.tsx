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
  const [subscription, setSubscription] = useState<{
    userId: string;
    status: MarketplaceSubscriptionStatus;
  } | null>(null);
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);
  const [bypassedUserId, setBypassedUserId] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ userId: string; error: string; notice: string } | null>(null);
  const currentUserId = currentUser?.id;

  const refreshStatus = useCallback(async () => {
    if (!currentUserId) return;
    setLoadingUserId(currentUserId);
    setFeedback({ userId: currentUserId, error: '', notice: '' });
    try {
      setSubscription({ userId: currentUserId, status: await getMarketplaceSubscriptionStatus() });
    } catch (statusError) {
      setFeedback({
        userId: currentUserId,
        error: statusError instanceof Error ? statusError.message : 'Could not verify your subscription.',
        notice: ''
      });
    } finally {
      setLoadingUserId((activeUserId) => activeUserId === currentUserId ? null : activeUserId);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || !isFirebase || demoAuthEnabled) return;
    let active = true;
    void getMarketplaceSubscriptionStatus()
      .then((status) => {
        if (active) setSubscription({ userId: currentUserId, status });
      })
      .catch((statusError: unknown) => {
        if (active) {
          setFeedback({
            userId: currentUserId,
            error: statusError instanceof Error ? statusError.message : 'Could not verify your subscription.',
            notice: ''
          });
        }
      });
    return () => {
      active = false;
    };
  }, [currentUserId, demoAuthEnabled, isFirebase]);

  const handleSubscribe = async () => {
    if (!currentUserId) return;
    setCheckoutLoading(true);
    setFeedback({ userId: currentUserId, error: '', notice: '' });
    try {
      const checkoutStatus = await buyMarketplaceSubscription();
      setSubscription({ userId: currentUserId, status: checkoutStatus });
      if (checkoutStatus.active) {
        setFeedback({
          userId: currentUserId,
          error: '',
          notice: 'Subscription active. You now have access to the marketplace.'
        });
      } else {
        setFeedback({
          userId: currentUserId,
          error: '',
          notice: 'Razorpay received your authorization. Waiting for the subscription to activate; refresh status in a moment.'
        });
      }
    } catch (checkoutError) {
      setFeedback({
        userId: currentUserId,
        error: checkoutError instanceof Error ? checkoutError.message : 'Could not start the subscription checkout.',
        notice: ''
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const requiresSubscription = Boolean(currentUser && isFirebase && !demoAuthEnabled);
  const currentStatus = subscription && subscription.userId === currentUserId ? subscription.status : null;
  const subscriptionActive = currentStatus?.active === true;
  const loading = Boolean(
    requiresSubscription &&
    (loadingUserId === currentUserId || (!currentStatus && !feedback?.error))
  );
  const error = feedback && feedback.userId === currentUserId ? feedback.error : '';
  const notice = feedback && feedback.userId === currentUserId ? feedback.notice : '';
  const showGate = requiresSubscription && bypassedUserId !== currentUserId && (loading || !subscriptionActive);

  return (
    <>
      {children}
      {showGate && (
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
                  <p className="mt-2 text-[11px] text-spider-muted">
                    No separate posting fee or per-job platform commission. Task payments are settled separately.
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
                  disabled={checkoutLoading || Boolean(loadingUserId)}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-spider-border px-4 py-2.5 text-xs font-bold text-spider-text disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh subscription status
                </button>
                <button
                  type="button"
                  onClick={() => setBypassedUserId(currentUserId || null)}
                  disabled={checkoutLoading}
                  className="mt-2 w-full rounded-xl px-4 py-2 text-xs font-semibold text-spider-muted hover:bg-spider-bg disabled:opacity-50"
                >
                  Continue to browse and use safety features
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!currentUserId) return;
                    void signOut().catch((signOutError: unknown) => {
                      setFeedback({
                        userId: currentUserId,
                        error: signOutError instanceof Error ? signOutError.message : 'Could not sign out.',
                        notice: ''
                      });
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
