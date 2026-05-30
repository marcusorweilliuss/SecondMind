-- Cortex seed data.
-- Replace :uid with a real auth.users id, e.g. in the SQL editor run:
--   \set uid '00000000-0000-0000-0000-000000000000'
-- or do a find/replace of REPLACE_WITH_USER_ID below before running.

\set ON_ERROR_STOP on

-- Projects -----------------------------------------------------------------
insert into public.projects (id, name, description, user_id) values
  ('11111111-1111-1111-1111-111111111111', 'AI Governance',
   'Tracking regulation, safety frameworks, and policy on frontier models.',
   'REPLACE_WITH_USER_ID'),
  ('22222222-2222-2222-2222-222222222222', 'Synthetic Biology',
   'Engineering biology, biosecurity, and lab automation.',
   'REPLACE_WITH_USER_ID')
on conflict (id) do nothing;

-- Signals ------------------------------------------------------------------
insert into public.signals
  (project_id, user_id, highlight_text, source_url, source_title, signal_summary, connected_to)
values
  ('11111111-1111-1111-1111-111111111111', 'REPLACE_WITH_USER_ID',
   'The EU AI Act classifies systems by risk tier, with the strictest obligations on high-risk deployments.',
   'https://example.com/eu-ai-act', 'EU AI Act Overview',
   'EU AI Act uses a tiered, risk-based regulatory model.',
   'Bridges to your note on NIST risk frameworks — both anchor obligations to deployment risk rather than model size.'),
  ('11111111-1111-1111-1111-111111111111', 'REPLACE_WITH_USER_ID',
   'Compute thresholds are emerging as a proxy for capability in several draft regulations.',
   'https://example.com/compute-thresholds', 'Compute as a Governance Lever',
   'Regulators are using training compute as a capability proxy.',
   'Connects to EU AI Act tiering — a second axis (compute) layered on top of risk tiers.'),
  ('22222222-2222-2222-2222-222222222222', 'REPLACE_WITH_USER_ID',
   'Automated cloud labs let researchers run wet-lab protocols remotely with reproducible results.',
   'https://example.com/cloud-labs', 'The Rise of Cloud Labs',
   'Cloud labs enable remote, reproducible wet-lab experiments.',
   'Relates to your biosecurity note — remote access expands the surface area for dual-use oversight.')
on conflict do nothing;

-- Knowledge notes ----------------------------------------------------------
insert into public.knowledge_notes (user_id, content, tags, source_url) values
  ('REPLACE_WITH_USER_ID',
   'NIST AI Risk Management Framework is voluntary, not binding, as of 2024.',
   array['ai','policy','nist'], 'https://example.com/nist-rmf'),
  ('REPLACE_WITH_USER_ID',
   'The EU AI Act entered into force in 2024 with staggered obligations through 2027.',
   array['ai','policy','eu'], 'https://example.com/eu-ai-act'),
  ('REPLACE_WITH_USER_ID',
   'Biosecurity screening of synthetic DNA orders is currently voluntary for most providers.',
   array['synbio','biosecurity'], 'https://example.com/dna-screening')
on conflict do nothing;

-- Task context -------------------------------------------------------------
insert into public.task_contexts (user_id, task_description, active) values
  ('REPLACE_WITH_USER_ID',
   'Drafting a memo comparing AI governance approaches across the EU, US, and UK. Priorities: risk-tiering models, compute thresholds, and enforcement mechanisms. Avoid drifting into unrelated synthetic biology topics.',
   true)
on conflict do nothing;

-- Interest vectors ---------------------------------------------------------
insert into public.interest_vectors (user_id, vector_text, source, active) values
  ('REPLACE_WITH_USER_ID', 'EU AI Act enforcement timeline', 'auto', true),
  ('REPLACE_WITH_USER_ID', 'compute thresholds in AI regulation', 'auto', true),
  ('REPLACE_WITH_USER_ID', 'NIST AI risk management framework', 'auto', true)
on conflict do nothing;
