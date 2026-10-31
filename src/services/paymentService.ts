import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

interface RazorpayCheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayCheckoutResponse) => void | Promise<void>;
  modal: { ondismiss: () => void };
}

interface RazorpayCheckoutInstance {
  open: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

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

export const buyEmergencyExtension = async (requestId: string): Promise<void> => {
  const key = import.meta.env.VITE_RAZORPAY_KEY_ID;
  if (!key) throw new Error('Razorpay is not configured. Add VITE_RAZORPAY_KEY_ID to the app environment.');
  if (!functions) throw new Error('Payments require a configured Firebase project and deployed Cloud Functions.');
  const callableFunctions = functions;

  const createOrder = httpsCallable<{ requestId: string }, RazorpayOrder>(callableFunctions, 'createEmergencyExtensionOrder');
  const { data: order } = await createOrder({ requestId });
  if (order.amount !== 2500 || order.currency !== 'INR') {
    throw new Error('Firebase returned an invalid payment order.');
  }
  await loadRazorpayCheckout();
  if (!window.Razorpay) throw new Error('Razorpay Checkout did not initialize.');

  await new Promise<void>((resolve, reject) => {
    const checkout = new window.Razorpay!({
      key,
      amount: order.amount,
      currency: order.currency,
      name: 'Hanuman',
      description: 'Emergency request extension',
      order_id: order.id,
      handler: async (response) => {
        try {
          const verifyPayment = httpsCallable<RazorpayCheckoutResponse & { requestId: string }, { verified: boolean }>(
            callableFunctions,
            'verifyEmergencyExtensionPayment'
          );
          const { data } = await verifyPayment({ ...response, requestId });
          if (data.verified !== true) throw new Error('Payment could not be verified.');
          resolve();
        } catch (error) {
          reject(new Error(
            `Payment was captured but the extension could not be confirmed. Contact support with payment ID ${response.razorpay_payment_id}. ${
              error instanceof Error ? error.message : ''
            }`.trim()
          ));
        }
      },
      modal: {
        ondismiss: () => reject(new Error('Payment checkout was closed before payment completed.'))
      }
    });
    checkout.open();
  });
};
