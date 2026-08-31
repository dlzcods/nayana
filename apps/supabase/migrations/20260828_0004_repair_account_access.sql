-- Repair migration for projects where an earlier core migration stopped after
-- an already-existing policy error. Safe to run repeatedly in Supabase SQL Editor.

grant usage on schema public to authenticated;
grant select, insert, delete on table public.screening_records to authenticated;

alter table public.screening_records enable row level security;

drop policy if exists "screening records are visible to their owner" on public.screening_records;
drop policy if exists "screening records are insertable by their owner" on public.screening_records;
drop policy if exists "screening records are deletable by their owner" on public.screening_records;

create policy "screening records are visible to their owner"
  on public.screening_records for select
  using (auth.uid() = user_id);

create policy "screening records are insertable by their owner"
  on public.screening_records for insert
  with check (auth.uid() = user_id);

create policy "screening records are deletable by their owner"
  on public.screening_records for delete
  using (auth.uid() = user_id);

-- Private Storage access is re-applied too, so an account can save both a
-- result row and its normalized fundus image after the database access repair.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fundus-private',
  'fundus-private',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "nayana owners read private fundus" on storage.objects;
drop policy if exists "nayana owners upload private fundus" on storage.objects;
drop policy if exists "nayana owners delete private fundus" on storage.objects;

create policy "nayana owners read private fundus"
  on storage.objects for select
  using (
    bucket_id = 'fundus-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "nayana owners upload private fundus"
  on storage.objects for insert
  with check (
    bucket_id = 'fundus-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "nayana owners delete private fundus"
  on storage.objects for delete
  using (
    bucket_id = 'fundus-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
