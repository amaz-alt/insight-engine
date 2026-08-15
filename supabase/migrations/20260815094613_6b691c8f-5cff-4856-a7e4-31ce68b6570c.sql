CREATE TABLE public.accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  profile_dir text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  needs_login boolean NOT NULL DEFAULT true,
  session_status text NOT NULL DEFAULT 'disconnected',
  chrome_status text NOT NULL DEFAULT 'unknown',
  last_heartbeat_at timestamptz,
  session_validated_at timestamptz,
  session_expires_at timestamptz,
  last_scan_at timestamptz,
  last_publish_at timestamptz,
  pending_command text,
  pending_command_at timestamptz,
  client_label text,
  daily_post_limit integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open accounts" ON public.accounts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER accounts_updated BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.groups ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.worker_jobs ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_groups_account ON public.groups(account_id);
CREATE INDEX idx_worker_jobs_account ON public.worker_jobs(account_id, status);

INSERT INTO public.accounts (name, profile_dir, needs_login, session_status, chrome_status, last_heartbeat_at, session_validated_at, session_expires_at, last_scan_at, last_publish_at)
SELECT COALESCE(NULLIF(s.fb_account_name, ''), 'Primary account'), 'default',
       s.session_status <> 'connected', s.session_status, s.chrome_status,
       s.last_heartbeat_at, s.session_validated_at, s.session_expires_at, s.last_scan_at, s.last_publish_at
FROM public.settings s WHERE s.id = true;

UPDATE public.groups SET account_id = (SELECT id FROM public.accounts WHERE profile_dir = 'default') WHERE account_id IS NULL;