# Lembretes com a app fechada — guia de instalação

Os avisos que a app mostra hoje só disparam com a página aberta. Para chegarem ao
telemóvel com a app fechada, é o servidor que envia (Web Push).

**Já está feito**, não precisas de tocar em código:

- `supabase/migrations/20261027130000_push_reminders.sql` — 3 tabelas + RLS
- `supabase/functions/send-reminders/index.ts` — função que envia os lembretes
- `app.js` (bloco `push`) — pede autorização, guarda a subscrição, sincroniza preferências
- `sw.js` — recebe o push e abre a app quando tocas na notificação

**Falta** ligar 4 coisas no painel da Supabase. 10 a 15 minutos. No fim há um teste
que responde `"ok": true` ou diz exatamente o que está mal.

Antes de começar, precisas de dois valores que estão no ficheiro local
`C:\Users\User\DiarioDeVida\.env.push.local` (ignorado pelo git — abre com o Notepad):

- `VAPID_PRIVATE_KEY` — a chave privada
- `CRON_SECRET` — troca o `troca-isto-por-uma-frase-longa` por uma frase tua, longa e aleatória

> A chave privada nunca deve ir para o repositório, para o chat, nem para um print.
> Se a perderes, peço eu outro par e atualizo a app.

---

## 0. Checklist

- [ ] 1. Ligar as extensões `pg_cron` e `pg_net`
- [ ] 2. Correr o SQL das tabelas
- [ ] 3. Publicar a função `send-reminders` com **Verify JWT desligado**
- [ ] 4. Guardar os 4 segredos e voltar a fazer Deploy
- [ ] 5. Agendar o cron de 5 em 5 minutos
- [ ] 6. Ligar na app e testar (`ping` → `dry` → envio real)

---

## 1. Ligar as extensões

Painel → **Database** → **Extensions** → procura e ativa:

- `pg_cron` (agendador)
- `pg_net` (pedidos HTTP a partir da base de dados)

Se preferires SQL, no **SQL Editor**:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

Se der erro de permissões ou "extension not available", usa mesmo o painel
(**Database → Extensions**) — é o caminho garantido.

## 2. Criar as tabelas

Painel → **SQL Editor** → **New query** → cola o conteúdo de
`supabase/migrations/20261027130000_push_reminders.sql` → **Run**.

Deve dizer `Success. No rows returned`. Cria `push_subscriptions`,
`reminder_settings` e `reminder_log`, todas com RLS (cada pessoa só vê as suas).

## 3. Publicar a função

Painel → **Edge Functions** → **New function** (ou **Deploy a new function**) →
nome **`send-reminders`** → cola `supabase/functions/send-reminders/index.ts` →
**Deploy**.

Depois, nas definições da função (**Settings** / **Details**), desliga
**Verify JWT** e guarda. A função tem o seu próprio segredo (`CRON_SECRET`); se o
Verify JWT ficar ligado, todos os pedidos morrem com `Missing authorization header`.

> Alternativa por CLI, se a tiveres instalada:
> `supabase functions deploy send-reminders --no-verify-jwt --project-ref nocafjkyiaigxttwdkei`

## 4. Guardar os segredos

**Edge Functions → Secrets** (ou **Project Settings → Edge Functions → Secrets**).
Cria os quatro:

| Nome | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | `BGwDndPahI6fqWBTjfz7i3pcCPS_e7933tdYXYmBaVxfKZyI_K4ATv59Pzn5SrMppROIGqD0lUzNR8sCd4SqSqk` |
| `VAPID_PRIVATE_KEY` | a chave privada de `.env.push.local` |
| `VAPID_SUBJECT` | `mailto:o-teu-email@exemplo.pt` (ou um URL teu) |
| `CRON_SECRET` | a frase longa que escolheste em `.env.push.local` |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente — não os
acrescentes.

Depois de guardar os segredos, **faz Deploy outra vez** (ou **Redeploy**). Sem isso a
função pode continuar a correr com o ambiente antigo.

## 5. Agendar de 5 em 5 minutos

**SQL Editor**, uma vez. Troca `O-TEU-CRON-SECRET` pela mesma frase do passo 4:

```sql
select cron.schedule(
  'diario-send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://nocafjkyiaigxttwdkei.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'O-TEU-CRON-SECRET'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
```

Confirmar que ficou agendado:

```sql
select jobid, jobname, schedule, active from cron.job;
select status, return_message, start_time
from cron.job_run_details
order by start_time desc
limit 5;
```

O `pg_cron` corre em UTC; não faz mal, porque a função converte para o fuso de cada
pessoa (`tz` em `reminder_settings`, por omissão `Europe/Lisbon`).

---

## 6. Ligar na app e testar

### 6.1 Ligar

1. Abre a app **com sessão iniciada** (não em modo convidado).
2. Configurações → **Lembretes** → escolhe as horas → **Guardar**. Isto envia as tuas
   preferências para `reminder_settings`.
3. No mesmo ecrã, em **"Avisar mesmo com a app fechada"**, toca **Ativar** e autoriza
   as notificações.
4. Confirma no **Table Editor** que apareceu uma linha em `push_subscriptions` e outra
   em `reminder_settings`.

### 6.2 Teste 1 — está viva?

Abre no browser (troca o segredo):

```
https://nocafjkyiaigxttwdkei.supabase.co/functions/v1/send-reminders?secret=O-TEU-CRON-SECRET&ping=1
```

