-- Store one browser push endpoint and coarse location per opted-in device.
CREATE TABLE IF NOT EXISTS public.safety_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_push_subscriptions_user
  ON public.safety_push_subscriptions(user_id);

-- Per-sender delivery preferences, editable from the account/profile section.
CREATE TABLE IF NOT EXISTS public.safety_alert_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  radius_meters INTEGER NOT NULL DEFAULT 5000 CHECK (radius_meters BETWEEN 500 AND 50000),
  recipient_limit INTEGER NOT NULL DEFAULT 25 CHECK (recipient_limit BETWEEN 1 AND 25),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.safety_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.safety_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.safety_push_subscriptions TO service_role;

ALTER TABLE public.safety_alert_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.safety_alert_preferences FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.safety_alert_preferences TO service_role;
