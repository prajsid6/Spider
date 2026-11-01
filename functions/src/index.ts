import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';
import webPush from 'web-push';

initializeApp();

const db = getFirestore();
const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const turnSharedSecret = defineSecret('TURN_SHARED_SECRET');
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY');
const vapidPublicKey = defineString('VAPID_PUBLIC_KEY');
const vapidSubject = defineString('VAPID_SUBJECT', { default: 'mailto:admin@example.com' });
const turnUrls = defineString('TURN_URLS', { default: '' });
const firebaseDatabaseURL = defineString('FIREBASE_DATABASE_URL', { default: '' });

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
