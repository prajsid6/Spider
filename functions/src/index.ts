import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';
import webPush from 'web-push';

initializeApp();

const db = getFirestore();
const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const razorpayWebhookSecret = defineSecret('RAZORPAY_WEBHOOK_SECRET');
const razorpayMonthlyPlanId = defineString('RAZORPAY_MONTHLY_PLAN_ID', { default: '' });
const turnSharedSecret = defineSecret('TURN_SHARED_SECRET');
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY');
const vapidPublicKey = defineString('VAPID_PUBLIC_KEY');
const vapidSubject = defineString('VAPID_SUBJECT', { default: 'mailto:admin@example.com' });
const turnUrls = defineString('TURN_URLS', { default: '' });
const firebaseDatabaseURL = defineString('FIREBASE_DATABASE_URL', { default: '' });
const SOS_CONTRIBUTION_PAISE = new Set([1000, 2500, 5000]);
const MARKETPLACE_SUBSCRIPTION_PAISE = 10000;
const MARKETPLACE_SUBSCRIPTION_CYCLES = 1200;

interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: string;
  current_end?: number | null;
  has_scheduled_changes?: boolean;
}

interface MarketplaceSubscriptionStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

const getRazorpayAuthorization = (): string =>
  `Basic ${Buffer.from(`${razorpayKeyId.value()}:${razorpayKeySecret.value()}`).toString('base64')}`;

const isMarketplaceSubscriptionActive = (
  status: string,
  currentPeriodEnd: number | null,
  cancelAtPeriodEnd = false
): boolean => {
  const hasPaidTimeRemaining = currentPeriodEnd !== null && currentPeriodEnd * 1000 > Date.now();
  return hasPaidTimeRemaining && (
    ['active', 'pending', 'halted', 'paused'].includes(status) ||
    (status === 'cancelled' && cancelAtPeriodEnd)
  );
};

const fetchRazorpaySubscription = async (subscriptionId: string): Promise<RazorpaySubscription> => {
  const response = await fetch(`https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: getRazorpayAuthorization() }
  });
  if (!response.ok) throw new HttpsError('internal', 'Could not confirm the Razorpay subscription status.');
  return await response.json() as RazorpaySubscription;
};

const syncMarketplaceSubscription = async (
  uid: string,
  subscription: RazorpaySubscription,
  cancelAtPeriodEnd = false
): Promise<MarketplaceSubscriptionStatus> => {
  if (subscription.plan_id !== razorpayMonthlyPlanId.value()) {
    throw new HttpsError('failed-precondition', 'The subscription is not for the Hanuman monthly plan.');
  }
  const currentPeriodEnd = Number.isInteger(subscription.current_end) && Number(subscription.current_end) > 0
    ? Number(subscription.current_end)
    : null;
  const active = isMarketplaceSubscriptionActive(subscription.status, currentPeriodEnd, cancelAtPeriodEnd);
  const statusRef = db.collection('marketplaceSubscriptions').doc(uid);
  const ownerRef = db.collection('razorpaySubscriptionOwners').doc(subscription.id);
  await db.runTransaction(async (transaction) => {
    const [ownerSnapshot, statusSnapshot] = await Promise.all([
      transaction.get(ownerRef),
      transaction.get(statusRef)
    ]);
    if (ownerSnapshot.exists && ownerSnapshot.data()?.user_id !== uid) {
      throw new HttpsError('permission-denied', 'This subscription belongs to a different account.');
    }
    const currentSubscriptionId = statusSnapshot.data()?.subscription_id;
    if (typeof currentSubscriptionId === 'string' && currentSubscriptionId !== subscription.id) {
      throw new HttpsError('aborted', 'A different subscription is already linked to this account.');
    }
    transaction.set(ownerRef, {
      user_id: uid,
      plan_id: subscription.plan_id,
      updated_at: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(statusRef, {
      subscription_id: subscription.id,
      status: subscription.status,
      is_active: active,
      current_period_end: currentPeriodEnd
        ? new Date(currentPeriodEnd * 1000)
        : null,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { active, status: subscription.status, currentPeriodEnd, cancelAtPeriodEnd };
};

const verifyMarketplacePlan = async (): Promise<void> => {
  const planId = razorpayMonthlyPlanId.value();
  if (!/^plan_[a-zA-Z0-9]{14}$/.test(planId)) {
    throw new HttpsError('failed-precondition', 'Set RAZORPAY_MONTHLY_PLAN_ID to the configured monthly Razorpay plan.');
  }
  const response = await fetch(`https://api.razorpay.com/v1/plans/${encodeURIComponent(planId)}`, {
    headers: { Authorization: getRazorpayAuthorization() }
  });
  if (!response.ok) throw new HttpsError('failed-precondition', 'Could not verify the configured Razorpay subscription plan.');
  const plan = await response.json() as {
    id: string; period: string; interval: number; item?: { amount?: number; currency?: string };
  };
  if (
    plan.id !== planId ||
    plan.period !== 'monthly' ||
    plan.interval !== 1 ||
    plan.item?.amount !== MARKETPLACE_SUBSCRIPTION_PAISE ||
    plan.item?.currency !== 'INR'
  ) throw new HttpsError('failed-precondition', 'The Razorpay plan must be ₹100 INR, billed monthly.');
};

