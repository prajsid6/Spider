-- Apply this migration to existing Supabase projects to enable task ratings.
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

ALTER TABLE public.help_ratings ENABLE ROW LEVEL SECURITY;

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
