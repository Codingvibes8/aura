-- Aura Phase 6 schema: profiles, synced settings, custom phrases.
-- Run in the Supabase SQL editor (or `supabase db push` with the CLI).
-- All tables are owner-only via RLS: users read/write only their own rows.

-- Profiles extend auth.users (one row per user, created on first sync).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Aura user',
  role text not null default 'dhh' check (role in ('dhh', 'hearing', 'interpreter')),
  language text not null default 'asl',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Synced settings: accessibility + TTS + ambient prefs (Phases 6.3, 7, 3.2).
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  font_scale double precision not null default 1,
  high_contrast boolean not null default false,
  dark boolean not null default false,
  haptics boolean not null default true,
  reduced_motion boolean not null default false,
  tts_voice_id text not null default '',
  tts_rate double precision not null default 1,
  ambient_sensitivity text not null default 'standard'
    check (ambient_sensitivity in ('low', 'standard', 'high')),
  updated_at timestamptz not null default now()
);

-- Custom quick phrases (Phase 6.4), replacing localStorage per-account.
create table if not exists public.custom_phrases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 280),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists custom_phrases_user_idx
  on public.custom_phrases (user_id, position);

-- Row Level Security: owner-only on all three tables.
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.custom_phrases enable row level security;

drop policy if exists "profiles_owner" on public.profiles;
create policy "profiles_owner" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "settings_owner" on public.user_settings;
create policy "settings_owner" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "phrases_owner" on public.custom_phrases;
create policy "phrases_owner" on public.custom_phrases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at fresh without client writes.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists settings_touch on public.user_settings;
create trigger settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();