const verifyCapturedRazorpayPayment = async (
  orderId: string,
  paymentId: string,
  signature: string
): Promise<{ amount: number; currency: string }> => {
  const expected = createHmac('sha256', razorpayKeySecret.value())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new HttpsError('permission-denied', 'Payment signature is invalid.');
  }
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${razorpayKeyId.value()}:${razorpayKeySecret.value()}`).toString('base64')}`
    }
  });
  if (!response.ok) throw new HttpsError('internal', 'Could not confirm payment status with Razorpay.');
  const payment = await response.json() as {
    order_id: string; amount: number; currency: string; status: string; captured: boolean;
  };
  if (
    payment.order_id !== orderId ||
    payment.currency !== 'INR' ||
    payment.status !== 'captured' ||
    payment.captured !== true
  ) throw new HttpsError('failed-precondition', 'Payment has not been captured for this order.');
  return { amount: payment.amount, currency: payment.currency };
};

const createRazorpayOrder = async (amount: number, receipt: string): Promise<{ id: string; amount: number; currency: string }> => {
  const basic = Buffer.from(`${razorpayKeyId.value()}:${razorpayKeySecret.value()}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency: 'INR', receipt })
  });
  if (!response.ok) throw new HttpsError('internal', 'Could not create the payment order.');
  return await response.json() as { id: string; amount: number; currency: string };
};

const requireAuth = (uid: string | undefined): string => {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return uid;
};

const validateCoordinates = (latitude: unknown, longitude: unknown): [number, number] => {
  if (
    typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) throw new HttpsError('invalid-argument', 'Valid coordinates are required.');
  return [Number(latitude.toFixed(3)), Number(longitude.toFixed(3))];
};

const verifyRequestParticipant = async (requestId: string, offerId: string, uid: string): Promise<void> => {
  const [requestSnapshot, offerSnapshot] = await Promise.all([
    db.collection('requests').doc(requestId).get(),
    db.collection('offers').doc(offerId).get()
  ]);
  if (!requestSnapshot.exists || !offerSnapshot.exists) {
    throw new HttpsError('not-found', 'The connected request or accepted offer was not found.');
  }
  const request = requestSnapshot.data();
  const offer = offerSnapshot.data();
  if (
    !request || !offer ||
    !['Connected', 'Completed'].includes(request.status) ||
    offer.request_id !== requestId ||
    offer.status !== 'Accepted' ||
    ![request.requester_id, offer.helper_id].includes(uid)
  ) throw new HttpsError('permission-denied', 'Only participants in the accepted request can use this feature.');
};

export const safetyAlert = onCall({ secrets: [vapidPrivateKey] }, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const data = request.data as Record<string, unknown>;
  const action = data.action;
  const preferenceRef = db.collection('pushPreferences').doc(uid);

  if (action === 'get-preferences') {
    const saved = await preferenceRef.get();
    return saved.exists
      ? saved.data()
      : { radiusMeters: 5000, recipientLimit: 25 };
  }

  if (action === 'save-preferences') {
    const radiusMeters = Number(data.radiusMeters);
    const recipientLimit = Number(data.recipientLimit);
    if (!Number.isInteger(radiusMeters) || radiusMeters < 500 || radiusMeters > 50000) {
      throw new HttpsError('invalid-argument', 'Search radius must be between 500 and 50,000 meters.');
    }
    if (!Number.isInteger(recipientLimit) || recipientLimit < 1 || recipientLimit > 25) {
      throw new HttpsError('invalid-argument', 'Recipient limit must be between 1 and 25.');
    }
    await preferenceRef.set({ radiusMeters, recipientLimit, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { saved: true };
  }

  if (action === 'subscribe' || action === 'update-location') {
    const [latitude, longitude] = validateCoordinates(data.latitude, data.longitude);
    const subscription = data.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    const endpoint = action === 'subscribe' ? subscription?.endpoint : data.endpoint;
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
      throw new HttpsError('invalid-argument', 'A valid browser push subscription is required.');
    }
    const id = createHash('sha256').update(endpoint).digest('hex');
    const ref = db.collection('pushSubscriptions').doc(id);
    const existing = await ref.get();
    if (existing.exists && existing.data()?.user_id !== uid) {
      throw new HttpsError('already-exists', 'This browser subscription is already linked to another account.');
    }
    if (action === 'update-location' && !existing.exists) {
      throw new HttpsError('not-found', 'This browser has no registered SOS subscription.');
    }
    if (action === 'subscribe' && (
      typeof subscription?.keys?.p256dh !== 'string' || typeof subscription.keys.auth !== 'string'
    )) throw new HttpsError('invalid-argument', 'The browser push encryption keys are missing.');
    await ref.set({
      user_id: uid,
      endpoint,
      keys: action === 'subscribe' ? subscription?.keys : existing.data()?.keys,
      latitude,
      longitude,
      geohash: geohashForLocation([latitude, longitude]),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { saved: true };
  }

  if (action === 'unsubscribe') {
    const endpoint = data.endpoint;
    if (typeof endpoint !== 'string') throw new HttpsError('invalid-argument', 'Push endpoint is required.');
    const id = createHash('sha256').update(endpoint).digest('hex');
    const ref = db.collection('pushSubscriptions').doc(id);
    const existing = await ref.get();
    if (existing.exists && existing.data()?.user_id === uid) await ref.delete();
    return { removed: true };
  }

  if (action === 'trigger') {
    const [latitude, longitude] = validateCoordinates(data.latitude, data.longitude);
    const locationAddress = typeof data.locationAddress === 'string' ? data.locationAddress.trim() : '';
    if (!locationAddress || locationAddress.length > 2000) {
      throw new HttpsError('invalid-argument', 'A location description of at most 2,000 characters is required.');
    }
    const preference = (await preferenceRef.get()).data() || { radiusMeters: 5000, recipientLimit: 25 };
    const bounds = geohashQueryBounds([latitude, longitude], Number(preference.radiusMeters));
    const subscriptions = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const [start, end] of bounds) {
      const matches = await db.collection('pushSubscriptions')
        .orderBy('geohash')
        .startAt(start)
        .endAt(end)
        .get();
      matches.docs.forEach((snapshot) => subscriptions.set(snapshot.id, snapshot));
    }
    const nearbyUsers = new Map<string, { distance: number; subscriptions: FirebaseFirestore.QueryDocumentSnapshot[] }>();
    for (const subscription of subscriptions.values()) {
      const saved = subscription.data();
      if (saved.user_id === uid) continue;
      const distance = distanceBetween([latitude, longitude], [saved.latitude, saved.longitude]) * 1000;
      if (distance > Number(preference.radiusMeters)) continue;
      const existing = nearbyUsers.get(saved.user_id) || { distance, subscriptions: [] };
      existing.distance = Math.min(existing.distance, distance);
      existing.subscriptions.push(subscription);
      nearbyUsers.set(saved.user_id, existing);
    }

    const recipients = [...nearbyUsers.entries()]
      .sort((left, right) => left[1].distance - right[1].distance)
      .slice(0, Number(preference.recipientLimit));
    const requestRef = db.collection('requests').doc();
    const profile = await db.collection('publicProfiles').doc(uid).get();
    if (!profile.exists) throw new HttpsError('failed-precondition', 'Your profile is missing.');
    await requestRef.set({
      id: requestRef.id,
      requester_id: uid,
      description: 'Emergency help requested nearby',
      details: locationAddress,
      connection_mode: 'in_person',
      status: 'Open',
      created_at: new Date().toISOString(),
      is_emergency: true,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      offers_count: 0,
      requester: profile.data()
    });
    await db.collection('emergencyLocations').doc(requestRef.id).set({
      request_id: requestRef.id,
      requester_id: uid,
      latitude,
      longitude,
      created_at: FieldValue.serverTimestamp()
    });

    webPush.setVapidDetails(vapidSubject.value(), vapidPublicKey.value(), vapidPrivateKey.value());
    const deliveredUsers = await Promise.all(recipients.map(async ([, recipient]) => {
      const deliveries = await Promise.all(recipient.subscriptions.map(async (subscription) => {
        const saved = subscription.data();
        try {
          await webPush.sendNotification(
            { endpoint: saved.endpoint, keys: saved.keys },
            JSON.stringify({
              title: 'Nearby SOS request',
              body: `${locationAddress} — open Spider to respond.`,
              url: `?request=${requestRef.id}`,
              latitude,
              longitude
            })
          );
          return true;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) await subscription.ref.delete();
          console.error('SOS push delivery failed:', error);
          return false;
        }
      }));
      return deliveries.some(Boolean);
    }));
    return {
      requestId: requestRef.id,
      recipients: deliveredUsers.filter(Boolean).length,
      recipientLimit: Number(preference.recipientLimit),
      radiusMeters: Number(preference.radiusMeters)
    };
  }

  throw new HttpsError('invalid-argument', 'Unknown safety alert operation.');
});

export const createSosContributionOrder = onCall({
  secrets: [razorpayKeyId, razorpayKeySecret]
}, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const { requestId, amount } = request.data as Record<string, unknown>;
  if (
    typeof requestId !== 'string' ||
    typeof amount !== 'number' ||
    !SOS_CONTRIBUTION_PAISE.has(amount * 100)
  ) throw new HttpsError('invalid-argument', 'Choose a contribution of ₹10, ₹25, or ₹50.');
  const sosRequest = await db.collection('requests').doc(requestId).get();
  if (!sosRequest.exists || sosRequest.data()?.requester_id !== uid || sosRequest.data()?.is_emergency !== true) {
    throw new HttpsError('permission-denied', 'Only the person who sent this SOS can contribute.');
  }
  const paymentOrderAmount = amount * 100;
  const order = await createRazorpayOrder(
    paymentOrderAmount,
    `sos_${randomUUID().replace(/-/g, '').slice(0, 32)}`
  );
  if (order.amount !== paymentOrderAmount || order.currency !== 'INR') {
    throw new HttpsError('internal', 'Razorpay returned an unexpected order amount.');
  }
  await db.collection('payments').doc(order.id).set({
    order_id: order.id,
    request_id: requestId,
    user_id: uid,
    type: 'sos_contribution',
    amount: paymentOrderAmount,
    currency: 'INR',
    status: 'created',
    created_at: FieldValue.serverTimestamp()
  });
  return { id: order.id, amount: paymentOrderAmount, currency: 'INR' };
});

export const verifySosContributionPayment = onCall({
  secrets: [razorpayKeyId, razorpayKeySecret]
}, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const { orderId, paymentId, signature } = request.data as Record<string, unknown>;
  if (![orderId, paymentId, signature].every((value) => typeof value === 'string')) {
    throw new HttpsError('invalid-argument', 'Payment verification fields are required.');
  }
  const paymentRef = db.collection('payments').doc(orderId as string);
  const paymentSnapshot = await paymentRef.get();
  const payment = paymentSnapshot.data();
  if (!paymentSnapshot.exists || !payment || payment.type !== 'sos_contribution') {
    throw new HttpsError('not-found', 'SOS contribution order was not found.');
  }
  if (payment.user_id !== uid || payment.order_id !== orderId) {
    throw new HttpsError('permission-denied', 'Contribution order does not belong to this account.');
  }
  if (typeof payment.amount !== 'number' || !SOS_CONTRIBUTION_PAISE.has(payment.amount)) {
    throw new HttpsError('failed-precondition', 'Contribution order has an invalid amount.');
  }
  const capturedPayment = await verifyCapturedRazorpayPayment(
    orderId as string,
    paymentId as string,
    signature as string
  );
  if (capturedPayment.amount !== payment.amount) {
    throw new HttpsError('failed-precondition', 'Contribution payment amount does not match the order.');
  }
  await db.runTransaction(async (transaction) => {
    const storedPayment = await transaction.get(paymentRef);
    const data = storedPayment.data();
    if (!data || data.user_id !== uid || data.type !== 'sos_contribution') {
      throw new HttpsError('permission-denied', 'Contribution order is invalid.');
    }
    if (data.status === 'paid' && data.payment_id === paymentId) return;
    if (data.status !== 'created') throw new HttpsError('already-exists', 'This contribution order has already been used.');
    transaction.update(paymentRef, {
      status: 'paid',
      payment_id: paymentId,
      paid_at: FieldValue.serverTimestamp()
    });
  });
  return { verified: true };
});

export const createEmergencyExtensionOrder = onCall({
  secrets: [razorpayKeyId, razorpayKeySecret]
}, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const requestId = request.data?.requestId;
  if (typeof requestId !== 'string') throw new HttpsError('invalid-argument', 'Request ID is required.');
  const requestRef = db.collection('requests').doc(requestId);
  const requestSnapshot = await requestRef.get();
  const emergencyRequest = requestSnapshot.data();
  if (
    !requestSnapshot.exists ||
    emergencyRequest?.requester_id !== uid ||
    emergencyRequest.status !== 'Open' ||
    emergencyRequest.is_emergency !== true ||
    !emergencyRequest.expires_at ||
    new Date(emergencyRequest.expires_at).getTime() <= Date.now()
  ) throw new HttpsError('failed-precondition', 'Only your active emergency request can be extended.');

  const basic = Buffer.from(`${razorpayKeyId.value()}:${razorpayKeySecret.value()}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 2500, currency: 'INR', receipt: requestId })
  });
  if (!response.ok) throw new HttpsError('internal', 'Could not create the payment order.');
  const order = await response.json() as { id: string; amount: number; currency: string };
  await db.collection('payments').doc(order.id).set({
    order_id: order.id,
    request_id: requestId,
    user_id: uid,
    amount: order.amount,
    currency: order.currency,
    status: 'created',
    created_at: FieldValue.serverTimestamp()
  });
  return { id: order.id, amount: order.amount, currency: order.currency };
});

