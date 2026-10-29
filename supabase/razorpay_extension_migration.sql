-- Store Razorpay orders server-side and prevent clients from changing payment state.
CREATE TABLE IF NOT EXISTS public.emergency_extension_payments (
  order_id TEXT PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.help_requests(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise = 2500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  payment_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  CONSTRAINT emergency_extension_payment_state CHECK (
    (status = 'pending' AND payment_id IS NULL AND paid_at IS NULL) OR
    (status = 'paid' AND payment_id IS NOT NULL AND paid_at IS NOT NULL)
  )
);

ALTER TABLE public.emergency_extension_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.emergency_extension_payments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.emergency_extension_payments TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_emergency_extension(
  p_order_id TEXT,
  p_payment_id TEXT,
  p_request_id UUID,
  p_requester_id UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payment public.emergency_extension_payments%ROWTYPE;
  new_expiry TIMESTAMPTZ;
BEGIN
  SELECT *
  INTO payment
  FROM public.emergency_extension_payments
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
    OR payment.request_id <> p_request_id
    OR payment.requester_id <> p_requester_id
    OR payment.amount_paise <> 2500
  THEN
    RAISE EXCEPTION 'Payment order does not match this alert.';
  END IF;

  IF payment.status = 'paid' THEN
    IF payment.payment_id <> p_payment_id THEN
      RAISE EXCEPTION 'Payment order has already been used.';
    END IF;
    SELECT expires_at INTO new_expiry
    FROM public.help_requests
    WHERE id = p_request_id;
    RETURN new_expiry;
  END IF;

  UPDATE public.help_requests
  SET expires_at = GREATEST(expires_at, now()) + INTERVAL '5 minutes'
  WHERE id = p_request_id
    AND requester_id = p_requester_id
    AND is_emergency = true
    AND status = 'Open'
  RETURNING expires_at INTO new_expiry;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This urgent alert can no longer be extended.';
  END IF;

  UPDATE public.emergency_extension_payments
  SET status = 'paid',
      payment_id = p_payment_id,
      paid_at = now()
  WHERE order_id = p_order_id;

  RETURN new_expiry;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_emergency_extension(TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_emergency_extension(TEXT, TEXT, UUID, UUID) TO service_role;
