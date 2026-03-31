CREATE TABLE public.access_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.access_keys ENABLE ROW LEVEL SECURITY;

INSERT INTO public.access_keys (key) VALUES ('NEON-ALPHA-2026');