export const verifyEmergencyExtensionPayment = onCall({
  secrets: [razorpayKeyId, razorpayKeySecret]
}, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const { requestId, orderId, paymentId, signature } = request.data as Record<string, unknown>;
  if (![requestId, orderId, paymentId, signature].every((value) => typeof value === 'string')) {
    throw new HttpsError('invalid-argument', 'Payment verification fields are required.');
  }
  const expected = createHmac('sha256', razorpayKeySecret.value())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const actualBytes = Buffer.from(signature as string, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new HttpsError('permission-denied', 'Payment signature is invalid.');
  }
  const paymentRef = db.collection('payments').doc(orderId as string);
  const [paymentSnapshot, paymentResponse] = await Promise.all([
    paymentRef.get(),
    fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId as string)}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${razorpayKeyId.value()}:${razorpayKeySecret.value()}`).toString('base64')}`
      }
    })
  ]);
  if (!paymentSnapshot.exists) throw new HttpsError('not-found', 'Payment order was not found.');
  const savedPayment = paymentSnapshot.data();
  if (!savedPayment || savedPayment.user_id !== uid || savedPayment.request_id !== requestId) {
    throw new HttpsError('permission-denied', 'Payment order does not belong to this request.');
  }
  if (!paymentResponse.ok) throw new HttpsError('internal', 'Could not confirm payment status with Razorpay.');
  const razorpayPayment = await paymentResponse.json() as {
    order_id: string; amount: number; currency: string; status: string; captured: boolean;
  };
  if (
    razorpayPayment.order_id !== orderId ||
    razorpayPayment.amount !== 2500 ||
    razorpayPayment.currency !== 'INR' ||
    razorpayPayment.status !== 'captured' ||
    razorpayPayment.captured !== true
  ) throw new HttpsError('failed-precondition', 'Payment is not captured for the expected amount and order.');

  const requestRef = db.collection('requests').doc(requestId as string);
  await db.runTransaction(async (transaction) => {
    const [storedPayment, emergencyRequest] = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(requestRef)
    ]);
    if (!storedPayment.exists || !emergencyRequest.exists) throw new HttpsError('not-found', 'Payment or request was not found.');
    const paymentData = storedPayment.data();
    const requestData = emergencyRequest.data();
    if (!paymentData || !requestData || paymentData.user_id !== uid || requestData.requester_id !== uid) {
      throw new HttpsError('permission-denied', 'You do not own this payment and request.');
    }
    if (paymentData.status === 'paid' && paymentData.payment_id === paymentId) return;
    if (paymentData.status !== 'created') throw new HttpsError('already-exists', 'This order has already been used.');
    if (
      requestData.status !== 'Open' ||
      requestData.is_emergency !== true ||
      !requestData.expires_at ||
      new Date(requestData.expires_at).getTime() <= Date.now()
    ) throw new HttpsError('failed-precondition', 'This emergency request is no longer active.');
    const currentExpiry = new Date(requestData.expires_at).getTime();
    transaction.update(requestRef, { expires_at: new Date(Math.max(currentExpiry, Date.now()) + 5 * 60 * 1000).toISOString() });
    transaction.update(paymentRef, { status: 'paid', payment_id: paymentId, paid_at: FieldValue.serverTimestamp() });
  });
  return { verified: true };
});

