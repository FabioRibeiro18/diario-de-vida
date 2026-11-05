-- Afinações sugeridas pelos avisos do Supabase. Não muda quem pode ver o quê.

-- 1) Funções sem search_path fixo
alter function public.ping() set search_path = '';
alter function public._num(text) set search_path = '';

-- 2) Índice igual ao da restrição diario_registos_user_id_data_key
drop index if exists public.diario_registos_user_data_uidx;

-- 3) diario_registos: quatro políticas repetiam o que "registos: cada um os seus" já garante
drop policy if exists "Utilizadores podem ver os seus proprios registos" on public.diario_registos;
drop policy if exists "Utilizadores podem inserir os seus proprios registos" on public.diario_registos;
drop policy if exists "Utilizadores podem atualizar os seus proprios registos" on public.diario_registos;
drop policy if exists "Utilizadores podem apagar os seus proprios registos" on public.diario_registos;

-- 4) Avaliar auth.uid() uma vez por consulta, e não uma vez por linha
alter policy "registos: cada um os seus" on public.diario_registos
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "perfil: cada um o seu" on public.diario_perfil
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "admins: ver o próprio" on public.admins
  using ((select auth.uid()) = user_id);
alter policy "perfis: o próprio ou admin" on public.perfis
  using ((select auth.uid()) = user_id or is_admin());
alter policy "participantes: ver o próprio" on public.competicao_participantes
  using ((select auth.uid()) = user_id);
alter policy "mood_checkins_select_own" on public.mood_checkins
  using (user_id = (select auth.uid()));
alter policy "mood_checkins_insert_own" on public.mood_checkins
  with check (user_id = (select auth.uid()));
alter policy "mood_checkins_update_own" on public.mood_checkins
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "mood_checkins_delete_own" on public.mood_checkins
  using (user_id = (select auth.uid()));
alter policy "push_subs_own" on public.push_subscriptions
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "reminder_settings_own" on public.reminder_settings
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "reminder_log_own_read" on public.reminder_log
  using ((select auth.uid()) = user_id);
