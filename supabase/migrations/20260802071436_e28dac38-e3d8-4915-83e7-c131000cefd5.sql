CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'fbos-ai-cycle',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--57b17798-8af1-491c-b6db-08c05e52f593.lovable.app/api/public/cron/ai-cycle',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-worker-token', (SELECT worker_token FROM public.settings WHERE id)
    ),
    body := '{}'::jsonb
  );
  $$
);