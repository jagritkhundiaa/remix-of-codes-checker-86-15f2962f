-- Dork Machine: jobs queue
CREATE TABLE public.dork_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  access_key text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'queued',
  preset text,
  dorks_pending text[] NOT NULL DEFAULT '{}',
  total_dorks integer NOT NULL DEFAULT 0,
  processed_dorks integer NOT NULL DEFAULT 0,
  results_count integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  engine text NOT NULL DEFAULT 'duckduckgo',
  results_per_dork integer NOT NULL DEFAULT 20,
  last_heartbeat timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dork_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read dork jobs" ON public.dork_jobs FOR SELECT USING (true);
CREATE POLICY "Public insert dork jobs" ON public.dork_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update dork jobs" ON public.dork_jobs FOR UPDATE USING (true);
CREATE POLICY "Public delete dork jobs" ON public.dork_jobs FOR DELETE USING (true);

CREATE INDEX idx_dork_jobs_access_key ON public.dork_jobs(access_key, created_at DESC);
CREATE INDEX idx_dork_jobs_status ON public.dork_jobs(status);

CREATE TRIGGER trg_dork_jobs_updated_at
BEFORE UPDATE ON public.dork_jobs
FOR EACH ROW EXECUTE FUNCTION public.aio_touch_updated_at();

-- Dork results
CREATE TABLE public.dork_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.dork_jobs(id) ON DELETE CASCADE,
  url text NOT NULL,
  domain text,
  title text,
  snippet text,
  dork text,
  engine text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dork_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read dork results" ON public.dork_results FOR SELECT USING (true);
CREATE POLICY "Public insert dork results" ON public.dork_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Public delete dork results" ON public.dork_results FOR DELETE USING (true);

CREATE INDEX idx_dork_results_job ON public.dork_results(job_id, created_at DESC);
CREATE UNIQUE INDEX idx_dork_results_job_url ON public.dork_results(job_id, url);

-- Dedicated proxy pool for dork engine
CREATE TABLE public.dork_proxies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proxy text NOT NULL UNIQUE,
  protocol text NOT NULL DEFAULT 'http',
  is_active boolean NOT NULL DEFAULT true,
  success_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  rr_index bigint NOT NULL DEFAULT 0,
  last_status text,
  last_checked timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dork_proxies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read dork proxies" ON public.dork_proxies FOR SELECT USING (true);
CREATE POLICY "Public insert dork proxies" ON public.dork_proxies FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update dork proxies" ON public.dork_proxies FOR UPDATE USING (true);
CREATE POLICY "Public delete dork proxies" ON public.dork_proxies FOR DELETE USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.dork_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dork_results;