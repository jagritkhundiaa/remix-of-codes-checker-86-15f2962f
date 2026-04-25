-- AIO Jobs queue
CREATE TABLE public.aio_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  access_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  bads INTEGER NOT NULL DEFAULT 0,
  twofa INTEGER NOT NULL DEFAULT 0,
  valid_mail INTEGER NOT NULL DEFAULT 0,
  xgp INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  combos_pending TEXT[] NOT NULL DEFAULT '{}',
  threads INTEGER NOT NULL DEFAULT 10,
  label TEXT,
  last_heartbeat TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_aio_jobs_status ON public.aio_jobs(status);
CREATE INDEX idx_aio_jobs_access_key ON public.aio_jobs(access_key);
CREATE INDEX idx_aio_jobs_created ON public.aio_jobs(created_at DESC);

ALTER TABLE public.aio_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read jobs" ON public.aio_jobs FOR SELECT USING (true);
CREATE POLICY "Public insert jobs" ON public.aio_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update jobs" ON public.aio_jobs FOR UPDATE USING (true);
CREATE POLICY "Public delete jobs" ON public.aio_jobs FOR DELETE USING (true);

-- AIO Results (every checked line)
CREATE TABLE public.aio_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.aio_jobs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  status TEXT NOT NULL,
  capture TEXT,
  country TEXT,
  subscriptions TEXT[],
  xbox_gamertag TEXT,
  has_xgp BOOLEAN DEFAULT false,
  has_xgpu BOOLEAN DEFAULT false,
  is_2fa BOOLEAN DEFAULT false,
  raw_response JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_aio_results_job ON public.aio_results(job_id);
CREATE INDEX idx_aio_results_status ON public.aio_results(status);
CREATE INDEX idx_aio_results_created ON public.aio_results(created_at DESC);

ALTER TABLE public.aio_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read results" ON public.aio_results FOR SELECT USING (true);
CREATE POLICY "Public insert results" ON public.aio_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Public delete results" ON public.aio_results FOR DELETE USING (true);

-- AIO Proxies (dedicated pool)
CREATE TABLE public.aio_proxies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proxy TEXT NOT NULL UNIQUE,
  protocol TEXT NOT NULL DEFAULT 'http',
  is_active BOOLEAN NOT NULL DEFAULT true,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_checked TIMESTAMP WITH TIME ZONE,
  rr_index BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_aio_proxies_active ON public.aio_proxies(is_active);

ALTER TABLE public.aio_proxies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read aio proxies" ON public.aio_proxies FOR SELECT USING (true);
CREATE POLICY "Public insert aio proxies" ON public.aio_proxies FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update aio proxies" ON public.aio_proxies FOR UPDATE USING (true);
CREATE POLICY "Public delete aio proxies" ON public.aio_proxies FOR DELETE USING (true);

-- Realtime + auto-update timestamp
ALTER PUBLICATION supabase_realtime ADD TABLE public.aio_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.aio_results;

CREATE OR REPLACE FUNCTION public.aio_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER aio_jobs_touch BEFORE UPDATE ON public.aio_jobs
FOR EACH ROW EXECUTE FUNCTION public.aio_touch_updated_at();