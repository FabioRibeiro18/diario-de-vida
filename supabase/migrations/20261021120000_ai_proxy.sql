create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_chars bigint not null default 0,
  output_chars bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists ai_usage_day_idx on public.ai_usage (day);

alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;
grant all on table public.ai_usage to service_role;

create table if not exists public.ai_key_state (
  provider text not null check (provider in ('openrouter', 'huggingface', 'gemini', 'groq')),
  key_id text not null,
  last_used_at timestamptz,
  cooldown_until timestamptz,
  fail_count integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (provider, key_id)
);

create index if not exists ai_key_state_cooldown_idx
  on public.ai_key_state (provider, cooldown_until);

alter table public.ai_key_state enable row level security;
revoke all on table public.ai_key_state from anon, authenticated;
grant all on table public.ai_key_state to service_role;

create or replace function public.ai_usage_status(
  p_user_id uuid,
  p_user_max integer,
  p_global_max integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_user_used integer := 0;
  v_global_used integer := 0;
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;
  select coalesce(max(requests), 0)
    into v_user_used
    from public.ai_usage
    where user_id = p_user_id and day = v_day;
  select coalesce(sum(requests), 0)::integer
    into v_global_used
    from public.ai_usage
    where day = v_day;
  return jsonb_build_object(
    'allowed', v_user_used < greatest(coalesce(p_user_max, 1), 1) and v_global_used < greatest(coalesce(p_global_max, 1), 1),
    'used', v_user_used,
    'limit', greatest(coalesce(p_user_max, 1), 1),
    'remaining', greatest(greatest(coalesce(p_user_max, 1), 1) - v_user_used, 0),
    'global_used', v_global_used,
    'global_limit', greatest(coalesce(p_global_max, 1), 1),
    'day', v_day
  );
end;
$$;

create or replace function public.ai_reserve_request(
  p_user_id uuid,
  p_user_max integer,
  p_global_max integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_user_used integer := 0;
  v_global_used integer := 0;
  v_user_max integer := greatest(coalesce(p_user_max, 1), 1);
  v_global_max integer := greatest(coalesce(p_global_max, 1), 1);
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_usage_' || v_day::text)::bigint);
  select coalesce(sum(requests), 0)::integer
    into v_global_used
    from public.ai_usage
    where day = v_day;
  insert into public.ai_usage (user_id, day, requests)
    values (p_user_id, v_day, 0)
    on conflict (user_id, day) do nothing;
  select requests
    into v_user_used
    from public.ai_usage
    where user_id = p_user_id and day = v_day
    for update;
  if v_user_used >= v_user_max then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'user',
      'used', v_user_used,
      'limit', v_user_max,
      'remaining', 0,
      'global_used', v_global_used,
      'global_limit', v_global_max,
      'day', v_day
    );
  end if;
  if v_global_used >= v_global_max then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'global',
      'used', v_user_used,
      'limit', v_user_max,
      'remaining', greatest(v_user_max - v_user_used, 0),
      'global_used', v_global_used,
      'global_limit', v_global_max,
      'day', v_day
    );
  end if;
  update public.ai_usage
    set requests = requests + 1, updated_at = now()
    where user_id = p_user_id and day = v_day
    returning requests into v_user_used;
  return jsonb_build_object(
    'allowed', true,
    'used', v_user_used,
    'limit', v_user_max,
    'remaining', greatest(v_user_max - v_user_used, 0),
    'global_used', v_global_used + 1,
    'global_limit', v_global_max,
    'day', v_day
  );
end;
$$;

create or replace function public.ai_record_usage(
  p_user_id uuid,
  p_input_chars bigint,
  p_output_chars bigint
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_input bigint := greatest(coalesce(p_input_chars, 0), 0);
  v_output bigint := greatest(coalesce(p_output_chars, 0), 0);
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;
  insert into public.ai_usage (user_id, day, requests, input_chars, output_chars)
    values (p_user_id, v_day, 0, v_input, v_output)
    on conflict (user_id, day) do update
      set input_chars = public.ai_usage.input_chars + excluded.input_chars,
          output_chars = public.ai_usage.output_chars + excluded.output_chars,
          updated_at = now();
end;
$$;

create or replace function public.ai_refund_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (timezone('utc', now()))::date;
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;
  update public.ai_usage
    set requests = greatest(requests - 1, 0), updated_at = now()
    where user_id = p_user_id and day = v_day;
end;
$$;

revoke all on function public.ai_usage_status(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.ai_reserve_request(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.ai_record_usage(uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.ai_refund_request(uuid) from public, anon, authenticated;

grant execute on function public.ai_usage_status(uuid, integer, integer) to service_role;
grant execute on function public.ai_reserve_request(uuid, integer, integer) to service_role;
grant execute on function public.ai_record_usage(uuid, bigint, bigint) to service_role;
grant execute on function public.ai_refund_request(uuid) to service_role;
