ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS target_duration_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS character_lock boolean NOT NULL DEFAULT true;