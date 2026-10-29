CREATE TABLE IF NOT EXISTS public.feature_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion TEXT NOT NULL CHECK (char_length(trim(suggestion)) BETWEEN 10 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.feature_suggestions FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.feature_suggestions TO anon, authenticated;

CREATE POLICY "Visitors can submit feature suggestions"
  ON public.feature_suggestions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (char_length(trim(suggestion)) BETWEEN 10 AND 2000);
