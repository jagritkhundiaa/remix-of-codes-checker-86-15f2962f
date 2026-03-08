CREATE TABLE public.promos_unchecked (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  title TEXT,
  status TEXT,
  source_email TEXT,
  pulled_by TEXT,
  discord_user_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Allow public insert from edge functions / bot
ALTER TABLE public.promos_unchecked ENABLE ROW LEVEL SECURITY;

-- RLS: allow service role full access (bot uses service key)
CREATE POLICY "Service role full access" ON public.promos_unchecked
  FOR ALL USING (true) WITH CHECK (true);