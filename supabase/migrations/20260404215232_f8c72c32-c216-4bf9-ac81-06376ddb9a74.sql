
-- Categories for site discovery
CREATE TABLE public.scraper_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  search_queries TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scraper_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read categories" ON public.scraper_categories FOR SELECT USING (true);
CREATE POLICY "Public insert categories" ON public.scraper_categories FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update categories" ON public.scraper_categories FOR UPDATE USING (true);
CREATE POLICY "Public delete categories" ON public.scraper_categories FOR DELETE USING (true);

-- Discovered sites
CREATE TABLE public.scraped_sites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  category_id UUID REFERENCES public.scraper_categories(id) ON DELETE SET NULL,
  payment_gateway TEXT DEFAULT 'unknown',
  gateway_details JSONB DEFAULT '{}',
  stripe_pk TEXT,
  client_secret TEXT,
  requires_login BOOLEAN DEFAULT false,
  requires_phone BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',
  telegram_notified BOOLEAN NOT NULL DEFAULT false,
  last_checked TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(url)
);

ALTER TABLE public.scraped_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read sites" ON public.scraped_sites FOR SELECT USING (true);
CREATE POLICY "Public insert sites" ON public.scraped_sites FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update sites" ON public.scraped_sites FOR UPDATE USING (true);
CREATE POLICY "Public delete sites" ON public.scraped_sites FOR DELETE USING (true);

-- Index for quick lookups
CREATE INDEX idx_scraped_sites_status ON public.scraped_sites(status);
CREATE INDEX idx_scraped_sites_gateway ON public.scraped_sites(payment_gateway);
CREATE INDEX idx_scraped_sites_domain ON public.scraped_sites(domain);
