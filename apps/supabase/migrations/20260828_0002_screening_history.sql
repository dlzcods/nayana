-- NAYANA account history and private fundus storage.
-- Run after 20260828_0001_nayana_core.sql in the Supabase SQL Editor.
-- The bucket is private. Browser access is always scoped by auth.uid() through RLS.

alter table public.screening_records
  add column if not exists photo_path text,
  add column if not exists photo_content_type text,
  add column if not exists photo_bytes integer,
  add column if not exists deleted_at timestamptz;

create index if not exists screening_records_user_expiry_idx
  on public.screening_records (user_id, expires_at desc);

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

-- Intended for a trusted scheduled job only. It is not executable from the browser.
create or replace function public.purge_expired_screening_records()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  deleted_count integer;
begin
  delete from storage.objects
  where bucket_id = 'fundus-private'
    and exists (
      select 1
      from public.screening_records record
      where record.photo_path = storage.objects.name
        and record.expires_at <= now()
    );

  delete from public.screening_records
  where expires_at <= now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_screening_records() from public, anon, authenticated;