export const createMarketplaceSubscription = onCall({
  secrets: [razorpayKeyId, razorpayKeySecret]
}, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  await verifyMarketplacePlan();
  const subscriptionRef = db.collection('marketplaceSubscriptions').doc(uid);
  const existingSnapshot = await subscriptionRef.get();
  const existing = existingSnapshot.data();
  if (existing?.subscription_id && typeof existing.subscription_id === 'string') {
    const currentSubscription = await fetchRazorpaySubscription(existing.subscription_id);
    if (['created', 'authenticated', 'active', 'pending', 'halted', 'paused'].includes(currentSubscription.status)) {
      await syncMarketplaceSubscription(
        uid,
        currentSubscription,
        existing.cancel_at_period_end === true
      );
      return { subscriptionId: currentSubscription.id, keyId: razorpayKeyId.value() };
    }
  }

  const lockRef = db.collection('marketplaceSubscriptionCreationLocks').doc(uid);
  const lockToken = randomUUID();
  await db.runTransaction(async (transaction) => {
    const [lockSnapshot, latestSubscription] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(subscriptionRef)
    ]);
    if (
      typeof latestSubscription.data()?.subscription_id === 'string' &&
      ['created', 'authenticated', 'active', 'pending', 'halted', 'paused'].includes(
        String(latestSubscription.data()?.status)
      )
    ) {
      throw new HttpsError('aborted', 'A subscription was just created. Refresh status and try again.');
    }
    if (Number(lockSnapshot.data()?.expires_at || 0) > Date.now()) {
      throw new HttpsError('aborted', 'Subscription checkout is already being prepared. Wait a moment and retry.');
    }
    transaction.set(lockRef, {
      token: lockToken,
      expires_at: Date.now() + 10 * 60 * 1000
    });
  });

  try {
    const response = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: getRazorpayAuthorization(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan_id: razorpayMonthlyPlanId.value(),
        total_count: MARKETPLACE_SUBSCRIPTION_CYCLES,
        quantity: 1,
        customer_notify: true,
        notes: { firebase_uid: uid, product: 'hanuman_marketplace' }
      })
    });
    if (!response.ok) throw new HttpsError('internal', 'Could not create the monthly Razorpay subscription.');
    const subscription = await response.json() as RazorpaySubscription;
    if (!subscription.id || subscription.plan_id !== razorpayMonthlyPlanId.value()) {
      throw new HttpsError('internal', 'Razorpay returned an invalid subscription.');
    }
    const currentPeriodEnd = Number.isInteger(subscription.current_end) && Number(subscription.current_end) > 0
      ? Number(subscription.current_end)
      : null;
    await db.runTransaction(async (transaction) => {
      const currentLock = await transaction.get(lockRef);
      if (currentLock.data()?.token !== lockToken) {
        throw new HttpsError('aborted', 'Subscription checkout expired before it could be saved. Refresh status and retry.');
      }
      transaction.set(db.collection('razorpaySubscriptionOwners').doc(subscription.id), {
        user_id: uid,
        plan_id: subscription.plan_id,
        updated_at: FieldValue.serverTimestamp()
      });
      transaction.set(subscriptionRef, {
        subscription_id: subscription.id,
        status: subscription.status,
        is_active: isMarketplaceSubscriptionActive(subscription.status, currentPeriodEnd),
        current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
        cancel_at_period_end: false,
        last_webhook_created_at: 0,
        updated_at: FieldValue.serverTimestamp()
      });
      transaction.delete(lockRef);
    });
    return { subscriptionId: subscription.id, keyId: razorpayKeyId.value() };
  } catch (error) {
    try {
      await db.runTransaction(async (transaction) => {
        const currentLock = await transaction.get(lockRef);
        if (currentLock.data()?.token === lockToken) transaction.delete(lockRef);
      });
    } catch (cleanupError) {
      console.error('Could not release marketplace subscription creation lock:', cleanupError);
    }
    throw error;
  }
});

