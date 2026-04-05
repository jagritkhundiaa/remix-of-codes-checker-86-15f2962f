
CREATE TABLE IF NOT EXISTS public.scraper_bot_auth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  granted_by text,
  granted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scraper_bot_auth ENABLE ROW LEVEL SECURITY;
