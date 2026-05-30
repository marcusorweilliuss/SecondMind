-- Cortex schema for Supabase (PostgreSQL)
-- Run this in the Supabase SQL editor.

-- Extensions ---------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Tables -------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  highlight_text text not null,
  source_url text,
  source_title text,
  signal_summary text,
  connected_to text,
  created_at timestamptz not null default now()
);

create table if not exists public.task_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_description text not null,
  email_thread_text text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  tags text[],
  source_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.radar_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  headline text not null,
  url text not null,
  source text,
  published_date timestamptz,
  type text check (type in ('news', 'longread', 'paper', 'report')),
  why_read text,
  relevance_score numeric,
  novelty_score numeric,
  actionability_score numeric,
  interest_vector text,
  dismissed boolean not null default false,
  saved_to_project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.interest_vectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  vector_text text not null,
  source text not null default 'auto' check (source in ('auto', 'manual')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Supporting table: Gmail read-only OAuth tokens.
-- Not in the original spec, but required to persist the OAuth grant for
-- Behaviour 2's "pull most recent relevant thread" feature.
create table if not exists public.gmail_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expiry timestamptz,
  email text,
  created_at timestamptz not null default now()
);

-- Indexes ------------------------------------------------------------------
create index if not exists idx_signals_user on public.signals (user_id, created_at desc);
create index if not exists idx_signals_project on public.signals (project_id, created_at desc);
create index if not exists idx_radar_user on public.radar_items (user_id, created_at desc);
create index if not exists idx_vectors_user on public.interest_vectors (user_id, active);
create index if not exists idx_notes_user on public.knowledge_notes (user_id, created_at desc);
create index if not exists idx_task_user on public.task_contexts (user_id, active);

-- Row Level Security -------------------------------------------------------
alter table public.projects enable row level security;
alter table public.signals enable row level security;
alter table public.task_contexts enable row level security;
alter table public.knowledge_notes enable row level security;
alter table public.radar_items enable row level security;
alter table public.interest_vectors enable row level security;
alter table public.gmail_tokens enable row level security;

-- Owner-only policies. Each table: a user may only touch their own rows.
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects','signals','task_contexts','knowledge_notes',
    'radar_items','interest_vectors','gmail_tokens'
  ] loop
    execute format('drop policy if exists "owner_all_%1$s" on public.%1$I;', t);
    execute format(
      'create policy "owner_all_%1$s" on public.%1$I
         for all using (auth.uid() = user_id)
         with check (auth.uid() = user_id);', t);
  end loop;
end $$;
