-- The client persists only the locally selected educational summary after a record exists.
-- Keep owner checks at the row layer and permit updates to that single column only.

grant update (executive_summary) on table public.screening_records to authenticated;

drop policy if exists "screening records may update their own summary" on public.screening_records;
create policy "screening records may update their own summary"
  on public.screening_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