export const verifyMarketplaceSubscription = onCall({
  secrets: [razorpayKeyId, razorpayKeySecret]
}, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const { subscriptionId, paymentId, signature } = request.data as Record<string, unknown>;
  if (
    typeof subscriptionId !== 'string' ||
    typeof paymentId !== 'string' ||
    typeof signature !== 'string'
  ) throw new HttpsError('invalid-argument', 'Subscription verification fields are required.');

  const ownerSnapshot = await db.collection('razorpaySubscriptionOwners').doc(subscriptionId).get();
  const subscriptionSnapshot = await db.collection('marketplaceSubscriptions').doc(uid).get();
  if (
    !ownerSnapshot.exists ||
    ownerSnapshot.data()?.user_id !== uid ||
    subscriptionSnapshot.data()?.subscription_id !== subscriptionId
  ) throw new HttpsError('permission-denied', 'Subscription does not belong to this account.');

  const expected = createHmac('sha256', razorpayKeySecret.value())
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new HttpsError('permission-denied', 'Subscription payment signature is invalid.');
  }

  const subscription = await fetchRazorpaySubscription(subscriptionId);
  return await syncMarketplaceSubscription(uid, subscription);
});

export const getMarketplaceSubscriptionStatus = onCall({
  secrets: [razorpayKeyId, razorpayKeySecret]
}, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const subscriptionRef = db.collection('marketplaceSubscriptions').doc(uid);
  const snapshot = await subscriptionRef.get();
  const subscriptionId = snapshot.data()?.subscription_id;
  if (typeof subscriptionId !== 'string') {
    return { active: false, status: 'inactive', currentPeriodEnd: null, cancelAtPeriodEnd: false };
  }
  const subscription = await fetchRazorpaySubscription(subscriptionId);
  return await syncMarketplaceSubscription(
    uid,
    subscription,
    snapshot.data()?.cancel_at_period_end === true
  );
});

