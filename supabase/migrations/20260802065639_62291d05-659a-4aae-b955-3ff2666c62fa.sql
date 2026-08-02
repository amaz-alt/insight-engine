-- helper
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.settings (
  id BOOLEAN PRIMARY KEY DEFAULT true,
  worker_token TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  fb_account_name TEXT,
  session_status TEXT NOT NULL DEFAULT 'disconnected',
  last_heartbeat_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  daily_post_limit INT NOT NULL DEFAULT 3,
  min_delay_seconds INT NOT NULL DEFAULT 900,
  max_delay_seconds INT NOT NULL DEFAULT 3600,
  window_start_hour INT NOT NULL DEFAULT 9,
  window_end_hour INT NOT NULL DEFAULT 21,
  scan_interval_hours INT NOT NULL DEFAULT 6,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settings_singleton CHECK (id)
);

CREATE TABLE public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'lime',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fb_group_id TEXT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  can_post BOOLEAN NOT NULL DEFAULT true,
  member_count INT,
  activity_level TEXT NOT NULL DEFAULT 'unknown',
  health TEXT NOT NULL DEFAULT 'ok',
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (url)
);
CREATE TRIGGER groups_updated BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
  fb_post_id TEXT,
  content_hash TEXT NOT NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  permalink TEXT,
  posted_at TIMESTAMPTZ,
  reactions INT NOT NULL DEFAULT 0,
  comments_count INT NOT NULL DEFAULT 0,
  shares INT NOT NULL DEFAULT 0,
  top_comments JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw JSONB,
  analyzed_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_hash)
);
CREATE INDEX posts_group_idx ON public.posts(group_id, posted_at DESC);
CREATE INDEX posts_analyzed_idx ON public.posts(analyzed_at);

CREATE TABLE public.post_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL UNIQUE REFERENCES public.posts(id) ON DELETE CASCADE,
  pain_point TEXT,
  desired_outcome TEXT,
  objections TEXT[] NOT NULL DEFAULT '{}',
  frustrations TEXT[] NOT NULL DEFAULT '{}',
  topics TEXT[] NOT NULL DEFAULT '{}',
  buying_intent INT NOT NULL DEFAULT 0,
  urgency INT NOT NULL DEFAULT 0,
  audience_type TEXT,
  niche TEXT,
  sentiment TEXT,
  confidence INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX post_insights_niche_idx ON public.post_insights(niche);

CREATE TABLE public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT,
  why_it_matters TEXT,
  pain_point TEXT,
  niche TEXT,
  audience TEXT,
  demand_score INT NOT NULL DEFAULT 0,
  buying_intent INT NOT NULL DEFAULT 0,
  urgency INT NOT NULL DEFAULT 0,
  confidence INT NOT NULL DEFAULT 0,
  frequency INT NOT NULL DEFAULT 0,
  trend TEXT NOT NULL DEFAULT 'flat',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  recommended_products JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER opportunities_updated BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.opportunity_posts (
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, post_id)
);

