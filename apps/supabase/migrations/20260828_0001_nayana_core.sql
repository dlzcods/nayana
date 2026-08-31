-- NAYANA core data model. Run through the Supabase SQL Editor or Supabase CLI.
-- Photos are intentionally not stored in this migration; storage is a separate opt-in stage.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.screening_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('demo', 'upload')),
  model_version text not null,
  top_prediction_key text not null,
  top_prediction_label text not null,
  predictions jsonb not null,
  executive_summary jsonb,
  retention_days smallint not null default 30 check (retention_days in (30, 90)),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.screening_records enable row level security;

drop policy if exists "profiles are visible to their owner" on public.profiles;
drop policy if exists "profiles are editable by their owner" on public.profiles;
drop policy if exists "screening records are visible to their owner" on public.screening_records;
drop policy if exists "screening records are insertable by their owner" on public.screening_records;
drop policy if exists "screening records are deletable by their owner" on public.screening_records;

create policy "profiles are visible to their owner"
  on public.profiles for select using (auth.uid() = user_id);
create policy "profiles are editable by their owner"
  on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "screening records are visible to their owner"
  on public.screening_records for select using (auth.uid() = user_id);
create policy "screening records are insertable by their owner"
  on public.screening_records for insert with check (auth.uid() = user_id);
create policy "screening records are deletable by their owner"
  on public.screening_records for delete using (auth.uid() = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create index if not exists screening_records_user_created_idx
  on public.screening_records (user_id, created_at desc);
create index if not exists screening_records_expiry_idx
  on public.screening_records (expires_at);
