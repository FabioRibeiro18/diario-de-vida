-- ─────────────────────────────────────────────────────────────────────────────
-- mood_checkins — check-in de humor em 2 passos (modo casa)
--
-- Cada utilizador só vê / escreve / apaga as suas próprias linhas. As políticas
-- usam auth.uid(), portanto funcionam com o cliente anónimo (publishable key)
-- autenticado por sessão. Nenhum acesso anónimo é permitido.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.mood_checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  mood        smallint not null check (mood between 1 and 5),
  "trigger"   text check ("trigger" is null or char_length("trigger") <= 60),
  note        text check (note is null or char_length(note) <= 120),
  created_at  timestamptz not null default now()
);

create index if not exists mood_checkins_user_created_idx
  on public.mood_checkins (user_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.mood_checkins enable row level security;

revoke all on table public.mood_checkins from anon;
revoke all on table public.mood_checkins from public;
grant select, insert, update, delete on table public.mood_checkins to authenticated;

drop policy if exists mood_checkins_select_own on public.mood_checkins;
create policy mood_checkins_select_own
  on public.mood_checkins
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists mood_checkins_insert_own on public.mood_checkins;
create policy mood_checkins_insert_own
  on public.mood_checkins
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists mood_checkins_update_own on public.mood_checkins;
create policy mood_checkins_update_own
  on public.mood_checkins
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists mood_checkins_delete_own on public.mood_checkins;
create policy mood_checkins_delete_own
  on public.mood_checkins
  for delete
  to authenticated
  using (user_id = auth.uid());
