ALTER TABLE public.worker_jobs
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS worker_jobs_status_sched_idx
  ON public.worker_jobs (status, scheduled_for);
CREATE INDEX IF NOT EXISTS worker_jobs_claimed_idx
  ON public.worker_jobs (status, claimed_at);
CREATE INDEX IF NOT EXISTS scheduled_posts_status_idx
  ON public.scheduled_posts (status, scheduled_for);
CREATE INDEX IF NOT EXISTS scheduled_posts_dupe_idx
  ON public.scheduled_posts (group_id, content_piece_id, status);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS job_lease_minutes integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS max_job_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS allow_repost_same_content boolean NOT NULL DEFAULT false;