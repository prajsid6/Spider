-- ==============================================================================
-- SPIDER - A People-Powered Paid Help Marketplace
-- Database Schema & Row-Level Security (RLS) Policies
-- ==============================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. Table: profiles
-- Exactly 4 required fields: name, username, mobile_number, date_of_birth
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2 AND char_length(name) <= 100),
  username TEXT UNIQUE NOT NULL CHECK (char_length(trim(username)) >= 3 AND char_length(username) <= 30 AND username ~ '^[a-zA-Z0-9_]+$'),
  mobile_number TEXT NOT NULL CHECK (mobile_number ~ '^[0-9+ -]{8,15}$'),
  date_of_birth DATE NOT NULL CHECK (date_of_birth <= CURRENT_DATE - INTERVAL '13 years'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index on username for fast lookup and uniqueness check
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- ------------------------------------------------------------------------------
-- 2. View: public_profiles
-- Exposes ONLY public identity (name, username, created_at).
-- Keeps mobile_number and date_of_birth strictly private.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  name,
  username,
  created_at
FROM public.profiles;

-- ------------------------------------------------------------------------------
-- 3. Table: help_requests
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (char_length(trim(description)) >= 5 AND char_length(description) <= 1000),
  details TEXT CHECK (details IS NULL OR char_length(details) <= 5000),
  budget_inr NUMERIC CHECK (budget_inr IS NULL OR (budget_inr >= 0 AND budget_inr <= 10000000)),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Connected', 'Completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  is_emergency BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  CONSTRAINT help_requests_emergency_expiry CHECK (NOT is_emergency OR expires_at IS NOT NULL)
);

ALTER TABLE public.help_requests ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.help_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

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

-- Indexes for request querying
CREATE INDEX IF NOT EXISTS idx_help_requests_status ON public.help_requests(status);
CREATE INDEX IF NOT EXISTS idx_help_requests_requester ON public.help_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_help_requests_created_at ON public.help_requests(created_at DESC);

-- ------------------------------------------------------------------------------
-- 4. Table: help_offers
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.help_requests(id) ON DELETE CASCADE,
  helper_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(trim(message)) >= 3 AND char_length(message) <= 2000),
  proposed_price_inr NUMERIC CHECK (proposed_price_inr IS NULL OR (proposed_price_inr >= 0 AND proposed_price_inr <= 10000000)),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for offer querying
CREATE INDEX IF NOT EXISTS idx_help_offers_request ON public.help_offers(request_id);
CREATE INDEX IF NOT EXISTS idx_help_offers_helper ON public.help_offers(helper_id);
CREATE INDEX IF NOT EXISTS idx_help_offers_status ON public.help_offers(status);

-- Ensure a helper cannot offer twice on the exact same request
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_offer_per_user_request 
  ON public.help_offers(request_id, helper_id);

-- Ensure only one accepted offer per request
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_accepted_offer_per_request
  ON public.help_offers(request_id)
  WHERE (status = 'Accepted');

-- ------------------------------------------------------------------------------
-- 5. Table: help_ratings
-- Each participant may rate the other once after a request is completed.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.help_requests(id) ON DELETE CASCADE,
  rater_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ratee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT help_ratings_distinct_users CHECK (rater_id <> ratee_id),
  CONSTRAINT help_ratings_one_per_rater_per_request UNIQUE (request_id, rater_id)
);