export const cancelMarketplaceSubscription = onCall({
  secrets: [razorpayKeyId, razorpayKeySecret]
}, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const subscriptionRef = db.collection('marketplaceSubscriptions').doc(uid);
  const subscriptionSnapshot = await subscriptionRef.get();
  const subscriptionId = subscriptionSnapshot.data()?.subscription_id;
  if (typeof subscriptionId !== 'string') {
    throw new HttpsError('failed-precondition', 'There is no marketplace subscription to cancel.');
  }
  const ownerSnapshot = await db.collection('razorpaySubscriptionOwners').doc(subscriptionId).get();
  if (!ownerSnapshot.exists || ownerSnapshot.data()?.user_id !== uid) {
    throw new HttpsError('permission-denied', 'Subscription does not belong to this account.');
  }
  const response = await fetch(
    `https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {
      method: 'POST',
      headers: {
        Authorization: getRazorpayAuthorization(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ cancel_at_cycle_end: true })
    }
  );
  if (!response.ok) throw new HttpsError('internal', 'Could not schedule subscription cancellation.');
  const subscription = await response.json() as RazorpaySubscription;
  const status = await syncMarketplaceSubscription(uid, subscription, true);
  return status;
});

export const razorpaySubscriptionWebhook = onRequest({
  secrets: [razorpayWebhookSecret]
}, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).send('Method not allowed.');
    return;
  }
  const signature = request.get('x-razorpay-signature');
  if (!signature || !request.rawBody) {
    response.status(400).send('Missing webhook signature or body.');
    return;
  }
  const expected = createHmac('sha256', razorpayWebhookSecret.value())
    .update(request.rawBody)
    .digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    response.status(400).send('Invalid webhook signature.');
    return;
  }

  const event = request.body as {
    id?: string;
    event?: string;
    created_at?: number;
    payload?: { subscription?: { entity?: RazorpaySubscription } };
  };
  const subscription = event.payload?.subscription?.entity;
  if (!event.event?.startsWith('subscription.') || !subscription?.id) {
    response.status(200).send('Ignored.');
    return;
  }

  const ownerRef = db.collection('razorpaySubscriptionOwners').doc(subscription.id);
  const ownerSnapshot = await ownerRef.get();
  const uid = ownerSnapshot.data()?.user_id;
  if (typeof uid !== 'string' || subscription.plan_id !== razorpayMonthlyPlanId.value()) {
    response.status(200).send('Untracked subscription.');
    return;
  }

  const eventId = event.id || createHash('sha256').update(request.rawBody).digest('hex');
  const eventRef = db.collection('razorpaySubscriptionWebhookEvents').doc(eventId);
  const subscriptionRef = db.collection('marketplaceSubscriptions').doc(uid);
  const currentPeriodEnd = Number.isInteger(subscription.current_end) && Number(subscription.current_end) > 0
    ? Number(subscription.current_end)
    : null;
  await db.runTransaction(async (transaction) => {
    const [seenEvent, currentSubscription] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(subscriptionRef)
    ]);
    if (seenEvent.exists) return;
    const lastEventAt = Number(currentSubscription.data()?.last_webhook_created_at || 0);
    const eventCreatedAt = Number(event.created_at || 0);
    const cancelAtPeriodEnd = currentSubscription.data()?.cancel_at_period_end === true;
    transaction.create(eventRef, {
      event: event.event,
      received_at: FieldValue.serverTimestamp()
    });
    if (
      currentSubscription.data()?.subscription_id !== subscription.id ||
      eventCreatedAt < lastEventAt
    ) return;
    const active = isMarketplaceSubscriptionActive(
      subscription.status,
      currentPeriodEnd,
      cancelAtPeriodEnd
    );
    transaction.set(subscriptionRef, {
      subscription_id: subscription.id,
      status: subscription.status,
      is_active: active,
      current_period_end: currentPeriodEnd
        ? new Date(currentPeriodEnd * 1000)
        : null,
      cancel_at_period_end: cancelAtPeriodEnd,
      last_webhook_created_at: eventCreatedAt,
      updated_at: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  response.status(200).send('Processed.');
});

export const getTurnCredentials = onCall({ secrets: [turnSharedSecret] }, async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const requestId = request.data?.requestId;
  const offerId = request.data?.offerId;
  if (typeof requestId !== 'string' || typeof offerId !== 'string') {
    throw new HttpsError('invalid-argument', 'Request and offer IDs are required.');
  }
  await verifyRequestParticipant(requestId, offerId, uid);
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const username = `${expiresAt}:${uid}`;
  const credential = createHmac('sha1', turnSharedSecret.value()).update(username).digest('base64');
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(turnUrls.value() ? [{
      urls: turnUrls.value().split(',').map((url) => url.trim()),
      username,
      credential
    }] : [])
  ];
  return { iceServers, expiresAt };
});

export const syncCallAccess = onDocumentWritten('requests/{requestId}', async (event) => {
  const requestId = event.params.requestId;
  const request = event.data?.after.data();
  const rtDatabaseUrl = firebaseDatabaseURL.value();
  if (!rtDatabaseUrl) {
    console.warn('FIREBASE_DATABASE_URL is not configured; call access sync skipped.');
    return;
  }
  const databaseApp = getApps().find((app) => app.name === 'call-access')
    || initializeApp({ databaseURL: rtDatabaseUrl }, 'call-access');
  const accessRef = getDatabase(databaseApp).ref(`callAccess/${requestId}`);
  if (!request || !['Connected', 'Completed'].includes(request.status)) {
    await accessRef.remove();
    return;
  }
  const acceptedOffers = await db.collection('offers')
    .where('request_id', '==', requestId)
    .where('status', '==', 'Accepted')
    .get();
  const acceptedOffer = acceptedOffers.docs[0]?.data();
  if (!acceptedOffer) {
    await accessRef.remove();
    return;
  }
  await accessRef.set({
    [request.requester_id]: true,
    [acceptedOffer.helper_id]: true
  });
});
