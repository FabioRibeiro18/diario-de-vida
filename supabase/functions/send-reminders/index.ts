// ═══════════════════════════════════════════════════════════════════
// send-reminders — envia os lembretes do dia, mesmo com a app fechada
// Corre a cada 5 minutos por cron. Pode ser chamada à mão para testar.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const JANELA_MIN = 6;      // minutos de tolerância (o cron corre de 5 em 5)
const ESPACO_MIN = 45;     // nunca dois lembretes com menos disto

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:diario@exemplo.pt';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const MENSAGENS: Record<string, { title: string; body: string }> = {
  manha: { title: 'Bom dia 🌱', body: 'Um registo pequeno chega para começar o dia.' },
  almoco: { title: 'Hora de almoço ☀️', body: 'Se te apetecer, anota o que comeste.' },
  noite: { title: 'Boa noite 🌙', body: 'Como foi o dia? Um toque chega.' },
  peso: { title: 'Pesagem semanal ⚖️', body: 'Quando puderes, regista o peso. Sem pressa.' },
  treino: { title: 'Treino de hoje 🏃', body: 'O plano diz treino. Se não der, fica para amanhã.' },
};

function minutosDe(hhmm: string): number {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (isNaN(h)) return -1;
  return h * 60 + (m || 0);
}

function agoraLocal(tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
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
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('método não suportado', { status: 405, headers: CORS });
  }

  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('não autorizado', { status: 401, headers: CORS });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response('faltam as chaves VAPID', { status: 500, headers: CORS });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const relatorio: Array<Record<string, unknown>> = [];

  const { data: settings, error } = await db.from('reminder_settings').select('*').eq('enabled', true);
  if (error) {
    return new Response(JSON.stringify({ erro: error.message }), { status: 500, headers: CORS });
  }

  for (const s of settings || []) {
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
    const enviadosHoje = (hoje || []).length;
    let max = Math.max(1, Math.min(5, Number(s.max_dia) || 3));
    if (enviadosHoje >= max) { relatorio.push({ user: s.user_id, saltado: 'limite do dia' }); continue; }

    const ultimo = (hoje || []).reduce((t, r) => Math.max(t, new Date(r.sent_at).getTime()), 0);
    if (ultimo && Date.now() - ultimo < ESPACO_MIN * 60 * 1000) {
      relatorio.push({ user: s.user_id, saltado: 'menos de 45 min' });
      continue;
    }

    for (const c of devidos) {
      if (jaEnviados.has(c.kind)) continue;
      if (enviadosHoje >= max) break;

      const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', s.user_id);
      if (!subs || !subs.length) { relatorio.push({ user: s.user_id, saltado: 'sem subscrição' }); break; }

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
          }
        }
      }

      if (entregues) {
        await db.from('reminder_log').insert({ user_id: s.user_id, sent_on: agora.date, kind: c.kind });
        enviadosHoje++;
        relatorio.push({ user: s.user_id, enviado: c.kind, dispositivos: entregues });
      }
      break; // um lembrete por execução
    }
  }

  return new Response(JSON.stringify({ ok: true, quando: new Date().toISOString(), relatorio }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
