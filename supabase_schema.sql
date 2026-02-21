-- StudyIsle Supabase schema (safe to rerun)
-- This matches the fields used by the app's client-side sync in app.js.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  weekly_goal_hours int default 10,
  theme text default 'midnight',
  stopwatch_cap_on boolean default true,
  stopwatch_cap_hours int default 6,
  session_ambient_type text default 'off',
  session_ambient_volume double precision default 0.4,

  island_xp_sec bigint default 0,
  garden_growth_sec bigint default 0,
  garden_tree_type text default 'Apple',
  garden_harvested_on_tree int default 0,
  fruit_collection jsonb default '{}'::jsonb,

  updated_at timestamptz default now()
);

-- If an older schema exists, add missing columns (no-op if already present)
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists weekly_goal_hours int default 10;
alter table public.profiles add column if not exists theme text default 'midnight';
alter table public.profiles add column if not exists stopwatch_cap_on boolean default true;
alter table public.profiles add column if not exists stopwatch_cap_hours int default 6;
alter table public.profiles add column if not exists session_ambient_type text default 'off';
alter table public.profiles add column if not exists session_ambient_volume double precision default 0.4;
alter table public.profiles add column if not exists island_xp_sec bigint default 0;
alter table public.profiles add column if not exists garden_growth_sec bigint default 0;
alter table public.profiles add column if not exists garden_tree_type text default 'Apple';
alter table public.profiles add column if not exists garden_harvested_on_tree int default 0;
alter table public.profiles add column if not exists fruit_collection jsonb default '{}'::jsonb;
alter table public.profiles add column if not exists updated_at timestamptz default now();

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null,
  favorite boolean default false,
  created_ts timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, name)
);

alter table public.labels add column if not exists favorite boolean default false;
alter table public.labels add column if not exists created_ts timestamptz default now();
alter table public.labels add column if not exists updated_at timestamptz default now();

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec int not null,
  label_name text,
  source text,
  reward_mode text,
  updated_at timestamptz default now(),
  unique(user_id, client_id)
);

alter table public.sessions add column if not exists reward_mode text;
alter table public.sessions add column if not exists updated_at timestamptz default now();

-- Helpful indexes
create index if not exists sessions_user_id_idx on public.sessions(user_id);
create index if not exists labels_user_id_idx on public.labels(user_id);

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.labels enable row level security;
alter table public.sessions enable row level security;

-- ─────────────────────────────────────────────────────────────
-- Policies (drop + create)
-- ─────────────────────────────────────────────────────────────

-- profiles
drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;

create policy "profiles read own"
on public.profiles for select
using (auth.uid() = id);

create policy "profiles insert own"
on public.profiles for insert
with check (auth.uid() = id);

create policy "profiles update own"
on public.profiles for update
using (auth.uid() = id);

-- labels
drop policy if exists "labels read own" on public.labels;
drop policy if exists "labels insert own" on public.labels;
drop policy if exists "labels update own" on public.labels;
drop policy if exists "labels delete own" on public.labels;

create policy "labels read own"
on public.labels for select
using (auth.uid() = user_id);

create policy "labels insert own"
on public.labels for insert
with check (auth.uid() = user_id);

create policy "labels update own"
on public.labels for update
using (auth.uid() = user_id);

create policy "labels delete own"
on public.labels for delete
using (auth.uid() = user_id);

-- sessions
drop policy if exists "sessions read own" on public.sessions;
drop policy if exists "sessions insert own" on public.sessions;
drop policy if exists "sessions update own" on public.sessions;
drop policy if exists "sessions delete own" on public.sessions;

create policy "sessions read own"
on public.sessions for select
using (auth.uid() = user_id);

create policy "sessions insert own"
on public.sessions for insert
with check (auth.uid() = user_id);

create policy "sessions update own"
on public.sessions for update
using (auth.uid() = user_id);

create policy "sessions delete own"
on public.sessions for delete
using (auth.uid() = user_id);


-- Labels: store client-side label id strings in local_id to avoid UUID issues.
alter table if exists public.labels add column if not exists local_id text;
create unique index if not exists labels_user_local_id_uq on public.labels(user_id, local_id);
