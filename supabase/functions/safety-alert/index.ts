import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

const parseApproximateLocation = (body: Record<string, unknown>) => {
  const latitude = body.latitude;
  const longitude = body.longitude;
  if (
    typeof latitude !== 'number' || typeof longitude !== 'number' ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) return null;

  return {
    latitude: Number(latitude.toFixed(3)),
    longitude: Number(longitude.toFixed(3))
  };
};

const isAllowedPushEndpoint = (endpoint: string) => {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com' ||
      host === 'push.services.mozilla.com' ||
      host === 'web.push.apple.com' ||
      host.endsWith('.notify.windows.com') ||
      host.endsWith('.notify.windows.net')
    );
  } catch {
    return false;
  }
};

const distanceInMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse(401, { error: 'Sign in to use nearby safety alerts.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Safety alert service is missing Supabase server configuration.');
    return jsonResponse(503, { error: 'Nearby safety alerts are not configured on the server.' });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return jsonResponse(401, { error: 'Your session is invalid. Sign in again.' });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    if (body.action === 'get-preferences') {
      const { data: preferences, error } = await admin.from('safety_alert_preferences')
        .select('radius_meters, recipient_limit')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) {
        console.error('Could not load SOS preferences.', error.message);
        return jsonResponse(500, { error: 'Could not load your SOS delivery preferences.' });
      }
      return jsonResponse(200, {
        radiusMeters: preferences?.radius_meters ?? 5000,
        recipientLimit: preferences?.recipient_limit ?? 25
      });
    }

    if (body.action === 'save-preferences') {
      const radiusMeters = body.radiusMeters;
      const recipientLimit = body.recipientLimit;
      if (
        typeof radiusMeters !== 'number' || !Number.isInteger(radiusMeters) ||
        radiusMeters < 500 || radiusMeters > 50000 ||
        typeof recipientLimit !== 'number' || !Number.isInteger(recipientLimit) ||
        recipientLimit < 1 || recipientLimit > 25
      ) {
        return jsonResponse(400, { error: 'Choose a distance from 500 m to 50 km and 1 to 25 recipients.' });
      }
      const { error } = await admin.from('safety_alert_preferences').upsert({
        user_id: user.id,
        radius_meters: radiusMeters,
        recipient_limit: recipientLimit,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) {
        console.error('Could not save SOS preferences.', error.message);
        return jsonResponse(500, { error: 'Could not save your SOS delivery preferences.' });
      }
      return jsonResponse(200, { saved: true });
    }

    if (body.action === 'subscribe' || body.action === 'update-location') {
      if (body.action === 'subscribe' && (!vapidPublicKey || !vapidPrivateKey || !vapidSubject)) {
        return jsonResponse(503, { error: 'Push notifications are not configured on the server.' });
      }
      const location = parseApproximateLocation(body);
      if (!location) return jsonResponse(400, { error: 'A valid approximate location is required.' });

      const subscription = body.subscription;
      const endpoint = body.action === 'subscribe'
        ? (typeof subscription === 'object' && subscription !== null && 'endpoint' in subscription
          ? subscription.endpoint
          : null)
        : body.endpoint;
      if (typeof endpoint !== 'string' || endpoint.length > 2048 || !isAllowedPushEndpoint(endpoint)) {
        return jsonResponse(400, { error: 'Unsupported push subscription endpoint.' });
      }

      let p256dh: unknown;
      let auth: unknown;
      if (body.action === 'subscribe') {
        const keys = typeof subscription === 'object' && subscription !== null && 'keys' in subscription
          ? subscription.keys
          : null;
        if (typeof keys === 'object' && keys !== null) {
          p256dh = 'p256dh' in keys ? keys.p256dh : null;
          auth = 'auth' in keys ? keys.auth : null;
        }
        if (typeof p256dh !== 'string' || p256dh.length > 256 || typeof auth !== 'string' || auth.length > 256) {
          return jsonResponse(400, { error: 'Invalid push encryption keys.' });
        }
      }

      if (body.action === 'subscribe') {
        const { data: existingSubscription, error: existingError } = await admin.from('safety_push_subscriptions')
          .select('user_id')
          .eq('endpoint', endpoint)
          .maybeSingle();
        if (existingError) {
          console.error('Could not verify push subscription ownership.', existingError.message);
          return jsonResponse(500, { error: 'Could not verify this browser subscription.' });
        }
        if (existingSubscription && existingSubscription.user_id !== user.id) {
          return jsonResponse(409, { error: 'This browser subscription is already linked to another account. Disable it there before enrolling this account.' });
        }

        const { error } = await admin.from('safety_push_subscriptions').upsert({
            user_id: user.id,
            endpoint,
            p256dh,
            auth,
            ...location,
            updated_at: new Date().toISOString()
          }, { onConflict: 'endpoint' })
        if (error) {
          console.error('Could not save opted-in safety push subscription.', error.message);
          return jsonResponse(500, { error: 'Could not save your safety-alert settings.' });
        }
      } else {
        const { data: existingSubscription, error: lookupError } = await admin.from('safety_push_subscriptions')
          .select('id')
          .eq('endpoint', endpoint)
          .eq('user_id', user.id)
          .maybeSingle();
        if (lookupError) {
          console.error('Could not verify safety push subscription ownership.', lookupError.message);
          return jsonResponse(500, { error: 'Could not verify your safety-alert settings.' });
        }
        if (!existingSubscription) return jsonResponse(404, { error: 'This browser is not enrolled in nearby alerts.' });

        const { error } = await admin.from('safety_push_subscriptions')
          .update({ ...location, updated_at: new Date().toISOString() })
          .eq('endpoint', endpoint)
          .eq('user_id', user.id);
        if (error) {
          console.error('Could not update opted-in safety location.', error.message);
          return jsonResponse(500, { error: 'Could not update your safety-alert location.' });
        }
      }
      return jsonResponse(200, { saved: true });
    }

    if (body.action === 'unsubscribe') {
      const endpoint = body.endpoint;
      if (typeof endpoint !== 'string' || endpoint.length > 2048 || !isAllowedPushEndpoint(endpoint)) {
        return jsonResponse(400, { error: 'Invalid push subscription endpoint.' });
      }
      const { error } = await admin.from('safety_push_subscriptions')
        .delete()
        .eq('endpoint', endpoint)
        .eq('user_id', user.id);
      if (error) {
        console.error('Could not remove safety push subscription.', error.message);
        return jsonResponse(500, { error: 'Could not disable nearby safety alerts.' });
      }
      return jsonResponse(200, { removed: true });
    }

    if (body.action !== 'trigger') return jsonResponse(400, { error: 'Unsupported safety alert action.' });
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      return jsonResponse(503, { error: 'Push notifications are not configured on the server.' });
    }
    const location = parseApproximateLocation(body);
    if (!location) return jsonResponse(400, { error: 'A valid approximate location is required to send an SOS.' });
    const locationAddress = typeof body.locationAddress === 'string'
      ? body.locationAddress.trim().replace(/\s+/g, ' ')
      : '';
    if (locationAddress.length < 3 || locationAddress.length > 160) {
      return jsonResponse(400, { error: 'Add an address, area, or nearby landmark between 3 and 160 characters.' });
    }

    const { data: preferences, error: preferencesError } = await admin.from('safety_alert_preferences')
      .select('radius_meters, recipient_limit')
      .eq('user_id', user.id)
      .maybeSingle();
    if (preferencesError) {
      console.error('Could not load SOS delivery preferences.', preferencesError.message);
      return jsonResponse(500, { error: 'Could not load your SOS delivery preferences.' });
    }
    const radiusMeters = preferences?.radius_meters ?? 5000;
    const recipientLimit = preferences?.recipient_limit ?? 25;

    const { data: helpRequest, error: createError } = await admin.from('help_requests')
      .insert({
        requester_id: user.id,
        description: 'Safety SOS: I need urgent help. Please contact me through Spider.',
        details: `SOS address: ${locationAddress}. Approximate map location (about 100 m): ${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}.`,
        status: 'Open',
        is_emergency: true,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      })
      .select('id')
      .single();
    if (createError || !helpRequest) {
      console.error('Could not create safety SOS request.', createError?.message);
      return jsonResponse(500, { error: 'Could not create the SOS alert. Please try again or contact emergency services.' });
    }

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from('safety_push_subscriptions')
      .select('user_id, endpoint, p256dh, auth, latitude, longitude')
      .neq('user_id', user.id);
    if (subscriptionsError) {
      console.error('Could not load nearby safety recipients.', subscriptionsError.message);
      return jsonResponse(500, { error: 'SOS was created, but nearby recipients could not be loaded.' });
    }

    const byUser = new Map<string, {
      distance: number;
      subscriptions: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>;
    }>();
    for (const subscription of subscriptions || []) {
      const distance = distanceInMeters(location, {
        latitude: subscription.latitude,
        longitude: subscription.longitude
      });
      const recipient = byUser.get(subscription.user_id) || { distance, subscriptions: [] };
      recipient.distance = Math.min(recipient.distance, distance);
      recipient.subscriptions.push({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      });
      byUser.set(subscription.user_id, recipient);
    }

    const nearestRecipients = Array.from(byUser.entries())
      .filter(([, recipient]) => recipient.distance <= radiusMeters)
      .sort((a, b) => a[1].distance - b[1].distance)
      .slice(0, recipientLimit);
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const mapUrl = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
    const payload = JSON.stringify({
      title: 'Nearby safety SOS',
      body: `Someone nearby needs urgent help at ${locationAddress}. Open the map or Spider to respond.`,
      tag: `spider-sos-${helpRequest.id}`,
      url: '/',
      mapUrl
    });

    const deliveredUsers = new Set<string>();
    const staleEndpoints: string[] = [];
    for (const [userId, recipient] of nearestRecipients) {
      const outcomes = await Promise.all(recipient.subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(subscription, payload, { TTL: 600 });
          return true;
        } catch (error) {
          const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
            ? error.statusCode
            : null;
          if (statusCode === 404 || statusCode === 410) staleEndpoints.push(subscription.endpoint);
          else console.error('Push delivery failed for a nearby SOS recipient.', statusCode || 'unknown');
          return false;
        }
      }));
      if (outcomes.some(Boolean)) deliveredUsers.add(userId);
    }

    if (staleEndpoints.length > 0) {
      const { error: cleanupError } = await admin.from('safety_push_subscriptions')
        .delete()
        .in('endpoint', staleEndpoints);
      if (cleanupError) console.error('Could not clean up expired push subscriptions.', cleanupError.message);
    }

    return jsonResponse(200, {
      requestId: helpRequest.id,
      recipients: deliveredUsers.size,
      recipientLimit,
      radiusMeters
    });
  } catch (error) {
    console.error('Safety alert request failed.', error instanceof Error ? error.message : 'Unknown error');
    return jsonResponse(500, { error: 'Safety alert request failed. Please try again or contact emergency services.' });
  }
});
