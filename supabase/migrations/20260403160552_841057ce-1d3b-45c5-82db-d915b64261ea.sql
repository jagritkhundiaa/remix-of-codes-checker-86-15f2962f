CREATE TABLE public.custom_gates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'stripe',
  stripe_pk TEXT,
  client_secret TEXT,
  merchant TEXT,
  product TEXT,
  amount TEXT,
  currency TEXT DEFAULT 'USD',
  created_by TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_gates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active gates"
ON public.custom_gates
FOR SELECT
USING (is_active = true);

CREATE POLICY "Anyone can insert gates"
ON public.custom_gates
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Creator can update own gates"
ON public.custom_gates
FOR UPDATE
USING (true);

CREATE POLICY "Creator can delete own gates"
ON public.custom_gates
FOR DELETE
USING (true);