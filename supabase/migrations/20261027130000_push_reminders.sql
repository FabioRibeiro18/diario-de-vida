-- ═══════════════════════════════════════════════════════════════════
-- Lembretes push com a app fechada
-- Corre isto no SQL Editor da Supabase (uma vez).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Subscrições push de cada dispositivo
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subs_own" on public.push_subscriptions;
create policy "push_subs_own" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Preferências de lembrete (o servidor precisa delas para saber quando enviar)
create table if not exists public.reminder_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  enabled       boolean not null default true,
  manha         time,
  almoco        time,
  noite         time,
  peso_enabled  boolean not null default true,
  peso_dia      int not null default 0,
  peso_hora     time default '09:00',
  treino_enabled boolean not null default true,
  treino_hora   time default '18:00',
  max_dia       int not null default 3,
  tz            text not null default 'Europe/Lisbon',
  updated_at    timestamptz not null default now()
);

alter table public.reminder_settings enable row level security;

drop policy if exists "reminder_settings_own" on public.reminder_settings;
create policy "reminder_settings_own" on public.reminder_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) Registo do que já foi enviado (evita repetições e conta o limite diário)
create table if not exists public.reminder_log (
  user_id  uuid not null references auth.users(id) on delete cascade,
  sent_on  date not null,
  kind     text not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, sent_on, kind)
);

create index if not exists reminder_log_user_day_idx on public.reminder_log(user_id, sent_on);

alter table public.reminder_log enable row level security;

drop policy if exists "reminder_log_own_read" on public.reminder_log;
create policy "reminder_log_own_read" on public.reminder_log
  for select using (auth.uid() = user_id);
