# Lembretes com a app fechada

Os avisos que a app mostra hoje só disparam com a página aberta. Para chegarem ao
telemóvel com a app fechada é preciso um envio a partir do servidor (Web Push).

O código já está neste repositório:

- `supabase/migrations/20261027130000_push_reminders.sql` — tabelas e permissões
- `supabase/functions/send-reminders/index.ts` — função que envia os lembretes
- `app.js` → bloco `push` — pede autorização, guarda a subscrição e sincroniza preferências
- `sw.js` — recebe o push e abre a app quando tocas na notificação

Faltam quatro passos no painel da Supabase (eu não tenho acesso à tua conta).

---

## 1. Criar as tabelas

Painel → **SQL Editor** → cola o conteúdo de
`supabase/migrations/20261027130000_push_reminders.sql` → **Run**.

## 2. Publicar a função

Painel → **Edge Functions** → **New function** → nome `send-reminders` →
cola `supabase/functions/send-reminders/index.ts` → **Deploy**.

Nas definições da função, desliga **Verify JWT** (a função valida um segredo próprio).

## 3. Guardar os segredos

**Edge Functions → Secrets** (ou Project Settings → Edge Functions → Secrets):

| Nome | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | `BGwDndPahI6fqWBTjfz7i3pcCPS_e7933tdYXYmBaVxfKZyI_K4ATv59Pzn5SrMppROIGqD0lUzNR8sCd4SqSqk` |
| `VAPID_PRIVATE_KEY` | a chave privada que te dei no chat — **não vai para o repositório** |
| `VAPID_SUBJECT` | `mailto:o-teu-email@exemplo.pt` |
| `CRON_SECRET` | uma frase longa à tua escolha, ex.: `diario-<20 caracteres aleatórios>` |

A chave pública é segura de publicar; a privada não. Se a privada se perder, gera-se
outro par e basta atualizar os dois sítios.

## 4. Agendar de 5 em 5 minutos

SQL Editor, uma vez (troca os dois valores em maiúsculas):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'diario-send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://nocafjkyiaigxttwdkei.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','O-TEU-CRON-SECRET'),
    body    := '{}'::jsonb
  );
  $$
);
```

---

## Como testar

1. Abre a app com sessão iniciada → Configurações → Lembretes → **Ativar** em
   "Avisar mesmo com a app fechada". Autoriza as notificações.
2. Confirma que aparece uma linha em `push_subscriptions` (Table Editor).
3. Confirma que as tuas preferências entraram em `reminder_settings`.
4. Chama a função à mão: **Edge Functions → send-reminders → Invoke**, com o
   header `x-cron-secret`. O JSON de resposta diz o que fez (`relatorio`).
5. Para forçar um envio: põe `manha` em `reminder_settings` para a hora atual
   (formato `HH:MM`) e chama a função outra vez.

## Limites que continuam a existir

- iOS só entrega push a apps **instaladas no ecrã inicial** (Adicionar ao ecrã principal).
- O modo "dia difícil" é conhecido apenas no dispositivo, por isso o servidor não
  o consegue respeitar. Se quiseres, passa a guardá-lo em `reminder_settings`.
- Uma notificação ignorada só conta como ignorada quando abres a app; o servidor
  não tem como saber que a viste.
