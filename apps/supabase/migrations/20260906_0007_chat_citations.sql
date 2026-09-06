-- Apply BEFORE enabling NEI RAG. Existing messages and owner RLS are preserved.
begin;
alter table public.screening_chat_messages
  add column if not exists citations jsonb not null default '[]'::jsonb,
  add column if not exists source_status text,
  add column if not exists corpus_version text;

alter table public.screening_chat_messages
  drop constraint if exists screening_chat_citations_shape;
alter table public.screening_chat_messages
  add constraint screening_chat_citations_shape check (
    case when jsonb_typeof(citations) = 'array' then jsonb_array_length(citations) <= 24 else false end
    and octet_length(citations::text) <= 100000
    and (
      (role = 'user' and citations = '[]'::jsonb and source_status is null and corpus_version is null)
      or
      (role = 'assistant' and (
        (source_status is null and citations = '[]'::jsonb and corpus_version is null)
        or (source_status = 'grounded' and jsonb_array_length(citations) between 1 and 24
            and corpus_version ~ '^nei-[a-f0-9]{16}$')
        or (source_status in ('insufficient_evidence','application_context') and citations = '[]'::jsonb
            and corpus_version ~ '^nei-[a-f0-9]{16}$')
      ))
    )
  );
commit;
