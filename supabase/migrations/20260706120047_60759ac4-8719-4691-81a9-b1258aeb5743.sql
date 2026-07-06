CREATE TABLE public.saved_audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  label TEXT NOT NULL DEFAULT 'Fiverr audit',
  profile_url TEXT,
  gig_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  niche TEXT,
  issue TEXT,
  profile_audit JSONB,
  gig_audits JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed_gigs JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_audits TO authenticated;
GRANT ALL ON public.saved_audits TO service_role;
ALTER TABLE public.saved_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own audits" ON public.saved_audits FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_saved_audits_updated BEFORE UPDATE ON public.saved_audits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE INDEX idx_saved_audits_user_created ON public.saved_audits (user_id, created_at DESC);