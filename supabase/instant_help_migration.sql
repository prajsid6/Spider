-- Add short-lived urgent practical-help alerts to existing deployments.
ALTER TABLE public.help_requests
  ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.help_requests
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'help_requests_emergency_expiry'
      AND conrelid = 'public.help_requests'::regclass
  ) THEN
    ALTER TABLE public.help_requests
      ADD CONSTRAINT help_requests_emergency_expiry
      CHECK (NOT is_emergency OR expires_at IS NOT NULL);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_offer_accepted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Accepted' AND (OLD.status IS DISTINCT FROM 'Accepted') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.help_requests
      WHERE id = NEW.request_id
        AND status = 'Open'
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      RAISE EXCEPTION 'Cannot accept an offer on a request that is not Open or has expired.';
    END IF;

    UPDATE public.help_requests
    SET status = 'Connected'
    WHERE id = NEW.request_id;

    UPDATE public.help_offers
    SET status = 'Declined'
    WHERE request_id = NEW.request_id
      AND id <> NEW.id
      AND status = 'Pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP POLICY IF EXISTS "Users can offer help on open requests" ON public.help_offers;
CREATE POLICY "Users can offer help on open requests"
  ON public.help_offers
  FOR INSERT
  WITH CHECK (
    auth.uid() = helper_id AND
    EXISTS (
      SELECT 1
      FROM public.help_requests
      WHERE public.help_requests.id = request_id
        AND public.help_requests.status = 'Open'
        AND public.help_requests.requester_id <> auth.uid()
        AND (public.help_requests.expires_at IS NULL OR public.help_requests.expires_at > now())
    )
  );
