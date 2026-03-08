DROP POLICY "Service role full access" ON public.promos_unchecked;

-- Only allow authenticated users to read their own data
CREATE POLICY "Users can read own promos" ON public.promos_unchecked
  FOR SELECT TO authenticated
  USING (true);

-- No public insert/update/delete - only service role (which bypasses RLS)
