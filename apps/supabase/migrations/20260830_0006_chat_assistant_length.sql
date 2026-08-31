-- User questions remain intentionally short; assistant education may be longer.
alter table public.screening_chat_messages
  drop constraint if exists screening_chat_messages_content_check;

alter table public.screening_chat_messages
  add constraint screening_chat_messages_content_check
  check (
    (role = 'user' and char_length(content) between 1 and 900)
    or (role = 'assistant' and char_length(content) between 1 and 4000)
  );