CREATE TABLE public.content_pieces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'value_post',
  variant_label TEXT,
  hook TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER content_pieces_updated BEFORE UPDATE ON public.content_pieces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_piece_id UUID NOT NULL REFERENCES public.content_pieces(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  result_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_posts_due_idx ON public.scheduled_posts(status, scheduled_for);

CREATE TABLE public.worker_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INT NOT NULL DEFAULT 5,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX worker_jobs_queue_idx ON public.worker_jobs(status, scheduled_for, priority);

CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_created_idx ON public.activity_log(created_at DESC);

-- grants: single-user tool, no login
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings, public.folders, public.groups, public.posts, public.post_insights, public.opportunities, public.opportunity_posts, public.content_pieces, public.scheduled_posts, public.worker_jobs, public.activity_log TO anon, authenticated;
GRANT ALL ON public.settings, public.folders, public.groups, public.posts, public.post_insights, public.opportunities, public.opportunity_posts, public.content_pieces, public.scheduled_posts, public.worker_jobs, public.activity_log TO service_role;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open settings" ON public.settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open folders" ON public.folders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open groups" ON public.groups FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open posts" ON public.posts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open post_insights" ON public.post_insights FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open opportunities" ON public.opportunities FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open opportunity_posts" ON public.opportunity_posts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open content_pieces" ON public.content_pieces FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open scheduled_posts" ON public.scheduled_posts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open worker_jobs" ON public.worker_jobs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open activity_log" ON public.activity_log FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

INSERT INTO public.settings (id) VALUES (true);

INSERT INTO public.folders (name, color) VALUES ('Digital Products', 'lime'), ('Freelancing', 'cyan'), ('Productivity', 'amber');

INSERT INTO public.groups (name, url, fb_group_id, folder_id, enabled, can_post, member_count, activity_level, health, engagement_score, last_scanned_at)
SELECT 'Notion Templates & Systems', 'https://facebook.com/groups/notion-templates', '1000001', (SELECT id FROM public.folders WHERE name='Digital Products'), true, true, 48200, 'high', 'ok', 78, now() - interval '3 hours'
UNION ALL SELECT 'Freelance Copywriters Hub', 'https://facebook.com/groups/freelance-copywriters', '1000002', (SELECT id FROM public.folders WHERE name='Freelancing'), true, true, 26400, 'high', 'ok', 71, now() - interval '5 hours'
UNION ALL SELECT 'Etsy Digital Sellers', 'https://facebook.com/groups/etsy-digital-sellers', '1000003', (SELECT id FROM public.folders WHERE name='Digital Products'), true, false, 33900, 'medium', 'no_posting', 54, now() - interval '9 hours'
UNION ALL SELECT 'ADHD Productivity Support', 'https://facebook.com/groups/adhd-productivity', '1000004', (SELECT id FROM public.folders WHERE name='Productivity'), true, true, 61500, 'high', 'ok', 83, now() - interval '2 hours'
UNION ALL SELECT 'Small Business Bookkeeping', 'https://facebook.com/groups/smb-bookkeeping', '1000005', (SELECT id FROM public.folders WHERE name='Freelancing'), false, true, 14800, 'low', 'stale', 31, now() - interval '4 days';

INSERT INTO public.posts (group_id, fb_post_id, content_hash, author_name, content, permalink, posted_at, reactions, comments_count, shares, analyzed_at)
SELECT g.id, 'p1', 'h1', 'Maya R.', 'I have bought like four Notion templates and I still cannot keep my client work organised. Every system falls apart after week two. Does anyone actually have something simple that survives a busy month?', g.url || '/posts/p1', now() - interval '6 hours', 142, 63, 4, now() - interval '5 hours' FROM public.groups g WHERE g.fb_group_id='1000001'
UNION ALL SELECT g.id, 'p2', 'h2', 'Daniel K.', 'Onboarding new clients takes me a full day of copy-pasting emails and contracts. I know I should have a repeatable process but every time I try to build one I get overwhelmed and give up.', g.url || '/posts/p2', now() - interval '11 hours', 98, 41, 2, now() - interval '10 hours' FROM public.groups g WHERE g.fb_group_id='1000002'
UNION ALL SELECT g.id, 'p3', 'h3', 'Priya S.', 'Second month in a row I underpriced a retainer. I genuinely do not know how to work out what to charge and I am scared of scaring clients off. Is there a calculator or worksheet people use?', g.url || '/posts/p3', now() - interval '1 day', 211, 88, 12, now() - interval '22 hours' FROM public.groups g WHERE g.fb_group_id='1000002'
UNION ALL SELECT g.id, 'p4', 'h4', 'Tom W.', 'My planner works for three days then I abandon it. I need something that assumes I will fall off and helps me restart without the guilt spiral.', g.url || '/posts/p4', now() - interval '2 days', 340, 127, 21, now() - interval '2 days' FROM public.groups g WHERE g.fb_group_id='1000004'
UNION ALL SELECT g.id, 'p5', 'h5', 'Alina M.', 'Client onboarding chaos again. Do I really need a whole CRM or is there a lightweight checklist approach that just works?', g.url || '/posts/p5', now() - interval '3 hours', 76, 29, 1, now() - interval '2 hours' FROM public.groups g WHERE g.fb_group_id='1000001'
UNION ALL SELECT g.id, 'p6', 'h6', 'Jess P.', 'How do you all price digital products? I keep guessing and then discounting because nobody buys at first.', g.url || '/posts/p6', now() - interval '4 days', 188, 74, 9, now() - interval '4 days' FROM public.groups g WHERE g.fb_group_id='1000003';

INSERT INTO public.post_insights (post_id, pain_point, desired_outcome, objections, frustrations, topics, buying_intent, urgency, audience_type, niche, sentiment, confidence)
SELECT id, 'Bought templates keep collapsing under real client workload', 'A simple system that survives busy months', ARRAY['already wasted money on templates'], ARRAY['systems fall apart after two weeks'], ARRAY['notion','client management','systems'], 78, 64, 'Freelancer', 'Productivity systems', 'frustrated', 84 FROM public.posts WHERE fb_post_id='p1'
UNION ALL SELECT id, 'Manual client onboarding eats a full day', 'A repeatable onboarding process', ARRAY['gets overwhelmed building processes'], ARRAY['copy-pasting emails and contracts'], ARRAY['onboarding','templates','automation'], 82, 71, 'Service provider', 'Client onboarding', 'frustrated', 88 FROM public.posts WHERE fb_post_id='p2'
UNION ALL SELECT id, 'Repeatedly underpricing retainers', 'Confident, defensible pricing', ARRAY['fear of scaring clients away'], ARRAY['no method to calculate rates'], ARRAY['pricing','retainers','calculator'], 91, 86, 'Freelancer', 'Pricing', 'anxious', 92 FROM public.posts WHERE fb_post_id='p3'
UNION ALL SELECT id, 'Planners abandoned after a few days', 'A restart-friendly planning system', ARRAY['guilt about failing systems'], ARRAY['shame spiral after falling off'], ARRAY['planner','adhd','habits'], 74, 58, 'ADHD adult', 'Productivity systems', 'hopeful', 81 FROM public.posts WHERE fb_post_id='p4'
UNION ALL SELECT id, 'Onboarding chaos without wanting a full CRM', 'Lightweight checklist workflow', ARRAY['does not want heavy software'], ARRAY['repeated onboarding chaos'], ARRAY['onboarding','checklist'], 69, 55, 'Freelancer', 'Client onboarding', 'frustrated', 76 FROM public.posts WHERE fb_post_id='p5'
UNION ALL SELECT id, 'Guessing digital product prices then discounting', 'A pricing framework that holds', ARRAY['nobody buys at first'], ARRAY['constant discounting'], ARRAY['pricing','digital products'], 85, 68, 'Digital seller', 'Pricing', 'uncertain', 83 FROM public.posts WHERE fb_post_id='p6';

INSERT INTO public.opportunities (title, summary, why_it_matters, pain_point, niche, audience, demand_score, buying_intent, urgency, confidence, frequency, trend, keywords, recommended_products, status)
VALUES
('Freelancers cannot price retainers with confidence', 'Across pricing-adjacent threads, people repeatedly admit to guessing rates, underpricing retainers, then discounting out of fear.', 'Buying intent is unusually high and the pain repeats monthly with money attached, which makes a paid tool an easy yes.', 'No repeatable method to calculate and defend pricing', 'Pricing', 'Freelancers and digital sellers', 94, 88, 77, 90, 2, 'rising', ARRAY['pricing','retainer','underpricing','discounting'],
 '[{"name":"Retainer Pricing Calculator","format":"Spreadsheet + guide","why":"Turns the guesswork into a number they can defend"},{"name":"Rate Raise Script Pack","format":"Swipe file","why":"Removes the fear of scaring clients off"}]'::jsonb, 'new'),
('Client onboarding takes a full day of manual work', 'Service providers describe copy-pasting emails and contracts for every new client, and abandoning process-building when it feels heavy.', 'The pain is operational and weekly, and the fix is a template pack rather than software, which matches a low-price digital product perfectly.', 'Manual, unrepeatable client onboarding', 'Client onboarding', 'Freelancers and agencies', 87, 76, 63, 84, 2, 'rising', ARRAY['onboarding','checklist','contracts','welcome'],
 '[{"name":"Client Onboarding Checklist Kit","format":"Checklist + email templates","why":"Lightweight alternative to a CRM"},{"name":"Welcome Packet Template","format":"Doc template","why":"Removes the day of copy-pasting"}]'::jsonb, 'new'),
('Planners get abandoned after three days', 'People with ADHD-style workflows say every planner collapses quickly and the guilt stops them restarting.', 'Emotional pain plus repeat purchase behaviour: they already buy templates, they just need one designed for falling off.', 'Systems assume perfect consistency', 'Productivity systems', 'ADHD adults and busy freelancers', 79, 71, 52, 80, 2, 'flat', ARRAY['planner','restart','adhd','habits'],
 '[{"name":"Restart-Friendly Weekly Planner","format":"Printable + Notion","why":"Designed around falling off and restarting"},{"name":"No-Guilt Reset Workbook","format":"Workbook","why":"Addresses the shame spiral directly"}]'::jsonb, 'watching');

INSERT INTO public.opportunity_posts (opportunity_id, post_id)
SELECT o.id, p.id FROM public.opportunities o JOIN public.posts p ON p.fb_post_id IN ('p3','p6') WHERE o.niche='Pricing'
UNION ALL SELECT o.id, p.id FROM public.opportunities o JOIN public.posts p ON p.fb_post_id IN ('p2','p5') WHERE o.niche='Client onboarding'
UNION ALL SELECT o.id, p.id FROM public.opportunities o JOIN public.posts p ON p.fb_post_id IN ('p1','p4') WHERE o.niche='Productivity systems';

INSERT INTO public.content_pieces (opportunity_id, kind, variant_label, hook, body, status)
SELECT id, 'value_post', 'Variation A', 'You are not underpricing because you are bad at business.', 'You are not underpricing because you are bad at business. You are underpricing because you have no number to defend.

Here is the shift that fixed it for me: stop pricing the deliverable, price the month. Work out what a month of being available to that client actually costs you — hours, revisions, the mental tab you keep open — then divide backwards.

Three things that changed immediately:
1. I stopped discounting to fill silence.
2. I could explain the number in one sentence.
3. Scope creep became a pricing conversation instead of a resentment one.

If you want the calculator I use for this, say the word and I will drop it in the comments.', 'approved' FROM public.opportunities WHERE niche='Pricing'
UNION ALL SELECT id, 'engagement_post', 'Variation B', 'Quick poll for the freelancers here.', 'Quick poll for the freelancers here: when you quoted your last retainer, did you calculate it or feel it?

No judgement, I felt mine for about three years. Curious how many of us are still guessing.', 'draft' FROM public.opportunities WHERE niche='Pricing'
UNION ALL SELECT id, 'value_post', 'Variation A', 'Onboarding should not cost you a working day.', 'Onboarding should not cost you a working day.

If every new client means rewriting the same welcome email, hunting the contract, and re-explaining your process, you do not need a CRM. You need four files that never change.

The welcome email. The contract. The intake questions. The what-happens-next note.

Write them once, badly. Improve them on client three. That is the whole system.', 'draft' FROM public.opportunities WHERE niche='Client onboarding';

INSERT INTO public.scheduled_posts (content_piece_id, group_id, scheduled_for, status)
SELECT c.id, g.id, now() + interval '4 hours', 'pending' FROM public.content_pieces c JOIN public.groups g ON g.fb_group_id='1000002' WHERE c.variant_label='Variation A' AND c.kind='value_post' AND c.status='approved'
UNION ALL SELECT c.id, g.id, now() + interval '9 hours', 'pending' FROM public.content_pieces c JOIN public.groups g ON g.fb_group_id='1000001' WHERE c.variant_label='Variation A' AND c.kind='value_post' AND c.status='approved';

INSERT INTO public.activity_log (kind, level, message, group_id, created_at)
SELECT 'scan', 'success', 'Scanned ADHD Productivity Support — 14 new posts, 2 duplicates skipped', g.id, now() - interval '2 hours' FROM public.groups g WHERE g.fb_group_id='1000004'
UNION ALL SELECT 'insight', 'info', 'AI clustered 6 discussions into 3 demand groups', NULL, now() - interval '90 minutes'
UNION ALL SELECT 'scan', 'warning', 'Etsy Digital Sellers — posting unavailable, scan only', g.id, now() - interval '9 hours' FROM public.groups g WHERE g.fb_group_id='1000003'
UNION ALL SELECT 'publish', 'success', 'Published value post to Freelance Copywriters Hub', g.id, now() - interval '1 day' FROM public.groups g WHERE g.fb_group_id='1000002'
UNION ALL SELECT 'session', 'info', 'Worker heartbeat received — Facebook session healthy', NULL, now() - interval '11 minutes';