import { supabase } from '../lib/supabase';

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

interface RazorpayPaymentResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  handler: (response: RazorpayPaymentResponse) => void;
  modal: { ondismiss: () => void };
}

interface RazorpayCheckout {
  open: () => void;
  on: (event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckout;
  }
}

const loadRazorpayCheckout = async (): Promise<void> => {
  if (window.Razorpay) return;

  const existingScript = document.getElementById('razorpay-checkout');
  if (existingScript) {
    await new Promise<void>((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Could not load Razorpay Checkout.')), { once: true });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'razorpay-checkout';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('Could not load Razorpay Checkout.'));
    };
    document.body.appendChild(script);
  });
};

export const buyEmergencyExtension = async (requestId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Razorpay extensions require a configured Supabase project and a signed-in account.');
  }
  const client = supabase;

  const key = import.meta.env.VITE_RAZORPAY_KEY_ID;
  if (!key) {
    throw new Error('Razorpay is not configured. Add VITE_RAZORPAY_KEY_ID to the app environment.');
  }

  await loadRazorpayCheckout();
  if (!window.Razorpay) {
    throw new Error('Razorpay Checkout did not initialize. Please try again.');
  }

  const { data: order, error: orderError } = await client.functions.invoke<RazorpayOrder>('emergency-extension', {
    body: { action: 'create', requestId }
  });
  if (orderError) throw new Error(orderError.message || 'Could not start the Razorpay payment.');
  if (!order?.id || order.amount !== 2500 || order.currency !== 'INR') {
    throw new Error('The payment service returned an invalid order.');
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    const checkout = new window.Razorpay!({
      key,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      name: 'Spider',
      description: 'Extend urgent alert by 5 minutes',
      handler: async (response) => {
        const paymentReference = `Razorpay payment ID: ${response.razorpay_payment_id}.`;
        try {
          const { error: verifyError } = await client.functions.invoke('emergency-extension', {
            body: {
              action: 'verify',
              requestId,
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature
            }
          });
          if (verifyError) {
            finish(new Error(`Payment was received but the alert extension could not be confirmed. Contact support. ${paymentReference}`));
            return;
          }
          finish();
        } catch (verificationError) {
          finish(new Error(verificationError instanceof Error
            ? `Payment was received but confirmation failed: ${verificationError.message}. Contact support. ${paymentReference}`
            : `Payment was received but confirmation failed. Contact support. ${paymentReference}`));
        }
      },
      modal: {
        ondismiss: () => finish(new Error('Payment cancelled. Your alert was not extended.'))
      }
    });

    checkout.on('payment.failed', (response) => {
      finish(new Error(response.error?.description || 'Payment failed. Your alert was not extended.'));
    });
    checkout.open();
  });
};
