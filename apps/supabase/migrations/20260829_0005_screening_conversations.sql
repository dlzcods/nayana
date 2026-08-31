-- Persistent, result-scoped conversations for signed-in NAYANA users.
-- Each saved screening result has at most one conversation and its messages are
-- removed automatically when the result is deleted or expires.

create table if not exists public.screening_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  screening_record_id uuid not null unique references public.screening_records(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.screening_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.screening_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 900),
  created_at timestamptz not null default now()
);

create index if not exists screening_conversations_user_updated_idx
  on public.screening_conversations (user_id, updated_at desc);
create index if not exists screening_chat_messages_conversation_created_idx
  on public.screening_chat_messages (conversation_id, created_at asc);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.screening_conversations to authenticated;
grant select, insert, delete on public.screening_chat_messages to authenticated;

alter table public.screening_conversations enable row level security;
alter table public.screening_chat_messages enable row level security;

drop policy if exists "nayana users read their conversations" on public.screening_conversations;
drop policy if exists "nayana users create their conversations" on public.screening_conversations;
drop policy if exists "nayana users update their conversations" on public.screening_conversations;
drop policy if exists "nayana users delete their conversations" on public.screening_conversations;
drop policy if exists "nayana users read their chat messages" on public.screening_chat_messages;
drop policy if exists "nayana users add their chat messages" on public.screening_chat_messages;
drop policy if exists "nayana users delete their chat messages" on public.screening_chat_messages;

create policy "nayana users read their conversations"
  on public.screening_conversations for select
  using (auth.uid() = user_id);

create policy "nayana users create their conversations"
  on public.screening_conversations for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.screening_records record
      where record.id = screening_record_id and record.user_id = auth.uid()
    )
  );

create policy "nayana users update their conversations"
  on public.screening_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "nayana users delete their conversations"
  on public.screening_conversations for delete
  using (auth.uid() = user_id);

create policy "nayana users read their chat messages"
  on public.screening_chat_messages for select
  using (
    exists (
      select 1 from public.screening_conversations conversation
      where conversation.id = conversation_id and conversation.user_id = auth.uid()
    )
  );

create policy "nayana users add their chat messages"
  on public.screening_chat_messages for insert
  with check (
    exists (
      select 1 from public.screening_conversations conversation
      where conversation.id = conversation_id and conversation.user_id = auth.uid()
    )
  );

create policy "nayana users delete their chat messages"
  on public.screening_chat_messages for delete
  using (
    exists (
      select 1 from public.screening_conversations conversation
      where conversation.id = conversation_id and conversation.user_id = auth.uid()
    )
  );
