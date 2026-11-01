import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

export interface MarketplaceSubscriptionStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

interface RazorpaySubscriptionCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

const requireFunctions = () => {
  if (!functions) throw new Error('Monthly subscriptions require a configured Firebase project and deployed Cloud Functions.');
  return functions;
};

const loadRazorpayCheckout = async (): Promise<void> => {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    const script = existing || document.createElement('script');
    if (!existing) {
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);
    }
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Could not load Razorpay Checkout.')), { once: true });
  });
  if (!window.Razorpay) throw new Error('Razorpay Checkout did not initialize.');
};

export const getMarketplaceSubscriptionStatus = async (): Promise<MarketplaceSubscriptionStatus> => {
  const callableFunctions = requireFunctions();
  const getStatus = httpsCallable<void, MarketplaceSubscriptionStatus>(
    callableFunctions,
    'getMarketplaceSubscriptionStatus'
  );
  const { data } = await getStatus();
  return data;
};

export const buyMarketplaceSubscription = async (): Promise<MarketplaceSubscriptionStatus> => {
  const callableFunctions = requireFunctions();
  const createSubscription = httpsCallable<void, { subscriptionId: string; keyId: string }>(
    callableFunctions,
    'createMarketplaceSubscription'
  );
  const { data: subscription } = await createSubscription();
  await loadRazorpayCheckout();
  const RazorpayCheckout = window.Razorpay;
  if (!RazorpayCheckout) throw new Error('Razorpay Checkout did not initialize.');

  return new Promise<MarketplaceSubscriptionStatus>((resolve, reject) => {
    const checkout = new RazorpayCheckout({
      key: subscription.keyId,
      subscription_id: subscription.subscriptionId,
      name: 'Hanuman',
      description: 'Marketplace access · ₹100 per month',
      handler: async (response: RazorpaySubscriptionCheckoutResponse) => {
        try {
          if (
            !response.razorpay_payment_id ||
            !response.razorpay_subscription_id ||
            !response.razorpay_signature
          ) throw new Error('Razorpay returned incomplete subscription details.');
          const verifySubscription = httpsCallable<
            RazorpaySubscriptionCheckoutResponse,
            MarketplaceSubscriptionStatus
          >(callableFunctions, 'verifyMarketplaceSubscription');
          const { data: status } = await verifySubscription(response);
          resolve(status);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Could not verify the subscription payment.'));
        }
      },
      modal: {
        ondismiss: () => reject(new Error('Subscription checkout was closed before authorization completed.'))
      }
    });
    checkout.open();
  });
};

export const cancelMarketplaceSubscription = async (): Promise<MarketplaceSubscriptionStatus> => {
  const callableFunctions = requireFunctions();
  const cancelSubscription = httpsCallable<void, MarketplaceSubscriptionStatus>(
    callableFunctions,
    'cancelMarketplaceSubscription'
  );
  const { data } = await cancelSubscription();
  return data;
};
