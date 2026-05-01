ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS bulk_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_projects_bulk_group ON public.projects(bulk_group_id) WHERE bulk_group_id IS NOT NULL;