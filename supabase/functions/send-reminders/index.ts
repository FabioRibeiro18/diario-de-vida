// ═══════════════════════════════════════════════════════════════════
// send-reminders — envia os lembretes do dia, mesmo com a app fechada
//
// Chamadas possíveis (todas com o segredo):
//   POST /send-reminders                      → envia o que estiver devido
//   GET  /send-reminders?secret=...&ping=1    → só confirma que está viva
//   GET  /send-reminders?secret=...&dry=1     → diz o que enviaria, sem enviar
//
// Segredo aceite no header x-cron-secret ou no parâmetro ?secret=
// ═══════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const JANELA_MIN = 6;
const ESPACO_MIN = 45;

const env = (k: string) => Deno.env.get(k) || '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const VAPID_PUBLIC = env('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE = env('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = env('VAPID_SUBJECT') || 'mailto:diario@exemplo.pt';
const CRON_SECRET = env('CRON_SECRET');

const MENSAGENS: Record<string, { title: string; body: string }> = {
  manha: { title: 'Bom dia 🌱', body: 'Um registo pequeno chega para começar o dia.' },
  almoco: { title: 'Hora de almoço ☀️', body: 'Se te apetecer, anota o que comeste.' },
  noite: { title: 'Boa noite 🌙', body: 'Como foi o dia? Um toque chega.' },
  peso: { title: 'Pesagem semanal ⚖️', body: 'Quando puderes, regista o peso. Sem pressa.' },
  treino: { title: 'Treino de hoje 🏃', body: 'O plano diz treino. Se não der, fica para amanhã.' },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

function minutosDe(hhmm: string): number {
  if (!hhmm) return -1;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (isNaN(h)) return -1;
  return h * 60 + (m || 0);
}

function agoraLocal(tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutos: Number(get('hour')) * 60 + Number(get('minute')),
    diaSemana: dias[get('weekday')] ?? -1,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const segredo = req.headers.get('x-cron-secret') || url.searchParams.get('secret') || '';

  // ── saúde da função: responde sem tocar em nada
  if (url.searchParams.get('ping')) {
    return json({
      ok: true,
      viva: true,
      temSegredo: !!CRON_SECRET,
      segredoConfere: !!CRON_SECRET && segredo === CRON_SECRET,
      segredoRecebido: !!segredo,
      temChavesVapid: !!(VAPID_PUBLIC && VAPID_PRIVATE),
      temServiceKey: !!SERVICE_KEY,
      hora: new Date().toISOString(),
    });
  }

  if (!CRON_SECRET) {
    return json({ ok: false, erro: 'falta CRON_SECRET nos segredos da função' }, 500);
  }
  if (segredo !== CRON_SECRET) {
    return json({ ok: false, erro: 'segredo em falta ou errado' }, 401);
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ ok: false, erro: 'faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nos segredos' }, 500);
  }

  const dry = !!url.searchParams.get('dry');

  // import dinâmico: se a biblioteca falhar, a função continua a responder
  let webpush: any = null;
  try {
    const mod: any = await import('npm:web-push@3.6.7');
    webpush = mod.default ?? mod;
    if (typeof webpush.setVapidDetails !== 'function') {
      throw new Error('a biblioteca não expôs setVapidDetails');
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) {
    return json({ ok: false, erro: 'não consegui carregar web-push: ' + (e as Error).message }, 500);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const relatorio: Array<Record<string, unknown>> = [];

  const { data: settings, error } = await db.from('reminder_settings').select('*').eq('enabled', true);
  if (error) return json({ ok: false, erro: 'reminder_settings: ' + error.message }, 500);
  if (!settings || !settings.length) {
    return json({ ok: true, quando: new Date().toISOString(), nota: 'nenhum utilizador com lembretes ligados', relatorio });
  }

  for (const s of settings) {
    const tz = s.tz || 'Europe/Lisbon';
    const agora = agoraLocal(tz);

    const candidatos: Array<{ kind: string; alvo: number }> = [];
    if (s.manha) candidatos.push({ kind: 'manha', alvo: minutosDe(s.manha) });
    if (s.almoco) candidatos.push({ kind: 'almoco', alvo: minutosDe(s.almoco) });
    if (s.noite) candidatos.push({ kind: 'noite', alvo: minutosDe(s.noite) });
    if (s.peso_enabled && Number(s.peso_dia) === agora.diaSemana) {
      candidatos.push({ kind: 'peso', alvo: minutosDe(s.peso_hora || '09:00') });
    }
    if (s.treino_enabled) candidatos.push({ kind: 'treino', alvo: minutosDe(s.treino_hora || '18:00') });

    const devidos = candidatos.filter((c) => {
      const delta = agora.minutos - c.alvo;
      return c.alvo >= 0 && delta >= 0 && delta < JANELA_MIN;
    });
    if (!devidos.length) continue;

    const { data: hoje } = await db.from('reminder_log')
      .select('kind,sent_at').eq('user_id', s.user_id).eq('sent_on', agora.date);

    const jaEnviados = new Set((hoje || []).map((r) => r.kind));
    let enviadosHoje = (hoje || []).length;
    const max = Math.max(1, Math.min(5, Number(s.max_dia) || 3));

    if (enviadosHoje >= max) { relatorio.push({ user: s.user_id, saltado: 'limite do dia' }); continue; }

    const ultimo = (hoje || []).reduce((t, r) => Math.max(t, new Date(r.sent_at).getTime()), 0);
    if (ultimo && Date.now() - ultimo < ESPACO_MIN * 60 * 1000) {
      relatorio.push({ user: s.user_id, saltado: 'menos de 45 min desde o último' });
      continue;
    }

    for (const c of devidos) {
      if (jaEnviados.has(c.kind)) { relatorio.push({ user: s.user_id, saltado: c.kind + ' já enviado hoje' }); continue; }
      if (enviadosHoje >= max) break;

      const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', s.user_id);
      if (!subs || !subs.length) { relatorio.push({ user: s.user_id, saltado: 'sem subscrição' }); break; }

      if (dry) {
        relatorio.push({ user: s.user_id, enviaria: c.kind, dispositivos: subs.length, horaLocal: agora.date + ' ' + Math.floor(agora.minutos / 60) + ':' + String(agora.minutos % 60).padStart(2, '0') + ' ' + tz });
        break;
      }

      const msg = MENSAGENS[c.kind] || MENSAGENS.manha;
      let entregues = 0;

      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: msg.title, body: msg.body, tag: 'diario-' + c.kind }),
          );
          entregues++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await db.from('push_subscriptions').delete().eq('id', sub.id);
          } else {
            relatorio.push({ user: s.user_id, erroPush: c.kind, status: code });
          }
        }
      }

      if (entregues) {
        const { error: logErr } = await db.from('reminder_log').upsert(
          { user_id: s.user_id, sent_on: agora.date, kind: c.kind },
          { onConflict: 'user_id,sent_on,kind', ignoreDuplicates: true },
        );
        enviadosHoje++;
        relatorio.push({
          user: s.user_id,
          enviado: c.kind,
          dispositivos: entregues,
          ...(logErr ? { avisoLog: logErr.message } : {}),
        });
      }
      break;
    }
  }

  return json({ ok: true, quando: new Date().toISOString(), relatorio });
});
