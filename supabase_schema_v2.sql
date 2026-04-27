create extension if not exists pgcrypto;

-- Bloomora V2 uses dedicated table names so it cannot collide with older
-- Bloomora/StudyIsle tables named profiles, labels, or sessions.

create table if not exists public.bloomora_profile_states (
  id uuid primary key references auth.users(id) on delete cascade,
  profile_data jsonb not null default '{}'::jsonb,
  gamification_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.bloomora_labels (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  color text not null,
  favorite boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.bloomora_tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  text text not null,
  notes text,
  label_id text,
  done boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.bloomora_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null,
  body text not null default '',
  label_id text,
  pinned boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.bloomora_subjects (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  qualification text,
  exam_board text,
  target_grade text,
  exam_date text,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.bloomora_flashcards (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  front text not null,
  back text not null,
  subject_id text,
  label_id text,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.bloomora_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  start_at timestamptz,
  end_at timestamptz,
  duration_sec int not null,
  method text not null,
  reward_mode text not null,
  note text,
  label_id text,
  label_name_snapshot text,
  task_ids text[] default '{}',
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

alter table public.bloomora_sessions add column if not exists note text;

alter table public.bloomora_profile_states enable row level security;
alter table public.bloomora_labels enable row level security;
alter table public.bloomora_tasks enable row level security;
alter table public.bloomora_notes enable row level security;
alter table public.bloomora_subjects enable row level security;
alter table public.bloomora_flashcards enable row level security;
alter table public.bloomora_sessions enable row level security;

drop policy if exists "bloomora profile states own read" on public.bloomora_profile_states;
drop policy if exists "bloomora profile states own insert" on public.bloomora_profile_states;
drop policy if exists "bloomora profile states own update" on public.bloomora_profile_states;
create policy "bloomora profile states own read" on public.bloomora_profile_states for select using (auth.uid() = id);
create policy "bloomora profile states own insert" on public.bloomora_profile_states for insert with check (auth.uid() = id);
create policy "bloomora profile states own update" on public.bloomora_profile_states for update using (auth.uid() = id);

drop policy if exists "bloomora labels own read" on public.bloomora_labels;
drop policy if exists "bloomora labels own insert" on public.bloomora_labels;
drop policy if exists "bloomora labels own update" on public.bloomora_labels;
drop policy if exists "bloomora labels own delete" on public.bloomora_labels;
create policy "bloomora labels own read" on public.bloomora_labels for select using (auth.uid() = user_id);
create policy "bloomora labels own insert" on public.bloomora_labels for insert with check (auth.uid() = user_id);
create policy "bloomora labels own update" on public.bloomora_labels for update using (auth.uid() = user_id);
create policy "bloomora labels own delete" on public.bloomora_labels for delete using (auth.uid() = user_id);

drop policy if exists "bloomora tasks own read" on public.bloomora_tasks;
drop policy if exists "bloomora tasks own insert" on public.bloomora_tasks;
drop policy if exists "bloomora tasks own update" on public.bloomora_tasks;
drop policy if exists "bloomora tasks own delete" on public.bloomora_tasks;
create policy "bloomora tasks own read" on public.bloomora_tasks for select using (auth.uid() = user_id);
create policy "bloomora tasks own insert" on public.bloomora_tasks for insert with check (auth.uid() = user_id);
create policy "bloomora tasks own update" on public.bloomora_tasks for update using (auth.uid() = user_id);
create policy "bloomora tasks own delete" on public.bloomora_tasks for delete using (auth.uid() = user_id);

drop policy if exists "bloomora notes own read" on public.bloomora_notes;
drop policy if exists "bloomora notes own insert" on public.bloomora_notes;
drop policy if exists "bloomora notes own update" on public.bloomora_notes;
drop policy if exists "bloomora notes own delete" on public.bloomora_notes;
create policy "bloomora notes own read" on public.bloomora_notes for select using (auth.uid() = user_id);
create policy "bloomora notes own insert" on public.bloomora_notes for insert with check (auth.uid() = user_id);
create policy "bloomora notes own update" on public.bloomora_notes for update using (auth.uid() = user_id);
create policy "bloomora notes own delete" on public.bloomora_notes for delete using (auth.uid() = user_id);

drop policy if exists "bloomora subjects own read" on public.bloomora_subjects;
drop policy if exists "bloomora subjects own insert" on public.bloomora_subjects;
drop policy if exists "bloomora subjects own update" on public.bloomora_subjects;
drop policy if exists "bloomora subjects own delete" on public.bloomora_subjects;
create policy "bloomora subjects own read" on public.bloomora_subjects for select using (auth.uid() = user_id);
create policy "bloomora subjects own insert" on public.bloomora_subjects for insert with check (auth.uid() = user_id);
create policy "bloomora subjects own update" on public.bloomora_subjects for update using (auth.uid() = user_id);
create policy "bloomora subjects own delete" on public.bloomora_subjects for delete using (auth.uid() = user_id);

drop policy if exists "bloomora flashcards own read" on public.bloomora_flashcards;
drop policy if exists "bloomora flashcards own insert" on public.bloomora_flashcards;
drop policy if exists "bloomora flashcards own update" on public.bloomora_flashcards;
drop policy if exists "bloomora flashcards own delete" on public.bloomora_flashcards;
create policy "bloomora flashcards own read" on public.bloomora_flashcards for select using (auth.uid() = user_id);
create policy "bloomora flashcards own insert" on public.bloomora_flashcards for insert with check (auth.uid() = user_id);
create policy "bloomora flashcards own update" on public.bloomora_flashcards for update using (auth.uid() = user_id);
create policy "bloomora flashcards own delete" on public.bloomora_flashcards for delete using (auth.uid() = user_id);

drop policy if exists "bloomora sessions own read" on public.bloomora_sessions;
drop policy if exists "bloomora sessions own insert" on public.bloomora_sessions;
drop policy if exists "bloomora sessions own update" on public.bloomora_sessions;
drop policy if exists "bloomora sessions own delete" on public.bloomora_sessions;
create policy "bloomora sessions own read" on public.bloomora_sessions for select using (auth.uid() = user_id);
create policy "bloomora sessions own insert" on public.bloomora_sessions for insert with check (auth.uid() = user_id);
create policy "bloomora sessions own update" on public.bloomora_sessions for update using (auth.uid() = user_id);
create policy "bloomora sessions own delete" on public.bloomora_sessions for delete using (auth.uid() = user_id);