-- ------------------------------------------------------------------------------
-- 6. Helper Function & Trigger: Automatic Connection Flow
-- When an offer is updated to 'Accepted', automatically update the request status
-- to 'Connected' and decline any other pending offers on the same request.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_offer_accepted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Accepted' AND (OLD.status IS DISTINCT FROM 'Accepted') THEN
    -- Verify the request is still Open
    IF NOT EXISTS (
      SELECT 1 FROM public.help_requests 
      WHERE id = NEW.request_id
        AND status = 'Open'
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      RAISE EXCEPTION 'Cannot accept an offer on a request that is not Open or has expired.';
    END IF;

    -- Update the request status to Connected
    UPDATE public.help_requests
    SET status = 'Connected'
    WHERE id = NEW.request_id;

    -- Decline all other pending offers for this request
    UPDATE public.help_offers
    SET status = 'Declined'
    WHERE request_id = NEW.request_id AND id <> NEW.id AND status = 'Pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_handle_offer_accepted ON public.help_offers;
CREATE TRIGGER trg_handle_offer_accepted
  BEFORE UPDATE ON public.help_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_offer_accepted();

-- ------------------------------------------------------------------------------
-- 7. Trigger: Handle new user profile initialization on Supabase Auth Signup
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert profile if metadata was provided during signUp
  IF (NEW.raw_user_meta_data->>'name') IS NOT NULL AND 
     (NEW.raw_user_meta_data->>'username') IS NOT NULL THEN
    INSERT INTO public.profiles (id, name, username, mobile_number, date_of_birth)
    VALUES (
      NEW.id,
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'mobile_number',
      (NEW.raw_user_meta_data->>'date_of_birth')::DATE
    )
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        username = EXCLUDED.username,
        mobile_number = EXCLUDED.mobile_number,
        date_of_birth = EXCLUDED.date_of_birth;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 7. ROW-LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_ratings ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- PROFILES POLICIES
-- ------------------------------------------------------------------------------

-- Private profile fields (mobile number and DOB) are visible only to the owner.
-- Public identity is available through the public_profiles view.
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can update only their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Grant select on public_profiles view to authenticated and anon users
GRANT SELECT ON public.public_profiles TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- HELP_REQUESTS POLICIES
-- ------------------------------------------------------------------------------

-- Everyone (authenticated or public) can view help requests
CREATE POLICY "Anyone can view help requests"
  ON public.help_requests
  FOR SELECT
  USING (true);

-- Authenticated users can create requests where requester_id is themselves
CREATE POLICY "Authenticated users can create requests"
  ON public.help_requests
  FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

-- Only the requester can update their request (e.g. mark Connected or Completed)
CREATE POLICY "Requester can update own request"
  ON public.help_requests
  FOR UPDATE
  USING (auth.uid() = requester_id)
  WITH CHECK (auth.uid() = requester_id);

-- Only the requester can delete their request (if needed)
CREATE POLICY "Requester can delete own request"
  ON public.help_requests
  FOR DELETE
  USING (auth.uid() = requester_id);

-- ------------------------------------------------------------------------------
-- HELP_OFFERS POLICIES
-- ------------------------------------------------------------------------------

-- View offers:
-- Helpers can see their own offers.
-- Requesters can see offers made on their requests.
CREATE POLICY "Helpers and Requesters can view offers"
  ON public.help_offers
  FOR SELECT
  USING (
    auth.uid() = helper_id OR
    EXISTS (
      SELECT 1 FROM public.help_requests
      WHERE public.help_requests.id = help_offers.request_id
        AND public.help_requests.requester_id = auth.uid()
    )
  );

-- Insert offers:
-- Authenticated users can offer help IF:
-- 1. Helper is the authenticated user (helper_id = auth.uid())
-- 2. Request is currently 'Open'
-- 3. Helper is NOT the requester (cannot offer help to oneself)
CREATE POLICY "Users can offer help on open requests"
  ON public.help_offers
  FOR INSERT
  WITH CHECK (
    auth.uid() = helper_id AND
    EXISTS (
      SELECT 1 FROM public.help_requests
      WHERE public.help_requests.id = request_id
        AND public.help_requests.status = 'Open'
        AND public.help_requests.requester_id <> auth.uid()
        AND (public.help_requests.expires_at IS NULL OR public.help_requests.expires_at > now())
    )
  );

-- Update offers:
-- 1. Requester can update offer status (Accept/Decline)
-- 2. Helper can update their own offer message/price while still Pending
CREATE POLICY "Requester can accept/decline offers, helper can edit pending offer"
  ON public.help_offers
  FOR UPDATE
  USING (
    -- Requester of the associated request
    EXISTS (
      SELECT 1 FROM public.help_requests
      WHERE public.help_requests.id = help_offers.request_id
        AND public.help_requests.requester_id = auth.uid()
    )
    OR
    -- Helper who owns the offer (while pending)
    (auth.uid() = helper_id AND status = 'Pending')
  )
  WITH CHECK (
    -- If requester is updating, status can be changed to Accepted or Declined
    EXISTS (
      SELECT 1 FROM public.help_requests
      WHERE public.help_requests.id = help_offers.request_id
        AND public.help_requests.requester_id = auth.uid()
    )
    OR
    -- If helper is updating, they cannot self-accept their own offer
    (auth.uid() = helper_id AND status = 'Pending')
  );

-- ------------------------------------------------------------------------------
-- 8. HELP_RATINGS POLICIES
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Participants can view completed request ratings" ON public.help_ratings;
CREATE POLICY "Participants can view completed request ratings"
  ON public.help_ratings
  FOR SELECT
  USING (
    auth.uid() IN (rater_id, ratee_id) AND
    EXISTS (
      SELECT 1
      FROM public.help_requests hr
      JOIN public.help_offers ho ON ho.request_id = hr.id AND ho.status = 'Accepted'
      WHERE hr.id = help_ratings.request_id
        AND hr.status = 'Completed'
        AND (
          (help_ratings.rater_id = hr.requester_id AND help_ratings.ratee_id = ho.helper_id) OR
          (help_ratings.rater_id = ho.helper_id AND help_ratings.ratee_id = hr.requester_id)
        )
    )
  );

DROP POLICY IF EXISTS "Participants can rate each other after completion" ON public.help_ratings;
CREATE POLICY "Participants can rate each other after completion"
  ON public.help_ratings
  FOR INSERT
  WITH CHECK (
    auth.uid() = rater_id AND
    EXISTS (
      SELECT 1
      FROM public.help_requests hr
      JOIN public.help_offers ho ON ho.request_id = hr.id AND ho.status = 'Accepted'
      WHERE hr.id = help_ratings.request_id
        AND hr.status = 'Completed'
        AND (
          (rater_id = hr.requester_id AND ratee_id = ho.helper_id) OR
          (rater_id = ho.helper_id AND ratee_id = hr.requester_id)
        )
    )
  );

GRANT SELECT, INSERT ON public.help_ratings TO authenticated;

-- ------------------------------------------------------------------------------
-- 9. Enable Realtime Subscriptions (Optional but recommended for instant updates)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.help_requests;
  EXCEPTION WHEN duplicate_object THEN
    -- already added
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.help_offers;
  EXCEPTION WHEN duplicate_object THEN
    -- already added
  END;
END $$;
