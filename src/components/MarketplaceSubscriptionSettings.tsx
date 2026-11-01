import React, { useEffect, useState } from 'react';
import { CalendarClock, CreditCard, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  buyMarketplaceSubscription,
  cancelMarketplaceSubscription,
  getMarketplaceSubscriptionStatus,
  type MarketplaceSubscriptionStatus
} from '../services/marketplaceSubscriptionService';
import { isFirebaseConfigured } from '../lib/firebase';

const formatDate = (timestamp: number | null): string =>
  timestamp
    ? new Date(timestamp * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Not available';

export const MarketplaceSubscriptionSettings: React.FC = () => {
  const [status, setStatus] = useState<MarketplaceSubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setStatus(await getMarketplaceSubscriptionStatus());
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not load subscription details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    let active = true;
    void getMarketplaceSubscriptionStatus()
      .then((subscription) => {
        if (active) setStatus(subscription);
      })
      .catch((statusError: unknown) => {
        if (active) setError(statusError instanceof Error ? statusError.message : 'Could not load subscription details.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubscribe = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const subscription = await buyMarketplaceSubscription();
      setStatus(subscription);
      setNotice(subscription.active
        ? 'Subscription active. Marketplace access is enabled.'
        : 'Payment authorization received. Refresh status after Razorpay activates the subscription.');
    } catch (subscriptionError) {
      setError(subscriptionError instanceof Error ? subscriptionError.message : 'Could not start the subscription checkout.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel renewal? Your marketplace access will remain active until the current billing period ends.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setStatus(await cancelMarketplaceSubscription());
      setNotice('Subscription cancellation is scheduled for the end of the current billing period.');
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel subscription renewal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-5 rounded-2xl border border-spider-border bg-spider-bg/70 p-4" aria-labelledby="marketplace-subscription-heading">
      <div className="flex items-start gap-2">
        <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-spider-deep" />
        <div className="min-w-0 flex-1">
          <h3 id="marketplace-subscription-heading" className="text-sm font-extrabold text-spider-text">Marketplace subscription</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-spider-muted">
            ₹100 per month for requester and helper access. This replaces marketplace posting and per-job platform fees; agreed task payments are settled separately between participants.
          </p>
        </div>
      </div>

      {!isFirebaseConfigured() ? (
        <p className="mt-3 text-xs text-spider-muted">Subscription billing is available after Firebase and Razorpay are configured.</p>
      ) : loading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-spider-muted"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Loading subscription...</p>
      ) : status?.active ? (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            {status.cancelAtPeriodEnd ? 'Cancels at period end' : 'Active'}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-spider-muted">
            <CalendarClock className="h-3.5 w-3.5" />
            Access through {formatDate(status.currentPeriodEnd)}
          </p>
          {!status.cancelAtPeriodEnd && (
            <button type="button" onClick={() => void handleCancel()} disabled={busy} className="mt-3 rounded-lg border border-spider-border bg-white px-3 py-2 text-xs font-semibold text-spider-text disabled:opacity-50">
              {busy ? 'Scheduling cancellation...' : 'Cancel renewal'}
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-xs font-semibold text-amber-800">No active marketplace subscription.</p>
          <button type="button" onClick={() => void handleSubscribe()} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-spider-primary px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
            {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
            {busy ? 'Opening Razorpay...' : 'Subscribe · ₹100/month'}
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-[11px] font-medium text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 text-[11px] font-medium text-emerald-700">{notice}</p>}
      {isFirebaseConfigured() && !loading && (
        <button type="button" onClick={() => void refresh()} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-spider-deep disabled:opacity-50">
          <RefreshCw className="h-3 w-3" />
          Refresh status
        </button>
      )}
    </section>
  );
};