Resposta boa:

```json
{
  "ok": true,
  "viva": true,
  "temSegredo": true,
  "segredoConfere": true,
  "segredoRecebido": true,
  "temChavesVapid": true,
  "temServiceKey": true,
  "hora": "2026-10-27T15:04:05.000Z"
}
```

- `segredoConfere: false` → o `secret` do URL não é igual ao `CRON_SECRET`.
- `temChavesVapid: false` → faltam os segredos VAPID (passo 4).
- Erro `Missing authorization header` → **Verify JWT** ainda está ligado (passo 3).

> O `?secret=` fica registado nos logs da Supabase. Serve só para testar. O cron usa o
> header `x-cron-secret`, que não fica no URL.

### 6.3 Teste 2 — o que enviaria agora?

```
.../send-reminders?secret=O-TEU-CRON-SECRET&dry=1
```

Resposta com algo como:

```json
{
  "ok": true,
  "quando": "2026-10-27T15:04:05.000Z",
  "relatorio": [
    { "user": "…", "enviaria": "manha", "dispositivos": 1, "horaLocal": "2026-10-27 15:04 Europe/Lisbon" }
  ]
}
```

`"relatorio": []` é normal fora das horas dos lembretes: nesse minuto não há nada
devido. Também podes ver `sem subscrição`, `limite do dia` ou
`menos de 45 min desde o último` — são os travões a funcionar.

### 6.4 Teste 3 — envio real

Para forçar sem esperar pela hora certa, no **SQL Editor**:

```sql
-- põe o lembrete da manhã à hora local de agora
update public.reminder_settings
set manha = to_char((now() at time zone tz)::time, 'HH24:MI');

-- limpa o registo de hoje para ele não ser considerado "já enviado"
delete from public.reminder_log
where sent_on = (now() at time zone 'Europe/Lisbon')::date;
```

Espera até 5 minutos (o cron) **ou** chama a função sem `ping`/`dry`:

```
https://nocafjkyiaigxttwdkei.supabase.co/functions/v1/send-reminders?secret=O-TEU-CRON-SECRET
```

Fecha a app antes, para provares que chega fechada. Depois confirma em `reminder_log`:

```sql
select * from public.reminder_log order by sent_at desc limit 5;
```

---

## 7. Se algo falhar

| O que vês | Causa provável | O que fazer |
|---|---|---|
| `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` ou `Missing authorization header` | Verify JWT ligado | Passo 3: desligar e guardar |
| `{"ok":false,"erro":"segredo em falta ou errado"}` | `secret` do URL ≠ `CRON_SECRET` | Copiar de novo, sem espaços, e repetir |
| `falta CRON_SECRET nos segredos da função` | Segredo não criado | Passo 4, depois Deploy |
| `faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY` | Segredos VAPID ausentes ou com nome trocado | Passo 4, depois Deploy |
| `não consegui carregar web-push` | Falha momentânea ao descarregar a biblioteca | **Redeploy** e repetir |
| `reminder_settings: relation … does not exist` | Passo 2 não correu | Correr o SQL outra vez |
| `nenhum utilizador com lembretes ligados` | A app ainda não sincronizou | Abrir Lembretes → **Guardar**, com sessão |
| `sem subscrição` | Push não ativado neste dispositivo | **Ativar** em "Avisar mesmo com a app fechada" |
| `erroPush … status: 401/403` | Chaves VAPID diferentes das que criaram a subscrição | Desligar e voltar a ligar o push na app |
| Chega ao Android e não ao iPhone | iOS só entrega a apps instaladas | Safari → Partilhar → **Adicionar ao ecrã principal**, abrir por esse ícone, ativar de novo |
| O cron nunca corre | Extensões desligadas ou job inativo | Passo 1 e `select * from cron.job` |
| Nada em `reminder_log` depois do teste | Fora da janela de 6 min, ou já enviado hoje | Repetir o bloco 6.4 e chamar a função à mão |

Mais detalhe: **Edge Functions → send-reminders → Logs** mostra cada execução e o
erro exato.

---

## 8. Limites que continuam a existir

- **iPhone**: só a partir de iOS 16.4 e só com a app **instalada no ecrã inicial**.
- **Modo "dia difícil"**: vive só no dispositivo; o servidor não o conhece. Se quiseres,
  passa a ser guardado em `reminder_settings` e o envio respeita-o.
- **Notificação ignorada**: só conta como ignorada quando abres a app. O servidor não
  sabe se a viste, por isso a redução automática para 1/dia continua a ser feita no
  dispositivo.
- **Travões no servidor**: máximo do dia (o que escolheres, 1 a 5), 45 minutos entre
  envios, um lembrete por execução, e remoção automática de subscrições mortas (404/410).

## 9. Como desligar tudo

```sql
select cron.unschedule('diario-send-reminders');

drop table if exists public.reminder_log;
drop table if exists public.reminder_settings;
drop table if exists public.push_subscriptions;
```

Depois, na app: Lembretes → **Desligar** em "Avisar mesmo com a app fechada". Os
lembretes com a app aberta continuam a funcionar.

## 10. Se a chave privada VAPID se perder

Pede-me um par novo. Eu gero, troco a chave pública em `app.js`, faço commit, e tu
substituis `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` nos segredos. Cada dispositivo tem
de desligar e voltar a ligar o push (a subscrição antiga fica inválida).
