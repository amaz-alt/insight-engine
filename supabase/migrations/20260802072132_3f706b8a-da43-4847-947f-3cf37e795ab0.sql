ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS auto_publish boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS worker_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS worker_version text,
  ADD COLUMN IF NOT EXISTS chrome_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS session_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_command text,
  ADD COLUMN IF NOT EXISTS pending_command_at timestamptz,
  ADD COLUMN IF NOT EXISTS scans_per_hour integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS max_groups_per_cycle integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS randomization_window_minutes integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS quiet_hours_start integer NOT NULL DEFAULT 23,
  ADD COLUMN IF NOT EXISTS quiet_hours_end integer NOT NULL DEFAULT 7;

CREATE TABLE IF NOT EXISTS public.content_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'value_post',
  body text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_templates TO anon, authenticated;
GRANT ALL ON public.content_templates TO service_role;

ALTER TABLE public.content_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open content_templates" ON public.content_templates
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER content_templates_updated_at
  BEFORE UPDATE ON public.content_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();