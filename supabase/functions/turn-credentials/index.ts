import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse(401, { error: 'Sign in to start a call.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const turnUrls = Deno.env.get('TURN_URLS')?.split(',').map((url) => url.trim()).filter(Boolean);
  const turnSharedSecret = Deno.env.get('TURN_SHARED_SECRET');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !turnUrls?.length || !turnSharedSecret) {
    console.error('TURN credentials service is missing required server configuration.');
    return jsonResponse(503, { error: 'Private calling is not configured on the server.' });
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
  if (!isUuid(body.requestId) || !isUuid(body.offerId)) {
    return jsonResponse(400, { error: 'A valid connected request and accepted offer are required.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const [{ data: helpRequest, error: requestError }, { data: offer, error: offerError }] = await Promise.all([
    admin.from('help_requests').select('id, requester_id, status').eq('id', body.requestId).maybeSingle(),
    admin.from('help_offers').select('id, helper_id, status').eq('id', body.offerId)
      .eq('request_id', body.requestId).maybeSingle()
  ]);
  if (requestError || offerError) {
    console.error('Could not verify call participants.', requestError?.message, offerError?.message);
    return jsonResponse(500, { error: 'Could not verify call access.' });
  }
  if (
    !helpRequest || !offer ||
    !['Connected', 'Completed'].includes(helpRequest.status) ||
    offer.status !== 'Accepted' ||
    ![helpRequest.requester_id, offer.helper_id].includes(user.id)
  ) {
    return jsonResponse(403, { error: 'Only people connected on this request can call.' });
  }

  try {
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const username = `${expiresAt}:${user.id}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(turnSharedSecret),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username));
    const credential = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return jsonResponse(200, {
      iceServers: [
        { urls: turnUrls, username, credential },
        { urls: 'stun:stun.l.google.com:19302' }
      ],
      expiresAt
    });
  } catch (error) {
    console.error('Could not generate temporary TURN credentials.', error);
    return jsonResponse(500, { error: 'Could not prepare the call connection.' });
  }
});
