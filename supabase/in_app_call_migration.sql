-- Limit private WebRTC broadcast signaling to the requester and accepted helper.
DROP POLICY IF EXISTS "Users can view own profile or connected counterparty" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Accepted request participants can read call signals" ON realtime.messages;
CREATE POLICY "Accepted request participants can read call signals"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    extension = 'broadcast'
    AND EXISTS (
      SELECT 1
      FROM public.help_requests AS request
      JOIN public.help_offers AS offer ON offer.request_id = request.id
      WHERE realtime.topic() = 'spider-call:' || request.id::text || ':' || offer.id::text
        AND request.status IN ('Connected', 'Completed')
        AND offer.status = 'Accepted'
        AND auth.uid() IN (request.requester_id, offer.helper_id)
    )
  );

DROP POLICY IF EXISTS "Accepted request participants can send call signals" ON realtime.messages;
CREATE POLICY "Accepted request participants can send call signals"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    extension = 'broadcast'
    AND EXISTS (
      SELECT 1
      FROM public.help_requests AS request
      JOIN public.help_offers AS offer ON offer.request_id = request.id
      WHERE realtime.topic() = 'spider-call:' || request.id::text || ':' || offer.id::text
        AND request.status IN ('Connected', 'Completed')
        AND offer.status = 'Accepted'
        AND auth.uid() IN (request.requester_id, offer.helper_id)
    )
  );
