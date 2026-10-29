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

const constantTimeEquals = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const hmacSha256Hex = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Sign in to extend an urgent alert.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
  const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) {
    console.error('Emergency extension payment service is missing required environment configuration.');
    return jsonResponse(503, { error: 'Razorpay payments are not configured on the server.' });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
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

  const action = body.action;
  const requestId = body.requestId;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return jsonResponse(400, { error: 'Invalid alert.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  if (action === 'create') {
    const { data: helpRequest, error: requestError } = await admin
      .from('help_requests')
      .select('id, expires_at')
      .eq('id', requestId)
      .eq('requester_id', user.id)
      .eq('is_emergency', true)
      .eq('status', 'Open')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (requestError) {
      console.error('Could not validate urgent alert for extension.', requestError.message);
      return jsonResponse(500, { error: 'Could not validate this urgent alert.' });
    }
    if (!helpRequest) return jsonResponse(404, { error: 'This urgent alert is no longer active or does not belong to you.' });

    const receipt = `alert5_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const orderResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 2500,
        currency: 'INR',
        receipt,
        notes: { request_id: requestId, requester_id: user.id, purpose: 'urgent_alert_extension_5_minutes' }
      })
    });

    if (!orderResponse.ok) {
      console.error('Razorpay order creation failed.', orderResponse.status);
      return jsonResponse(502, { error: 'Razorpay could not start the payment. Please try again.' });
    }

    const order = await orderResponse.json();
    const { error: insertError } = await admin.from('emergency_extension_payments').insert({
      order_id: order.id,
      request_id: requestId,
      requester_id: user.id,
      amount_paise: 2500
    });
    if (insertError) {
      console.error('Could not save Razorpay order.', insertError.message);
      return jsonResponse(500, { error: 'Could not prepare the payment. Please try again.' });
    }

    return jsonResponse(200, { id: order.id, amount: 2500, currency: 'INR' });
  }

  if (action === 'verify') {
    const orderId = body.orderId;
    const paymentId = body.paymentId;
    const signature = body.signature;
    if (
      typeof orderId !== 'string' || orderId.length > 64 ||
      typeof paymentId !== 'string' || paymentId.length > 64 ||
      typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)
    ) {
      return jsonResponse(400, { error: 'Invalid payment confirmation.' });
    }

    const { data: paymentOrder, error: paymentOrderError } = await admin
      .from('emergency_extension_payments')
      .select('order_id, request_id, requester_id, amount_paise, status, payment_id')
      .eq('order_id', orderId)
      .eq('request_id', requestId)
      .eq('requester_id', user.id)
      .maybeSingle();

    if (paymentOrderError) {
      console.error('Could not load payment order.', paymentOrderError.message);
      return jsonResponse(500, { error: 'Could not verify the payment.' });
    }
    if (!paymentOrder || paymentOrder.amount_paise !== 2500) {
      return jsonResponse(404, { error: 'Payment order was not found for this alert.' });
    }
    if (paymentOrder.status === 'paid' && paymentOrder.payment_id === paymentId) {
      return jsonResponse(200, { verified: true });
    }

    const expectedSignature = await hmacSha256Hex(razorpayKeySecret, `${orderId}|${paymentId}`);
    if (!constantTimeEquals(expectedSignature, signature)) {
      return jsonResponse(400, { error: 'Payment signature is invalid.' });
    }

    const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: {
        Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`
      }
    });
    if (!paymentResponse.ok) {
      console.error('Razorpay payment lookup failed.', paymentResponse.status);
      return jsonResponse(502, { error: 'Could not confirm payment with Razorpay. Please try again.' });
    }

    const razorpayPayment = await paymentResponse.json();
    if (
      razorpayPayment.order_id !== orderId ||
      razorpayPayment.amount !== 2500 ||
      razorpayPayment.currency !== 'INR' ||
      razorpayPayment.status !== 'captured'
    ) {
      return jsonResponse(400, { error: 'Razorpay has not confirmed this payment as captured.' });
    }

    const { error: extensionError } = await admin.rpc('confirm_emergency_extension', {
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_request_id: requestId,
      p_requester_id: user.id
    });
    if (extensionError) {
      console.error('Verified payment could not extend the alert.', extensionError.message);
      return jsonResponse(409, { error: 'Payment was received but the alert could not be extended. Contact support with your Razorpay payment ID.' });
    }

    return jsonResponse(200, { verified: true });
  }

  return jsonResponse(400, { error: 'Unsupported payment action.' });
});
