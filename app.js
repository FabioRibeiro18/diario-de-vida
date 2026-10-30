// ── Funcionalidades removidas (90 Dias, Hábitos, Hobbys, Casa de Banho, Tempo de Ecrã) ──
// O código antigo ainda consulta estes elementos; devolve um elemento vazio (fora da página)
// para não dar erro. Os dados antigos continuam guardados nos registos, mas já não aparecem.
const _REMOVED_UI = {"anxietyLevel": "input", "anxietyVal": "div", "bathroomNotes": "textarea", "bestMoment": "input", "card-habits-chart": "div", "chart-habits": "canvas", "cnt-banho": "div", "cnt-defecar": "div", "cnt-intimacy": "div", "cnt-pausas": "div", "cnt-urinar": "div", "dailyRoutine": "div", "energyLevel": "input", "energyVal": "div", "exDoneCount": "div", "exDuration": "input", "exIntensity": "select", "exName": "input", "exerciseList": "div", "gratitude": "input", "habitResponse": "div", "habitTipBtn": "button", "habitsList": "div", "hobbyGrid": "div", "intimacyNotes": "textarea", "intimateContent": "div", "journalEntry": "textarea", "journalResponse": "div", "lockLabel": "div", "moodSelector": "div", "n90-active-screen": "div", "n90-ai-status": "div", "n90-daily-checks": "div", "n90-day-num": "div", "n90-end-label": "div", "n90-gen-btn": "button", "n90-phase-card": "div", "n90-phase-desc": "div", "n90-phase-icon": "div", "n90-phase-label": "div", "n90-phase-name": "div", "n90-progress-bar": "div", "n90-roadmap": "div", "n90-start-label": "div", "n90-start-screen": "div", "n90-subtitle": "div", "n90-week-content": "div", "n90-week-num": "div", "nextAlertTime": "div", "ov-ex": "div", "ov-hobby": "div", "ov-water": "div", "ov-wc": "div", "overviewHabits": "div", "quickExercises": "div", "routineDoneCount": "div", "routineTag": "div", "routineTotalCount": "div", "screenEnd": "input", "screenStart": "input", "screenTag": "div", "screenTotal": "div", "section-bathroom": "div", "section-exercise": "div", "section-habits": "div", "section-journal": "div", "section-noventa": "div", "section-screen": "div", "section-water": "div", "sidebarDrops": "div", "stats-habits-summary": "div", "stats-mood-summary": "div", "stats-sleep-summary": "div", "stats-water-summary": "div", "stressLevel": "input", "stressVal": "div", "toastWaterCount": "div", "waterAlertInterval": "select", "waterCount": "div", "waterDropsMain": "div", "waterGoalInput": "input", "waterGoalNum": "div", "waterMl": "div", "waterProgressBar": "div", "waterTag": "div", "waterTip": "div", "waterToast": "div", "wcTip": "div"};
const _getElById = document.getElementById.bind(document);
document.getElementById = function(id) {
  return _getElById(id) || (id in _REMOVED_UI ? document.createElement(_REMOVED_UI[id]) : null);
};

// ═══════════════════════════════════════════════════════════════════
// SYNC MANAGER — o Supabase é a fonte de verdade; o browser é só cache.
// Fila persistente + reenvio com espera crescente + deteção offline.
// «Guardado» só aparece depois de o Supabase confirmar a gravação.
// ═══════════════════════════════════════════════════════════════════
var SyncManager = (function() {
  var QUEUE_KEY = 'dvSyncQueue', META_KEY = 'dvSyncMeta';
  var SKIP_KEYS = { savedAt: 1, _fromSheets: 1 };
  var queue = load(QUEUE_KEY, []);
  var meta = load(META_KEY, {});
  if (!Array.isArray(queue)) queue = [];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
  var waiters = {};
  var running = false, drainPromise = null, tickTimer = null;
  var offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
  var fatal = false, lastError = '', guest = false, lastUid = null, rpcMissing = false;
  var listeners = [];
  var pushAfterLoad = [];

  try { localStorage.removeItem('diarioVida'); } catch (e) {}   // cópia antiga e sem uso

  function load(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; }
  }
  function persist() {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) { console.error('SyncManager: não foi possível guardar a fila local', e); }
  }
  function hash(v) {
    var s = JSON.stringify(v === undefined ? null : v), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + s.length;
  }
  function client() { return (typeof supabaseClient !== 'undefined') ? supabaseClient : null; }
  async function getUid() {
    var sb = client(); if (!sb) return null;
    try {
      var r = await sb.auth.getSession();
      var s = r && r.data && r.data.session;
      lastUid = s && s.user ? s.user.id : null;
      return lastUid;
    } catch (e) { return null; }
  }
  function mine() { return queue.filter(function(j) { return !lastUid || j.uid === lastUid; }); }
  function pendingCount() { return mine().length; }
  function status() {
    if (guest) return 'local';
    if (running) return 'syncing';
    if (!mine().length) return 'synced';
    if (offline) return 'offline';
    if (fatal) return 'error';
    return 'pending';
  }
  function renderBadge(s) {
    var el = document.getElementById('syncBadge'); if (!el) return;
    var n = pendingCount();
    var m = {
      synced:  ['☁ Tudo guardado na nuvem', 'var(--sage-l)'],
      syncing: ['⟳ A guardar…', 'var(--moss-l)'],
      pending: ['⏳ ' + n + ' por enviar', '#d9a441'],
      offline: ['📴 Sem ligação · ' + n + ' por enviar', '#d9a441'],
      error:   ['⚠ Erro ao guardar · toca para repetir', 'var(--rose)'],
      local:   ['💾 Só neste dispositivo', 'var(--muted)']
    }[s] || ['', 'var(--muted)'];
    el.textContent = m[0]; el.style.color = m[1];
    el.title = lastError ? ('Último erro: ' + lastError) : 'Estado da sincronização';
  }
  function emit() {
    var s = status();
    listeners.forEach(function(f) { try { f(s); } catch (e) {} });
    renderBadge(s);
  }
  function backoff(tries) {
    var base = Math.min(300000, 1000 * Math.pow(2, Math.min(tries, 9)));
    return base / 2 + Math.random() * base / 2;
  }
  function settle(id, state) {
    var w = waiters[id]; if (!w) return;
    delete waiters[id];
    w.forEach(function(f) { try { f(state); } catch (e) {} });
  }
  function settleAll(state) { Object.keys(waiters).forEach(function(id) { settle(id, state); }); }
  function fail(err) {
    var msg = (err && (err.message || err.details)) || String(err);
    var net = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
      /failed to fetch|networkerror|network request failed|load failed|timeout|fetch/i.test(msg);
    lastError = msg;
    if (net) { offline = true; return { ok: false, state: 'offline' }; }
    offline = false; fatal = true;
    return { ok: false, state: 'error' };
  }
  function isMissingFn(err) {
    var m = (err && (err.message || '')) || '';
    return !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function|does not exist/i.test(m));
  }
  function setMeta(date, obj, v) {
    var m = { v: v || 0, h: {} };
    Object.keys(obj || {}).forEach(function(k) { m.h[k] = hash(obj[k]); });
    meta[date] = m;
  }
  function mergeRemote(date, remote, sent) {
    var local = DB[date] || (DB[date] = {});
    var m = meta[date] || (meta[date] = { v: 0, h: {} });
    var changed = false;
    Object.keys(remote || {}).forEach(function(k) {
      if (sent && Object.prototype.hasOwnProperty.call(sent, k)) return;
      var untouched = !(k in local) || m.h[k] === undefined || hash(local[k]) === m.h[k];
      if (untouched && hash(local[k]) !== hash(remote[k])) { local[k] = remote[k]; changed = true; }
      if (untouched) m.h[k] = hash(remote[k]);
    });
    if (changed) {
      try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
      if (date === TODAY && typeof reloadTodayFromDB === 'function') { try { reloadTodayFromDB(); } catch (e) {} }
    }
  }

  async function execDay(sb, job, uid) {
    var date = job.key;
    var m0 = meta[date];
    var baseV = m0 ? m0.v : null;
    if (!rpcMissing) {
      var r = await sb.rpc('merge_dia', { p_data: date, p_patch: job.patch, p_base_versao: baseV });
      if (!r.error) {
        var res = r.data || {};
        var m = meta[date] || (meta[date] = { v: 0, h: {} });
        m.v = (res.versao != null) ? res.versao : (m.v || 0) + 1;
        Object.keys(job.patch).forEach(function(k) { if (job.hashes[k]) m.h[k] = job.hashes[k]; });
        if (res.conflito && res.dados) mergeRemote(date, res.dados, job.patch);
        return { ok: true };
      }
      if (isMissingFn(r.error)) { rpcMissing = true; console.warn('SyncManager: função merge_dia em falta no Supabase; a usar gravação completa (corre o supabase-setup.sql).'); }
      else return fail(r.error);
    }
    // Compatibilidade: o SQL novo ainda não foi executado → grava o registo completo (comportamento antigo)
    var snap = DB[date]; if (!snap) return { ok: true };
    var u = await sb.from('diario_registos').upsert({ user_id: uid, data: date, dados: snap, atualizado_em: new Date().toISOString() }, { onConflict: 'user_id,data' });
    if (u.error) return fail(u.error);
    setMeta(date, snap, (meta[date] && meta[date].v) || 0);
    return { ok: true };
  }
  async function execConfig(sb, job) {
    var r = await sb.rpc('merge_config', { p_patch: job.patch });
    if (!r.error) return { ok: true };
    if (isMissingFn(r.error)) { console.warn('SyncManager: função merge_config em falta; preferências ficam só neste dispositivo.'); return { ok: true }; }
    return fail(r.error);
  }
  async function execProfile(sb, job, uid) {
    var row = Object.assign({ user_id: uid, atualizado_em: new Date().toISOString() }, job.patch);
    var r = await sb.from('diario_perfil').upsert(row, { onConflict: 'user_id' });
    if (r.error) return fail(r.error);
    return { ok: true };
  }
  async function execute(job, uid) {
    var sb = client();
    try {
      if (job.kind === 'day') return await execDay(sb, job, uid);
      if (job.kind === 'config') return await execConfig(sb, job);
      return await execProfile(sb, job, uid);
    } catch (e) { return fail(e); }
  }

  function drain(force) {
    if (drainPromise) return drainPromise;
    drainPromise = (async function() {
      try {
        var sb = client(); if (!sb || !queue.length) return;
        var uid = await getUid(); if (!uid) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          offline = true; settleAll('offline'); return;
        }
        running = true; emit();
        for (;;) {
          var now = Date.now();
          var job = queue.find(function(j) { return j.uid === uid && (force || j.nextAt <= now); });
          if (!job) break;
          job.inflight = true;
          var res = await execute(job, uid);
          job.inflight = false;
          if (res.ok) {
            queue = queue.filter(function(j) { return j !== job; });
            offline = false; fatal = false; lastError = '';
            persist(); settle(job.id, 'cloud');
          } else {
            job.tries = (job.tries || 0) + 1;
            job.nextAt = Date.now() + backoff(job.tries);
            persist(); settle(job.id, res.state);
            break;   // mantém a ordem: pára no primeiro erro
          }
        }
      } finally {
        running = false; drainPromise = null; emit();
      }
    })();
    return drainPromise;
  }

  function enqueue(kind, key, patch, hashes) {
    return new Promise(function(resolve) {
      getUid().then(function(uid) {
        if (!uid) return resolve('local');
        var job = queue.find(function(j) { return j.uid === uid && j.kind === kind && j.key === key && !j.inflight; });
        if (job) { Object.assign(job.patch, patch); Object.assign(job.hashes, hashes || {}); job.nextAt = 0; }
        else {
          job = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), uid: uid, kind: kind, key: key,
                  patch: Object.assign({}, patch), hashes: Object.assign({}, hashes || {}), tries: 0, nextAt: 0 };
          queue.push(job);
        }
        (waiters[job.id] = waiters[job.id] || []).push(resolve);
        persist(); emit();
        drain(true);
      });
    });
  }

  async function saveDay(date) {
    var snap = DB[date]; if (!snap) return 'none';
    var uid = await getUid(); if (!uid) return 'local';
    var m = meta[date], patch = {}, hashes = {}, any = false;
    Object.keys(snap).forEach(function(k) {
      if (SKIP_KEYS[k]) return;
      var h = hash(snap[k]);
      if (!m || m.h[k] !== h) { patch[k] = snap[k]; hashes[k] = h; any = true; }
    });
    if (!any) {
      var existing = queue.find(function(j) { return j.kind === 'day' && j.key === date && j.uid === uid; });
      if (!existing) return 'cloud';          // nada mudou desde a última confirmação
      return new Promise(function(resolve) { (waiters[existing.id] = waiters[existing.id] || []).push(resolve); drain(true); });
    }
    if (snap.savedAt) patch.savedAt = snap.savedAt;
    return enqueue('day', date, patch, hashes);
  }
  function saveConfig(patch) { return enqueue('config', 'config', patch, {}); }
  function saveProfile(patch) { return enqueue('profile', 'profile', patch, {}); }

  async function flushAll(timeoutMs) {
    var t0 = Date.now();
    await getUid();
    while (pendingCount() > 0 && Date.now() - t0 < (timeoutMs || 15000)) {
      await drain(true);
      if (pendingCount() === 0) break;
      if (offline) break;
      await new Promise(function(r) { setTimeout(r, 800); });
    }
    return pendingCount() === 0;
  }
  async function recover() {
    offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    await getUid();
    emit();
    if (queue.length) await drain(true);
  }

  function adoptRemote(date, remote, versao) {
    var local = DB[date];
    var job = queue.find(function(j) { return j.kind === 'day' && j.key === date; });
    var m = meta[date];
    if (!local) { DB[date] = remote; setMeta(date, remote, versao); return; }
    if (job) {   // há alterações locais por enviar: mantém-nas e importa só o resto
      Object.keys(remote).forEach(function(k) { if (!(k in job.patch)) local[k] = remote[k]; });
      if (!meta[date]) setMeta(date, remote, versao); else meta[date].v = versao || meta[date].v;
      return;
    }
    if (!m) {    // dia local sem histórico de sincronização (versões antigas da app)
      if (local.savedAt && remote.savedAt && local.savedAt > remote.savedAt) {
        DB[date] = Object.assign({}, remote, local);
        setMeta(date, remote, versao);
        pushAfterLoad.push(date);
      } else { DB[date] = remote; setMeta(date, remote, versao); }
      return;
    }
    DB[date] = remote; setMeta(date, remote, versao);   // normal: a nuvem é a fonte de verdade
  }
  function isLocalOnly(d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && DB[d] && typeof DB[d] === 'object' && !DB[d]._fromSheets &&
           Object.keys(DB[d]).length > 0 && !meta[d];
  }
  function unsyncedLocalDays() { return Object.keys(DB).filter(isLocalOnly); }
  async function reconcileLocal(remoteDates) {
    var uid = await getUid(); if (!uid) return;
    var only = unsyncedLocalDays().filter(function(d) { return !remoteDates.has(d); });
    var list = pushAfterLoad.slice(); pushAfterLoad = [];
    if (only.length && window._firstLoginOnDevice) {
      var ok = confirm('Há ' + only.length + ' dia(s) guardado(s) só neste dispositivo.\n\nQueres juntá-los à tua conta?\n\nOK = juntar à conta · Cancelar = deixar só neste dispositivo');
      if (!ok) only = [];
    }
    only.forEach(function(d) { if (list.indexOf(d) < 0) list.push(d); });
    if (list.length) await Promise.all(list.map(function(d) { return saveDay(d); }));
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', function() { offline = false; emit(); drain(true); });
    window.addEventListener('offline', function() { offline = true; emit(); });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function() { if (!document.hidden && queue.length) drain(true); });
  }
  setInterval(function() { if (queue.length && !running) drain(false); }, 5000);

  return {
    saveDay: saveDay, saveConfig: saveConfig, saveProfile: saveProfile,
    flushAll: flushAll, recover: recover, retryNow: function() { return drain(true); },
    adoptRemote: adoptRemote, reconcileLocal: reconcileLocal, unsyncedLocalDays: unsyncedLocalDays,
    setGuest: function(g) { guest = !!g; emit(); },
    pendingCount: pendingCount, status: status, onChange: function(f) { listeners.push(f); },
    isPending: function(date) { return queue.some(function(j) { return j.kind === 'day' && j.key === date; }); },
    resetLocal: function() { queue = []; meta = {}; try { localStorage.removeItem(QUEUE_KEY); localStorage.removeItem(META_KEY); } catch (e) {} emit(); },
    _debug: function() { return { queue: queue, meta: meta, rpcMissing: rpcMissing, offline: offline }; }
  };
})();

// ── Mensagens de resultado: «guardado» só depois da confirmação do Supabase ──
function showSavedBar(text, kind) {
  var bar = document.getElementById('savedBar'); if (!bar) return;
  bar.textContent = text;
  bar.classList.remove('warn', 'err');
  if (kind) bar.classList.add(kind);
  bar.classList.add('show');
  clearTimeout(showSavedBar._t);
  showSavedBar._t = setTimeout(function() { bar.classList.remove('show'); }, kind ? 6000 : 2500);
}
function showSaveResult(state) {
  var map = {
    cloud:   ['✓ Guardado na nuvem', ''],
    local:   ['✓ Guardado neste dispositivo (sem conta)', ''],
    pending: ['⚠ Ainda não enviado para a nuvem — vou tentar de novo', 'warn'],
    offline: ['📴 Sem ligação — guardado neste dispositivo, envio pendente', 'warn'],
    error:   ['⚠ Erro ao guardar na nuvem — vou tentar de novo', 'err']
  };
  var m = map[state]; if (!m) return;
  showSavedBar(m[0], m[1]);
}
function saveMsgText(state, stamp) {
  var at = stamp ? ' às ' + stamp : '';
  return ({
    cloud:   '✓ guardado na nuvem' + at,
    local:   '✓ guardado neste dispositivo' + at,
    pending: '⚠ guardado neste dispositivo; envio pendente',
    offline: '📴 sem ligação — guardado neste dispositivo; envio pendente',
    error:   '⚠ erro ao guardar na nuvem; vou tentar de novo'
  })[state] || ('✓ guardado' + at);
}
// Campos do Banco de horas: só lê o formulário se o dia em edição for hoje
function _wf(id) {
  var isToday = true;
  try { isToday = (workEditDate === TODAY); } catch (e) {}
  return isToday ? document.getElementById(id).value : ((DB[TODAY] || {})[id] || '');
}
// Preferências (lembretes, IA, conquistas) → guardadas também na conta
var _CFG_MAP = { dvReminders: 'reminders', dvAiMode: 'aiMode', dvAiProvider: 'aiProvider', dvOpenRouterModel: 'openrouterModel', dvAchievements: 'achievements', dvPerfil: 'perfil', dvAvatar: 'avatar', dvTreadmillPlan: 'treadmillPlan', dvTreadmillPlanChat: 'treadmillPlanChat', dvTreadmillCriteria: 'treadmillCriteria' };
var _CFG_JSON = { reminders: 1, achievements: 1, perfil: 1, avatar: 1, treadmillPlan: 1, treadmillPlanChat: 1, treadmillCriteria: 1 };
function _cfgAt(value) {
  return value && typeof value === 'object' && value.at ? (Date.parse(value.at) || 0) : 0;
}
function cfgSave(localKey, str) {
  try { localStorage.setItem(localKey, str); } catch (e) {}
  var ck = _CFG_MAP[localKey]; if (!ck) return Promise.resolve('local');
  var val = str;
  if (_CFG_JSON[ck]) { try { val = JSON.parse(str); } catch (e) { val = str; } }
  var patch = {}; patch[ck] = val;
  return SyncManager.saveConfig(patch);
}
async function loadConfigFromCloud() {
  if (!supabaseClient) return;
  try {
    var r = await supabaseClient.auth.getSession();
    var s = r && r.data && r.data.session; if (!s || !s.user) return;
    var q = await supabaseClient.from('diario_perfil').select('config').eq('user_id', s.user.id).maybeSingle();
    if (q.error) { console.error('Supabase config load error:', q.error); return; }
    var cfg = (q.data && q.data.config) || {}, push = {};
    Object.keys(_CFG_MAP).forEach(function(lk) {
      var ck = _CFG_MAP[lk];
      if (cfg[ck] !== undefined && cfg[ck] !== null) {
        if (ck === 'treadmillPlan' || ck === 'treadmillPlanChat' || ck === 'treadmillCriteria') {
          var localRaw = localStorage.getItem(lk), localVal = null;
          try { localVal = JSON.parse(localRaw); } catch (e) {}
          if (_cfgAt(localVal) > _cfgAt(cfg[ck])) {
            push[ck] = localVal;
            return;
          }
        }
        try { localStorage.setItem(lk, typeof cfg[ck] === 'string' ? cfg[ck] : JSON.stringify(cfg[ck])); } catch (e) {}
      } else {
        var lv = localStorage.getItem(lk);
        if (lv != null) { try { push[ck] = _CFG_JSON[ck] ? JSON.parse(lv) : lv; } catch (e) {} }
      }
    });
    try { applyPerfilToForm(); } catch (e) {}
    try { if (typeof tmRenderSavedPlan === 'function') tmRenderSavedPlan(); } catch (e) {}
    if (Object.keys(push).length) SyncManager.saveConfig(push);
  } catch (e) { console.error('Erro ao carregar preferências da conta:', e); }
}


// ═══════════════════════════════════════════════════════════════════
// STATE & PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

const _d = new Date();
const TODAY = _d.getFullYear() + '-' + String(_d.getMonth()+1).padStart(2,'0') + '-' + String(_d.getDate()).padStart(2,'0');

// Helper: data local (evita problemas de fuso horário UTC vs PT)
function localDateStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ── Detetar mudança de dia (ex: browser aberto durante a noite) ──
setInterval(() => {
  const nowDate = localDateStr();
  if (nowDate !== TODAY) {
    // Dia mudou — guardar dados atuais antes de recarregar
    try { if (typeof saveData === 'function') saveData(); } catch(e) {}
    window.location.reload();
  }
}, 60 * 1000); // verifica a cada minuto


// ── FORMAT TIME INPUTS (HH:MM, 24h) ──
function fmtTime(el) {
  let v = el.value.replace(/\D/g, '');
  if (v.length > 4) v = v.slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2);
  el.value = v;
  // Trigger onchange manually after formatting
  if (v.length === 5) {
    const ev = new Event('change');
    el.dispatchEvent(ev);
  }
}

// Also fix getNowTime to return HH:MM compatible with text inputs

const DB_KEY = 'dvLifeDiary_v3';

let DB = {};
try { DB = JSON.parse(localStorage.getItem(DB_KEY) || '{}'); } catch(e) {}

let DAY = DB[TODAY] || {};

// sub-objects
let counters   = DAY.counters   || {urinar:0,defecar:0,banho:0,pausas:0,intimacy:0};
let meals = DAY.meals || {breakfast:[], lunch:[], dinner:[], snacks:[]};
// Migrate old flat array format if needed
if (Array.isArray(meals)) {
  const old = meals;
  meals = {breakfast:[], lunch:[], dinner:[], snacks:[]};
  old.forEach(m => meals.lunch.push(m)); // put old meals in lunch
}
let exercises  = DAY.exercises  || [];
let waterCount = DAY.waterCount || 0;
let waterGoal  = DAY.waterGoal  || 8;
let moods      = DAY.moods      || {};
let habitsDone = DAY.habitsDone || {};

const DEFAULT_HOBBIES = [
  {name:'leitura',icon:'📖',seconds:0,tracking:false,start:null},
  {name:'jogar',icon:'🎮',seconds:0,tracking:false,start:null},
  {name:'ver séries',icon:'📺',seconds:0,tracking:false,start:null},
];
let hobbies = (DAY.hobbies && DAY.hobbies.length > 0)
  ? DAY.hobbies.map(h => ({...h, tracking:false, start:null})) // reset timers on load
  : DEFAULT_HOBBIES.map(h => ({...h}));
// Ensure all 3 predefined exist (add missing ones)
DEFAULT_HOBBIES.forEach(def => {
  if (!hobbies.find(h => h.name === def.name)) hobbies.push({...def});
});

let hobbyTimers = {};
let waterAlertTimer = null;
let selectedMood = DAY.selectedMood || '';
let intimateRevealed = false;

// ═══════════════════════════════════════════════════════════════════
// DATE & UI INIT
// ═══════════════════════════════════════════════════════════════════

const DAYS   = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTHS_S = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const now = new Date();
document.getElementById('sb-weekday').textContent = DAYS[now.getDay()];
document.getElementById('sb-day').textContent     = now.getDate();
document.getElementById('sb-month').textContent   = MONTHS_S[now.getMonth()] + ' ' + now.getFullYear();
document.getElementById('todayFull').textContent  = `${DAYS[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]} de ${now.getFullYear()}`;

// ═══════════════════════════════════════════════════════════════════
// MOTIVATIONAL QUOTES
// ═══════════════════════════════════════════════════════════════════

const QUOTES = [
  {q:"Cuida do teu corpo. É o único lugar que tens para viver.", a:"Jim Rohn"},
  {q:"A saúde não é tudo, mas sem saúde tudo é nada.", a:"Arthur Schopenhauer"},
  {q:"O maior risco é não correr nenhum risco.", a:"Mark Zuckerberg"},
  {q:"Começa onde estás. Usa o que tens. Faz o que podes.", a:"Arthur Ashe"},
  {q:"A autodisciplina é a ponte entre metas e conquistas.", a:"Jim Rohn"},
  {q:"Cuida-te primeiro. Não podes dar o que não tens.", a:"Provérbio"},
  {q:"Pequenos passos todos os dias levam a grandes distâncias.", a:"Anónimo"},
  {q:"A saúde mental é tão importante quanto a física.", a:"Anónimo"},
  {q:"O que fazes hoje pode melhorar todos os teus amanhãs.", a:"Ralph Marston"},
  {q:"Sê gentil contigo mesmo. Estás a fazer o melhor que podes.", a:"Anónimo"},
  {q:"Movimento é vida. Sem movimento a vida é impensável.", a:"Moshé Feldenkrais"},
  {q:"O descanso não é preguiça. É sabedoria.", a:"Anónimo"},
  {q:"Cada dia é uma nova oportunidade para melhorar.", a:"Anónimo"},
  {q:"A gratidão transforma o que temos em suficiente.", a:"Anónimo"},
  {q:"Beber água é o ato mais simples de autocuidado.", a:"Anónimo"},
];

function getDayQuote() {
  const idx = Math.floor(Date.now() / 86400000) % QUOTES.length;
  const q = QUOTES[idx];
  // Fill top header
  const tq = document.getElementById('topQuote');
  const ta = document.getElementById('topAuthor');
  if (tq) tq.textContent = `"${q.q}"`;
  if (ta) ta.textContent = `— ${q.a}`;
  // Keep old sidebar elements if they exist (legacy)
  const mq = document.getElementById('motivQuote');
  const ma = document.getElementById('motivAuthor');
  if (mq) mq.textContent = `"${q.q}"`;
  if (ma) ma.textContent = `— ${q.a}`;
}

getDayQuote();

// ═══════════════════════════════════════════════════════════════════
// HABITS & QUICK EXERCISES
// ═══════════════════════════════════════════════════════════════════

const HABITS = [
  {id:'h1',icon:'🌞',name:'Exposição ao sol matinal',desc:'10-15 min de luz natural pela manhã regula o ritmo circadiano, melhora o humor e ajuda na perda de peso.'},
  {id:'h2',icon:'💧',name:'Beber 8 copos de água',desc:'A água ajuda a sentir saciedade, acelera o metabolismo e elimina toxinas. Essencial para perda de peso.'},
  {id:'h3',icon:'📵',name:'Sem ecrãs 1h antes de dormir',desc:'A luz azul suprime a melatonina e piora a qualidade do sono, que por sua vez afeta o metabolismo.'},
  {id:'h4',icon:'🚶',name:'Caminhar pelo menos 20 min',desc:'Mesmo uma caminhada curta melhora a circulação, queima calorias e reduz o apetite.'},
  {id:'h5',icon:'🦷',name:'Higiene oral completa',desc:'Escovagem + fio dentário. Escovar os dentes depois do jantar reduz a vontade de petiscar.'},
  {id:'h6',icon:'🥗',name:'Comer devagar e sem distrações',desc:'Comer sem ver televisão aumenta a saciedade. O cérebro demora 20 min a registar que estás cheio.'},
  {id:'h7',icon:'😴',name:'Dormir 7-8 horas',desc:'A privação de sono aumenta a grelina (hormona da fome) e reduz a leptina (saciedade). Crucial para perder peso.'},
  {id:'h8',icon:'🛁',name:'Banho tomado',desc:'Higiene diária. Um banho quente antes de dormir baixa a temperatura corporal e melhora o sono.'},
];

const QUICK_EXERCISES = [
  // AQUECIMENTO
  {id:'e1',icon:'🚶',name:'Marcha no lugar',qty:'3 minutos contínuos',desc:'Levanta os joelhos alternadamente, braços a balançar. Aquece o corpo sem impacto. Faz antes de qualquer exercício.',cat:'aquecimento',dur:'3 min',nivel:'fácil',kcal:12,video:'https://www.youtube.com/results?search_query=marcha+no+lugar+aquecimento'},
  {id:'e2',icon:'🤸',name:'Rotação dos ombros e pescoço',qty:'10 rotações cada',desc:'Roda os ombros para a frente e para trás. Depois inclina a cabeça devagar para cada lado. Alivia tensão acumulada.',cat:'aquecimento',dur:'2 min',nivel:'fácil',kcal:8,video:'https://www.youtube.com/results?search_query=rotacao+ombros+pescoco+alongamento'},

  // FORÇA — em casa, sem equipamento
  {id:'e3',icon:'🪑',name:'Agachamento com cadeira',qty:'3 séries de 8 a 10 repetições',desc:'Em frente a uma cadeira resistente. Pés à largura dos ombros. Desce devagar como se fosses sentar, toca levemente e levanta. A cadeira dá segurança. Descansa 30 seg entre séries.',cat:'forca',dur:'7 min',nivel:'fácil',kcal:42,video:'https://www.youtube.com/results?search_query=agachamento+com+cadeira+iniciante'},
  {id:'e4',icon:'🖐️',name:'Flexões na parede',qty:'3 séries de 8 repetições',desc:'Coloca as mãos na parede à altura do peito. Afasta os pés um passo. Dobra os cotovelos até o nariz quase tocar a parede. Mais fácil e seguro que flexão no chão.',cat:'forca',dur:'6 min',nivel:'fácil',kcal:36,video:'https://www.youtube.com/results?search_query=flexoes+na+parede+iniciante'},
  {id:'e5',icon:'🦶',name:'Elevação de calcanhares',qty:'3 séries de 12 repetições',desc:'Em pé junto à parede para equilíbrio. Levanta os calcanhares devagar, segura 2 segundos no topo, desce lentamente. Fortalece as pernas e melhora a circulação.',cat:'forca',dur:'5 min',nivel:'fácil',kcal:30,video:'https://www.youtube.com/results?search_query=elevacao+calcanhares+exercicio'},
  {id:'e6',icon:'🧎',name:'Prancha de joelhos',qty:'3 séries de 20 segundos',desc:'Com os joelhos no chão, mãos alinhadas com os ombros. Corpo reto dos joelhos à cabeça. Não deixas a barriga cair. Fortalece o core sem pressão na lombar.',cat:'forca',dur:'5 min',nivel:'fácil',kcal:30,video:'https://www.youtube.com/results?search_query=prancha+joelhos+core+iniciante'},
  {id:'e7',icon:'💪',name:'Flexões de joelhos',qty:'2 séries de 6 a 8 repetições',desc:'Joelhos no chão, mãos largas. Desce o peito até quase tocar o chão. Versão adaptada da flexão tradicional. Excelente para começar a ganhar força nos braços.',cat:'forca',dur:'5 min',nivel:'fácil',kcal:30,video:'https://www.youtube.com/results?search_query=flexoes+joelhos+no+chao+iniciante'},

  // CARDIO — baixo impacto, ideal para perda de peso
  {id:'e8',icon:'💃',name:'Passo lateral (side step)',qty:'4 séries de 20 passos',desc:'Da um passo para a direita, junta o pé esquerdo. Depois o contrário. Ritmo suave mas constante. Cardio de baixo impacto, bom para os joelhos e para queimar calorias.',cat:'cardio',dur:'5 min',nivel:'fácil',kcal:40,video:'https://www.youtube.com/results?search_query=passo+lateral+cardio+baixo+impacto'},
  {id:'e9',icon:'🙌',name:'Jumping Jacks adaptados',qty:'3 séries de 10 repetições',desc:'Versão sem salto: um pé de cada vez para fora, depois junta. Braços sobem ao mesmo tempo. Ativa a circulação e acelera o metabolismo sem impacto nas articulações.',cat:'cardio',dur:'4 min',nivel:'fácil',kcal:32,video:'https://www.youtube.com/results?search_query=jumping+jacks+sem+salto+baixo+impacto'},
  {id:'e10',icon:'🚴',name:'Bicicleta deitado',qty:'3 séries de 15 repetições',desc:'Deitado de costas, pernas no ar. Pedala como uma bicicleta alternando os joelhos. Trabalha o abdómen e as pernas sem stress nas costas.',cat:'cardio',dur:'5 min',nivel:'fácil',kcal:40,video:'https://www.youtube.com/results?search_query=bicicleta+deitado+abdominal+iniciante'},

  // ALONGAMENTO — essencial para recuperação
  {id:'e11',icon:'🧘',name:'Alongamento gato-vaca',qty:'8 repetições lentas',desc:'De joelhos com apoio das mãos. Arqueia as costas para cima (gato) depois para baixo (vaca). Alinha a coluna e alivia dores lombares — muito comum em excesso de peso.',cat:'alongamento',dur:'3 min',nivel:'fácil',kcal:9,video:'https://www.youtube.com/results?search_query=alongamento+gato+vaca+coluna'},
  {id:'e12',icon:'🦵',name:'Alongamento dos quadríceps',qty:'30 seg cada perna · 2 vezes',desc:'Em pé junto à parede. Dobra um joelho e segura o pé atrás com a mão. Mantém o equilíbrio com a outra mão na parede. Essencial após agachamentos.',cat:'alongamento',dur:'3 min',nivel:'fácil',kcal:9,video:'https://www.youtube.com/results?search_query=alongamento+quadriceps+em+pe'},
  {id:'e13',icon:'🤾',name:'Rotação dos tornozelos',qty:'15 círculos cada pé',desc:'Sentado numa cadeira. Levanta um pé e faz círculos lentos. Ativa a circulação nas pernas e reduz o inchaço que pode acompanhar excesso de peso.',cat:'alongamento',dur:'2 min',nivel:'fácil',kcal:6,video:'https://www.youtube.com/results?search_query=rotacao+tornozelos+circulacao'},

  // MOVIMENTO DIÁRIO
  {id:'e14',icon:'🚶',name:'Caminhada de 10 minutos',qty:'1 ou 2 vezes ao dia',desc:'Mesmo a um ritmo lento. Sai de casa, anda pelo bairro. 10 min de caminhada 2x/dia = 1 hora por semana de exercício sem esforço concentrado.',cat:'movimento',dur:'10 min',nivel:'fácil',kcal:50,video:'https://www.youtube.com/results?search_query=caminhada+rapida+perda+peso'},
  {id:'e15',icon:'⏰',name:'Levantar a cada hora',qty:'1-2 minutos de pé',desc:'Programa um alarme no telemóvel. Levanta, vai à casa de banho, bebe água, estica as pernas. Quem está sentado 8h/dia tem maior risco mesmo que faça exercício.',cat:'movimento',dur:'2 min',nivel:'fácil',kcal:10,video:'https://www.youtube.com/results?search_query=exercicios+para+fazer+no+escritorio'},
  {id:'e16',icon:'🧹',name:'Tarefas domésticas ativas',qty:'20 a 30 minutos',desc:'Aspirar, varrer, lavar — tudo conta como atividade física. Uma pessoa de 100kg queima cerca de 200-250 kcal em 30 min de tarefas domésticas.',cat:'movimento',dur:'20 min',nivel:'fácil',kcal:100,video:'https://www.youtube.com/results?search_query=calorias+tarefas+domesticas+exercicio'},
];

// Daily routines — rotate by day of week, 5-10 min, beginner
const DAILY_ROUTINES = [
  // Segunda
  [ {id:'e16',steps:'Levanta, abre a janela e respira fundo 5 vezes'}, {id:'e1',steps:'Inclina o pescoço para cada lado, 5x'}, {id:'e9',steps:'Junto à parede: levanta os calcanhares 12x, 2 séries'}, {id:'e11',steps:'Marcha no lugar durante 2 minutos'} ],
  // Terça
  [ {id:'e2',steps:'Roda os ombros: 10x para a frente, 10x para trás'}, {id:'e7',steps:'Agachamento com cadeira: 8x, 2 séries'}, {id:'e12',steps:'Passo lateral: 20 passos para cada lado, 3x'}, {id:'e5',steps:'Sentado: rotação dos tornozelos, 10x cada pé'} ],
  // Quarta
  [ {id:'e3',steps:'Gato-vaca no chão: 8 repetições lentas'}, {id:'e10',steps:'Apoio de braços na parede: 8x, 2 séries'}, {id:'e13',steps:'Jumping jacks suaves: 10x, 2 séries'}, {id:'e14',steps:'Caminhada de 10 minutos lá fora ou em casa'} ],
  // Quinta
  [ {id:'e1',steps:'Alongamento do pescoço: 5x cada lado, devagar'}, {id:'e8',steps:'Prancha nos joelhos: 15 segundos, 2 séries'}, {id:'e11',steps:'Marcha no lugar: 2 minutos a bom ritmo'}, {id:'e15',steps:'Faz uma tarefa doméstica de 15 min de forma ativa'} ],
  // Sexta
  [ {id:'e4',steps:'Junto à parede: alonga cada quadríceps 30 seg'}, {id:'e6',steps:'Flexões de joelhos: 5x, 2 séries — sem pressa'}, {id:'e12',steps:'Passo lateral: 20 passos, 3 séries'}, {id:'e2',steps:'Termina com rotação de ombros: 10x cada sentido'} ],
  // Sábado
  [ {id:'e14',steps:'Caminhada de 10 minutos — aproveita o dia'}, {id:'e3',steps:'Gato-vaca: 8 repetições para soltar as costas'}, {id:'e5',steps:'Rotação dos tornozelos: 10x cada pé'}, {id:'e9',steps:'Elevação dos calcanhares: 12x, 2 séries'} ],
  // Domingo
  [ {id:'e2',steps:'Dia de descanso ativo — roda os ombros suavemente'}, {id:'e1',steps:'Pescoço: inclinações lentas para cada lado'}, {id:'e3',steps:'Gato-vaca: 5 repetições muito lentas'}, {id:'e16',steps:'Levanta a cada hora e anda 2 minutos pela casa'} ],
];

function getTodayRoutine() {
  return DAILY_ROUTINES[new Date().getDay()];
}

function renderDailyRoutine() {
  const routine = getTodayRoutine();
  const exMap = {};
  QUICK_EXERCISES.forEach(e => exMap[e.id] = e);

  let totalTime = 0;
  routine.forEach(r => { const ex = exMap[r.id]; if(ex) totalTime += parseInt(ex.dur) || 0; });

  document.getElementById('routineTotalCount').textContent = routine.length;

  document.getElementById('dailyRoutine').innerHTML = routine.map((r, i) => {
    const ex = exMap[r.id];
    if(!ex) return '';
    const done = habitsDone[r.id];
    return `
      <div class="ex-card ${done ? 'ex-done' : ''}" onclick="toggleHabit('${r.id}'); renderDailyRoutine();" style="margin-bottom:8px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size: calc(11px * var(--font-scale));color:var(--faint);min-width:20px;text-align:center;padding-top:3px;">${i+1}</div>
        <div class="ex-checkbox">${done ? '✓' : ''}</div>
        <div class="ex-card-icon" style="font-size: calc(22px * var(--font-scale));">${ex.icon}</div>
        <div class="ex-card-body">
          <div class="ex-card-name">${ex.name}</div>
          <div class="ex-card-qty">${r.steps}</div>
          <div style="margin-top:4px;"><span class="tag tag-amber" style="font-size: calc(10px * var(--font-scale));">⏱ ${ex.dur}</span></div>
        </div>
      </div>
    `;
  }).join('');

  const doneInRoutine = routine.filter(r => habitsDone[r.id]).length;
  document.getElementById('routineDoneCount').textContent = doneInRoutine;
  const tag = document.getElementById('routineTag');
  if(doneInRoutine === 0)              tag.innerHTML = '';
  else if(doneInRoutine < routine.length) tag.innerHTML = `<span class="tag tag-amber">em progresso…</span>`;
  else                                 tag.innerHTML = `<span class="tag tag-green">✓ rotina completa! Parabéns!</span>`;
}

let currentExFilter = 'todos';

function filterExercises(cat, btn) {
  currentExFilter = cat;
  document.querySelectorAll('.ex-filter-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderExerciseCards();
}

function renderExerciseCards() {
  const filtered = currentExFilter === 'todos'
    ? QUICK_EXERCISES
    : QUICK_EXERCISES.filter(e => e.cat === currentExFilter);

  const catColors = {alongamento:'tag-sky', forca:'tag-green', cardio:'tag-rose', movimento:'tag-sand'};
  const catNames  = {alongamento:'Alongamento', forca:'Força', cardio:'Cardio', movimento:'Movimento'};

  const exKcalTotal = QUICK_EXERCISES.filter(e => habitsDone[e.id]).reduce((s,e) => s+(e.kcal||0), 0);
  const exKcalEl = document.getElementById('exKcalBurned');
  if (exKcalEl) exKcalEl.textContent = exKcalTotal + ' kcal queimadas hoje';
  document.getElementById('quickExercises').innerHTML = filtered.map(e => `
    <div class="ex-card ${habitsDone[e.id] ? 'ex-done' : ''}" id="excard-${e.id}">
      <div class="ex-checkbox" onclick="toggleHabit('${e.id}')">${habitsDone[e.id] ? '✓' : ''}</div>
      <div class="ex-card-icon" onclick="toggleHabit('${e.id}')">${e.icon}</div>
      <div class="ex-card-body" onclick="toggleHabit('${e.id}')">
        <div class="ex-card-name">${e.name}</div>
        <div class="ex-card-qty">${e.qty}</div>
        <div class="ex-card-desc">${e.desc}</div>
        <div class="ex-card-meta">
          <span class="tag ${catColors[e.cat]}">${catNames[e.cat]}</span>
          <span class="tag tag-amber">⏱ ${e.dur} · <span style="color:var(--amber);font-weight:500">${e.kcal||0} kcal</span></span>
          <span class="tag tag-green">✓ fácil</span>
        </div>
      </div>
      ${e.video ? `<a href="${e.video}" target="_blank" onclick="event.stopPropagation()" title="Ver vídeo no YouTube" style="flex-shrink:0;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:rgba(255,0,0,0.12);border:1px solid rgba(255,0,0,0.25);color:#ff4444;font-size: calc(16px * var(--font-scale));text-decoration:none;transition:all 0.2s;margin-top:4px;" onmouseover="this.style.background='rgba(255,0,0,0.25)'" onmouseout="this.style.background='rgba(255,0,0,0.12)'">▶</a>` : ''}
    </div>
  `).join('');

  const doneCount = QUICK_EXERCISES.filter(e => habitsDone[e.id]).length;
  const el = document.getElementById('exDoneCount');
  if(el) el.textContent = doneCount;
}

function renderHabits() {
  const el = document.getElementById('habitsList');
  el.innerHTML = HABITS.map(h => `
    <div class="habit-card">
      <div class="habit-check ${habitsDone[h.id] ? 'done' : ''}" onclick="toggleHabit('${h.id}')" id="hcheck-${h.id}">${habitsDone[h.id] ? '✓' : ''}</div>
      <div class="habit-icon">${h.icon}</div>
      <div class="habit-info">
        <div class="habit-name">${h.name}</div>
        <div class="habit-desc">${h.desc}</div>
      </div>
    </div>
  `).join('');

  renderDailyRoutine();
  renderExerciseCards();
  renderOverviewHabits();
}

function toggleHabit(id) {
  habitsDone[id] = !habitsDone[id];
  // habits checklist
  const hel = document.getElementById('hcheck-' + id);
  if(hel) { hel.className = 'habit-check ' + (habitsDone[id] ? 'done' : ''); hel.textContent = habitsDone[id] ? '✓' : ''; }
  // exercise cards list
  const exel = document.getElementById('excard-' + id);
  if(exel) {
    exel.classList.toggle('ex-done', habitsDone[id]);
    const cb = exel.querySelector('.ex-checkbox');
    if(cb) cb.textContent = habitsDone[id] ? '✓' : '';
  }
  const doneCount = QUICK_EXERCISES.filter(e => habitsDone[e.id]).length;
  const countEl = document.getElementById('exDoneCount');
  if(countEl) countEl.textContent = doneCount;
  // ── atualizar calorias queimadas ──
  const exKcalTotal = QUICK_EXERCISES.filter(e => habitsDone[e.id]).reduce((s,e) => s+(e.kcal||0), 0);
  const exKcalEl = document.getElementById('exKcalBurned');
  if(exKcalEl) exKcalEl.textContent = exKcalTotal + ' kcal queimadas hoje';
  updateSidebarCals();
  renderOverviewHabits();
  saveData();
}

function renderOverviewHabits() {
  const habDone = HABITS.filter(h => habitsDone[h.id]);
  const exDone  = QUICK_EXERCISES.filter(e => habitsDone[e.id]);
  const el = document.getElementById('overviewHabits');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap;">
      <div>
        <span style="font-family:'Source Serif 4',serif;font-size: calc(32px * var(--font-scale));font-weight:300;color:var(--moss-l);">${habDone.length}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--muted);display:block;text-transform:uppercase;letter-spacing:1px;">de ${HABITS.length} hábitos</span>
      </div>
      <div>
        <span style="font-family:'Source Serif 4',serif;font-size: calc(32px * var(--font-scale));font-weight:300;color:var(--moss-l);">${exDone.length}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--muted);display:block;text-transform:uppercase;letter-spacing:1px;">de ${QUICK_EXERCISES.length} exercícios</span>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${HABITS.map(h => `<span class="tag ${habitsDone[h.id]?'tag-green':'tag-amber'}" style="opacity:${habitsDone[h.id]?1:0.45}">${h.icon} ${habitsDone[h.id]?'✓':'○'}</span>`).join('')}
    </div>
    ${exDone.length > 0 ? `<div style="margin-top:8px;font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--moss);letter-spacing:0.5px;">💪 ${exDone.map(e=>e.name).join(' · ')}</div>` : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════════════════════════

function toggleMobileMenu(force) {
  const sb = document.getElementById('appSidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if (!sb) return;
  const isOpen = sb.classList.contains('mobile-open');
  const nextState = (typeof force === 'boolean') ? force : !isOpen;
  if (nextState) {
    sb.classList.add('mobile-open');
    if (bd) bd.classList.add('active');
  } else {
    sb.classList.remove('mobile-open');
    if (bd) bd.classList.remove('active');
  }
  const btn = document.getElementById('mobileMenuBtn');
  if (btn) {
    btn.setAttribute('aria-expanded', String(nextState));
    btn.setAttribute('aria-label', nextState ? 'Fechar menu' : 'Abrir menu');
  }
}

const SECTION_LABELS = {
  overview: 'Resumo', ai: 'Chat IA', weight: 'Peso', meals: 'Refeições',
  work: 'Trabalho', treadmill: 'Passadeira', plan: 'Plano', calendar: 'Calendário',
  profile: 'Perfil', competition: 'Competição', compadmin: 'Gerir competição',
  last5: 'Últimos 5 Dias', stats: 'Estatísticas', settings: 'Configurações', eu: 'Eu',
  report: 'Relatório do mês', shopping: 'Lista de compras'
};

function initSectionA11y() {
  document.querySelectorAll('.section-title').forEach(t => {
    t.setAttribute('role', 'heading');
    t.setAttribute('aria-level', '1');
    t.setAttribute('tabindex', '-1');
  });
}

function announceSection(id, navEl) {
  const label = SECTION_LABELS[id] || (navEl ? navEl.textContent.trim().replace(/\s+/g, ' ') : id);
  const announcer = document.getElementById('routeAnnouncer');
  if (announcer) announcer.textContent = label;
  const app = document.getElementById('appContent');
  const overlay = document.getElementById('authOverlay');
  if (!app || getComputedStyle(app).display === 'none') return;
  if (overlay && getComputedStyle(overlay).display !== 'none') return;
  const title = document.querySelector('#section-' + id + ' .section-title');
  if (title) setTimeout(() => title.focus({ preventScroll: true }), 0);
}

function showSection(id, el, fromHistory) {
  const target = document.getElementById('section-' + id);
  if (!target) return;
  if (window.innerWidth <= 768) {
    toggleMobileMenu(false);
  }
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => { n.classList.remove('active'); n.removeAttribute('aria-current'); });
  const navEl = el || (typeof navBySection === 'function' ? navBySection(id) : null);
  if (navEl) { navEl.classList.add('active'); navEl.setAttribute('aria-current', 'page'); }
  announceSection(id, navEl);
  if (!fromHistory) {
    const hash = '#' + id;
    if (location.hash !== hash) {
      try { history.pushState(null, '', hash); } catch (e) { location.hash = id; }
    }
  }
  if (id === 'overview') updateOverview();
  if (id === 'stats') { setTimeout(renderAllCharts, 60); updateGoalCounter(); }
  if (id === 'weight') { renderWeightHistory(); renderWeeklyWeight(); }
  if (id === 'exercise') renderHobbies();
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

function applyHashSection() {
  const id = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
  if (!id) {
    showSection('overview', navBySection('overview'), true);
    return true;
  }
  if (!document.getElementById('section-' + id)) return false;
  showSection(id, navBySection(id), true);
  return true;
}

window.addEventListener('popstate', applyHashSection);
window.addEventListener('hashchange', applyHashSection);

// ═══════════════════════════════════════════════════════════════════
// RESTORE FIELDS
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// RECARREGAR DIA DE HOJE DA DB (após sync ou importação)
// ═══════════════════════════════════════════════════════════════════

let _reloading = false; // guard contra loop infinito

function reloadTodayFromDB() {
  if (_reloading) return;
  _reloading = true;

  const fresh = DB[TODAY] || {};

  DAY          = fresh;
  counters     = fresh.counters     || {urinar:0,defecar:0,banho:0,pausas:0,intimacy:0};
  meals        = fresh.meals        || {breakfast:[],lunch:[],dinner:[],snacks:[]};
  exercises    = fresh.exercises    || [];
  waterCount   = fresh.waterCount   || 0;
  waterGoal    = fresh.waterGoal    || 8;
  selectedMood = fresh.selectedMood || '';
  habitsDone   = fresh.habitsDone   || {};
  hobbies      = fresh.hobbies      || [];

  if (Array.isArray(meals)) {
    const old = meals;
    meals = {breakfast:[],lunch:[],dinner:[],snacks:[]};
    old.forEach(m => meals.lunch.push(m));
  }

  restoreFields();

  // Só liberta o flag depois de todos os timers internos do restoreFields terminarem
  setTimeout(() => { _reloading = false; }, 500);
}

function restoreFields() {
  const d = DAY;
  // Usar setter direto que não dispara onchange
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && v != null) el.value = v;
  };
  set('weight', d.weight); set('weightTime', d.weightTime); set('weightGoal', d.weightGoal);
  set('height', d.height); set('weightDeadline', d.weightDeadline);
  set('workStart', d.workStart); set('workEnd', d.workEnd);
  set('lunchStart', d.lunchStart||''); set('lunchEnd', d.lunchEnd||'');
  markWorkEntry(); markWorkExit(); calcWorkHours(); renderOvertimeBank();
  set('workMood', d.workMood); set('workFocus', d.workFocus); set('workNotes', d.workNotes);
  set('screenStart', d.screenStart); set('screenEnd', d.screenEnd);
  set('bathroomNotes', d.bathroomNotes);
  set('journalEntry', d.journalEntry); set('bestMoment', d.bestMoment); set('gratitude', d.gratitude);
  set('energyLevel', d.energyLevel || 5); set('anxietyLevel', d.anxietyLevel || 3); set('stressLevel', d.stressLevel || 3);
  set('intimacyNotes', d.intimacyNotes);
  set('waterGoalInput', waterGoal);
  if(d.energyLevel) document.getElementById('energyVal').textContent = d.energyLevel;
  if(d.anxietyLevel) document.getElementById('anxietyVal').textContent = d.anxietyLevel;
  if(d.stressLevel) document.getElementById('stressVal').textContent = d.stressLevel;

  if(selectedMood) {
    document.querySelectorAll('.mood-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.mood === selectedMood);
    });
  }

  calcBMI(); calcWorkHours(); calcScreenTime(); calcWCTip();
  updateCounters(); renderMeals(); renderExercises(); renderHobbies();
  renderHabits(); updateOverview();
  // Water must be rendered LAST after all state is set
  renderWaterDrops(); updateWaterProgress();
  setTimeout(() => { renderWaterDrops(); updateSidebarCals(); }, 150);
}

// ═══════════════════════════════════════════════════════════════════
// SLEEP
// ═══════════════════════════════════════════════════════════════════

function calcSleep() {
  const bed = document.getElementById('bedtime').value;
  const wake = document.getElementById('waketime').value;
  if (!bed || !wake) return;
  let [bh,bm] = bed.split(':').map(Number), [wh,wm] = wake.split(':').map(Number);
  let bM = bh*60+bm, wM = wh*60+wm;
  if (wM < bM) wM += 24*60;
  const h = (wM - bM) / 60;
  document.getElementById('sleepBig').textContent = h.toFixed(1);
  document.getElementById('sleepBar').style.width = Math.min((h/10)*100, 100) + '%';
  const tag = document.getElementById('sleepTag');
  if(h < 5)     tag.innerHTML = '<span class="tag tag-red">⚠ muito pouco</span>';
  else if(h < 7) tag.innerHTML = '<span class="tag tag-amber">abaixo do ideal</span>';
  else if(h <= 9) tag.innerHTML = '<span class="tag tag-green">sono ideal ✓</span>';
  else           tag.innerHTML = '<span class="tag tag-sky">muito sono</span>';
  updateOverview();
}

function calcBMI() {
  const w = parseFloat(document.getElementById('weight').value);
  const h = parseFloat(document.getElementById('height').value);
  if (!w || !h) return;
  const bmi = w / ((h/100)**2);
  const cat = bmi<18.5?'Abaixo do peso':bmi<25?'Peso normal ✓':bmi<30?'Excesso de peso':'Obesidade';
  document.getElementById('bmiDisplay').textContent = `IMC: ${bmi.toFixed(1)} — ${cat}`;
}

// ═══════════════════════════════════════════════════════════════════
// WATER
// ═══════════════════════════════════════════════════════════════════

const WATER_TIPS = [
  "Começa o dia com um copo de água morna com limão. Hidrata, alcaliniza e ajuda a digestão.",
  "Beber água antes das refeições pode reduzir a ingestão calórica em até 13%.",
  "Urina amarela escura? Precisas de beber mais água.",
  "Café e chá contam para a hidratação, mas não substituem a água.",
  "Manter uma garrafa de água visível faz com que bebas mais sem pensar.",
  "O corpo humano é ~60% água. O cérebro é ~75% água.",
  "Desidratação leve (1-2%) já reduz o desempenho cognitivo e físico.",
];

document.getElementById('waterTip').textContent = WATER_TIPS[now.getDate() % WATER_TIPS.length];

function renderWaterDrops() {
  // Sidebar drops
  let sbDrops = '';
  for(let i = 0; i < waterGoal; i++) {
    const filled = i < waterCount;
    sbDrops += `<div class="water-drop ${filled ? 'filled' : ''}" onclick="toggleWaterCup(${i})" title="${filled ? 'Remover copo ' + (i+1) : 'Adicionar copo ' + (i+1)}"></div>`;
  }
  document.getElementById('sidebarDrops').innerHTML = sbDrops;

  // Main section cups
  let cups = '';
  for(let i = 0; i < waterGoal; i++) {
    const filled = i < waterCount;
    cups += `
      <div class="water-cup" onclick="toggleWaterCup(${i})" title="${filled?'Remover':'Adicionar'} copo ${i+1}">
        <svg viewBox="0 0 36 44" fill="none">
          <path d="M6 8 L8 38 Q8 42 18 42 Q28 42 28 38 L30 8 Z"
            fill="${filled ? 'rgba(120,152,168,0.35)' : 'none'}"
            stroke="${filled ? 'rgba(120,152,168,0.7)' : 'var(--border2)'}"
            stroke-width="1.5"/>
          ${filled ? `<path d="M9 28 Q9 40 18 40 Q27 40 27 28 L26 20 Q18 24 10 20 Z" fill="rgba(120,152,168,0.5)"/>` : ''}
          <text x="18" y="18" text-anchor="middle" font-size="14" fill="${filled ? 'var(--sky)' : 'var(--faint)'}">${filled ? '💧' : '○'}</text>
        </svg>
      </div>
    `;
  }
  document.getElementById('waterDropsMain').innerHTML = cups;
  updateWaterProgress();
}

function addWater() {
  if (waterCount < waterGoal) { waterCount++; renderWaterDrops(); saveData(); }
}

function toggleWaterCup(idx) {
  if (idx < waterCount) {
    waterCount = idx;
  } else {
    waterCount = idx + 1;
  }
  waterCount = Math.max(0, Math.min(waterCount, waterGoal));
  renderWaterDrops();
  updateOverview();
  saveData();
}

function updateWaterProgress() {
  const pct = Math.min((waterCount / waterGoal) * 100, 100);
  document.getElementById('waterProgressBar').style.width = pct + '%';
  document.getElementById('waterCount').textContent = waterCount;
  document.getElementById('waterGoalNum').textContent = waterGoal;
  document.getElementById('toastWaterCount').textContent = waterCount;
  document.getElementById('waterMl').textContent = (waterCount * 250) + ' ml';
  document.getElementById('ov-water').textContent = waterCount + '/' + waterGoal;

  const tag = document.getElementById('waterTag');
  if(waterCount === 0)            tag.innerHTML = '<span class="tag tag-amber">ainda sem água</span>';
  else if(waterCount < waterGoal/2) tag.innerHTML = '<span class="tag tag-amber">bebe mais</span>';
  else if(waterCount < waterGoal)  tag.innerHTML = '<span class="tag tag-sky">a caminho ✓</span>';
  else                            tag.innerHTML = '<span class="tag tag-green">meta atingida! ✓</span>';
}

function updateWaterGoal() {
  waterGoal = parseInt(document.getElementById('waterGoalInput').value) || 8;
  renderWaterDrops();
}

// ── WATER ALERTS ──────────────────────────────────────────────────

function setupWaterAlerts() {
  if(waterAlertTimer) clearInterval(waterAlertTimer);
  const mins = parseInt(document.getElementById('waterAlertInterval').value);
  if(!mins) { document.getElementById('nextAlertTime').textContent = 'alertas desligados'; return; }

  showNextAlertTime(mins);
  waterAlertTimer = setInterval(() => {
    if(waterCount < waterGoal) showWaterToast();
    showNextAlertTime(mins);
  }, mins * 60 * 1000);
}

function showNextAlertTime(mins) {
  const next = new Date(Date.now() + mins * 60000);
  document.getElementById('nextAlertTime').textContent = `próximo alerta: ${next.getHours().toString().padStart(2,'0')}:${next.getMinutes().toString().padStart(2,'0')}`;
}

function showWaterToast() {
  const toast = document.getElementById('waterToast');
  document.getElementById('toastWaterCount').textContent = waterCount;
  toast.classList.add('show');
  // Auto-dismiss after 8s
  setTimeout(() => toast.classList.remove('show'), 8000);
  // Browser notification if supported
  if('Notification' in window && Notification.permission === 'granted') {
    new Notification('💧 Hora de beber água!', { body: `Já bebeste ${waterCount} de ${waterGoal} copos hoje.`, icon: '' });
  }
}

function closeWaterToast() { document.getElementById('waterToast').classList.remove('show'); }


// ═══════════════════════════════════════════════════════════════════
// COUNTERS
// ═══════════════════════════════════════════════════════════════════

function changeCounter(name, delta) {
  counters[name] = Math.max(0, (counters[name] || 0) + delta);
  updateCounters();
  saveData();
}

function updateCounters() {
  for(const [k,v] of Object.entries(counters)) {
    const el = document.getElementById('cnt-' + k);
    if(el) el.textContent = v;
  }
  document.getElementById('ov-wc').textContent = (counters.urinar || 0) + (counters.defecar || 0);
  const banhoEl = document.getElementById('cnt-banho'); if(banhoEl) banhoEl.textContent = counters.banho || 0;
  calcWCTip();
}

function calcWCTip() {
  const u = counters.urinar || 0;
  const el = document.getElementById('wcTip');
  if(!el) return;
  if(u < 4)      el.textContent = '⚠ Menos de 4 vezes pode indicar desidratação. Bebe mais água!';
  else if(u <= 8) el.textContent = '✓ Frequência urinária normal (4-8x/dia).';
  else           el.textContent = 'Mais de 8 vezes pode indicar ingestão excessiva de líquidos ou outras causas.';
}

// ═══════════════════════════════════════════════════════════════════
// MEALS
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// AI HELPER — MULTI-PROVIDER KEY ROTATION SYSTEM
// OpenRouter → Hugging Face → Google Gemini → Groq (fallback chain)
// ═══════════════════════════════════════════════════════════════════

// ── Chaves default embutidas (utilizador pode adicionar mais via Settings) ──
const DEFAULT_OPENROUTER_KEY  = '';
const DEFAULT_HF_KEY          = '';
const DEFAULT_GEMINI_KEY      = '';
const GROQ_MODEL              = 'llama-3.3-70b-versatile';
const HF_MODEL                = 'meta-llama/Llama-3.1-8B-Instruct';
const GEMINI_MODEL            = 'gemini-3.8-flash';

// ── Helpers round-robin persistente ───────────────────────────────────────
function _getIdx(storageKey) {
  return parseInt(localStorage.getItem(storageKey) || '0', 10);
}
function _nextIdx(storageKey, len) {
  const next = (_getIdx(storageKey) + 1) % len;
  localStorage.setItem(storageKey, String(next));
  return next;
}

// ── OpenRouter ─────────────────────────────────────────────────────────────
function getOpenRouterKeys() {
  try {
    const stored = JSON.parse(localStorage.getItem('dvOpenRouterKeys') || '[]');
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch(e) {}
  const single = localStorage.getItem('dvOpenRouterKey');
  return [single || DEFAULT_OPENROUTER_KEY];
}
function setOpenRouterKeys(arr) {
  localStorage.setItem('dvOpenRouterKeys', JSON.stringify(arr));
  if (arr.length > 0) localStorage.setItem('dvOpenRouterKey', arr[0]);
}
function getOpenRouterKey() {
  const keys = getOpenRouterKeys();
  const idx = _getIdx('dvOpenRouterKeyIdx') % keys.length;
  return keys[idx];
}
function getOpenRouterModel() { return localStorage.getItem('dvOpenRouterModel') || 'nvidia/nemotron-3.5-lightning:free'; }
function getAiProvider() { return localStorage.getItem('dvAiProvider') || 'auto'; }

// ── Groq ───────────────────────────────────────────────────────────────────
function getGroqKeys() {
  try {
    const stored = JSON.parse(localStorage.getItem('dvGroqKeys') || '[]');
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch(e) {}
  const single = localStorage.getItem('dvGroqKey');
  return single ? [single] : [];
}
function setGroqKeys(arr) {
  localStorage.setItem('dvGroqKeys', JSON.stringify(arr));
  if (arr.length > 0) localStorage.setItem('dvGroqKey', arr[0]);
}
function getGroqKey() {
  const keys = getGroqKeys();
  if (keys.length === 0) return '';
  const idx = _getIdx('dvGroqKeyIdx') % keys.length;
  return keys[idx];
}
function setGroqKey(k) {
  const keys = getGroqKeys();
  const trimmed = k.trim();
  if (!keys.includes(trimmed)) keys.push(trimmed);
  setGroqKeys(keys);
}
Object.defineProperty(window, 'GROQ_KEY', { get: getGroqKey });

// ── Hugging Face ─────────────────────────────────────────────────────────────
function getHFKeys() {
  try {
    const stored = JSON.parse(localStorage.getItem('dvHFKeys') || '[]');
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch(e) {}
  const single = localStorage.getItem('dvHFKey');
  return [single || DEFAULT_HF_KEY];
}
function setHFKeys(arr) {
  localStorage.setItem('dvHFKeys', JSON.stringify(arr));
  if (arr.length > 0) localStorage.setItem('dvHFKey', arr[0]);
}
function getHFKey() {
  const keys = getHFKeys();
  const idx = _getIdx('dvHFKeyIdx') % keys.length;
  return keys[idx];
}

// ── Google Gemini ───────────────────────────────────────────────────────────
function getGeminiKeys() {
  try {
    const stored = JSON.parse(localStorage.getItem('dvGeminiKeys') || '[]');
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch(e) {}
  const single = localStorage.getItem('dvGeminiKey');
  return [single || DEFAULT_GEMINI_KEY];
}
function setGeminiKeys(arr) {
  localStorage.setItem('dvGeminiKeys', JSON.stringify(arr));
  if (arr.length > 0) localStorage.setItem('dvGeminiKey', arr[0]);
}
function getGeminiKey() {
  const keys = getGeminiKeys();
  const idx = _getIdx('dvGeminiKeyIdx') % keys.length;
  return keys[idx];
}

// ── CHAMADAS DE API COM ROTAÇÃO ─────────────────────────────────────────────

async function callOpenRouter(systemPrompt, userPrompt, maxTokens) {
  const keys = getOpenRouterKeys();
  if (!keys.length) throw new Error('Sem chaves OpenRouter.');
  const model = getOpenRouterModel();
  let lastErr;
  const startIdx = _getIdx('dvOpenRouterKeyIdx') % keys.length;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (startIdx + attempt) % keys.length;
    const key = keys[idx];
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key,
          'HTTP-Referer': window.location.origin || 'https://github.com',
          'X-Title': 'Diário de Vida'
        },
        body: JSON.stringify({
          model, max_tokens: maxTokens || 800, temperature: 0.3,
          messages: [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }]
        })
      });
      if (response.ok) {
        localStorage.setItem('dvOpenRouterKeyIdx', String((idx + 1) % keys.length));
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Resposta vazia da IA');
        return text;
      }
      const errText = await response.text();
      let msg = 'OpenRouter HTTP ' + response.status;
      try { const j = JSON.parse(errText); msg = j.error?.message || msg; } catch(e2) {}
      if (response.status === 401) msg = `OR chave #${idx+1} inválida`;
      if (response.status === 429) msg = `OR chave #${idx+1} limite atingido`;
      if (response.status !== 401 && response.status !== 429) throw new Error(msg);
      lastErr = new Error(msg);
      console.warn('[AI Rotation] OpenRouter:', msg);
    } catch(fetchErr) {
      if (['429','401','inválida','limite','próxima'].some(s => fetchErr.message.includes(s))) {
        lastErr = fetchErr; continue;
      }
      throw fetchErr;
    }
  }
  throw lastErr || new Error('Todas as chaves OpenRouter falharam.');
}

async function callHuggingFace(systemPrompt, userPrompt, maxTokens) {
  const keys = getHFKeys();
  if (!keys.length) throw new Error('Sem chaves Hugging Face.');
  let lastErr;
  const startIdx = _getIdx('dvHFKeyIdx') % keys.length;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (startIdx + attempt) % keys.length;
    const key = keys[idx];
    try {
      const response = await fetch(`https://router.huggingface.co/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify({
          model: HF_MODEL,
          max_tokens: maxTokens || 800,
          temperature: 0.3,
          messages: [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }]
        })
      });
      if (response.ok) {
        localStorage.setItem('dvHFKeyIdx', String((idx + 1) % keys.length));
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Resposta vazia HF');
        return text;
      }
      const errText = await response.text();
      let msg = 'HuggingFace HTTP ' + response.status;
      try { const j = JSON.parse(errText); msg = j.error?.message || msg; } catch(e2) {}
      if (response.status === 401 || response.status === 403) msg = `HF chave #${idx+1} inválida`;
      if (response.status === 429) msg = `HF chave #${idx+1} limite atingido`;
      if (![401,403,429].includes(response.status)) throw new Error(msg);
      lastErr = new Error(msg);
      console.warn('[AI Rotation] HuggingFace:', msg);
    } catch(fetchErr) {
      if (['429','401','403','inválida','limite'].some(s => fetchErr.message.includes(s))) {
        lastErr = fetchErr; continue;
      }
      throw fetchErr;
    }
  }
  throw lastErr || new Error('Todas as chaves Hugging Face falharam.');
}

function geminiResponseText(data) {
  const parts = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(part => part && part.thought !== true && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
    .trim();
}

async function callGeminiDirect(systemPrompt, userPrompt, maxTokens) {
  const keys = getGeminiKeys();
  if (!keys.length) throw new Error('Sem chaves Gemini.');
  let lastErr;
  const startIdx = _getIdx('dvGeminiKeyIdx') % keys.length;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (startIdx + attempt) % keys.length;
    const key = keys[idx];
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens || 800,
            thinkingConfig: { thinkingLevel: 'low' }
          }
        })
      });
      if (response.ok) {
        localStorage.setItem('dvGeminiKeyIdx', String((idx + 1) % keys.length));
        const data = await response.json();
        const text = geminiResponseText(data);
        if (!text) throw new Error('Resposta vazia Gemini');
        return text;
      }
      const errText = await response.text();
      let msg = 'Gemini HTTP ' + response.status;
      try { const j = JSON.parse(errText); msg = j.error?.message || msg; } catch(e2) {}
      if (response.status === 400) msg = `Gemini chave #${idx+1} inválida ou quota esgotada`;
      if (response.status === 403) msg = `Gemini chave #${idx+1} sem permissão`;
      if (response.status === 429) msg = `Gemini chave #${idx+1} limite atingido`;
      if (![400,403,429].includes(response.status)) throw new Error(msg);
      lastErr = new Error(msg);
      console.warn('[AI Rotation] Gemini:', msg);
    } catch(fetchErr) {
      if (['429','403','400','inválida','limite','quota'].some(s => fetchErr.message.includes(s))) {
        lastErr = fetchErr; continue;
      }
      throw fetchErr;
    }
  }
  throw lastErr || new Error('Todas as chaves Gemini falharam.');
}

async function callGroqDirect(systemPrompt, userPrompt, maxTokens) {
  const keys = getGroqKeys();
  if (!keys.length) throw new Error('Sem chaves Groq.');
  let lastErr;
  const startIdx = _getIdx('dvGroqKeyIdx') % keys.length;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (startIdx + attempt) % keys.length;
    const key = keys[idx];
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: GROQ_MODEL, max_tokens: maxTokens || 800, temperature: 0.4,
          messages: [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }]
        })
      });
      if (response.ok) {
        localStorage.setItem('dvGroqKeyIdx', String((idx + 1) % keys.length));
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Resposta vazia Groq');
        return text;
      }
      const errText = await response.text();
      let msg = 'Groq HTTP ' + response.status;
      try { const j = JSON.parse(errText); msg = j.error?.message || msg; } catch(e2) {}
      if (response.status === 401) msg = `Groq chave #${idx+1} inválida`;
      if (response.status === 429) msg = `Groq chave #${idx+1} limite atingido`;
      if (response.status !== 401 && response.status !== 429) throw new Error(msg);
      lastErr = new Error(msg);
      console.warn('[AI Rotation] Groq:', msg);
    } catch(fetchErr) {
      if (['429','401','inválida','limite'].some(s => fetchErr.message.includes(s))) {
        lastErr = fetchErr; continue;
      }
      throw fetchErr;
    }
  }
  throw lastErr || new Error('Todas as chaves Groq falharam.');
}

function getAiMode() {
  return localStorage.getItem('dvAiMode') === 'byok' ? 'byok' : 'app';
}

function hasLocalAiKeys() {
  return [getOpenRouterKeys(), getHFKeys(), getGeminiKeys(), getGroqKeys()]
    .some(keys => keys.some(key => key && key.length > 10));
}

async function getAiAuthSession() {
  if (!supabaseClient) return null;
  try {
    const result = await supabaseClient.auth.getSession();
    return result && result.data ? result.data.session : null;
  } catch(e) {
    return null;
  }
}

async function callAiProxy(systemPrompt, userPrompt, maxTokens, purpose) {
  if (!supabaseClient) {
    const err = new Error('Entra na conta para usar a IA incluída.');
    err.proxyUnavailable = true;
    throw err;
  }
  let result;
  try {
    result = await supabaseClient.functions.invoke('ai-proxy', {
      body: {
        systemPrompt: systemPrompt,
        userPrompt: userPrompt,
        maxTokens: maxTokens || 800,
        purpose: purpose || 'app'
      }
    });
  } catch(e) {
    const err = new Error('Não foi possível contactar a IA incluída.');
    err.proxyUnavailable = true;
    throw err;
  }
  const error = result && result.error;
  const data = result && result.data;
  if (error) {
    let message = '';
    let status = 0;
    try {
      status = error.context && error.context.status ? error.context.status : 0;
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        message = body && body.error ? body.error : '';
      }
    } catch(e) {}
    if (!message) message = error.message || 'IA indisponível.';
    if (status === 401) message = 'Sessão expirada. Entra novamente para usar a IA incluída.';
    if (status === 429) message = 'Limite diário de IA atingido. Tenta novamente amanhã.';
    const err = new Error(message);
    if (status === 404 || status >= 500 || /failed to send|not found/i.test(error.message || '')) {
      err.proxyUnavailable = true;
    }
    throw err;
  }
  if (!data || !data.text) {
    throw new Error((data && data.error) || 'Resposta vazia da IA.');
  }
  return data.text;
}

async function callAiWithLocalKeys(systemPrompt, userPrompt, maxTokens) {
  const provider = getAiProvider();
  if (provider === 'openrouter') return await callOpenRouter(systemPrompt, userPrompt, maxTokens);
  if (provider === 'huggingface') return await callHuggingFace(systemPrompt, userPrompt, maxTokens);
  if (provider === 'gemini')      return await callGeminiDirect(systemPrompt, userPrompt, maxTokens);
  if (provider === 'groq')        return await callGroqDirect(systemPrompt, userPrompt, maxTokens);

  const chain = [
    { name: 'OpenRouter',    fn: () => callOpenRouter(systemPrompt, userPrompt, maxTokens) },
    { name: 'HuggingFace',  fn: () => callHuggingFace(systemPrompt, userPrompt, maxTokens) },
    { name: 'Gemini',       fn: () => callGeminiDirect(systemPrompt, userPrompt, maxTokens) },
    { name: 'Groq',         fn: () => callGroqDirect(systemPrompt, userPrompt, maxTokens) },
  ];
  let lastErr;
  for (const { name, fn } of chain) {
    try {
      const result = await fn();
      return result;
    } catch(e) {
      console.warn(`[AI Auto] ${name} falhou:`, e.message);
      lastErr = e;
    }
  }
  throw lastErr || new Error('Todos os providers de IA falharam. Verifica as chaves em ⚙️ Configurações → IA.');
}

async function callGemini(systemPrompt, userPrompt, maxTokens, purpose) {
  if (getAiMode() === 'app') {
    const session = await getAiAuthSession();
    if (session) {
      try {
        return await callAiProxy(systemPrompt, userPrompt, maxTokens, purpose);
      } catch(e) {
        if (e.proxyUnavailable && hasLocalAiKeys()) {
          console.warn('[AI] IA incluída indisponível; a usar chaves locais.', e.message);
          return await callAiWithLocalKeys(systemPrompt, userPrompt, maxTokens);
        }
        throw e;
      }
    }
    if (hasLocalAiKeys()) {
      console.warn('[AI] Sem sessão; a usar chaves locais.');
      return await callAiWithLocalKeys(systemPrompt, userPrompt, maxTokens);
    }
    throw new Error('Entra na tua conta para usar a IA incluída, ou ativa as tuas chaves em ⚙️ Configurações → IA.');
  }
  return await callAiWithLocalKeys(systemPrompt, userPrompt, maxTokens);
}

// Compatibilidade — getGroqKey já definida acima

function extractJSON(text) {
  // Try direct parse first
  try { return JSON.parse(text.trim()); } catch(e) {}
  // Strip markdown fences
  const stripped = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  try { return JSON.parse(stripped); } catch(e) {}
  // Find first { ... } block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end+1)); } catch(e) {}
  }
  throw new Error('Nao foi possivel extrair JSON da resposta');
}

// ── CÁLCULO AUTOMÁTICO DE CALORIAS COM IA (COM CACHE LOCAL) ──
let foodSearchTimeout = null;
let foodResults = [];

async function calcCaloriesAI(foodName) {
  const normKey = (foodName || '').trim().toLowerCase();
  const cacheKey = 'dv_food_cache';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}'); } catch(e) {}
  if (normKey && cache[normKey]) {
    return cache[normKey];
  }

  const text = await callGemini(
    'Nutricionista. Responde APENAS em JSON sem markdown nem texto extra: {"calorias":0,"calorias_alto":0,"proteina":0,"carbo":0,"gordura":0}. "calorias" = estimativa média, "calorias_alto" = estimativa conservadora pelo valor mais alto possível. Para a quantidade descrita ou porção normal se não indicada.',
    'Alimento: ' + foodName,
    200
  );
  const result = extractJSON(text);
  if (result && normKey && typeof result.calorias === 'number') {
    cache[normKey] = result;
    try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch(e) {}
  }
  return result;
}

async function searchFoodSheets(query) {
  if (!sheetsUrl || !query || query.length < 2) return [];
  try {
    const url = sheetsUrl.replace('/exec', '/exec') + '?action=search&q=' + encodeURIComponent(query);
    const r = await fetch(url);
    const data = await r.json();
    return data.results || [];
  } catch(e) {
    return searchFoodLocal(query);
  }
}

// Local fallback — basic food db always available
const LOCAL_FOODS = [
  // ── AS TUAS REFEIÇÕES HABITUAIS ──
  // Massas & Cereais
  {nome:'Massa cozida c/ manteiga (100g)',    calorias:185, proteina:5,  carbo:31, gordura:6},
  {nome:'Massa cozida c/ manteiga (150g)',    calorias:278, proteina:7,  carbo:46, gordura:9},
  {nome:'Massa cozida c/ manteiga (200g)',    calorias:370, proteina:10, carbo:62, gordura:12},
  {nome:'Esparguete cozido c/ manteiga (100g)', calorias:183, proteina:5, carbo:30, gordura:6},
  {nome:'Esparguete cozido c/ manteiga (150g)', calorias:275, proteina:8, carbo:45, gordura:9},
  {nome:'Esparguete cozido c/ manteiga (200g)', calorias:366, proteina:10,carbo:60, gordura:12},
  {nome:'Arroz cozido (100g)',                calorias:130, proteina:3,  carbo:28, gordura:0.3},
  {nome:'Arroz cozido (150g)',                calorias:195, proteina:4,  carbo:42, gordura:0.5},
  {nome:'Arroz cozido (200g)',                calorias:260, proteina:5,  carbo:56, gordura:0.6},
  // Carnes
  {nome:'Bife de frango grelhado (100g)',     calorias:165, proteina:31, carbo:0,  gordura:3.6},
  {nome:'Bife de frango grelhado (150g)',     calorias:248, proteina:47, carbo:0,  gordura:5.4},
  {nome:'Bife de frango grelhado (200g)',     calorias:330, proteina:62, carbo:0,  gordura:7.2},
  {nome:'Bife de peru grelhado (100g)',       calorias:135, proteina:29, carbo:0,  gordura:1.7},
  {nome:'Bife de peru grelhado (150g)',       calorias:203, proteina:44, carbo:0,  gordura:2.6},
  {nome:'Bife de peru grelhado (200g)',       calorias:270, proteina:58, carbo:0,  gordura:3.4},
  {nome:'Peito de frango grelhado (100g)',    calorias:158, proteina:32, carbo:0,  gordura:3.2},
  {nome:'Peito de frango grelhado (150g)',    calorias:237, proteina:48, carbo:0,  gordura:4.8},
  {nome:'Peito de frango grelhado (200g)',    calorias:316, proteina:64, carbo:0,  gordura:6.4},
  // Gelatina
  {nome:'Gelatina sem açúcar (125g)',         calorias:8,   proteina:1.5,carbo:0.5,gordura:0},
  {nome:'Gelatina sem açúcar (250g)',         calorias:16,  proteina:3,  carbo:1,  gordura:0},
  // Bebidas
  {nome:'Água (250ml)',                       calorias:0,   proteina:0,  carbo:0,  gordura:0},
  {nome:'Água (500ml)',                       calorias:0,   proteina:0,  carbo:0,  gordura:0},
  {nome:'Sumo de fruta (200ml)',              calorias:90,  proteina:0.5,carbo:22, gordura:0.2},
  // Outros comuns
  {nome:'Ovo cozido (1 unid)',                calorias:78,  proteina:6,  carbo:0.6,gordura:5},
  {nome:'Pão de forma (1 fatia)',             calorias:63,  proteina:2.2,carbo:12, gordura:0.6},
  {nome:'Iogurte natural (125g)',             calorias:75,  proteina:5,  carbo:8,  gordura:2},
  {nome:'Manteiga (10g)',                     calorias:74,  proteina:0.1,carbo:0,  gordura:8.2},
];

function searchFoodLocal(query) {
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return LOCAL_FOODS.filter(f => {
    const name = f.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return name.includes(q);
  }).slice(0,8);
}

function onFoodInput() {
  const query = document.getElementById('foodInput').value.trim();
  clearTimeout(foodSearchTimeout);
  hideFoodSuggestions();
  if (query.length < 2) return;
  foodSearchTimeout = setTimeout(async () => {
    const results = sheetsUrl ? await searchFoodSheets(query) : searchFoodLocal(query);
    showFoodSuggestions(results, query);
  }, 300);
}

function showFoodSuggestions(results, query) {
  let box = document.getElementById('foodSuggestions');
  if (!box) {
    box = document.createElement('div');
    box.id = 'foodSuggestions';
    box.style.cssText = 'position:absolute;z-index:1000;background:var(--card);border:1px solid var(--border2);border-radius:10px;box-shadow:0 4px 20px rgba(44,40,32,0.12);max-height:280px;overflow-y:auto;width:100%;margin-top:4px;';
    const inputWrap = document.getElementById('foodInput').parentElement;
    inputWrap.style.position = 'relative';
    inputWrap.appendChild(box);
  }
  if (!results.length) {
    box.innerHTML = '<div style="padding:12px 16px;font-family:JetBrains Mono,monospace;font-size: calc(11px * var(--font-scale));color:var(--muted);font-style:italic;">Nenhum resultado. Tenta outra palavra.</div>';
    box.style.display = 'block';
    return;
  }
  box.innerHTML = results.map((f,i) => `
    <div onclick="selectFood(${i})" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;transition:background 0.1s;" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      <span style="font-size: calc(13px * var(--font-scale));color:var(--text)">${f.nome}</span>
      <span style="font-family:JetBrains Mono,monospace;font-size: calc(11px * var(--font-scale));color:var(--moss-l);font-weight:500">${f.calorias} kcal</span>
    </div>
  `).join('');
  foodResults = results;
  box.style.display = 'block';
}

function hideFoodSuggestions() {
  const box = document.getElementById('foodSuggestions');
  if (box) box.style.display = 'none';
}

function selectFood(idx) {
  const food = foodResults[idx];
  if (!food) return;
  document.getElementById('foodInput').value = food.nome;
  hideFoodSuggestions();
  showFoodNutrition(food);
}

function showFoodNutrition(food) {
  const resp = document.getElementById('calResponse');
  resp.className = 'ai-response visible';
  resp.innerHTML = `
    <strong>${food.nome}</strong><br><br>
    <strong style="color:var(--moss-l)">${food.calorias} kcal</strong><br>
    <small style="color:var(--muted)">Proteína: ${food.proteina}g · Hidratos: ${food.carbo}g · Gordura: ${food.gordura}g</small>
  `;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary';
  addBtn.style.marginTop = '10px';
  addBtn.textContent = `+ Adicionar (${food.calorias} kcal)`;
  addBtn.onclick = () => {
    addMeal(food.nome, food.calorias);
    document.getElementById('foodInput').value = '';
    resp.className = 'ai-response';
    hideFoodSuggestions();
  };
  resp.appendChild(addBtn);
}

async function calcCalories() {
  const query = document.getElementById('foodInput').value.trim();
  if (!query) return;
  const results = sheetsUrl ? await searchFoodSheets(query) : searchFoodLocal(query);
  if (results.length === 1) {
    selectFood(0);
  } else if (results.length > 1) {
    showFoodSuggestions(results, query);
  } else {
    const resp = document.getElementById('calResponse');
    resp.className = 'ai-response visible';
    resp.innerHTML = '<span style="color:var(--muted);font-style:italic">Nenhum alimento encontrado. Tenta: "frango", "arroz", "pão"...</span>';
  }
}

// Close suggestions when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#foodInput') && !e.target.closest('#foodSuggestions')) {
    hideFoodSuggestions();
  }
});

const SLOTS = {
  breakfast: {label:'Pequeno Almoço', icon:'🌅'},
  lunch:     {label:'Almoço',         icon:'☀️'},
  dinner:    {label:'Jantar',         icon:'🌙'},
  snacks:    {label:'Lanches & Snacks', icon:'🍎'},
};

// Adicionar manualmente (utilizador escreve as calorias)
function addMealManual(slot) {
  const nameEl   = document.getElementById('name-' + slot);
  const kcalEl   = document.getElementById('kcal-' + slot);
  const statusEl = document.getElementById('ai-status-' + slot);
  const name = (nameEl.value || '').trim();
  if (!name) { nameEl.focus(); return; }
  const cal = parseInt(kcalEl.value) || 0;
  meals[slot].push({ name, cal, aiCalc: false });
  nameEl.value = ''; kcalEl.value = '';
  if (statusEl) { statusEl.style.color = 'var(--moss-l)'; statusEl.textContent = cal ? `✓ ${cal} kcal adicionado` : '✓ adicionado (sem calorias)'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
  nameEl.focus();
  renderMeals();
  updateSidebarCals();
}

// Adicionar via IA (calcula calorias automaticamente)
async function addMealAI(slot) {
  const nameEl   = document.getElementById('name-' + slot);
  const kcalEl   = document.getElementById('kcal-' + slot);
  const addBtn   = document.getElementById('btn-' + slot);
  const statusEl = document.getElementById('ai-status-' + slot);
  const name = (nameEl.value || '').trim();
  if (!name) { nameEl.focus(); return; }

  if (addBtn)   { addBtn.textContent = '⏳...'; addBtn.disabled = true; }
  if (statusEl) { statusEl.textContent = '🤖 A calcular calorias...'; statusEl.style.color = 'var(--moss-l)'; }

  try {
    const result = await calcCaloriesAI(name);
    const cal = result.calorias_alto || result.calorias || 0;
    meals[slot].push({ name, cal, aiCalc: true });
    if (kcalEl) kcalEl.value = cal;
    if (statusEl) {
      statusEl.textContent = `✓ ${cal} kcal  ·  P:${result.proteina||0}g  HC:${result.carbo||0}g  G:${result.gordura||0}g`;
      setTimeout(() => { statusEl.textContent = ''; if(kcalEl) kcalEl.value=''; }, 5000);
    }
  } catch(e) {
    meals[slot].push({ name, cal: 0, aiCalc: false });
    if (statusEl) {
      statusEl.textContent = '⚠️ ' + (e.message || 'Erro IA') + ' — adicionado com 0 kcal';
      statusEl.style.color = '#f87171';
      setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = 'var(--moss-l)'; }, 7000);
    }
  }

  if (addBtn) { addBtn.textContent = '🤖 IA'; addBtn.disabled = false; }
  nameEl.value = '';
  nameEl.focus();
  renderMeals();
  updateSidebarCals();
}

// Alias para compatibilidade com Enter no campo nome
async function addMealToSlot(slot) { return addMealAI(slot); }

function removeMealFromSlot(slot, idx) {
  meals[slot].splice(idx, 1);
  renderMeals();
  updateSidebarCals();
  saveData();
}

function renderMeals() {
  let grandTotal = 0;
  const breakdown = [];

  Object.keys(SLOTS).forEach(slot => {
    const items = meals[slot] || [];
    const slotTotal = items.reduce((s,m) => s + (m.cal||0), 0);
    grandTotal += slotTotal;

    // Update slot total badge
    const totalEl = document.getElementById('cal-' + slot);
    if (totalEl) totalEl.textContent = slotTotal + ' kcal';

    // Render items
    const list = document.getElementById('list-' + slot);
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div style="font-family:JetBrains Mono,monospace;font-size: calc(11px * var(--font-scale));color:var(--faint);padding:4px 0 8px;font-style:italic;">Nada registado ainda</div>';
    } else {
      list.innerHTML = items.map((m,i) => `
        <div class="meal-row">
          <span class="meal-name">${m.name}</span>
          <span class="meal-kcal">${m.cal} kcal</span>
          <button class="meal-del" onclick="removeMealFromSlot('${slot}',${i})" title="Remover">×</button>
        </div>
      `).join('');
    }

    if (slotTotal > 0) {
      breakdown.push({label: SLOTS[slot].label, cal: slotTotal, icon: SLOTS[slot].icon});
    }
  });

  // Grand total
  const totalEl = document.getElementById('totalCal');
  if (totalEl) totalEl.textContent = grandTotal;

  // Calorie tag
  const tag = document.getElementById('calTag');
  if (tag) {
    if (grandTotal === 0) { tag.textContent=''; tag.className='tag'; }
    else if (grandTotal < 1500) { tag.textContent='abaixo do normal'; tag.className='tag tag-warn'; }
    else if (grandTotal <= 2200) { tag.textContent='dentro do normal'; tag.className='tag tag-ok'; }
    else { tag.textContent='acima do normal'; tag.className='tag tag-warn'; }
  }

  // Breakdown bar
  const bd = document.getElementById('calBreakdown');
  if (bd && breakdown.length) {
    const colors = ['var(--sage)','var(--moss)','var(--moss-d)','var(--amber)'];
    bd.innerHTML = breakdown.map((b,i) => `
      <div class="cal-breakdown-item">
        <div class="cal-breakdown-dot" style="background:${colors[i%colors.length]}"></div>
        <span>${b.icon} ${b.label}: <strong style="color:var(--text)">${b.cal}</strong></span>
      </div>
    `).join('');
  } else if (bd) {
    bd.innerHTML = '';
  }

  updateOverview();
  updateDinnerAdvisor();
  updateSidebarCals();
}

// Legacy compat — keep addMeal for flow detail
function addMeal(name, cal) {
  meals.lunch.push({name, cal});
  renderMeals();
}

function removeMeal(i) { removeMealFromSlot('lunch', i); }

// ═══════════════════════════════════════════════════════════════════
// EXERCISE
// ═══════════════════════════════════════════════════════════════════

async function getExerciseSuggestions() {
  const q = document.getElementById('exerciseQuery').value.trim(); if(!q) return;
  const btn = document.getElementById('exBtn'), resp = document.getElementById('exResponse');
  btn.disabled = true; btn.textContent = '...';
  resp.className = 'ai-response visible';
  resp.innerHTML = '<span class="loading-dots">A criar plano personalizado</span>';
  try {
    const text = await callGemini(
      'Personal trainer em Portugal. Sugestões práticas, seguras e motivadoras. Estrutura: aquecimento → exercícios → alongamento. Máximo 200 palavras.',
      `Situação do utilizador: ${q}`, 800
    );
    resp.textContent = text;
  } catch(e) { resp.textContent = e.message && e.message.includes('configurada') ? '⚙️ ' + e.message : '❌ ' + (e.message || 'Erro de ligação'); }
  btn.disabled = false; btn.textContent = 'Sugerir';
}

function addExercise() {
  const name = document.getElementById('exName').value.trim(); if(!name) return;
  const dur = parseInt(document.getElementById('exDuration').value)||0;
  const intensity = document.getElementById('exIntensity').value;
  const iconMap = {correr:'🏃',caminhada:'🚶',ciclismo:'🚴',natação:'🏊',yoga:'🧘',musculação:'💪',alongamento:'🤸',futebol:'⚽',bicicleta:'🚴',dança:'💃',pilates:'🧘',padel:'🏓',ténis:'🎾'};
  const icon = Object.entries(iconMap).find(([k])=>name.toLowerCase().includes(k))?.[1]||'🏃';
  exercises.push({name,duration:dur,intensity,icon});
  document.getElementById('exName').value=''; document.getElementById('exDuration').value='';
  renderExercises();
  saveData();
}

function renderExercises() {
  const list = document.getElementById('exerciseList');
  if(!exercises.length) { list.innerHTML='<div class="empty-state">Nenhum exercício registado.</div>'; document.getElementById('ov-ex').textContent='—'; return; }
  list.innerHTML = exercises.map((e,i)=>`
    <div class="exercise-row">
      <span class="ex-icon">${e.icon}</span>
      <div class="ex-info">
        <div class="ex-name">${e.name}</div>
        <div class="ex-meta">${e.duration?e.duration+' min':'—'} · ${e.intensity||'—'}</div>
      </div>
      <button class="meal-del" onclick="removeExercise(${i})">×</button>
    </div>`).join('');
  document.getElementById('ov-ex').textContent = exercises.length;
}

function removeExercise(i) { exercises.splice(i,1); renderExercises(); saveData(); }

// ═══════════════════════════════════════════════════════════════════
// WORK & SCREEN
// ═══════════════════════════════════════════════════════════════════

function calcWorkHours() {
  const s  = document.getElementById('workStart').value;
  const e  = document.getElementById('workEnd').value;
  const ls = document.getElementById('lunchStart').value;
  const le = document.getElementById('lunchEnd').value;

  // ── Duração do almoço (real ou 60min por defeito)
  let lunchMins = 60;
  if (ls && le) {
    const [lsh,lsm] = ls.split(':').map(Number);
    const [leh,lem] = le.split(':').map(Number);
    lunchMins = Math.max(0, (leh*60+lem) - (lsh*60+lsm));
    const lbl = document.getElementById('lunchDurLabel');
    if (lbl) lbl.textContent = lunchMins + ' min de pausa';
    const lunchCard = document.getElementById('lunchCard');
    if (lunchCard && lunchMins > 0) lunchCard.style.borderColor = 'rgba(184,144,80,0.5)';
  }

  // ── Hora de saída ideal: entrada + 8h trabalho + almoço real
  if (s) {
    const [sh,sm] = s.split(':').map(Number);
    const idealMins = sh*60 + sm + 480 + lunchMins; // 480 = 8h
    const iH = Math.floor(idealMins/60) % 24;
    const iM = idealMins % 60;
    const iEl = document.getElementById('idealExit');
    if (iEl) iEl.textContent = String(iH).padStart(2,'0') + ':' + String(iM).padStart(2,'0') + 'h';
  }

  // Se não tiver saída ainda, mostra apenas a hora ideal
  if (!s || !e) {
    document.getElementById('workTotal').textContent = '0:00';
    const ovEl = document.getElementById('overtimeVal');
    if (ovEl) ovEl.textContent = '—';
    renderOvertimeBank();
    return;
  }

  // ── Minutos trabalhados = (saída - entrada) - almoço real
  const [sh,sm] = s.split(':').map(Number);
  const [eh,em] = e.split(':').map(Number);
  const totalMins = (eh*60+em) - (sh*60+sm) - lunchMins;
  const workedMins = Math.max(0, totalMins);

  // Mostrar total
  const h = Math.floor(workedMins/60);
  const m = workedMins % 60;
  document.getElementById('workTotal').textContent = `${h}:${m.toString().padStart(2,'0')}`;
  document.getElementById('ov-work').textContent = `${h}h${m?m+'m':''}`;

  // ── Overtime do dia = trabalhado - 8h (480 min)
  const overtimeMins = totalMins - 480;
  const ovEl = document.getElementById('overtimeVal');
  if (ovEl) {
    if (overtimeMins > 0) {
      const oh = Math.floor(overtimeMins/60), om = overtimeMins%60;
      ovEl.textContent = `+${oh}h${om?om+'m':''}`;
      ovEl.style.color = 'var(--moss-l)';
    } else if (overtimeMins < 0) {
      const oh = Math.floor(Math.abs(overtimeMins)/60), om = Math.abs(overtimeMins)%60;
      ovEl.textContent = `-${oh}h${om?om+'m':''}`;
      ovEl.style.color = '#f87171';
    } else {
      ovEl.textContent = '0h00 ✓';
      ovEl.style.color = 'var(--moss-l)';
    }
  }

  // Tag
  const tag = document.getElementById('workTag');
  if (tag) {
    if (workedMins > 9*60)      tag.innerHTML = '<span class="tag tag-red">dia muito longo</span>';
    else if (workedMins >= 8*60) tag.innerHTML = '<span class="tag tag-green">dentro do horário ✓</span>';
    else if (workedMins > 0)     tag.innerHTML = '<span class="tag tag-sky">dia curto</span>';
  }

  // Auto-sync screen time
  const ssEl = document.getElementById('screenStart'), seEl = document.getElementById('screenEnd');
  if (ssEl && seEl) { ssEl.value = s; seEl.value = e; calcScreenTime(); }

  renderOvertimeBank();
  renderWorkCalendar();
  updateSidebarCals();
  updateOverview();
}

// ── Helper: converte HH:MM em minutos, retorna null se inválido
function parseTimeToMins(t) {
  if (!t || !t.includes(':')) return null;
  const parts = t.split(':').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

// ── Banco de horas: soma overtime de todos os dias guardados
const OVERTIME_START_DATE = '2026-03-04'; // data de início do banco de horas

// ═══════════════════════════════════════════════════════════════════
// 90 DIAS — PLANO DE ALTA PERFORMANCE
// ═══════════════════════════════════════════════════════════════════

const N90_PHASES = [
  {
    days: [1,30], icon: '🌱', name: 'Fundação',
    label: 'FASE 1 · DIAS 1–30',
    desc: 'Criar as bases inabaláveis: sono consistente, movimento diário, foco no trabalho e limpeza alimentar.',
    color: 'rgba(var(--accent-rgb),0.15)', border: 'rgba(var(--accent-rgb),0.3)'
  },
  {
    days: [31,60], icon: '⚡', name: 'Aceleração',
    label: 'FASE 2 · DIAS 31–60',
    desc: 'Construir momentum: intensificar treino, otimizar produtividade e consolidar hábitos mentais.',
    color: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)'
  },
  {
    days: [61,90], icon: '🔥', name: 'Domínio',
    label: 'FASE 3 · DIAS 61–90',
    desc: 'Peak performance: sistemas automáticos, disciplina sem esforço e preparar o próximo ciclo.',
    color: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)'
  }
];

const N90_WEEKS = [
  // Fase 1 — Fundação
  { w:1,  phase:1, focus:'Audit & Reset',        theme:'🧭', desc:'Avalia onde estás. Define os teus 3 objetivos principais. Começa as rotinas base.' },
  { w:2,  phase:1, focus:'Sono & Energia',        theme:'🌙', desc:'Sono consistente 7-8h. Hora de deitar fixa. Sem ecrãs 1h antes de dormir.' },
  { w:3,  phase:1, focus:'Movimento Diário',      theme:'🚶', desc:'20 min de movimento todos os dias. Sem exceções. Qualquer forma conta.' },
  { w:4,  phase:1, focus:'Alimentação Limpa',     theme:'🥗', desc:'Reduz açúcar e ultra-processados. 8 copos de água. Regista tudo.' },
  { w:5,  phase:1, focus:'Foco Profundo',         theme:'🎯', desc:'Blocos de trabalho de 90 min. Uma tarefa de cada vez. Elimina distrações.' },
  { w:6,  phase:1, focus:'Revisão Fase 1',        theme:'📊', desc:'Analisa os últimos 30 dias. O que funcionou? Ajusta o que não funcionou.' },
  // Fase 2 — Aceleração
  { w:7,  phase:2, focus:'Intensidade Física',    theme:'💪', desc:'Adiciona treino de força 3x/semana. Aumenta volume gradualmente.' },
  { w:8,  phase:2, focus:'Gestão de Tempo',       theme:'⏱', desc:'Time-blocking semanal. Elimina tarefas de baixo impacto. Automatiza.' },
  { w:9,  phase:2, focus:'Mindset Resiliente',    theme:'🧠', desc:'Diário de gratidão. Reflexão diária. Confronta o desconforto intencionalmente.' },
  { w:10, phase:2, focus:'Nutrição Otimizada',    theme:'⚗️', desc:'Proteína em cada refeição. Timing das refeições alinhado com o treino.' },
  { w:11, phase:2, focus:'Recuperação Ativa',     theme:'🧘', desc:'Alongamento, descanso intencional, caminhadas. A recuperação é treino.' },
  { w:12, phase:2, focus:'Revisão Fase 2',        theme:'📈', desc:'Compara métricas com o início. Identifica o teu maior ganho. Celebra.' },
  // Fase 3 — Domínio
  { w:13, phase:3, focus:'Sistemas Automáticos',  theme:'🔁', desc:'Os hábitos devem ser automáticos agora. Refina e prepara o próximo ciclo de 90 dias.' },
];

const N90_DAILY_CHECKS = {
  mindset:   ['✍️ Reflexão matinal (5 min)', '🙏 3 gratidões', '🎯 1 objetivo do dia definido', '📵 Sem redes sociais antes das 10h'],
  fisico:    ['🌅 Exposição ao sol matinal', '💧 8 copos de água', '🏃 20 min de movimento', '😴 Na cama antes das 23h'],
  trabalho:  ['📋 Top 3 tarefas definidas', '⏱ Bloco de foco profundo (90 min)', '📵 Telefone silenciado no trabalho', '✅ Revisão do dia (5 min)'],
  alimentacao: ['🥗 Proteína ao pequeno-almoço', '🍽️ Comer devagar e sem distrações', '🚫 Sem açúcar depois das 20h', '📝 Refeições registadas no app'],
};


function calcOvertimeBank() {
  let totalMins = 0;
  let daysCount = 0;

  Object.entries(DB).forEach(([date, d]) => {
    if (!d) return;
    // Só contar a partir da data de início
    if (date < OVERTIME_START_DATE) return;

    const startM = parseTimeToMins(d.workStart);
    const endM   = parseTimeToMins(d.workEnd);
    if (startM === null || endM === null) return;

    // Almoço real ou 60min por defeito
    let lunch = 60;
    const lsM = parseTimeToMins(d.lunchStart);
    const leM = parseTimeToMins(d.lunchEnd);
    if (lsM !== null && leM !== null) {
      lunch = Math.max(0, leM - lsM);
    }

    const worked = endM - startM - lunch;
    if (isNaN(worked) || worked < 0) return;
    totalMins += worked - 480;
    daysCount++;
  });

  return { totalMins, daysCount };
}

// ═══════════════════════════════════════════════════════════════════
// CALENDÁRIO BANCO DE HORAS
// ═══════════════════════════════════════════════════════════════════

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based

function calPrevMonth() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderWorkCalendar();
}
function calNextMonth() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderWorkCalendar();
}

function renderWorkCalendar() {
  const grid      = document.getElementById('workCalGrid');
  const weekDiv   = document.getElementById('workWeekSummary');
  const labelEl   = document.getElementById('calMonthLabel');
  const totalEl   = document.getElementById('calOtTotal');
  const daysEl    = document.getElementById('calOtDays');
  if (!grid) return;

  const monthNames = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  if (labelEl) labelEl.textContent = monthNames[calMonth] + ' ' + calYear;

  // ── dados do mês ──
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);
  const totalDays = lastDay.getDate();

  // Offset: semana começa à segunda (0=seg..6=dom)
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  // Calcular overtime por dia deste mês
  function getDayOT(dateStr) {
    const d = DB[dateStr];
    if (!d || !d.workStart || !d.workEnd) return null;
    const [sh,sm] = d.workStart.split(':').map(Number);
    const [eh,em] = d.workEnd.split(':').map(Number);
    let lunch = 60;
    if (d.lunchStart && d.lunchEnd) {
      const [lsh,lsm] = d.lunchStart.split(':').map(Number);
      const [leh,lem] = d.lunchEnd.split(':').map(Number);
      lunch = Math.max(0, (leh*60+lem)-(lsh*60+lsm));
    }
    const worked = (eh*60+em)-(sh*60+sm)-lunch;
    return { worked, ot: worked - 480, workStart: d.workStart, workEnd: d.workEnd, lunch };
  }

  // ── render células ──
  let html = '';

  // células vazias antes do dia 1
  for (let i = 0; i < startOffset; i++) {
    html += `<div style="height:56px;"></div>`;
  }

  const today = localDateStr();
  const weeks = {}; // semana ISO → {totalOt, days}

  for (let day = 1; day <= totalDays; day++) {
    const d   = new Date(calYear, calMonth, day);
    const dow = d.getDay(); // 0=dom
    const isWeekend = dow === 0 || dow === 6;
    const dateStr = localDateStr(d);
    const isToday = dateStr === today;
    const isBefore = dateStr < OVERTIME_START_DATE;
    const data    = getDayOT(dateStr);

    // Semana ISO (seg=início)
    const weekKey = getISOWeek(d);
    if (!weeks[weekKey]) weeks[weekKey] = { ot: 0, worked: 0, days: 0, label: '' };
    if (data && !isWeekend && !isBefore) {
      weeks[weekKey].ot     += data.ot;
      weeks[weekKey].worked += data.worked;
      weeks[weekKey].days++;
    }

    let bg = '', border = '', label = '';

    if (isWeekend) {
      bg     = 'background:transparent;';
      border = 'border:1px dashed rgba(100,116,139,0.12);';
      label  = `<span style="font-size: calc(10px * var(--font-scale));color:var(--muted);">${day}</span>`;
    } else if (isBefore) {
      // Antes da data de início — mostrar como inativo
      bg     = 'background:rgba(30,40,55,0.4);';
      border = 'border:1px solid rgba(100,116,139,0.1);';
      label  = `<span style="font-size: calc(10px * var(--font-scale));color:var(--muted);">${day}</span>`;
    } else if (!data) {
      // Sem registo (dia útil)
      bg     = 'background:rgba(51,65,85,0.5);';
      border = 'border:1px dashed rgba(100,116,139,0.3);';
      label  = `<span style="font-size: calc(10px * var(--font-scale));color:var(--muted);">${day}</span>`;
    } else {
      const ot    = data.ot;
      const otH   = Math.floor(Math.abs(ot)/60);
      const otM   = Math.abs(ot)%60;
      const sign  = ot >= 0 ? '+' : '-';
      const otTxt = `${sign}${otH}h${otM ? otM+'m' : ''}`;
      const wH    = Math.floor(data.worked/60);
      const wM    = data.worked%60;
      const wTxt  = `${wH}:${String(wM).padStart(2,'0')}`;

      if (ot > 0) {
        // Verde escuro → teal vivo conforme intensidade
        const intensity = Math.min(ot / 90, 1);
        const alpha = 0.25 + intensity * 0.5;
        bg     = `background:rgba(var(--accent-rgb),${alpha});`;
        border = `border:1px solid rgba(var(--accent-rgb),${0.4 + intensity*0.5});`;
        label  = `
          <span style="font-size: calc(10px * var(--font-scale));color:#fff;font-weight:600;">${day}</span>
          <span style="font-size: calc(10px * var(--font-scale));font-weight:800;color:var(--moss-l);font-family:'JetBrains Mono',monospace;">${otTxt}</span>
          <span style="font-size: calc(10px * var(--font-scale));color:rgba(255,255,255,0.6);font-family:'JetBrains Mono',monospace;">${wTxt}</span>
        `;
      } else if (ot < 0) {
        // Vermelho escuro → vivo conforme intensidade
        const intensity = Math.min(-ot / 90, 1);
        const alpha = 0.25 + intensity * 0.45;
        bg     = `background:rgba(153,27,27,${alpha});`;
        border = `border:1px solid rgba(248,113,113,${0.4 + intensity*0.5});`;
        label  = `
          <span style="font-size: calc(10px * var(--font-scale));color:#fff;font-weight:600;">${day}</span>
          <span style="font-size: calc(10px * var(--font-scale));font-weight:800;color:#fca5a5;font-family:'JetBrains Mono',monospace;">${otTxt}</span>
          <span style="font-size: calc(10px * var(--font-scale));color:rgba(255,255,255,0.6);font-family:'JetBrains Mono',monospace;">${wTxt}</span>
        `;
      } else {
        bg     = 'background:rgba(var(--accent-rgb),0.2);';
        border = 'border:1px solid rgba(var(--accent-rgb),0.35);';
        label  = `
          <span style="font-size: calc(10px * var(--font-scale));color:#fff;font-weight:600;">${day}</span>
          <span style="font-size: calc(10px * var(--font-scale));font-weight:800;color:var(--moss-l);font-family:'JetBrains Mono',monospace;">8:00 ✓</span>
          <span style="font-size: calc(10px * var(--font-scale));color:rgba(255,255,255,0.6);font-family:'JetBrains Mono',monospace;">${wTxt}</span>
        `;
      }
    }

    const todayRing = isToday ? 'box-shadow:0 0 0 2px var(--moss), 0 0 8px rgba(var(--accent-rgb),0.4);' : '';
    html += `
      <div style="height:56px;border-radius:8px;${bg}${border}${todayRing}padding:5px 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:default;transition:transform 0.12s,filter 0.12s;" 
           onmouseover="this.style.transform='scale(1.08)';this.style.filter='brightness(1.2)'" 
           onmouseout="this.style.transform='';this.style.filter=''">
        ${label}
      </div>`;
  }

  grid.innerHTML = html;

  // ── resumo semanal ──
  const sortedWeeks = Object.entries(weeks).sort((a,b) => a[0].localeCompare(b[0]));
  let weekHtml = '';
  sortedWeeks.forEach(([wk, w]) => {
    if (w.days === 0) return;
    const sign  = w.ot >= 0 ? '+' : '-';
    const ah    = Math.floor(Math.abs(w.ot)/60), am = Math.abs(w.ot)%60;
    const otTxt = `${sign}${ah}h${am ? am+'m' : ''}`;
    const isPos = w.ot >= 0;
    const bg    = isPos ? 'rgba(var(--accent-rgb),0.2)' : 'rgba(153,27,27,0.25)';
    const bord  = isPos ? '1px solid rgba(var(--accent-rgb),0.4)' : '1px solid rgba(248,113,113,0.4)';
    const col   = isPos ? 'var(--moss-l)' : '#fca5a5';
    const wh    = Math.floor(w.worked/60), wm = w.worked%60;
    weekHtml += `
      <div style="flex:0 0 auto;background:${bg};border:${bord};border-radius:10px;padding:8px 14px;min-width:110px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:rgba(255,255,255,0.4);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px;">SEM ${wk.split('-W')[1]}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size: calc(16px * var(--font-scale));font-weight:800;color:${col};">${otTxt}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:rgba(255,255,255,0.45);margin-top:2px;">${wh}h${wm?wm+'m':''} · ${w.days}d</div>
      </div>`;
  });
  if (weekDiv) weekDiv.innerHTML = weekHtml || `<span style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--faint);padding:8px;">sem registos este mês</span>`;

  // ── banco total do mês visível ──
  const { totalMins, daysCount } = calcOvertimeBank();
  if (totalEl) {
    const sign = totalMins >= 0 ? '+' : '-';
    const h = Math.floor(Math.abs(totalMins)/60), m = Math.abs(totalMins)%60;
    totalEl.textContent = `${sign}${h}h${m ? m+'m' : ''}`;
    totalEl.style.color = totalMins >= 0 ? 'var(--moss-l)' : '#f87171';
  }
  if (daysEl) daysEl.textContent = `acumulado · ${daysCount} dias`;
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

function renderOvertimeBank() {
  const el = document.getElementById('overtimeAccum');
  const elDays = document.getElementById('overtimeAccumDays');
  if (!el) return;

  const { totalMins, daysCount } = calcOvertimeBank();
  const abs = Math.abs(totalMins);
  const h = Math.floor(abs/60), m = abs%60;
  const sign = totalMins >= 0 ? '+' : '-';
  const color = totalMins >= 0 ? 'var(--moss-l)' : '#f87171';

  el.textContent = `${sign}${h}h${m?m+'m':''}`;
  el.style.color = color;
  if (elDays) elDays.textContent = `em ${daysCount} dia${daysCount!==1?'s':''}`;
}

function resetOvertimeBank() {
  if (!confirm('Resetar o banco de horas? O contador começa do zero a partir de hoje.')) return;
  const today = localDateStr();
  localStorage.setItem('dvOvertimeReset', today);
  renderOvertimeBank();
}

function calcScreenTime() {
  const s=document.getElementById('screenStart').value, e=document.getElementById('screenEnd').value;
  if(!s||!e) return;
  let[sh,sm]=s.split(':').map(Number),[eh,em]=e.split(':').map(Number);
  let mins=(eh*60+em)-(sh*60+sm); if(mins<0)mins=0;
  const h=Math.floor(mins/60),m=mins%60;
  document.getElementById('screenTotal').textContent=`${h}:${m.toString().padStart(2,'0')}`;
  const tag=document.getElementById('screenTag');
  if(mins>8*60) tag.innerHTML='<span class="tag tag-red">⚠ excesso de ecrã</span>';
  else if(mins>6*60) tag.innerHTML='<span class="tag tag-amber">muitas horas</span>';
  else tag.innerHTML='<span class="tag tag-green">controlado ✓</span>';
}

// ═══════════════════════════════════════════════════════════════════
// HOBBIES
// ═══════════════════════════════════════════════════════════════════

function renderHobbies() {
  document.getElementById('hobbyGrid').innerHTML = hobbies.map((h,i) => `
    <div class="hobby-tile ${h.tracking?'tracking':''}" id="hobby-${i}">
      <div class="hobby-tile-icon">${h.icon}</div>
      <div class="hobby-tile-name">${h.name}</div>
      <div class="hobby-tile-time" id="hobby-time-${i}">${formatSecs(h.seconds)}</div>
      <button class="hobby-tile-btn" onclick="toggleHobby(${i})">${h.tracking?'⏸ parar':'▶ iniciar'}</button>
    </div>`).join('');
  const totalSecs = hobbies.reduce((s,h)=>s+h.seconds+(h.tracking?Math.floor((Date.now()-h.start)/1000):0),0);
  document.getElementById('ov-hobby').textContent = totalSecs > 60 ? formatSecs(totalSecs) : '—';
}

function toggleHobby(i) {
  if(hobbies[i].tracking) {
    hobbies[i].seconds += Math.floor((Date.now()-hobbies[i].start)/1000);
    hobbies[i].tracking = false; hobbies[i].start = null;
    clearInterval(hobbyTimers[i]);
  } else {
    hobbies[i].tracking = true; hobbies[i].start = Date.now();
    hobbyTimers[i] = setInterval(() => {
      const el = document.getElementById('hobby-time-'+i);
      if(el) el.textContent = formatSecs(hobbies[i].seconds+Math.floor((Date.now()-hobbies[i].start)/1000));
    }, 1000);
  }
  renderHobbies();
}

function addHobby() {
  const name = document.getElementById('newHobby').value.trim(); if(!name) return;
  const icon = document.getElementById('newHobbyIcon').value.trim() || '⭐';
  hobbies.push({name,icon,seconds:0,tracking:false,start:null});
  document.getElementById('newHobby').value=''; document.getElementById('newHobbyIcon').value='';
  renderHobbies();
}

function formatSecs(s) {
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
  return h>0?`${h}h ${m}m`:`${m}m`;
}

// ═══════════════════════════════════════════════════════════════════
// JOURNAL & MOOD
// ═══════════════════════════════════════════════════════════════════

function selectMood(emoji, label) {
  selectedMood = emoji;
  document.querySelectorAll('.mood-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.mood === emoji);
  });
}

function toggleIntimate() {
  intimateRevealed = !intimateRevealed;
  document.getElementById('intimateContent').classList.toggle('revealed', intimateRevealed);
  document.getElementById('lockLabel').textContent = intimateRevealed ? 'tocar para ocultar' : 'tocar para revelar';
  document.querySelector('.lock-icon').textContent = intimateRevealed ? '🔓' : '🔒';
}

async function getJournalInsight() {
  const resp = document.getElementById('journalResponse');
  resp.className = 'ai-response visible';
  resp.innerHTML = '<span class="loading-dots">A analisar o teu estado emocional</span>';
  const entry = document.getElementById('journalEntry').value;
  const energy = document.getElementById('energyLevel').value;
  const anxiety = document.getElementById('anxietyLevel').value;
  const stress = document.getElementById('stressLevel').value;
  try {
    const text = await callGemini(
      'És um psicólogo bem-estarista em Portugal. Analisa o estado emocional descrito e dá insights gentis, empáticos e práticos. Tom caloroso, sem julgamento. Máx 180 palavras.',
      `Humor: ${selectedMood||'não selecionado'}. Energia: ${energy}/10. Ansiedade: ${anxiety}/10. Stress: ${stress}/10. Reflexão: "${entry||'(sem texto)'}"`, 600
    );
    resp.textContent = text;
  } catch(e) { resp.textContent = e.message && e.message.includes('configurada') ? '⚙️ ' + e.message : '❌ ' + (e.message || 'Erro de ligação'); }
}

// ═══════════════════════════════════════════════════════════════════
// HABITS TIP AI
// ═══════════════════════════════════════════════════════════════════

async function getDailyHabitTip() {
  const btn = document.getElementById('habitTipBtn'), resp = document.getElementById('habitResponse');
  btn.disabled = true;
  resp.className = 'ai-response visible';
  resp.innerHTML = '<span class="loading-dots">A preparar sugestão personalizada</span>';
  try {
    const text = await callGemini(
      'Coach de saúde e bem-estar em Portugal. Sugere um hábito ou exercício em casa fácil de implementar hoje. Inclui o porquê e como fazer. Tom motivador. Máx 200 palavras.',
      `Data: ${new Date().toLocaleDateString('pt-PT')}. Sugere uma ação de bem-estar para hoje.`, 700
    );
    resp.textContent = text;
  } catch(e) { resp.textContent = e.message && e.message.includes('configurada') ? '⚙️ ' + e.message : '❌ ' + (e.message || 'Erro de ligação'); }
  btn.disabled = false;
}

// ═══════════════════════════════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════════════════════════════

const AI_CHAT_KEY = 'dvAiChatHistory';
const AI_CHAT_SYSTEM = 'És o assistente do Diário de Vida, uma app pessoal de saúde e rotina em português de Portugal. Responde de forma clara, calorosa e prática. Podes falar de qualquer tema. Quando for útil, usa o contexto do dia fornecido, mas não inventes dados. Em temas médicos, dá informação geral e recomenda ajuda profissional quando necessário. Usa parágrafos curtos e listas apenas quando ajudarem.';

let aiChatMessages = aiChatLoad();
let aiChatBusy = false;

function aiChatLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_CHAT_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string').slice(-40);
  } catch (e) { return []; }
}

function aiChatSave() {
  try { localStorage.setItem(AI_CHAT_KEY, JSON.stringify(aiChatMessages.slice(-40))); } catch (e) {}
}

function _escAiChat(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatAiChat(text) {
  let html = _escAiChat(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function aiChatRender() {
  const log = document.getElementById('aiChatLog');
  const empty = document.getElementById('aiChatEmpty');
  if (!log) return;
  log.querySelectorAll('.ai-chat-msg').forEach(el => el.remove());
  if (empty) empty.hidden = aiChatMessages.length > 0;

  aiChatMessages.forEach(m => {
    const row = document.createElement('div');
    row.className = 'ai-chat-msg ' + m.role + (m.error ? ' error' : '');
    const bubble = document.createElement('div');
    bubble.className = 'ai-chat-bubble';
    bubble.innerHTML = formatAiChat(m.text);
    row.appendChild(bubble);
    log.appendChild(row);
  });
  log.scrollTop = log.scrollHeight;
}

function aiChatContext() {
  const day = (typeof DB !== 'undefined' && DB[TODAY]) ? DB[TODAY] : {};
  const parts = [];
  if (typeof waterCount === 'number') parts.push('água: ' + waterCount + '/' + waterGoal + ' copos');
  if (day.weight) parts.push('peso: ' + day.weight + ' kg');
  const sleep = (typeof getSleepH === 'function') ? getSleepH(day) : 0;
  if (sleep > 0) parts.push('sono: ' + sleep.toFixed(1) + 'h');
  const meals = (typeof DB !== 'undefined' && DB[TODAY] && DB[TODAY].meals) ? DB[TODAY].meals : null;
  if (meals && typeof meals === 'object') {
    let kcal = 0;
    Object.values(meals).forEach(slot => (slot || []).forEach(m => { kcal += parseInt(m.cal, 10) || 0; }));
    if (kcal > 0) parts.push('calorias registadas: ' + kcal + ' kcal');
  }
  return parts.length
    ? 'Contexto de hoje (usa só se for relevante): ' + parts.join('; ') + '.'
    : '';
}

function aiChatAutoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function aiChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendAiChat();
  }
}

function aiChatAsk(text) {
  if (aiChatBusy) return;
  const input = document.getElementById('aiChatInput');
  if (!input) return;
  input.value = text;
  aiChatAutoGrow(input);
  sendAiChat();
}

async function sendAiChat(event) {
  if (event) event.preventDefault();
  if (aiChatBusy) return;

  const input = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiChatSend');
  const status = document.getElementById('aiChatStatus');
  const text = ((input && input.value) || '').trim();
  if (!text) return;

  aiChatBusy = true;
  if (sendBtn) sendBtn.disabled = true;
  if (status) status.textContent = 'A pensar…';

  aiChatMessages.push({ role: 'user', text, at: Date.now() });
  if (input) { input.value = ''; aiChatAutoGrow(input); }
  aiChatRender();
  aiChatSave();

  try {
    const history = aiChatMessages.slice(-12)
      .map(m => (m.role === 'user' ? 'Utilizador' : 'Assistente') + ': ' + m.text)
      .join('\n\n');
    const context = aiChatContext();
    const prompt = (context ? context + '\n\n' : '') + 'Conversa até agora:\n' + history + '\n\nResponde à última mensagem do utilizador.';
    const reply = await callGemini(AI_CHAT_SYSTEM, prompt, 1400, 'chat');
    const clean = String(reply || '').trim();
    if (!clean) throw new Error('A IA devolveu uma resposta vazia.');
    aiChatMessages.push({ role: 'assistant', text: clean, at: Date.now() });
  } catch (err) {
    const message = (err && err.message) ? err.message : 'Erro de ligação.';
    const textOut = message.includes('configurada')
      ? '⚙️ ' + message
      : 'Não consegui responder agora. ' + message;
    aiChatMessages.push({ role: 'assistant', text: textOut, error: true, at: Date.now() });
  } finally {
    aiChatBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    if (status) status.textContent = '';
    aiChatRender();
    aiChatSave();
    if (input) input.focus();
  }
}

function clearAiChat() {
  if (!aiChatMessages.length) return;
  if (!confirm('Limpar toda a conversa?')) return;
  aiChatMessages = [];
  aiChatSave();
  aiChatRender();
}

function initAiChat() {
  aiChatRender();
}

// ═══════════════════════════════════════════════════════════════════
// AI SUMMARY & WEIGHT
// ═══════════════════════════════════════════════════════════════════

async function generateDaySummary() {
  const btn=document.getElementById('summaryBtn'), resp=document.getElementById('summaryResponse');
  btn.disabled=true; resp.className='ai-response visible'; resp.innerHTML='<span class="loading-dots">A analisar o teu dia completo</span>';
  const sleepToday = (typeof getSleepH === 'function' && typeof DAY !== 'undefined') ? getSleepH(DAY) : 0;
  const sleepH = sleepToday > 0 ? sleepToday.toFixed(1) + ' horas' : 'não registado';
  const summary = {
    sono:sleepH, peso:document.getElementById('weight').value||'não registado',
    calorias:(()=>{let t=0;Object.values(meals).forEach(s=>s.forEach(m=>t+=m.cal||0));return t})()+' kcal',
    exercicios:exercises.map(e=>e.name+' '+e.duration+'min').join(', ')||'nenhum',
    trabalho:document.getElementById('workStart').value||'não registado',
  };
  try {
    const text = await callGemini(
      'Coach de saúde holística em Portugal. Analisa os dados do dia e dá um resumo personalizado, motivador e com sugestões práticas para amanhã. Tom caloroso. Máx 220 palavras.',
      `Dados do meu dia:\n${JSON.stringify(summary,null,2)}`, 800
    );
    resp.textContent = text;
  } catch(e){resp.textContent = e.message && e.message.includes('configurada') ? '⚙️ ' + e.message : '❌ ' + (e.message || 'Erro de ligação');}
  btn.disabled=false;
}

async function getWeightAdvice() {
  const resp=document.getElementById('weightResponse');
  resp.className='ai-response visible'; resp.innerHTML='<span class="loading-dots">A preparar conselho</span>';
  const w=document.getElementById('weight').value, g=document.getElementById('weightGoal').value, h=document.getElementById('height').value;
  try{
    const text = await callGemini(
      'Nutricionista em Portugal. Conselhos práticos e motivadores sobre gestão de peso. Baseado em evidência científica. Máx 160 palavras.',
      `Peso atual: ${w||'?'}kg. Objetivo: ${g||'?'}kg. Altura: ${h||'?'}cm.`, 600
    );
    resp.textContent = text;
  }catch(e){resp.textContent = e.message && e.message.includes('configurada') ? '⚙️ ' + e.message : '❌ ' + (e.message || 'Erro de ligação');}
}

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW UPDATE
// ═══════════════════════════════════════════════════════════════════

function _updateOverviewBase() {
  // ── SONO ──
  const dayNow = (typeof DAY !== 'undefined' && DAY) ? DAY : ((typeof DB !== 'undefined' && DB[TODAY]) || {});
  const bed = dayNow.bedtime || '';
  const wake = dayNow.waketime || '';
  if (bed && wake) {
    const [bh,bm] = bed.split(':').map(Number);
    const [wh,wm] = wake.split(':').map(Number);
    let bM = bh*60+bm, wM = wh*60+wm;
    if (wM < bM) wM += 24*60;
    document.getElementById('ov-sleep').textContent = ((wM-bM)/60).toFixed(1) + 'h';
  } else {
    document.getElementById('ov-sleep').textContent = '—';
  }

  // ── PESO (último registo, não exige pesagem hoje) ──
  const lw = latestWeightEntry();
  const w = lw ? lw.w : null;
  const ovW = document.getElementById('ov-weight');
  const ovWName = document.getElementById('ov-weight-name');
  if (ovW) ovW.textContent = w ? fmtWeight(w) + ' kg' : '—';
  if (ovWName) ovWName.textContent = lw ? weightAgoLabel(lw.d) : 'peso kg';

  // ── CALORIAS ──
  let calIn = 0;
  try {
    const mealObj = (meals && typeof meals === 'object' && !Array.isArray(meals))
      ? meals : {x: Array.isArray(meals) ? meals : []};
    Object.values(mealObj).forEach(slot => {
      (slot||[]).forEach(m => { calIn += (parseInt(m.cal)||0); });
    });
  } catch(e) {}
  document.getElementById('ov-cal').textContent = calIn > 0 ? calIn + ' kcal' : '—';

  // ── ÁGUA ──
  document.getElementById('ov-water').textContent = waterCount > 0 ? waterCount + ' copos' : '—';

  // ── EXERCÍCIOS ──
  const exDone = QUICK_EXERCISES.filter(e => habitsDone[e.id]).length + (exercises||[]).length;
  document.getElementById('ov-ex').textContent = exDone > 0 ? exDone : '—';

  // ── WC ──
  const wcTotal = (counters.urinar||0) + (counters.defecar||0);
  document.getElementById('ov-wc').textContent = wcTotal > 0 ? wcTotal : '—';

  // ── TRABALHO ──
  const ws = document.getElementById('workStart').value;
  const we = document.getElementById('workEnd').value;
  if (ws && we) {
    const [sh,sm] = ws.split(':').map(Number);
    const [eh,em] = we.split(':').map(Number);
    const workH = (((eh*60+em)-(sh*60+sm)-60)/60).toFixed(1);
    document.getElementById('ov-work').textContent = workH > 0 ? workH + 'h' : '—';
  } else {
    document.getElementById('ov-work').textContent = '—';
  }

  // ── HOBBYS ──
  const totalSecs = (hobbies||[]).reduce((s,h) => s + h.seconds + (h.tracking ? Math.floor((Date.now()-h.start)/1000) : 0), 0);
  document.getElementById('ov-hobby').textContent = totalSecs > 60 ? formatSecs(totalSecs) : '—';

  renderOverviewHabits();
}

// ── Versão que lê diretamente do snap guardado (usada pelo botão Guardar) ──
function updateOverviewFromSnap(s) {
  // SONO
  if (s.bedtime && s.waketime) {
    const [bh,bm] = s.bedtime.split(':').map(Number);
    const [wh,wm] = s.waketime.split(':').map(Number);
    let bM = bh*60+bm, wM = wh*60+wm;
    if (wM < bM) wM += 24*60;
    document.getElementById('ov-sleep').textContent = ((wM-bM)/60).toFixed(1) + 'h';
  } else {
    document.getElementById('ov-sleep').textContent = '—';
  }

  // PESO (último registo, não exige pesagem hoje)
  const lwSnap = latestWeightEntry();
  const ovWSnap = document.getElementById('ov-weight');
  const ovWNameSnap = document.getElementById('ov-weight-name');
  if (ovWSnap) ovWSnap.textContent = lwSnap ? fmtWeight(lwSnap.w) + ' kg' : '—';
  if (ovWNameSnap) ovWNameSnap.textContent = lwSnap ? weightAgoLabel(lwSnap.d) : 'peso kg';

  // CALORIAS
  let calIn = 0;
  try {
    const mealObj = (s.meals && typeof s.meals === 'object' && !Array.isArray(s.meals))
      ? s.meals : {x: Array.isArray(s.meals) ? s.meals : []};
    Object.values(mealObj).forEach(slot => {
      (slot||[]).forEach(m => { calIn += (parseInt(m.cal)||0); });
    });
  } catch(e) {}
  document.getElementById('ov-cal').textContent = calIn > 0 ? calIn + ' kcal' : '—';

  // ÁGUA
  document.getElementById('ov-water').textContent = (s.waterCount||0) > 0 ? s.waterCount + ' copos' : '—';

  // EXERCÍCIOS
  const exDone = QUICK_EXERCISES.filter(e => s.habitsDone && s.habitsDone[e.id]).length + (s.exercises||[]).length;
  document.getElementById('ov-ex').textContent = exDone > 0 ? exDone : '—';

  // WC
  const wcTotal = ((s.counters&&s.counters.urinar)||0) + ((s.counters&&s.counters.defecar)||0);
  document.getElementById('ov-wc').textContent = wcTotal > 0 ? wcTotal : '—';

  // TRABALHO
  if (s.workStart && s.workEnd) {
    const [sh,sm] = s.workStart.split(':').map(Number);
    const [eh,em] = s.workEnd.split(':').map(Number);
    const workH = (((eh*60+em)-(sh*60+sm)-60)/60).toFixed(1);
    document.getElementById('ov-work').textContent = workH > 0 ? workH + 'h' : '—';
  } else {
    document.getElementById('ov-work').textContent = '—';
  }

  // HOBBYS
  const totalSecs = (hobbies||[]).reduce((s2,h) => s2 + h.seconds + (h.tracking ? Math.floor((Date.now()-h.start)/1000) : 0), 0);
  document.getElementById('ov-hobby').textContent = totalSecs > 60 ? formatSecs(totalSecs) : '—';

  renderOverviewHabits();
}

// ═══════════════════════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// GUARDAR / EDITAR por secção
// ═══════════════════════════════════════════════════════════════════

const SECTION_FIELDS = {
  weight: ['weight','weightTime','height','weightGoal','weightDeadline'],
  work: ['workStart','workEnd','lunchStart','lunchEnd','workMood','workFocus','workNotes'],
};

function saveSection(section) {
  const syncP = (section === 'work') ? saveWorkDay() : saveData();

  const saveBtn = document.getElementById('saveBtn-' + section);
  const editBtn = document.getElementById('editBtn-' + section);
  const msg     = document.getElementById('saveMsg-' + section);
  const fields  = SECTION_FIELDS[section] || [];

  // Bloquear campos — usar readonly em vez de disabled para manter os valores guardados
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('readonly', true);
    el.style.pointerEvents = 'none';
    el.style.opacity = '0.65';
  });

  if (saveBtn) saveBtn.style.display = 'none';
  if (editBtn) editBtn.style.display = 'flex';
  if (msg) {
    const now = new Date();
    const stamp = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
    msg.textContent = '⏳ a guardar…';
    Promise.resolve(syncP).then(r => { msg.textContent = saveMsgText(r, stamp); });
  }
}

function editSection(section) {
  const saveBtn = document.getElementById('saveBtn-' + section);
  const editBtn = document.getElementById('editBtn-' + section);
  const msg     = document.getElementById('saveMsg-' + section);
  const fields  = SECTION_FIELDS[section] || [];

  // Desbloquear campos
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('readonly');
    el.style.pointerEvents = '';
    el.style.opacity = '';
  });

  if (saveBtn) saveBtn.style.display = 'flex';
  if (editBtn) editBtn.style.display = 'none';
  if (msg) msg.textContent = 'a editar...';

  const first = document.getElementById(fields[0]);
  if (first) first.focus();
}

function saveData(silent) {
  // Atualização por campos: parte do registo existente e só altera o que a interface edita
  const snap = Object.assign({}, DB[TODAY] || {}, {
    weight:document.getElementById('weight').value,
    weightTime:document.getElementById('weightTime').value,
    weightGoal:document.getElementById('weightGoal').value,
    height:document.getElementById('height').value,
    weightDeadline:document.getElementById('weightDeadline').value,
    meals:JSON.parse(JSON.stringify(meals)), exercises, counters, waterCount, waterGoal, habitsDone,
    workStart:_wf('workStart'),
    workEnd:_wf('workEnd'),
    lunchStart:_wf('lunchStart'),
    lunchEnd:_wf('lunchEnd'),
    lunchBreak: 60,
    workMood:_wf('workMood'),
    workFocus:_wf('workFocus'),
    workNotes:_wf('workNotes'),
    selectedMood,
    hobbies: hobbies.map(h=>({...h,tracking:false,start:null})),
    treadmillTime:(DB[TODAY]||{}).treadmillTime||'',
    treadmillDistance:(DB[TODAY]||{}).treadmillDistance||'',
    treadmillIncline:(DB[TODAY]||{}).treadmillIncline||'',
    savedAt: new Date().toISOString(),
  });
  DB[TODAY] = snap;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  } catch(e) {
    // If localStorage is full, remove oldest entries
    const keys = Object.keys(DB).sort();
    const old = keys.find(d => d !== TODAY && !SyncManager.isPending(d));
    if (keys.length > 90 && old) delete DB[old];
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch(e2) { console.error('localStorage cheio', e2); }
  }

  // Enviar para o Supabase (só as alterações) e mostrar «guardado» apenas depois da confirmação
  const syncP = SyncManager.saveDay(TODAY);
  if (!silent) showSavedBar('⏳ A guardar…');
  syncP.then(r => { if (!silent || (r !== 'cloud' && r !== 'local' && r !== 'none')) showSaveResult(r); });
  // Atualizar resumo a partir do snap guardado (funciona mesmo noutras secções)
  updateOverviewFromSnap(snap);
  renderWeeklyWeight();
  renderWeightHistory();
  updateSidebarCals();
  renderMascot();
  // Sync to Sheets if configured (não sincronizar durante reload para evitar loop)
  if(!_reloading && typeof sheetsUrl !== 'undefined' && sheetsUrl) setTimeout(syncAllData, 600);
  return syncP;
}

// Auto-save every 5 minutes (silencioso)
setInterval(() => saveData(true), 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUT
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveData(); }
});

// ═══════════════════════════════════════════════════════════════════
// STATISTICS & CHARTS ENGINE
// ═══════════════════════════════════════════════════════════════════

let statsPeriod = 7;
let statsWeightMode = 'week';

function setStatsPeriod(days, btn) {
  statsPeriod = days;
  document.querySelectorAll('#section-stats .ex-filter-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderAllCharts();
}

function setWeightChartMode(mode) {
  statsWeightMode = mode === 'day' ? 'day' : 'week';
  const weekBtn = document.getElementById('weightModeWeek');
  const dayBtn = document.getElementById('weightModeDay');
  if (weekBtn) { weekBtn.classList.toggle('active', statsWeightMode === 'week'); weekBtn.setAttribute('aria-pressed', String(statsWeightMode === 'week')); }
  if (dayBtn) { dayBtn.classList.toggle('active', statsWeightMode === 'day'); dayBtn.setAttribute('aria-pressed', String(statsWeightMode === 'day')); }
  renderAllCharts();
}

function weightWeeklySeries(period) {
  const weeks = Math.max(8, Math.ceil((period || statsPeriod) / 7));
  const current = weightWeekStart();
  const labels = [], data = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(current);
    start.setDate(start.getDate() - 7 * i);
    const sum = weightWeekSummary(start);
    labels.push(weightShortDate(sum.start));
    data.push(sum.entries.length ? +avg(sum.entries.map(x => x.w)).toFixed(1) : null);
  }
  return { labels, data };
}

function weightWeeklyStats() {
  const current = weightWeekStart();
  const vals = [];
  for (let i = 3; i >= 0; i--) {
    const start = new Date(current);
    start.setDate(start.getDate() - 7 * i);
    const sum = weightWeekSummary(start);
    if (sum.entries.length) vals.push(avg(sum.entries.map(x => x.w)));
  }
  const weeklyAvg = vals.length ? avg(vals) : null;
  const variation = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : null;
  const last = lastSavedWeightEntry();
  return { current: last ? last.w : null, weeklyAvg, variation, weeks: vals.length };
}

// ── Get ordered days from DB ──────────────────────────────────────

function getLastNDays(n) {
  const days = [];
  for(let i = n-1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate()-i);
    // Use local date, not UTC
    const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    days.push(dateStr);
  }
  return days;
}

function getDayData(dateStr) { return DB[dateStr] || {}; }

function shortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDate() + '/' + (d.getMonth()+1);
}

// ── CANVAS CHART HELPERS ──────────────────────────────────────────

const CHART_COLORS = {
  moss:    '#5a6e4a',
  mossL:   '#7a8f68',
  mossD:   '#3d4e32',
  sage:    '#a0b090',
  sageL:   '#c8d4be',
  sky:     '#7898a8',
  sand:    '#c4a882',
  clay:    '#a07050',
  amber:   '#b89050',
  rose:    '#c08890',
  bg:      '#f5f0e8',
  bg2:     '#ede8dc',
  border:  '#d8d0c0',
  muted:   '#8a8278',
  text:    '#2c2820',
};

function setupCanvas(id) {
  const canvas = document.getElementById(id);
  if(!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width - 48; // card padding
  const h = parseInt(canvas.getAttribute('height')) || 200;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.W = w; ctx.H = h;
  return ctx;
}

function drawGrid(ctx, minY, maxY, steps=5) {
  const pad = {top:20, right:16, bottom:36, left:48};
  const chartH = ctx.H - pad.top - pad.bottom;
  const chartW = ctx.W - pad.left - pad.right;
  ctx.strokeStyle = CHART_COLORS.border;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3,3]);
  const dec = (maxY - minY) < 2 ? 2 : (maxY - minY) < 10 ? 1 : 0;
  for(let i=0; i<=steps; i++) {
    const y = pad.top + (chartH/steps)*i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left+chartW, y); ctx.stroke();
    const val = maxY - (maxY-minY)/steps*i;
    ctx.fillStyle = CHART_COLORS.muted;
    ctx.font = chartFont(10, 'JetBrains Mono, monospace');
    ctx.textAlign = 'right';
    ctx.fillText(dec ? val.toFixed(dec).replace('.', ',') : String(Math.round(val)), pad.left-6, y+4);
  }
  ctx.setLineDash([]);
  return pad;
}

function drawXLabels(ctx, labels, pad) {
  const chartW = ctx.W - pad.left - pad.right;
  const step = chartW / (labels.length-1 || 1);
  ctx.fillStyle = CHART_COLORS.muted;
  ctx.font = chartFont(9, 'JetBrains Mono, monospace');
  ctx.textAlign = 'center';
  // show fewer labels if many
  const skip = labels.length > 14 ? Math.ceil(labels.length/7) : 1;
  labels.forEach((l,i) => {
    if(i % skip === 0 || i === labels.length-1) {
      const x = pad.left + i * step;
      ctx.fillText(l, x, ctx.H - pad.bottom + 16);
    }
  });
}

// ── LINE CHART ────────────────────────────────────────────────────

function drawLineChart(canvasId, labels, datasets) {
  const ctx = setupCanvas(canvasId);
  if(!ctx) return;
  rememberChartData(canvasId, labels, datasets);

  // find range
  const allVals = datasets.flatMap(d => d.data.filter(v => v !== null));
  if(!allVals.length) { drawEmpty(ctx); return; }
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;
  const minY = Math.max(0, minV - range*0.1);
  const maxY = maxV + range*0.1;

  const pad = drawGrid(ctx, minY, maxY);
  const chartH = ctx.H - pad.top - pad.bottom;
  const chartW = ctx.W - pad.left - pad.right;
  const n = labels.length;
  const xStep = n > 1 ? chartW/(n-1) : chartW/2;

  function toY(v) { return pad.top + chartH - ((v-minY)/(maxY-minY))*chartH; }
  function toX(i) { return pad.left + i*xStep; }

  datasets.forEach(ds => {
    const color = ds.color || CHART_COLORS.moss;
    const validPts = ds.data.map((v,i) => v !== null ? {x:toX(i),y:toY(v),v} : null);

    // draw area fill
    ctx.beginPath();
    let started = false;
    validPts.forEach((p,i) => {
      if(!p) return;
      if(!started) { ctx.moveTo(p.x, p.y); started=true; }
      else ctx.lineTo(p.x, p.y);
    });
    if(started) {
      const last = validPts.filter(Boolean).pop();
      const first = validPts.filter(Boolean)[0];
      ctx.lineTo(last.x, pad.top+chartH);
      ctx.lineTo(first.x, pad.top+chartH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top+chartH);
      grad.addColorStop(0, color+'33');
      grad.addColorStop(1, color+'04');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // draw line
    ctx.beginPath(); started=false;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin='round'; ctx.lineCap='round';
    validPts.forEach(p => {
      if(!p) { started=false; return; }
      if(!started) { ctx.moveTo(p.x,p.y); started=true; }
      else ctx.lineTo(p.x,p.y);
    });
    ctx.stroke();

    // draw dots
    validPts.forEach(p => {
      if(!p) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI*2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // goal line
    if(ds.goal) {
      const gy = toY(ds.goal);
      ctx.beginPath();
      ctx.setLineDash([6,4]);
      ctx.strokeStyle = color+'88'; ctx.lineWidth=1;
      ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left+chartW, gy);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font=chartFont(9, 'JetBrains Mono,monospace'); ctx.textAlign='right';
      ctx.fillText('meta '+ds.goal, pad.left+chartW, gy-3);
    }
  });

  drawXLabels(ctx, labels, pad);
}

// ── BAR CHART ─────────────────────────────────────────────────────

function drawBarChart(canvasId, labels, datasets, stacked=false) {
  const ctx = setupCanvas(canvasId);
  if(!ctx) return;
  rememberChartData(canvasId, labels, datasets);

  const allVals = datasets.flatMap(d => d.data.filter(v=>v!==null));
  if(!allVals.length) { drawEmpty(ctx); return; }
  const maxY = Math.max(...allVals) * 1.15 || 1;

  const pad = drawGrid(ctx, 0, maxY);
  const chartH = ctx.H - pad.top - pad.bottom;
  const chartW = ctx.W - pad.left - pad.right;
  const n = labels.length;
  const totalBarW = chartW/n;
  const barW = Math.min(totalBarW*0.65, 30);

  function toY(v) { return pad.top + chartH - (v/maxY)*chartH; }
  function toH(v) { return (v/maxY)*chartH; }

  datasets.forEach((ds, di) => {
    const color = ds.color || CHART_COLORS.moss;
    ds.data.forEach((v,i) => {
      if(v === null) return;
      const x = pad.left + i*totalBarW + (totalBarW-barW)/2;
      const h = toH(v);
      const y = toY(v);
      // bar
      ctx.beginPath();
      ctx.roundRect(x, y, barW, h, [3,3,0,0]);
      ctx.fillStyle = color + (v>0?'dd':'44');
      ctx.fill();
      // goal line indicator
      if(ds.goal && v >= ds.goal) {
        ctx.fillStyle = CHART_COLORS.mossD;
        ctx.font = chartFont(10, 'sans-serif');
        ctx.textAlign = 'center';
        ctx.fillText('✓', x+barW/2, y-4);
      }
    });
  });

  drawXLabels(ctx, labels, pad);
}

// ── MOOD BAR CHART ────────────────────────────────────────────────

function drawMoodChart(canvasId, labels, moodData, energyData, stressData) {
  const ctx = setupCanvas(canvasId);
  if(!ctx) return;

  const moodMap = {'😢':1,'😕':2,'😐':3,'🙂':4,'😄':5,'🤩':6};
  const moodNums = moodData.map(m => moodMap[m] || null);
  const allVals = [...moodNums.filter(Boolean), ...energyData.filter(Boolean), ...stressData.filter(Boolean)];
  if(!allVals.length) { drawEmpty(ctx); return; }

  const maxY = 10;
  const pad = drawGrid(ctx, 0, maxY, 5);
  const chartH = ctx.H - pad.top - pad.bottom;
  const chartW = ctx.W - pad.left - pad.right;
  const n = labels.length;
  const xStep = n > 1 ? chartW/(n-1) : chartW/2;
  function toY(v) { return pad.top + chartH - (v/maxY)*chartH; }
  function toX(i) { return pad.left + i*xStep; }

  const series = [
    {data:moodNums,    color:CHART_COLORS.rose,  label:'Humor'},
    {data:energyData,  color:CHART_COLORS.amber,  label:'Energia'},
    {data:stressData,  color:CHART_COLORS.clay,   label:'Stress'},
  ];

  series.forEach(s => {
    ctx.beginPath();
    let started=false;
    ctx.strokeStyle=s.color; ctx.lineWidth=1.8; ctx.lineJoin='round';
    s.data.forEach((v,i) => {
      if(v===null){started=false;return;}
      const x=toX(i), y=toY(v);
      if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);
    });
    ctx.stroke();
    // dots
    s.data.forEach((v,i) => {
      if(v===null)return;
      ctx.beginPath(); ctx.arc(toX(i),toY(v),2.5,0,Math.PI*2);
      ctx.fillStyle=s.color; ctx.fill();
    });
  });

  // legend
  let lx = pad.left;
  series.forEach(s => {
    ctx.fillStyle=s.color;
    ctx.fillRect(lx, 6, 12, 4);
    ctx.fillStyle=CHART_COLORS.muted;
    ctx.font=chartFont(9, 'JetBrains Mono,monospace');
    ctx.textAlign='left';
    ctx.fillText(s.label, lx+15, 12);
    lx += ctx.measureText(s.label).width + 30;
  });

  drawXLabels(ctx, labels, pad);
}

// ── HABITS DOT CHART ──────────────────────────────────────────────

function drawHabitsChart(canvasId, labels, habitsData, exData) {
  const ctx = setupCanvas(canvasId);
  if(!ctx) return;

  const maxH = HABITS.length, maxE = QUICK_EXERCISES.length;
  const datasets = [
    {data:habitsData, color:CHART_COLORS.moss,  label:'Hábitos', max:maxH},
    {data:exData,     color:CHART_COLORS.sky,   label:'Exercícios', max:maxE},
  ];
  const allVals = [...habitsData.filter(Boolean), ...exData.filter(Boolean)];
  if(!allVals.length) { drawEmpty(ctx); return; }
  const maxY = Math.max(maxH, maxE, 1);

  const pad = drawGrid(ctx, 0, maxY, 4);
  const chartH = ctx.H - pad.top - pad.bottom;
  const chartW = ctx.W - pad.left - pad.right;
  const n = labels.length;
  const totalBarW = chartW/n;
  const barW = Math.min(totalBarW*0.35, 14);

  datasets.forEach((ds, di) => {
    ds.data.forEach((v,i) => {
      if(v===null)return;
      const x = pad.left + i*totalBarW + (totalBarW/2) + (di===0?-barW-1:1);
      const h = (v/maxY)*chartH;
      const y = pad.top + chartH - h;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, h, [2,2,0,0]);
      ctx.fillStyle = ds.color + 'cc';
      ctx.fill();
    });
  });

  // legend
  let lx = pad.left;
  datasets.forEach(ds => {
    ctx.fillStyle=ds.color; ctx.fillRect(lx, 6, 12, 8); ctx.borderRadius=2;
    ctx.fillStyle=CHART_COLORS.muted; ctx.font=chartFont(9, 'JetBrains Mono,monospace');
    ctx.textAlign='left'; ctx.fillText(ds.label, lx+15, 13); lx += 90;
  });

  drawXLabels(ctx, labels, pad);
}

// ── EMPTY STATE ───────────────────────────────────────────────────

function drawEmpty(ctx) {
  ctx.fillStyle = CHART_COLORS.muted;
  ctx.font = 'italic ' + chartFont(13, 'Lora, serif');
  ctx.textAlign = 'center';
  ctx.fillText('Sem dados suficientes para este período.', ctx.W/2, ctx.H/2);
  ctx.font = chartFont(11, 'JetBrains Mono, monospace');
  ctx.fillText('Continua a registar e os gráficos vão aparecer.', ctx.W/2, ctx.H/2+20);
}

const CHART_TABLE_DATA = {};

function chartEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rememberChartData(canvasId, labels, datasets) {
  CHART_TABLE_DATA[canvasId] = {
    labels: (labels || []).slice(),
    datasets: (datasets || []).map(d => ({
      label: d.label || 'Valor',
      data: (d.data || []).slice()
    }))
  };
  const table = document.getElementById(canvasId + '-table');
  if (table && !table.hidden) renderChartTable(canvasId);
}

function renderChartTable(canvasId) {
  const table = document.getElementById(canvasId + '-table');
  const data = CHART_TABLE_DATA[canvasId];
  if (!table || !data) return;
  const canvas = document.getElementById(canvasId);
  const caption = canvas ? canvas.getAttribute('aria-label') : 'Dados do gráfico';
  const head = data.datasets.map(d => `<th scope="col">${chartEsc(d.label)}</th>`).join('');
  const rows = data.labels.map((label, i) => {
    const cells = data.datasets.map(d => {
      const v = d.data[i];
      if (v === null || v === undefined) return '<td>—</td>';
      return '<td>' + Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + '</td>';
    }).join('');
    return `<tr><th scope="row">${chartEsc(label)}</th>${cells}</tr>`;
  }).join('');
  table.innerHTML = rows
    ? `<table><caption>${chartEsc(caption)}</caption><thead><tr><th scope="col">Período</th>${head}</tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="cal-a11y-note">Sem dados para mostrar.</p>';
}

function toggleChartTable(canvasId) {
  const table = document.getElementById(canvasId + '-table');
  const btn = document.querySelector('.chart-table-btn[aria-controls="' + canvasId + '-table"]');
  if (!table) return;
  const open = table.hidden;
  table.hidden = !open;
  if (btn) btn.setAttribute('aria-expanded', String(open));
  if (open) renderChartTable(canvasId);
}

// ── ACTIVITY CALENDAR ─────────────────────────────────────────────

function renderActivityCalendar() {
  const container = document.getElementById('activity-calendar');
  if(!container) return;

  // 16 weeks back
  const totalDays = 112;
  const endDate = new Date();
  const startDate = new Date(); startDate.setDate(startDate.getDate()-totalDays);

  // align to Sunday
  while(startDate.getDay() !== 0) startDate.setDate(startDate.getDate()-1);

  const weeks = [];
  let week = [];
  const cur = new Date(startDate);
  while(cur <= endDate) {
    if(week.length === 7) { weeks.push(week); week=[]; }
    const dateStr = localDateStr(cur);
    const d = DB[dateStr] || null;
    const score = d ? calcDayScore(d) : 0;
    week.push({date:dateStr, score, day:cur.getDate(), month:cur.getMonth(), hasData:!!d});
    cur.setDate(cur.getDate()+1);
  }
  if(week.length) {
    while(week.length < 7) week.push(null);
    weeks.push(week);
  }

  const dayLabels = ['D','S','T','Q','Q','S','S'];
  const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  // Build HTML
  let html = '<div style="display:flex;gap:3px;">';
  const loggedDays = [];

  // Day labels column
  html += '<div style="display:flex;flex-direction:column;gap:3px;padding-top:20px;">';
  [0,1,2,3,4,5,6].forEach(i => {
    html += `<div class="cal-day-label">${i%2===1?dayLabels[i]:''}</div>`;
  });
  html += '</div>';

  // Weeks
  let lastMonth = -1;
  weeks.forEach(w => {
    html += '<div style="display:flex;flex-direction:column;gap:3px;">';
    // month label on first day of month
    const firstValid = w.find(d=>d&&d.hasData!==undefined);
    const monthLabel = firstValid && firstValid.day <= 7 && firstValid.month !== lastMonth
      ? monthNames[firstValid.month]
      : '';
    if(firstValid && firstValid.day <= 7 && firstValid.month !== lastMonth) lastMonth = firstValid.month;
    html += `<div style="height:14px;font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--muted);white-space:nowrap;">${monthLabel}</div>`;
    w.forEach(day => {
      if(!day) { html += '<div class="cal-day" style="background:transparent;"></div>'; return; }
      const bg = getCalColor(day.score);
      const title = day.date + (day.hasData ? ' · '+day.score+' dados' : ' · sem registo');
      if (day.hasData) loggedDays.push({ date: day.date, score: day.score });
      html += `<div class="cal-day" style="background:${bg};" title="${title}"></div>`;
    });
    html += '</div>';
  });

  html += '</div>';
  const dateLabel = iso => {
    const p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  };
  const summary = loggedDays.length
    ? `<details class="cal-a11y"><summary>Ver dias registados (${loggedDays.length})</summary><ul>${loggedDays
        .slice().reverse()
        .map(d => `<li>${dateLabel(d.date)} — ${d.score} ${d.score === 1 ? 'registo' : 'registos'}</li>`)
        .join('')}</ul></details>`
    : '<p class="cal-a11y-note">Ainda não há dias registados neste período.</p>';
  container.innerHTML = `<div aria-hidden="true">${html}</div>${summary}`;
}

function calcDayScore(d) {
  let score = 0;
  if(d.bedtime) score++;
  if(d.weight) score++;
  if(d.meals && d.meals.length) score += Math.min(d.meals.length, 2);
  if(d.exercises && d.exercises.length) score++;
  return score;
}

function getCalColor(score) {
  if(!score) return 'var(--bg2)';
  if(score<=2)  return 'var(--sage-l)';
  if(score<=4)  return 'var(--sage)';
  if(score<=6)  return 'var(--moss-l)';
  return 'var(--moss-d)';
}

// ── SUMMARY STATS ─────────────────────────────────────────────────

function makeSummaryItem(label, val, suffix='') {
  return `<div class="stats-summary-item">
    <div class="stats-summary-label">${label}</div>
    <div class="stats-summary-val">${val !== null && val !== undefined ? val+suffix : '—'}</div>
  </div>`;
}

function avg(arr) {
  const valid = arr.filter(v=>v!==null&&!isNaN(v));
  if(!valid.length) return null;
  return (valid.reduce((a,b)=>a+b,0)/valid.length);
}

function trend(arr) {
  const valid = arr.filter(v=>v!==null&&!isNaN(v));
  if(valid.length < 2) return null;
  return valid[valid.length-1] - valid[0];
}

// ── KPI CARDS ─────────────────────────────────────────────────────

function renderKPIs(days) {
  const sleepArr  = days.map(d => { const dd=getDayData(d); if(!dd.bedtime||!dd.waketime)return null; let[bh,bm]=dd.bedtime.split(':').map(Number),[wh,wm]=dd.waketime.split(':').map(Number); let bM=bh*60+bm,wM=wh*60+wm;if(wM<bM)wM+=24*60;return+((wM-bM)/60).toFixed(1); });
  const weightArr = days.map(d => { const dd=getDayData(d); return dd.weight?+dd.weight:null; });
  const calArr    = days.map(d => { const dd=getDayData(d); if(!dd.meals) return null; const mv=typeof dd.meals==='object'&&!Array.isArray(dd.meals)?Object.values(dd.meals).flat():dd.meals; const t=mv.reduce((s,m)=>s+(m.cal||0),0); return t||null; });

  const avgSleep  = avg(sleepArr);
  const avgWeight = avg(weightArr);
  const avgCal    = avg(calArr);
  const sleepTrend = trend(sleepArr);
  const weightTrend = trend(weightArr);
  const weightStats = weightWeeklyStats();

  const trendIcon = (v) => v===null?'':v>0?'↑':'↓';
  const trendColor = (v,good='up') => v===null?'var(--muted)':((v>0&&good==='up')||(v<0&&good==='down'))?'var(--moss)':'var(--clay)';

  document.getElementById('statsKPIs').innerHTML = `
    <div class="stat-kpi">
      <div class="stat-kpi-label">🌙 Sono médio</div>
      <div class="stat-kpi-val">${avgSleep!==null?avgSleep.toFixed(1):'—'}<span style="font-size: calc(14px * var(--font-scale));color:var(--muted)">h</span></div>
      <div class="stat-kpi-sub">últimos ${statsPeriod} dias</div>
      ${sleepTrend!==null?`<div class="stat-kpi-trend" style="color:${trendColor(sleepTrend,'up')}">${trendIcon(sleepTrend)} ${Math.abs(sleepTrend).toFixed(1)}h vs início</div>`:''}
    </div>
    <div class="stat-kpi">
      <div class="stat-kpi-label">⚖️ Peso atual</div>
      <div class="stat-kpi-val">${weightStats.current!==null?fmtWeight(weightStats.current):'—'}<span style="font-size: calc(14px * var(--font-scale));color:var(--muted)">kg</span></div>
      <div class="stat-kpi-sub">${weightStats.weeklyAvg!==null?'média semanal '+fmtWeight(weightStats.weeklyAvg)+' kg':'sem média semanal'}</div>
      ${weightStats.variation!==null?`<div class="stat-kpi-trend" style="color:${trendColor(weightStats.variation,'down')}">${trendIcon(weightStats.variation)} ${fmtWeightDelta(Math.abs(weightStats.variation))}kg nas últimas 4 semanas</div>`:''}
    </div>
    <div class="stat-kpi">
      <div class="stat-kpi-label">🍽️ Calorias médias</div>
      <div class="stat-kpi-val">${avgCal!==null?Math.round(avgCal):'—'}<span style="font-size: calc(14px * var(--font-scale));color:var(--muted)">kcal</span></div>
      <div class="stat-kpi-sub">por dia</div>
    </div>
  `;
}

// ── MAIN RENDER ───────────────────────────────────────────────────

function renderAllCharts() {
  const weekBtn = document.getElementById('weightModeWeek');
  const dayBtn = document.getElementById('weightModeDay');
  if (weekBtn) { weekBtn.classList.toggle('active', statsWeightMode === 'week'); weekBtn.setAttribute('aria-pressed', String(statsWeightMode === 'week')); }
  if (dayBtn) { dayBtn.classList.toggle('active', statsWeightMode === 'day'); dayBtn.setAttribute('aria-pressed', String(statsWeightMode === 'day')); }
  const days = getLastNDays(statsPeriod);
  const labels = days.map(shortDate);

  // ── Data extraction
  const sleepData  = days.map(d => { const dd=getDayData(d); if(!dd.bedtime||!dd.waketime)return null; let[bh,bm]=dd.bedtime.split(':').map(Number),[wh,wm]=dd.waketime.split(':').map(Number); let bM=bh*60+bm,wM=wh*60+wm;if(wM<bM)wM+=24*60;return+((wM-bM)/60).toFixed(1); });
  const dailyWeightData = days.map(d => { const dd=getDayData(d); return dd.weight?+dd.weight:null; });
  const weeklyWeight = statsWeightMode === 'week' ? weightWeeklySeries(statsPeriod) : null;
  const weightLabels = weeklyWeight ? weeklyWeight.labels : labels;
  const weightData = weeklyWeight ? weeklyWeight.data : dailyWeightData;
  const calData    = days.map(d => { const dd=getDayData(d); if(!dd.meals) return null; const mv=typeof dd.meals==='object'&&!Array.isArray(dd.meals)?Object.values(dd.meals).flat():dd.meals; const t=mv.reduce((s,m)=>s+(m.cal||0),0); return t||null; });

  // Weight goal
  const weightGoalVal = parseFloat(document.getElementById('weightGoal')?.value) || null;

  // ── Draw charts
  renderKPIs(days);

  drawLineChart('chart-weight', weightLabels, [{
    label: 'Peso (kg)', data: weightData, color: CHART_COLORS.clay,
    goal: weightGoalVal
  }]);

  drawBarChart('chart-calories', labels, [{
    label: 'Calorias (kcal)', data: calData, color: CHART_COLORS.amber, goal: 2000
  }]);

  renderActivityCalendar();

  // ── Summaries
  const avgSleep = avg(sleepData);
  const daysGoal = sleepData.filter(v=>v&&v>=7).length;
  document.getElementById('stats-sleep-summary').innerHTML =
    makeSummaryItem('média', avgSleep!==null?avgSleep.toFixed(1):null,'h') +
    makeSummaryItem('noites ≥7h', daysGoal) +
    makeSummaryItem('melhor noite', sleepData.filter(Boolean).length?Math.max(...sleepData.filter(Boolean)).toFixed(1):null,'h') +
    makeSummaryItem('pior noite', sleepData.filter(Boolean).length?Math.min(...sleepData.filter(Boolean)).toFixed(1):null,'h');

  const validWeights = weightData.filter(Boolean);
  document.getElementById('stats-weight-summary').innerHTML =
    makeSummaryItem('mínimo', validWeights.length?fmtWeight(Math.min(...validWeights)):null,' kg') +
    makeSummaryItem('máximo', validWeights.length?fmtWeight(Math.max(...validWeights)):null,' kg') +
    makeSummaryItem('diferença', validWeights.length>=2?fmtWeightDelta(validWeights[validWeights.length-1]-validWeights[0]):null,' kg') +
    (weightGoalVal?makeSummaryItem('falta para meta', validWeights.length?fmtWeightDelta(validWeights[validWeights.length-1]-weightGoalVal):null,' kg'):'');

  const avgCal = avg(calData);
  document.getElementById('stats-cal-summary').innerHTML =
    makeSummaryItem('média diária', avgCal!==null?Math.round(avgCal):null,'kcal') +
    makeSummaryItem('máximo', calData.filter(Boolean).length?Math.round(Math.max(...calData.filter(Boolean))):null,'kcal') +
    makeSummaryItem('dias registados', calData.filter(Boolean).length);


}

// ── Override showSection to render charts when navigating to stats ──
// (integrated into original showSection below — no duplicate needed)




// ═══════════════════════════════════════════════════════════════════
// DAILY FLOW
// ═══════════════════════════════════════════════════════════════════

const FLOW_STEPS = [
  {
    id: 'water', icon: '💧', label: 'Água',
    section: 'overview',
    check: () => waterCount >= waterGoal ? 'done' : waterCount > 0 ? 'partial' : null,
    detail: () => {
      if (waterCount === 0) return ['Ainda não registado'];
      return [
        waterCount + ' de ' + waterGoal + ' copos',
        (waterCount * 250) + ' ml',
        waterCount >= waterGoal ? 'Meta atingida' : 'Faltam ' + (waterGoal - waterCount) + ' copos'
      ];
    }
  },
  {
    id: 'meals', icon: '🍽️', label: 'Refeições',
    section: 'meals',
    check: () => { const n=Object.values(meals).flat().length; return n>=2?'done':n===1?'partial':null; },
    detail: () => {
      if (!Object.values(meals).flat().length) return ['Nenhuma refeição ainda'];
      const allMeals = Object.values(meals).flat();
      const total = allMeals.reduce((s,m) => s+m.cal, 0);
      return [
        ...allMeals.map(m => m.name + ' · ' + (m.cal||0) + ' kcal'),
        '─',
        'Total: ' + total + ' kcal'
      ];
    }
  },
  {
    id: 'work', icon: '💼', label: 'Trabalho',
    section: 'work',
    check: () => {
      const s = document.getElementById('workStart').value;
      const e = document.getElementById('workEnd').value;
      return s && e ? 'done' : s ? 'partial' : null;
    },
    detail: () => {
      const s = document.getElementById('workStart').value;
      const e = document.getElementById('workEnd').value;
      const mood = document.getElementById('workMood').value;
      if (!s) return ['Ainda não registado'];
      const lines = [];
      if (s) lines.push('Início: ' + s);
      if (e) lines.push('Fim: ' + e);
      if (mood) lines.push(mood);
      return lines;
    }
  },
];

let activeFlowStep = null;

// ═══════════════════════════════════════════════════════════════════
// MASCOTE PIXEL ART — REATIVO & PERSONALIZÁVEL
// ═══════════════════════════════════════════════════════════════════

const MASCOT_KEY = 'dvMascot';
const MASCOT_DEFAULT = { name: 'Broto', palette: 'teal', accessory: 'none', animate: true };
const MASCOT_STAGE_NAMES = ['rebento', 'jovem', 'florescer', 'pleno'];

const MASCOT_PALETTES = {
  teal:  { base: '#2dd4bf', light: '#5eead4', dark: '#0f766e', cheek: '#f472b6', glow: '45,212,191' },
  amber: { base: '#f59e0b', light: '#fcd34d', dark: '#92400e', cheek: '#fb7185', glow: '245,158,11' },
  rose:  { base: '#f472b6', light: '#f9a8d4', dark: '#9d174d', cheek: '#fda4af', glow: '244,114,182' },
  sky:   { base: '#60a5fa', light: '#93c5fd', dark: '#1e40af', cheek: '#f472b6', glow: '96,165,250' },
  moss:  { base: '#84cc16', light: '#bef264', dark: '#3f6212', cheek: '#f59e0b', glow: '132,204,22' },
  grape: { base: '#a78bfa', light: '#c4b5fd', dark: '#5b21b6', cheek: '#f472b6', glow: '167,139,250' },
};

const MASCOT_ACCESSORIES = { none: 'Nenhum', hat: 'Chapéu', glasses: 'Óculos', scarf: 'Cachecol', flower: 'Flor' };

function getMascotConfig() {
  try {
    return Object.assign({}, MASCOT_DEFAULT, JSON.parse(localStorage.getItem(MASCOT_KEY) || '{}'));
  } catch (e) {
    return Object.assign({}, MASCOT_DEFAULT);
  }
}
function saveMascotConfig(cfg) {
  try { localStorage.setItem(MASCOT_KEY, JSON.stringify(cfg)); } catch (e) {}
}

function mascotStreak() {
  try {
    if (typeof DB === 'undefined' || typeof localDateStr !== 'function') return 0;
    const start = new Date();
    if (!(DB[localDateStr(start)] && DB[localDateStr(start)].savedAt)) start.setDate(start.getDate() - 1);
    let n = 0, gaps = 0;
    for (let i = 0; i < 400; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() - i);
      const k = localDateStr(d);
      if (DB[k] && DB[k].savedAt) { n++; gaps = 0; }
      else if (++gaps >= 3) break; // até 2 dias em pausa; só se perde ao 3.º seguido
    }
    return n;
  } catch (e) { return 0; }
}

function mascotTotalDays() {
  try { return Object.keys(DB).filter(k => DB[k] && DB[k].savedAt).length; } catch (e) { return 0; }
}

function mascotStage() {
  const score = Math.max(mascotStreak(), Math.min(mascotTotalDays(), 30));
  if (score >= 30) return 4;
  if (score >= 14) return 3;
  if (score >= 3) return 2;
  return 1;
}

function getMascotReaction() {
  const cfg = getMascotConfig();
  let today = {};
  try { today = (typeof DB !== 'undefined' && DB[TODAY]) ? DB[TODAY] : {}; } catch (e) {}

  let wc = 0, wg = 8;
  try {
    wc = (typeof waterCount === 'number') ? waterCount : (today.waterCount || 0);
    wg = (typeof waterGoal === 'number' && waterGoal > 0) ? waterGoal : (today.waterGoal || 8);
  } catch (e) {}

  let sleepH = 0;
  try {
    const bedEl = document.getElementById('bedtime');
    const wakeEl = document.getElementById('waketime');
    const bed = bedEl ? bedEl.value : '';
    const wake = wakeEl ? wakeEl.value : '';
    if (bed && wake) {
      const [bh, bm] = bed.split(':').map(Number);
      const [wh, wm] = wake.split(':').map(Number);
      let bM = bh * 60 + bm, wM = wh * 60 + wm;
      if (wM < bM) wM += 24 * 60;
      sleepH = (wM - bM) / 60;
    } else if (typeof getSleepH === 'function') {
      sleepH = getSleepH(today);
    }
  } catch (e) { sleepH = 0; }

  let flowPct = 0;
  try {
    if (typeof FLOW_STEPS !== 'undefined' && Array.isArray(FLOW_STEPS) && FLOW_STEPS.length) {
      let done = 0;
      FLOW_STEPS.forEach(step => {
        const st = step.check();
        if (st === 'done') done += 1;
        else if (st === 'partial') done += 0.5;
      });
      flowPct = Math.round((done / FLOW_STEPS.length) * 100);
    }
  } catch (e) {}

  const streak = mascotStreak();
  const hour = new Date().getHours();
  let expression = 'neutral';
  let text = '';

  if (sleepH > 0 && sleepH < 6.5) {
    expression = 'sleepy';
    text = `Dormiste só ${sleepH.toFixed(1)}h… hoje vou devagar contigo. Se puderes, deita-te mais cedo.`;
  } else if (hour >= 10 && wc < Math.ceil(wg * 0.5)) {
    expression = 'thirsty';
    text = `Tenho sede! Só ${wc} de ${wg} copos de água. Bebe um gole por mim? 💧`;
  } else if (streak >= 7) {
    expression = 'proud';
    text = `${streak} dias seguidos a registar! Estou a crescer contigo — continua assim. 🌱`;
  } else if (flowPct >= 60 || wc >= wg || sleepH >= 7) {
    expression = 'happy';
    if (flowPct >= 60) text = `Já tens ${flowPct}% do dia preenchido. Que organização!`;
    else if (wc >= wg) text = `Meta de água batida (${wc}/${wg})! Estou orgulhoso.`;
    else text = `Dormiste ${sleepH.toFixed(1)}h — bem! Hoje rende mais.`;
  } else {
    expression = 'neutral';
    text = 'Olá! Ainda há pouco registado hoje. Começa pela água ou por uma refeição?';
  }

  return { expression, text, waterCount: wc, waterGoal: wg, sleepH, streak, flowPct, stage: mascotStage(), name: cfg.name || 'Broto' };
}

function _mRect(x, y, w, h, fill, cls, opacity) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"`
    + (cls ? ` class="${cls}"` : '')
    + (opacity != null ? ` opacity="${opacity}"` : '')
    + '/>';
}

function _mLeaves(stage) {
  const gd = '#15803d', gl = '#4ade80', gb = '#22c55e';
  let s = '<g class="m-leaf">';
  if (stage >= 2) {
    // folha esquerda
    s += _mRect(2, 7, 5, 1, gd) + _mRect(3, 6, 4, 1, gd) + _mRect(2, 8, 4, 1, gd);
    s += _mRect(3, 7, 3, 1, gl) + _mRect(4, 6, 2, 1, gb) + _mRect(3, 8, 2, 1, gb);
    // folha direita (espelhada)
    s += _mRect(17, 7, 5, 1, gd) + _mRect(17, 6, 4, 1, gd) + _mRect(18, 8, 4, 1, gd);
    s += _mRect(18, 7, 3, 1, gl) + _mRect(18, 6, 2, 1, gb) + _mRect(19, 8, 2, 1, gb);
    // ligação das folhas ao corpo
    s += _mRect(6, 8, 2, 1, gd) + _mRect(6, 8, 1, 1, gb);
    s += _mRect(16, 8, 2, 1, gd) + _mRect(17, 8, 1, 1, gb);
  } else {
    // rebento: folhas pequenas
    s += _mRect(3, 7, 4, 1, gd) + _mRect(4, 6, 3, 1, gd) + _mRect(3, 8, 3, 1, gd);
    s += _mRect(4, 7, 2, 1, gl) + _mRect(4, 6, 1, 1, gb);
    s += _mRect(17, 7, 4, 1, gd) + _mRect(17, 6, 3, 1, gd) + _mRect(18, 8, 3, 1, gd);
    s += _mRect(18, 7, 2, 1, gl) + _mRect(19, 6, 1, 1, gb);
    s += _mRect(6, 8, 2, 1, gd) + _mRect(16, 8, 2, 1, gd);
  }
  s += '</g>';

  // caule
  s += _mRect(11, 6, 2, 2, '#8b5e3c') + _mRect(11, 6, 1, 2, '#a16207');
  if (stage < 2) {
    s += _mRect(10, 5, 4, 1, gd) + _mRect(11, 5, 2, 1, gb);
  }
  if (stage >= 2) {
    s += _mRect(11, 4, 2, 4, '#8b5e3c');
    if (stage === 2) {
      s += _mRect(11, 1, 2, 1, gd) + _mRect(10, 2, 4, 2, gd) + _mRect(11, 4, 2, 1, gd);
      s += _mRect(11, 2, 2, 2, gb) + _mRect(11, 3, 2, 1, gl);
    } else if (stage === 3) {
      // ramo lateral com botão dourado
      s += _mRect(12, 4, 4, 1, '#8b5e3c');
      s += _mRect(16, 4, 2, 1, gd);
      s += _mRect(16, 1, 2, 3, '#f59e0b');
      s += _mRect(16, 2, 1, 1, '#fcd34d');
    } else {
      // flor aberta no topo (5 pétalas + centro)
      s += _mRect(11, 0, 2, 2, '#f472b6');
      s += _mRect(9, 2, 2, 2, '#f472b6');
      s += _mRect(13, 2, 2, 2, '#f472b6');
      s += _mRect(11, 4, 2, 2, '#f472b6');
      s += _mRect(11, 2, 2, 2, '#fcd34d');
    }
  }
  return s;
}

function _mBody(pal) {
  let s = '';
  const outlineRows = [[8, 8, 8], [9, 6, 12], [10, 5, 14], [11, 5, 14], [12, 5, 14], [13, 5, 14], [14, 5, 14], [15, 5, 14], [16, 6, 12], [17, 7, 10], [18, 8, 8]];
  outlineRows.forEach(([y, x, w]) => { s += _mRect(x, y, w, 1, pal.dark); });
  const innerRows = [[9, 7, 10], [10, 6, 12], [11, 6, 12], [12, 6, 12], [13, 6, 12], [14, 6, 12], [15, 6, 12], [16, 7, 10], [17, 8, 8], [18, 9, 6]];
  innerRows.forEach(([y, x, w]) => { s += _mRect(x, y, w, 1, pal.base); });
  // barriga
  s += _mRect(8, 14, 8, 2, pal.light, null, 0.35);
  s += _mRect(9, 16, 6, 1, pal.light, null, 0.2);
  // pés
  s += _mRect(7, 19, 3, 2, pal.dark) + _mRect(14, 19, 3, 2, pal.dark);
  s += _mRect(8, 19, 1, 1, pal.base) + _mRect(15, 19, 1, 1, pal.base);
  return s;
}

function _mFace(expression, pal) {
  const eye = '#0b1220', white = '#f8fafc';
  let s = '';

  if (expression === 'sleepy') {
    s += _mRect(8, 12, 2, 1, eye) + _mRect(14, 12, 2, 1, eye);
    s += _mRect(10, 15, 4, 1, eye);
  } else if (expression === 'thirsty') {
    s += _mRect(8, 11, 2, 2, eye) + _mRect(14, 11, 2, 2, eye);
    s += _mRect(8, 11, 1, 1, white) + _mRect(14, 11, 1, 1, white);
    s += _mRect(11, 14, 2, 2, eye);
    s += _mRect(18, 10, 1, 1, '#60a5fa') + _mRect(17, 11, 2, 1, '#60a5fa') + _mRect(18, 12, 1, 1, '#60a5fa');
  } else if (expression === 'proud') {
    s += _mRect(8, 12, 1, 1, eye) + _mRect(9, 11, 1, 1, eye);
    s += _mRect(14, 11, 1, 1, eye) + _mRect(15, 12, 1, 1, eye);
    s += _mRect(10, 14, 4, 1, eye) + _mRect(9, 13, 1, 1, eye) + _mRect(14, 13, 1, 1, eye);
  } else if (expression === 'happy') {
    s += _mRect(8, 11, 2, 2, eye) + _mRect(14, 11, 2, 2, eye);
    s += _mRect(8, 11, 1, 1, white) + _mRect(14, 11, 1, 1, white);
    s += _mRect(10, 14, 4, 1, eye) + _mRect(9, 13, 1, 1, eye) + _mRect(14, 13, 1, 1, eye);
  } else {
    s += _mRect(8, 11, 2, 2, eye) + _mRect(14, 11, 2, 2, eye);
    s += _mRect(8, 11, 1, 1, white) + _mRect(14, 11, 1, 1, white);
    s += _mRect(10, 15, 4, 1, eye);
  }

  // bochechas
  s += _mRect(6, 13, 1, 2, pal.cheek, null, 0.75);
  s += _mRect(17, 13, 1, 2, pal.cheek, null, 0.75);
  return s;
}

function _mAccessory(acc) {
  let s = '';
  if (acc === 'hat') {
    s += _mRect(8, 2, 8, 1, '#92400e') + _mRect(8, 2, 1, 4, '#92400e') + _mRect(15, 2, 1, 4, '#92400e');
    s += _mRect(9, 3, 6, 3, '#f59e0b') + _mRect(8, 5, 8, 1, '#92400e');
    s += _mRect(4, 6, 16, 1, '#b45309') + _mRect(5, 7, 14, 1, '#f59e0b');
  } else if (acc === 'glasses') {
    const f = '#0b1220';
    s += _mRect(6, 10, 4, 1, f) + _mRect(6, 13, 4, 1, f) + _mRect(6, 10, 1, 4, f) + _mRect(9, 10, 1, 4, f);
    s += _mRect(14, 10, 4, 1, f) + _mRect(14, 13, 4, 1, f) + _mRect(14, 10, 1, 4, f) + _mRect(17, 10, 1, 4, f);
    s += _mRect(10, 11, 4, 1, f);
    s += _mRect(7, 11, 2, 2, '#60a5fa', null, 0.22) + _mRect(15, 11, 2, 2, '#60a5fa', null, 0.22);
  } else if (acc === 'scarf') {
    s += _mRect(5, 16, 14, 2, '#dc2626') + _mRect(5, 17, 14, 1, '#b91c1c');
    s += _mRect(17, 18, 3, 1, '#dc2626') + _mRect(18, 19, 2, 2, '#b91c1c');
  } else if (acc === 'flower') {
    // flor de 5 pétalas na folha esquerda
    s += _mRect(4, 5, 2, 2, '#f472b6');
    s += _mRect(4, 9, 2, 2, '#f472b6');
    s += _mRect(2, 7, 2, 2, '#f472b6');
    s += _mRect(6, 7, 2, 2, '#f472b6');
    s += _mRect(4, 7, 2, 2, '#fbbf24');
  }
  return s;
}

function _mEffects(expression) {
  if (expression === 'sleepy') {
    return '<g class="m-zzz">'
      + _mRect(18, 5, 1, 1, '#94a3b8') + _mRect(19, 6, 1, 1, '#94a3b8')
      + _mRect(17, 6, 2, 1, '#94a3b8') + _mRect(17, 7, 2, 1, '#94a3b8')
      + '</g>';
  }
  if (expression === 'proud') {
    return '<g class="m-spark">'
      + _mRect(3, 4, 1, 3, '#fcd34d') + _mRect(2, 5, 3, 1, '#fcd34d')
      + _mRect(20, 9, 1, 3, '#fcd34d') + _mRect(19, 10, 3, 1, '#fcd34d')
      + '</g>';
  }
  return '';
}

function _mEsc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMascotSVG(opts) {
  opts = opts || {};
  const cfg = opts.cfg || getMascotConfig();
  const pal = MASCOT_PALETTES[cfg.palette] || MASCOT_PALETTES.teal;
  const stage = opts.stage || mascotStage();
  const expression = opts.expression || getMascotReaction().expression;
  const animate = opts.animate !== false && cfg.animate !== false;

  const art = _mLeaves(stage) + _mBody(pal) + _mFace(expression, pal) + _mAccessory(cfg.accessory);

  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" class="mascot-svg${animate ? ' m-anim' : ''}" role="img" aria-label="Mascote ${_mEsc(cfg.name || 'Broto')}">`
    + `<g class="m-bob">${art}</g>`
    + _mEffects(expression)
    + '</svg>';
}

function renderMascot() {
  const stageEl = document.getElementById('mascotStage');
  if (!stageEl) return;

  const cfg = getMascotConfig();
  const pal = MASCOT_PALETTES[cfg.palette] || MASCOT_PALETTES.teal;
  const reaction = getMascotReaction();

  stageEl.style.setProperty('--mascot-glow', pal.glow);
  stageEl.innerHTML = renderMascotSVG({ cfg, stage: reaction.stage, expression: reaction.expression });

  const nameEl = document.getElementById('mascotNameTop');
  if (nameEl) nameEl.textContent = reaction.name;

  const stageLabel = document.getElementById('mascotStageLabel');
  if (stageLabel) stageLabel.textContent = 'fase ' + reaction.stage + ' · ' + (MASCOT_STAGE_NAMES[reaction.stage - 1] || '');

  const bubble = document.getElementById('mascotBubble');
  if (bubble) bubble.textContent = reaction.text;

  const meta = document.getElementById('mascotMeta');
  if (meta) {
    meta.innerHTML = '<span>' + reaction.streak + ' dias seguidos</span>'
      + '<span>' + reaction.waterCount + '/' + reaction.waterGoal + ' água</span>'
      + '<span>' + (reaction.sleepH ? reaction.sleepH.toFixed(1) + 'h sono' : '— sono') + '</span>'
      + '<span>' + reaction.flowPct + '% rotina</span>';
  }

  renderMascotSettingsPreview();
}

function renderMascotSettingsPreview() {
  const el = document.getElementById('mascotSettingsStage');
  if (!el) return;

  const cfg = getMascotConfig();
  const pal = MASCOT_PALETTES[cfg.palette] || MASCOT_PALETTES.teal;
  const reaction = getMascotReaction();

  el.style.setProperty('--mascot-glow', pal.glow);
  el.innerHTML = renderMascotSVG({ cfg, stage: reaction.stage, expression: reaction.expression });
}

function initMascotSettings() {
  const cfg = getMascotConfig();
  const nameInput = document.getElementById('mascotNameInput');
  if (nameInput) nameInput.value = cfg.name || 'Broto';

  const anim = document.getElementById('mascotAnimateToggle');
  if (anim) anim.checked = cfg.animate !== false;

  document.querySelectorAll('[data-mascot-palette]').forEach(btn => {
    const on = btn.dataset.mascotPalette === cfg.palette;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('[data-mascot-acc]').forEach(btn => {
    const on = btn.dataset.mascotAcc === cfg.accessory;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  renderMascotSettingsPreview();
}

function setMascotPalette(palette) {
  if (!MASCOT_PALETTES[palette]) return;
  const cfg = getMascotConfig();
  cfg.palette = palette;
  saveMascotConfig(cfg);
  initMascotSettings();
  renderMascot();
}

function setMascotAccessory(accessory) {
  if (!(accessory in MASCOT_ACCESSORIES)) return;
  const cfg = getMascotConfig();
  cfg.accessory = accessory;
  saveMascotConfig(cfg);
  initMascotSettings();
  renderMascot();
}

function saveMascotOptions() {
  const cfg = getMascotConfig();
  const nameInput = document.getElementById('mascotNameInput');
  const anim = document.getElementById('mascotAnimateToggle');
  cfg.name = ((nameInput && nameInput.value) || '').trim().slice(0, 20) || 'Broto';
  cfg.animate = anim ? anim.checked : true;
  saveMascotConfig(cfg);

  const status = document.getElementById('mascotSettingsStatus');
  if (status) {
    status.textContent = '✓ Mascote guardado!';
    status.style.color = 'var(--moss-l)';
    setTimeout(() => { status.textContent = ''; }, 2500);
  }
  renderMascot();
  initMascotSettings();
}

function resetMascot() {
  if (!confirm('Repor o mascote original?')) return;
  try { localStorage.removeItem(MASCOT_KEY); } catch (e) {}
  initMascotSettings();
  renderMascot();
  const status = document.getElementById('mascotSettingsStatus');
  if (status) {
    status.textContent = '↺ Mascote reposto';
    status.style.color = 'var(--muted)';
    setTimeout(() => { status.textContent = ''; }, 2500);
  }
}

function _mRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function exportMascotPNG(size) {
  size = parseInt(size, 10) || 512;
  const cfg = getMascotConfig();
  const pal = MASCOT_PALETTES[cfg.palette] || MASCOT_PALETTES.teal;
  const reaction = getMascotReaction();
  const svg = renderMascotSVG({ cfg, stage: reaction.stage, expression: reaction.expression, animate: false })
    .replace('<svg ', `<svg width="${size}" height="${size}" `);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#0f1117';
      _mRoundRect(ctx, 0, 0, size, size, size * 0.22);
      ctx.fill();

      const glow = ctx.createRadialGradient(size / 2, size * 0.48, size * 0.04, size / 2, size * 0.5, size * 0.52);
      glow.addColorStop(0, `rgba(${pal.glow},0.20)`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
      ctx.fill();

      const pad = Math.round(size * 0.13);
      ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);

      canvas.toBlob(b => {
        URL.revokeObjectURL(url);
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `icon-${size}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);

        const status = document.getElementById('mascotSettingsStatus');
        if (status) {
          status.textContent = `✓ icon-${size}.png descarregado`;
          status.style.color = 'var(--moss-l)';
          setTimeout(() => { status.textContent = ''; }, 3000);
        }
      }, 'image/png');
    } catch (e) {
      alert('Erro ao exportar PNG: ' + e.message);
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('Erro ao gerar a imagem do mascote.');
  };
  img.src = url;
}

let onboardingDismissed = false;

function navBySection(id) {
  return Array.from(document.querySelectorAll('.nav-item')).find(n => (n.getAttribute('onclick') || '').includes("'" + id + "'")) || null;
}

function dismissOnboarding() {
  onboardingDismissed = true;
  renderOnboarding();
}

function renderOnboarding() {
  const card = document.getElementById('onboardingCard');
  if (!card) return;
  const empty = mascotTotalDays() === 0 && !onboardingDismissed;
  card.hidden = !empty;
  const grid = document.getElementById('overviewGrid');
  if (grid) grid.hidden = empty;
}

function skipToMain(e) {
  if (e) e.preventDefault();
  if (typeof showSection === 'function') showSection('overview', navBySection('overview'));
  const main = document.getElementById('mainContent');
  if (main) {
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    main.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (typeof toggleMobileMenu === 'function') toggleMobileMenu(false);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    const t = e.target;
    if (t && t.matches && t.matches('.nav-item, .flow-step')) {
      e.preventDefault();
      t.click();
    }
  }
});

document.querySelectorAll('.nav-item').forEach(function (n) {
  n.setAttribute('role', 'button');
  n.setAttribute('tabindex', '0');
});

function renderDailyFlow() {
  const container = document.getElementById('dailyFlow');
  if (!container) return;

  let doneCount = 0;
  const statuses = FLOW_STEPS.map(s => s.check());
  statuses.forEach(s => { if (s === 'done') doneCount++; if (s === 'partial') doneCount += 0.5; });
  const pct = Math.round((doneCount / FLOW_STEPS.length) * 100);

  // Update progress bar
  const fill = document.getElementById('flowProgressFill');
  const pctEl = document.getElementById('flowProgressPct');
  const textEl = document.getElementById('flowProgressText');
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (textEl) {
    const fullDone = statuses.filter(s => s === 'done').length;
    textEl.textContent = fullDone + ' de ' + FLOW_STEPS.length + ' secções completas hoje';
  }

  // Build flow HTML
  let html = '';
  FLOW_STEPS.forEach((step, i) => {
    const status = statuses[i];
    const circleClass = status === 'done' ? 'done' : status === 'partial' ? 'partial' : '';
    const labelClass = status === 'done' ? 'done' : '';

    if (i > 0) {
      html += `<div class="flow-connector ${status === 'done' ? 'done' : ''}"></div>`;
    }

    html += `
      <div class="flow-step" role="button" tabindex="0" onclick="toggleFlowDetail('${step.id}')">
        <div class="flow-circle ${circleClass}">${step.icon}</div>
        <div class="flow-label ${labelClass}">${step.label}</div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function toggleFlowDetail(stepId) {
  const detail = document.getElementById('flowDetail');
  const step = FLOW_STEPS.find(s => s.id === stepId);
  if (!step) return;

  if (activeFlowStep === stepId) {
    // Close if clicking same step
    detail.classList.remove('visible');
    activeFlowStep = null;
    return;
  }

  activeFlowStep = stepId;
  document.getElementById('flowDetailTitle').textContent = step.icon + ' ' + step.label;
  const items = step.detail();
  document.getElementById('flowDetailItems').innerHTML = items
    .map(item => item === '─' ? '<hr style="border:none;border-top:1px solid var(--border);margin:4px 0">' : '<div>' + item + '</div>')
    .join('');

  detail.classList.add('visible');

  // Also navigate to that section
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + step.section + "'")) {
      setTimeout(() => showSection(step.section, n), 300);
    }
  });
}

// Hook into updateOverview to also refresh flow
const _origUpdateOverview = _updateOverviewBase;
updateOverview = function () {
  _origUpdateOverview();
  renderDailyFlow();
  renderMascot();
  renderOnboarding();
  renderWeeklyWeight();
  renderWeightHistory();
};




// ── WORK ENTRY / EXIT STAMPS ──
function getNowTime() {
  const n = new Date();
  return String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
}

function stampLunchStart() {
  document.getElementById('lunchStart').value = getNowTime();
  calcWorkHours();
}

function stampLunchEnd() {
  document.getElementById('lunchEnd').value = getNowTime();
  calcWorkHours();
}

// ═══════════════════════════════════════════════════════════════════
// WORK DATE PICKER — editar dias anteriores
// ═══════════════════════════════════════════════════════════════════

let workEditDate = TODAY; // data atualmente visível na secção trabalho

function initWorkDatePicker() {
  const picker = document.getElementById('workDatePicker');
  if (!picker) return;
  picker.max = TODAY;
  picker.value = TODAY;
  workEditDate = TODAY;
  updateWorkDateBanner();
}

function workDateChange(val) {
  if (!val) return;
  workEditDate = val;
  loadWorkDayIntoForm(val);
  updateWorkDateBanner();
}

function workDatePrev() {
  const d = new Date(workEditDate + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const newDate = localDateStr(d);
  const picker = document.getElementById('workDatePicker');
  if (picker) picker.value = newDate;
  workDateChange(newDate);
}

function workDateNext() {
  const d = new Date(workEditDate + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  const newDate = localDateStr(d);
  if (newDate > TODAY) return; // não avançar para o futuro
  const picker = document.getElementById('workDatePicker');
  if (picker) picker.value = newDate;
  workDateChange(newDate);
}

function workDateReset() {
  const picker = document.getElementById('workDatePicker');
  if (picker) picker.value = TODAY;
  workDateChange(TODAY);
}

function updateWorkDateBanner() {
  const banner = document.getElementById('workDateBanner');
  const bannerText = document.getElementById('workDateBannerText');
  const nextBtn = document.getElementById('workDateNextBtn');
  if (!banner) return;

  if (workEditDate === TODAY) {
    banner.style.display = 'none';
  } else {
    const d = new Date(workEditDate + 'T12:00:00');
    const days = Math.round((new Date(TODAY + 'T12:00:00') - d) / 86400000);
    const label = days === 1 ? 'ontem' : `há ${days} dias`;
    const dayNames = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
    bannerText.textContent = `✏️  A editar ${dayNames[d.getDay()]} ${workEditDate} (${label})`;
    banner.style.display = 'block';
  }

  // Desativar botão › se já estamos em hoje
  if (nextBtn) nextBtn.style.opacity = workEditDate >= TODAY ? '0.3' : '1';

  // Desativar/ativar botões stamp conforme se é hoje ou não
  const isToday = workEditDate === TODAY;
  ['stampWorkEntry', 'stampWorkExit', 'stampLunchStart', 'stampLunchEnd'].forEach(fn => {
    document.querySelectorAll(`[onclick="${fn}()"]`).forEach(btn => {
      btn.style.display = isToday ? '' : 'none';
    });
  });
}

function loadWorkDayIntoForm(date) {
  const d = DB[date] || {};
  // Preencher campos sem disparar saveData do dia errado
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('workStart',   d.workStart   || '');
  set('workEnd',     d.workEnd     || '');
  set('lunchStart',  d.lunchStart  || '');
  set('lunchEnd',    d.lunchEnd    || '');
  set('workMood',    d.workMood    || '');
  set('workFocus',   d.workFocus   || '');
  set('workNotes',   d.workNotes   || '');
  markWorkEntry(); markWorkExit(); calcWorkHours();
}

function saveWorkDay() {
  // Guardar no dia correto (workEditDate, não necessariamente TODAY)
  if (!DB[workEditDate]) DB[workEditDate] = {};
  const d = DB[workEditDate];
  const get = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  d.workStart  = get('workStart');
  d.workEnd    = get('workEnd');
  d.lunchStart = get('lunchStart');
  d.lunchEnd   = get('lunchEnd');
  d.workMood   = get('workMood');
  d.workFocus  = get('workFocus');
  d.workNotes  = get('workNotes');
  d.savedAt    = new Date().toISOString();
  try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
  renderWorkCalendar();
  renderOvertimeBank();
  // O Banco de horas também vai para o Supabase; «guardado» só depois da confirmação
  const dayLabel = workEditDate === TODAY ? '' : workEditDate + ' ';
  const msg = document.getElementById('saveMsg-work');
  const p = SyncManager.saveDay(workEditDate);
  if (msg) msg.textContent = '⏳ a guardar…';
  p.then(r => { if (msg) msg.textContent = dayLabel + saveMsgText(r, ''); });
  return p;
}

function stampWorkEntry() {
  document.getElementById('workStart').value = getNowTime();
  markWorkEntry();
  calcWorkHours();
}


function stampWorkExit() {
  document.getElementById('workEnd').value = getNowTime();
  markWorkExit();
  calcWorkHours();
}

function markWorkEntry() {
  const val = document.getElementById('workStart').value;
  const lbl = document.getElementById('workStartLabel');
  const card = document.getElementById('workStartCard');
  if (val) {
    lbl.textContent = 'registado às ' + val + 'h';
    lbl.style.color = 'var(--moss)';
    card.style.borderColor = 'rgba(90,110,74,0.5)';
  } else {
    lbl.textContent = '— não registado —';
    lbl.style.color = '';
    card.style.borderColor = '';
  }
}

function markWorkExit() {
  const val = document.getElementById('workEnd').value;
  const lbl = document.getElementById('workEndLabel');
  const card = document.getElementById('workEndCard');
  if (val) {
    lbl.textContent = 'registado às ' + val + 'h';
    lbl.style.color = '#f87171';
    card.style.borderColor = 'rgba(180,80,80,0.4)';
  } else {
    lbl.textContent = '— não registado —';
    lbl.style.color = '';
    card.style.borderColor = '';
  }
}


// ═══════════════════════════════════════════════════════════════════
// SIDEBAR CALORIE BALANCE
// BMR (Mifflin-St Jeor) for ~100kg sedentary person
// ═══════════════════════════════════════════════════════════════════
function updateSidebarCals() {
  const sbIn  = document.getElementById('sbCalIn');
  const sbBMR = document.getElementById('sbCalBMR');
  const sbEx  = document.getElementById('sbCalExercise');
  const sbBal = document.getElementById('sbCalBalance');
  if (!sbIn) return;

  // Calories consumed — read directly from global meals object
  let calIn = 0;
  try {
    const mealObj = (meals && typeof meals === 'object' && !Array.isArray(meals))
      ? meals : {x: Array.isArray(meals) ? meals : []};
    Object.values(mealObj).forEach(slot => {
      (slot||[]).forEach(m => { calIn += (parseInt(m.cal) || 0); });
    });
  } catch(err) { calIn = 0; }
  sbIn.textContent = calIn + ' kcal';

  // BMR (Mifflin-St Jeor, sedentary x1.2) — masculino, 172cm, 32 anos (07/09/1993)
  // Fórmula: (10×peso + 6.25×altura - 5×idade + 5) × 1.2
  const weightInput = document.getElementById('weight');
  const w = Math.max(40, parseFloat((weightInput && weightInput.value) || 100) || 100);
  const bmr = Math.round((10*w + 6.25*175 - 5*32 + 5) * 1.2);
  sbBMR.textContent = bmr + ' kcal';

  // Exercise kcal from checked exercises + manual extras
  let exKcal = 0;
  try {
    (QUICK_EXERCISES||[]).forEach(e => { if (habitsDone && habitsDone[e.id]) exKcal += (e.kcal||0); });
    (exercises||[]).forEach(e => {
      const mins = e.duration||0;
      const rate = e.intensity==='intensa'?9:e.intensity==='moderada'?7:5;
      exKcal += Math.round(mins * rate * (w/70));
    });
  } catch(err) {}
  sbEx.textContent = '+' + exKcal + ' kcal';

  // Balance: negative = défice calórico (bom para perder peso)
  const balance = calIn - (bmr + exKcal);
  sbBal.textContent = (balance >= 0 ? '+' : '') + balance + ' kcal';
  sbBal.style.color = balance <= -200 ? '#8fbc6a' : balance <= 0 ? 'var(--sage)' : balance < 300 ? 'var(--amber)' : '#c06060';
}


// ═══════════════════════════════════════════════════════════════════
// WEIGHT GOAL COUNTER
// Start: 102.1kg · Goal: 75kg · Height: 175cm
// 1kg fat ≈ 7700 kcal deficit
// ═══════════════════════════════════════════════════════════════════
const GOAL_START_WEIGHT = 102.1;
const GOAL_TARGET_WEIGHT = 75;
const GOAL_TOTAL_KG = GOAL_START_WEIGHT - GOAL_TARGET_WEIGHT; // 27.1kg
const GOAL_TOTAL_KCAL = Math.round(GOAL_TOTAL_KG * 7700);    // 208,670 kcal
const KCAL_PER_DAY_DEFICIT = 500; // realistic daily deficit

function updateGoalCounter() {
  const elLeft    = document.getElementById('gcKcalLeft');
  const elKgLeft  = document.getElementById('gcKgLeft');
  const elPct     = document.getElementById('gcPct');
  const elDays    = document.getElementById('gcDays');
  const elBar     = document.getElementById('gcBar');
  const elCurrent = document.getElementById('gcCurrentWeight');
  const elMiles   = document.getElementById('gcMilestones');
  if (!elLeft) return;

  // Get current weight — from today's entry or latest recorded
  let currentWeight = GOAL_START_WEIGHT;
  // Search DB for most recent weight entry
  const dates = Object.keys(DB).sort().reverse();
  for (const d of dates) {
    const w = parseFloat(DB[d].weight);
    if (w && w > 40 && w < 300) { currentWeight = w; break; }
  }

  const kgLost   = GOAL_START_WEIGHT - currentWeight;
  const kgLeft   = Math.max(0, currentWeight - GOAL_TARGET_WEIGHT);
  const kcalLeft = Math.round(kgLeft * 7700);
  const pct      = Math.min(100, Math.max(0, (kgLost / GOAL_TOTAL_KG) * 100));
  const daysLeft = Math.round(kcalLeft / KCAL_PER_DAY_DEFICIT);

  // Format large numbers
  const fmt = n => n >= 1000 ? (n/1000).toFixed(1) + 'k' : n.toString();

elLeft.textContent    = fmt(kcalLeft);
elKgLeft.textContent  = kgLeft.toFixed(1);
elPct.textContent     = pct.toFixed(1) + '%';
elDays.textContent    = daysLeft;
  elBar.style.width     = pct.toFixed(1) + '%';
  elCurrent.textContent = currentWeight.toFixed(1) + ' kg (atual)';

  // Update title dynamically
  const titleEl = document.querySelector('#goalCounter .goal-counter-title');
  if (titleEl) titleEl.textContent = '🎯 objetivo de peso — ' + currentWeight.toFixed(1) + ' kg → 75 kg';

  // Milestones every 5kg
  const milestones = [];
  for (let m = 100; m >= 75; m -= 5) {
    const reached = currentWeight <= m;
    milestones.push({ label: m + ' kg', reached });
  }
  if (elMiles) {
    elMiles.innerHTML = milestones.map(m =>
      `<span class="goal-milestone ${m.reached ? 'reached' : ''}">${m.reached ? '✓ ' : ''}${m.label}</span>`
    ).join('');
  }
}

// ═══════════════════════════════════════════════════════════════════
// DINNER ADVISOR — personalizado para perda de peso >20kg
// Meta calórica: ~1400-1600 kcal/dia (défice para >100kg)
// Jantar recomendado: 19h-20h
// ═══════════════════════════════════════════════════════════════════

const DIET_PROFILE = {
  goalCal: 1500,        // meta diária para perda de peso
  maxDinnerCal: 350,    // jantar máximo recomendado
  lightDinnerCal: 200,  // jantar leve ideal
  dinnerHour: 19.5,     // hora alvo do jantar (19h30)
};

function calcTotalSoFar() {
  const bk = (meals.breakfast||[]).reduce((s,m) => s+(m.cal||0), 0);
  const lu = (meals.lunch||[]).reduce((s,m) => s+(m.cal||0), 0);
  const sn = (meals.snacks||[]).reduce((s,m) => s+(m.cal||0), 0);
  return {breakfast:bk, lunch:lu, snacks:sn, total:bk+lu+sn};
}

function updateDinnerAdvisor() {
  const el = document.getElementById('dinnerAdvisor');
  const emojiEl = document.getElementById('advisorEmoji');
  const titleEl = document.getElementById('advisorTitle');
  const subEl = document.getElementById('advisorSub');
  const reasonEl = document.getElementById('advisorReasoning');
  const suggEl = document.getElementById('advisorSuggestion');
  const statsEl = document.getElementById('advisorStats');
  if (!el) return;

  const now = new Date();
  const hour = now.getHours() + now.getMinutes()/60;
  const {breakfast, lunch, snacks, total} = calcTotalSoFar();
  const dinnerItems = (meals.dinner||[]);
  const dinnerCal = dinnerItems.reduce((s,m) => s+(m.cal||0), 0);
  const grandTotal = total + dinnerCal;
  const remaining = DIET_PROFILE.goalCal - total;

  // Update stats bar
  statsEl.innerHTML = `
    <div class="advisor-stat"><strong>${total}</strong>kcal consumidas</div>
    <div class="advisor-stat"><strong>${DIET_PROFILE.goalCal}</strong>kcal meta diária</div>
    <div class="advisor-stat" style="color:${remaining>0?'var(--moss)':'var(--rose'})"><strong style="color:${remaining>0?'var(--moss)':'#c04'}">${Math.abs(remaining)}</strong>kcal ${remaining>0?'disponíveis':'acima da meta'}</div>
    ${dinnerCal>0?`<div class="advisor-stat"><strong>${dinnerCal}</strong>kcal no jantar</div>`:''}
  `;

  // Already ate dinner
  if (dinnerCal > 0) {
    if (grandTotal <= DIET_PROFILE.goalCal) {
      el.className = 'dinner-advisor go';
      emojiEl.textContent = '✅';
      titleEl.textContent = 'Jantar dentro da meta!';
      subEl.textContent = grandTotal + ' kcal no total hoje';
      reasonEl.textContent = 'Ótimo trabalho! O teu jantar ficou dentro do plano. Total do dia: ' + grandTotal + ' kcal de ' + DIET_PROFILE.goalCal + ' kcal.';
      suggEl.style.display = 'none';
    } else {
      el.className = 'dinner-advisor warn';
      emojiEl.textContent = '⚠️';
      titleEl.textContent = 'Ultrapassaste a meta hoje';
      subEl.textContent = (grandTotal - DIET_PROFILE.goalCal) + ' kcal acima do plano';
      reasonEl.textContent = 'Hoje ficaste ' + (grandTotal - DIET_PROFILE.goalCal) + ' kcal acima da meta. Não te preocupes — amanhã compensas comendo um pouco menos. Uma gelatina sem açúcar ao final do dia ajuda a saciar sem calorias.';
      suggEl.style.display = 'block';
      suggEl.innerHTML = '💡 Amanhã tenta manter o almoço abaixo de ' + Math.round(DIET_PROFILE.goalCal * 0.45) + ' kcal para compensar.';
    }
    return;
  }

  // No dinner yet — give recommendation
  if (total === 0 && breakfast === 0 && lunch === 0) {
    // Nothing recorded yet
    el.className = 'dinner-advisor';
    emojiEl.textContent = '🤔';
    titleEl.textContent = 'Devo jantar hoje?';
    subEl.textContent = 'regista o que comeste para ver a recomendação';
    reasonEl.textContent = 'Regista o teu pequeno almoço e almoço para receber uma recomendação personalizada.';
    suggEl.style.display = 'none';
    return;
  }

  // Logic based on calories consumed and time
  if (total >= DIET_PROFILE.goalCal) {
    // Already at or over goal
    el.className = 'dinner-advisor warn';
    emojiEl.textContent = '🛑';
    titleEl.textContent = 'Salta o jantar hoje';
    subEl.textContent = 'já atingiste a meta calórica do dia';
    reasonEl.textContent = 'Já consumiste ' + total + ' kcal hoje, que é a tua meta de ' + DIET_PROFILE.goalCal + ' kcal. Jantar agora dificultaria a perda de peso. O teu corpo vai usar as reservas durante a noite — isso é exatamente o que queremos!';
    suggEl.style.display = 'block';
    suggEl.innerHTML = '<strong>Alternativa:</strong> Se sentires fome, uma <strong>gelatina sem açúcar</strong> tem apenas 8 kcal e vai saciar. Bebe também um copo de água grande — muitas vezes a fome é sede disfarçada.';

  } else if (total >= DIET_PROFILE.goalCal * 0.85) {
    // Close to goal (85-100%)
    el.className = 'dinner-advisor skip';
    emojiEl.textContent = '⚡';
    titleEl.textContent = 'Jantar muito leve ou salta';
    subEl.textContent = 'apenas ' + remaining + ' kcal disponíveis';
    reasonEl.textContent = 'Já consumiste ' + total + ' kcal. Tens margem para ' + remaining + ' kcal mais — isso é muito pouco para uma refeição normal. Um jantar pesado agora ultrapassaria a meta.';
    suggEl.style.display = 'block';
    suggEl.innerHTML = '<strong>Se jantares:</strong> Opta por <strong>proteína pura</strong> — um bife de peru grelhado (100g) = 135 kcal, sem arroz nem massa. Ou simplesmente uma <strong>gelatina sem açúcar</strong> (8 kcal) e chá.';

  } else if (remaining >= DIET_PROFILE.maxDinnerCal) {
    // Good margin for a proper dinner
    el.className = 'dinner-advisor go';
    emojiEl.textContent = '✅';
    titleEl.textContent = 'Sim, podes jantar!';
    subEl.textContent = 'tens ' + remaining + ' kcal disponíveis';

    // Suggest what to eat based on remaining
    let suggestion = '';
    if (remaining >= 400) {
      suggestion = 'Tens boa margem! Podes fazer uma refeição completa: <strong>bife de frango ou peru grelhado (150g) + salada</strong> = ~200 kcal. Ou <strong>massa/arroz (100g) + proteína</strong>. Evita manteiga extra.';
    } else {
      suggestion = 'Bom espaço para um jantar equilibrado: <strong>bife de peru grelhado (100g) com salada</strong> = ~150 kcal, ou <strong>arroz cozido (100g) + bife de frango (100g)</strong> = ~295 kcal.';
    }

    if (hour > 20.5) {
      reasonEl.textContent = 'Atenção — já são ' + Math.floor(hour) + 'h' + String(Math.round((hour%1)*60)).padStart(2,'0') + '. Jantar tarde atrasa o metabolismo. Se ainda vais jantar, torna-o o mais leve possível.';
    } else {
      reasonEl.textContent = 'Estás dentro do plano! Consumiste ' + total + ' kcal e tens ' + remaining + ' kcal disponíveis para o jantar. Uma boa altura para jantar é agora (antes das 20h).';
    }
    suggEl.style.display = 'block';
    suggEl.innerHTML = '💡 ' + suggestion;

  } else {
    // Some margin but tight
    el.className = 'dinner-advisor skip';
    emojiEl.textContent = '🥗';
    titleEl.textContent = 'Jantar muito leve';
    subEl.textContent = 'apenas ' + remaining + ' kcal disponíveis';
    reasonEl.textContent = 'Tens ' + remaining + ' kcal de margem — suficiente para um jantar muito leve. Uma refeição normal ultrapassaria a meta de hoje.';
    suggEl.style.display = 'block';
    suggEl.innerHTML = '<strong>Opções ideais:</strong> <strong>Bife de peru grelhado (100g)</strong> = 135 kcal · <strong>Gelatina sem açúcar</strong> = 8 kcal · <strong>Salada com frango (100g)</strong> = ~180 kcal. Sem arroz nem massa esta noite.';
  }
}

// ═══════════════════════════════════════════════════════════════════
// GOOGLE SHEETS SYNC
// ═══════════════════════════════════════════════════════════════════

const SHEETS_URL_KEY = 'dvSheetsUrl';
let sheetsUrl = localStorage.getItem(SHEETS_URL_KEY) || '';

function updateSyncStatus(msg, type) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const colors = { ok:'#a0b090', err:'#c08890', ing:'#b89050', off:'#8e9cb4' };
  el.textContent = msg;
  el.style.color = colors[type] || colors.off;
}

function openSyncModal() {
  const modal = document.getElementById('syncModal');
  if (!modal) return;
  const input = document.getElementById('sheetsUrlInput');
  const curEl = document.getElementById('currentSyncUrl');
  if (sheetsUrl) {
    input.value = sheetsUrl;
    if (curEl) curEl.textContent = 'URL configurado';
  } else {
    if (curEl) curEl.textContent = 'Nenhum URL configurado ainda';
  }
  modal.classList.add('open');
}

function closeSyncModal() {
  const modal = document.getElementById('syncModal');
  if (modal) modal.classList.remove('open');
}

function syncToSheets() {
  if (!sheetsUrl) { openSyncModal(); } else { syncAllData(); }
}

async function saveSheetsUrl() {
  const input = document.getElementById('sheetsUrlInput');
  const url = (input.value || '').trim();
  const resultEl = document.getElementById('syncTestResult');
  if (!url || !url.includes('script.google.com')) {
    resultEl.innerHTML = '<span class="sync-badge sync-badge-err">URL invalido</span>';
    return;
  }
  resultEl.innerHTML = '<span class="sync-badge sync-badge-ing">A testar...</span>';
  sheetsUrl = url;
  localStorage.setItem(SHEETS_URL_KEY, url);
  saveSheetsUrlToCloud(url);
  updateSyncStatus('Sheets configurado', 'ok');
  const curEl = document.getElementById('currentSyncUrl');
  if (curEl) curEl.textContent = 'URL guardado';
  resultEl.innerHTML = '<span class="sync-badge sync-badge-ok">URL guardado! A sincronizar...</span>';
  setTimeout(() => { closeSyncModal(); syncAllData(); }, 1000);
}

// ── HELPER: build row object from a day entry ──
function buildRow(date, d) {
  let sleepH = '';
  if (d.bedtime && d.waketime) {
    const [bh,bm] = d.bedtime.split(':').map(Number);
    const [wh,wm] = d.waketime.split(':').map(Number);
    let bM=bh*60+bm, wM=wh*60+wm;
    if (wM<bM) wM+=24*60;
    sleepH = ((wM-bM)/60).toFixed(1);
  }
  let totalCal=0;
  if (d.meals) {
    const mv = typeof d.meals==='object'&&!Array.isArray(d.meals) ? Object.values(d.meals).flat() : d.meals;
    totalCal = mv.reduce((s,m)=>s+(parseInt(m.cal)||0),0);
  }
  const exArr = (typeof QUICK_EXERCISES !== 'undefined') ? QUICK_EXERCISES : [];
  const habDone = d.habitsDone ? Object.values(d.habitsDone).filter(Boolean).length : 0;
  const exDone  = d.habitsDone ? exArr.filter(e=>d.habitsDone[e.id]).length : 0;
  const exKcal  = d.habitsDone ? exArr.filter(e=>d.habitsDone[e.id]).reduce((s,e)=>s+(e.kcal||0),0) : 0;

  // ── Cálculo de horas de trabalho com almoço real ──
  let workH = '', overtimeH = '', lunchMinsReal = '';
  if (d.workStart && d.workEnd) {
    const [sh,sm] = d.workStart.split(':').map(Number);
    const [eh,em] = d.workEnd.split(':').map(Number);
    let lunch = 60; // default
    if (d.lunchStart && d.lunchEnd) {
      const [lsh,lsm] = d.lunchStart.split(':').map(Number);
      const [leh,lem] = d.lunchEnd.split(':').map(Number);
      lunch = Math.max(0, (leh*60+lem) - (lsh*60+lsm));
      lunchMinsReal = lunch;
    }
    const workedMins = (eh*60+em) - (sh*60+sm) - lunch;
    workH = (workedMins/60).toFixed(2);
    const ot = workedMins - 480; // overtime vs 8h
    const sign = ot >= 0 ? '+' : '-';
    const ah = Math.floor(Math.abs(ot)/60), am = Math.abs(ot)%60;
    overtimeH = `${sign}${ah}h${am ? am+'m' : ''}`;
  }

  return {
    data:date, sono_horas:sleepH, sono_qual:d.sleepQual||'', sonhos:d.dreams||'',
    peso_kg:d.weight||'', altura_cm:d.height||'',
    calorias:totalCal||'', agua_copos:d.waterCount||'',
    exercicios:(d.exercises||[]).map(e=>e.name).join('; '),
    habitos_feitos:habDone, exercicios_feitos:exDone, kcal_queimadas:exKcal,
    urinar:(d.counters&&d.counters.urinar)||'', defecar:(d.counters&&d.counters.defecar)||'',
    workStart:d.workStart||'', workEnd:d.workEnd||'',
    lunchStart:d.lunchStart||'', lunchEnd:d.lunchEnd||'', almoco_mins:lunchMinsReal,
    trabalho_h:workH, overtime_dia:overtimeH,
    trabalho_humor:d.workMood||'', trabalho_foco:d.workFocus||'',
    humor:d.selectedMood||'', energia:d.energyLevel||'',
    stress:d.stressLevel||'', ansiedade:d.anxietyLevel||'',
    diario:(d.journalEntry||'').substring(0,500),
    melhor_momento:d.bestMoment||'', gratidao:d.gratitude||'',
    passadeira_tempo:d.treadmillTime||'', passadeira_distancia:d.treadmillDistance||'', passadeira_inclinacao:d.treadmillIncline||'',
    guardado_em:d.savedAt||'',
    n90_score:d.n90Score||'', n90_checks:d.n90Checks||'',
  };
}

// ── ENVIAR dados para Sheets ──
async function syncAllData() {
  if (!sheetsUrl) { openSyncModal(); return; }
  updateSyncStatus('A sincronizar...', 'ing');
  const rows = [];
  for (const [date, d] of Object.entries(DB)) {
    if (!d || !date) continue;
    rows.push(buildRow(date, d));
  }
  if (!rows.length) { updateSyncStatus('Sem dados ainda', 'off'); return; }

  // Calcular banco de horas total para enviar como resumo
  const { totalMins, daysCount } = calcOvertimeBank();
  const otSign = totalMins >= 0 ? '+' : '-';
  const otH = Math.floor(Math.abs(totalMins)/60), otM = Math.abs(totalMins)%60;
  const overtimeBankStr = `${otSign}${otH}h${otM ? otM+'m' : ''} (${daysCount} dias)`;

  try {
    const r = await fetch(sheetsUrl, {
      method:'POST', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({action:'sync', rows, overtimeBank: overtimeBankStr})
    });
    if (r.ok) {
      const t = new Date();
      const ts = t.getHours().toString().padStart(2,'0')+':'+t.getMinutes().toString().padStart(2,'0');
      updateSyncStatus('Sincronizado '+ts, 'ok');
      const bar = document.getElementById('savedBar');
      if (bar) { bar.textContent='✓ Sincronizado com Google Sheets'; bar.classList.add('show'); setTimeout(()=>{bar.classList.remove('show');bar.textContent='Dados guardados';},3000); }
      setTimeout(reloadTodayFromDB, 200);
    } else { throw new Error('HTTP '+r.status); }
  } catch(e) {
    console.error('Sheets sync error:',e);
    const msg = e.message || 'erro desconhecido';
    updateSyncStatus('Erro: ' + msg.substring(0,40), 'err');
  }
}

// ── LER histórico do Sheets e fundir com DB local ──
async function loadFromSheets() {
  if (!sheetsUrl) return;
  updateSyncStatus('A carregar histórico...', 'ing');
  try {
    const url = sheetsUrl + '?action=load';
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP '+r.status);
    const json = await r.json();
    if (!json.ok || !json.rows) throw new Error('Sem dados');

    let imported = 0;
    json.rows.forEach(row => {
      const date = row.data;
      if (!date) return;
      // Só importa dias que não existem localmente (não sobrescreve dados locais)
      if (!DB[date]) {
        DB[date] = {
          bedtime: row.bedtime||'', waketime: row.waketime||'',
          sleepQual: row.sono_qual||'', dreams: row.sonhos||'',
          weight: row.peso_kg||'', height: row.altura_cm||'',
          waterCount: parseInt(row.agua_copos)||0,
          workStart: row.workStart||'', workEnd: row.workEnd||'',
          workMood: row.trabalho_humor||'', workFocus: row.trabalho_foco||'',
          selectedMood: row.humor||'',
          energyLevel: row.energia||'', stressLevel: row.stress||'', anxietyLevel: row.ansiedade||'',
          journalEntry: row.diario||'', bestMoment: row.melhor_momento||'', gratitude: row.gratidao||'',
          treadmillTime: row.passadeira_tempo||'', treadmillDistance: row.passadeira_distancia||'', treadmillIncline: row.passadeira_inclinacao||'',
          savedAt: row.guardado_em||'',
          meals:{breakfast:[],lunch:[],dinner:[],snacks:[]},
          exercises:[], counters:{urinar:0,defecar:0,banho:0,pausas:0,intimacy:0},
          habitsDone:{}, _fromSheets: true,
        };
        imported++;
      }
    });

    if (imported > 0) {
      localStorage.setItem(DB_KEY, JSON.stringify(DB));
      console.log('Sheets: importados ' + imported + ' dias do histórico');
    }

    updateSyncStatus('Histórico carregado', 'ok');
    if (typeof renderStats === 'function') renderStats();
    // Recarregar ecrã com novos dados (setTimeout evita conflitos de stack)
    setTimeout(reloadTodayFromDB, 100);
  } catch(e) {
    console.error('Sheets load error:', e);
    updateSyncStatus('Sheets ligado', 'ok');
  }
}

// Init on load
if (sheetsUrl) {
  updateSyncStatus('Sheets ligado', 'ok');
  // Primeiro carrega histórico, depois sincroniza dados locais
  setTimeout(() => loadFromSheets().then(() => setTimeout(syncAllData, 1000)), 3000);
} else {
  updateSyncStatus('Clica para ligar', 'off');
}

// Modal overlay close
document.getElementById('syncModal').addEventListener('click', function(e){ if(e.target===this) closeSyncModal(); });
document.getElementById('groqModal').addEventListener('click', function(e){ if(e.target===this) closeGroqModal(); });

// ── GROQ KEY MANAGEMENT ──
function openGroqModal() {
  const modal = document.getElementById('groqModal');
  modal.classList.add('open');
  const key = getGroqKey();
  const input = document.getElementById('groqKeyInput');
  if (key) {
    input.value = key.slice(0,8) + '••••••••••••••••';
    document.getElementById('groqKeyStatus').textContent = '✓ Chave configurada';
  } else {
    input.value = '';
    document.getElementById('groqKeyStatus').textContent = '';
  }
}

function closeGroqModal() {
  document.getElementById('groqModal').classList.remove('open');
}

function saveGroqKey() {
  const textarea = document.getElementById('groqKeyInput');
  const rawKeys = (textarea?.value || '').split('\n')
    .map(k => k.trim())
    .filter(k => k.startsWith('gsk_') && k.length > 10);

  const invalid = (textarea?.value || '').split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 3 && !k.startsWith('gsk_'));

  if (invalid.length > 0) {
    document.getElementById('groqKeyStatus').textContent = '⚠ Chaves inválidas: devem começar com gsk_';
    return;
  }
  if (rawKeys.length === 0) {
    document.getElementById('groqKeyStatus').textContent = 'Cola pelo menos uma chave (gsk_...)';
    return;
  }
  setGroqKeys(rawKeys);
  localStorage.setItem('dvGroqKeyIdx', '0');
  const n = rawKeys.length;
  document.getElementById('groqKeyStatus').textContent = `✓ ${n} chave${n>1?'s':''} guardada${n>1?'s':''}! Rotação automática ativa.`;
  document.getElementById('groqConfigBtn').textContent = `✓ IA (${n} chave${n>1?'s':''})`;
  setTimeout(closeGroqModal, 1800);
}

function clearGroqKey() {
  if (!confirm('Remover todas as chaves Groq?')) return;
  localStorage.removeItem('dvGroqKey');
  localStorage.removeItem('dvGroqKeys');
  localStorage.removeItem('dvGroqKeyIdx');
  if (document.getElementById('groqKeyInput')) document.getElementById('groqKeyInput').value = '';
  document.getElementById('groqKeyStatus').textContent = 'Chaves removidas';
  document.getElementById('groqConfigBtn').textContent = '⚙️ Configurar IA';
}

// Update button state on load
if (getGroqKey()) {
  const btn = document.getElementById('groqConfigBtn');
  if (btn) btn.textContent = '✓ IA configurada';
}


// ═══════════════════════════════════════════════════════════════════
// SUPABASE CLIENT & AUTH
// ═══════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://nocafjkyiaigxttwdkei.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JemTyDpY6iPhrpSAemaQDg_ws94_aBm';
let supabaseClient = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch(e) {
  console.error('Erro ao inicializar cliente Supabase:', e);
}

let currentAuthTab = 'login';
function setAuthTab(tab) {
  currentAuthTab = tab;
  const loginBtn = document.getElementById('tabLoginBtn');
  const regBtn = document.getElementById('tabRegisterBtn');
  const confirmBox = document.getElementById('authConfirmBox');
  const submitBtn = document.getElementById('authSubmitBtn');
  const errEl = document.getElementById('authError');
  if (errEl) errEl.textContent = '';

  if (tab === 'login') {
    if (loginBtn) { loginBtn.style.background = 'var(--card)'; loginBtn.style.color = 'var(--text)'; loginBtn.style.fontWeight = '600'; }
    if (regBtn) { regBtn.style.background = 'transparent'; regBtn.style.color = 'var(--muted)'; regBtn.style.fontWeight = '400'; }
    if (confirmBox) confirmBox.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Entrar na Conta';
  } else {
    if (regBtn) { regBtn.style.background = 'var(--card)'; regBtn.style.color = 'var(--text)'; regBtn.style.fontWeight = '600'; }
    if (loginBtn) { loginBtn.style.background = 'transparent'; loginBtn.style.color = 'var(--muted)'; loginBtn.style.fontWeight = '400'; }
    if (confirmBox) confirmBox.style.display = 'block';
    if (submitBtn) submitBtn.textContent = 'Criar Nova Conta';
  }
}

function toggleAuthPwdVisibility() {
  const pwd = document.getElementById('authPassword');
  const eye = document.getElementById('authEyeBtn');
  if (!pwd) return;
  if (pwd.type === 'password') {
    pwd.type = 'text';
    if (eye) eye.textContent = '🙈';
  } else {
    pwd.type = 'password';
    if (eye) eye.textContent = '👁';
  }
}

async function submitAuthForm() {
  const email = (document.getElementById('authEmail')?.value || '').trim();
  const password = document.getElementById('authPassword')?.value || '';
  const confirmPwd = document.getElementById('authConfirmPassword')?.value || '';
  const errEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmitBtn');

  if (errEl) errEl.textContent = '';

  if (!email || !password) {
    if (errEl) errEl.textContent = 'Por favor preenche o email e a palavra-passe.';
    return;
  }

  if (!supabaseClient) {
    if (errEl) errEl.textContent = 'Supabase indisponível. Podes aceder pelo modo local abaixo.';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.textContent = 'A processar...';
  }

  try {
    if (currentAuthTab === 'register') {
      if (password.length < 6) {
        throw new Error('A palavra-passe deve ter pelo menos 6 caracteres.');
      }
      if (password !== confirmPwd) {
        throw new Error('As palavras-passe não coincidem.');
      }

      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
      });

      if (error) throw error;

      if (data.session) {
        onUserAuthenticated(data.user);
      } else {
        if (errEl) {
          errEl.style.color = 'var(--sage-l)';
          errEl.textContent = '✓ Conta criada com sucesso! A iniciar sessão...';
        }
        const { data: logData, error: logErr } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (!logErr && logData.user) {
          onUserAuthenticated(logData.user);
        }
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
      if (data.user) {
        onUserAuthenticated(data.user);
      }
    }
  } catch (err) {
    console.error('Erro de autenticação:', err);
    if (errEl) {
      errEl.style.color = 'var(--rose)';
      let msg = err.message || 'Erro ao autenticar.';
      if (msg.includes('Invalid login credentials')) msg = 'Email ou palavra-passe incorretos.';
      if (msg.includes('User already registered')) msg = 'Este email já está registado. Tenta fazer login.';
      errEl.textContent = msg;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.textContent = currentAuthTab === 'register' ? 'Criar Nova Conta' : 'Entrar na Conta';
    }
  }
}

function handleLocalGuestLogin() {
  localStorage.setItem('dvGuestMode', 'true');
  showApp({ email: 'Convidado' });
}

async function onUserAuthenticated(user) {
  localStorage.removeItem('dvGuestMode');
  // Se entrou um utilizador diferente neste dispositivo, limpa os dados locais do anterior
  const lastUser = localStorage.getItem('dvLastUserId');
  if (lastUser && user && user.id && lastUser !== user.id) {
    ['dvLifeDiary_v3', 'dvSheetsUrl', 'dvAvatar', 'dvSyncQueue', 'dvSyncMeta', 'diarioVida',
     'dvReminders', 'dvAiProvider', 'dvOpenRouterModel', 'dvAchievements', 'dvPerfil', 'dvTreadmillPlan', 'dvTreadmillPlanChat', 'dvAiChatHistory'].forEach(k => localStorage.removeItem(k));
    clearByokKeys(false);
    localStorage.setItem('dvLastUserId', user.id);
    location.reload();
    return;
  }
  window._firstLoginOnDevice = !lastUser;
  if (user && user.id) localStorage.setItem('dvLastUserId', user.id);
  showApp(user);
  await SyncManager.recover();          // envia primeiro o que ficou pendente
  await loadFromSupabase();
  await loadConfigFromCloud();
  await loadSheetsUrlFromCloud();
  await initCompetition();
}

function showApp(user) {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appContent').style.display = 'block';
  document.body.classList.add('app-ready');

  const userEmail = (user && user.email) ? user.email : (localStorage.getItem('dvGuestMode') ? 'Convidado' : '');
  const userLabel = document.getElementById('sidebarUserEmail');
  if (userLabel) userLabel.textContent = userEmail;
  const userBox = document.getElementById('sidebarUserBox');
  if (userBox) userBox.title = userEmail;

  SyncManager.setGuest(!(user && user.id));
  restoreFields();
  try { applyPerfilToForm(); } catch (e) {}
  renderDailyFlow();
  setTimeout(force24hInputs, 200);
}

async function logout() {
  let hadSession = false;
  if (supabaseClient) {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      hadSession = !!(session && session.user);
    } catch(e) {}
  }
  if (hadSession) {
    // 1) enviar o que está pendente; 2) só sair se tudo foi confirmado
    showSavedBar('⏳ A enviar alterações pendentes…');
    const ok = await SyncManager.flushAll(20000);
    if (!ok) {
      const n = SyncManager.pendingCount();
      showSaveResult('error');
      alert('⚠ Não foi possível enviar ' + n + ' alteração(ões) para a nuvem.\n\nPor segurança não terminei a sessão e os dados continuam neste dispositivo. Verifica a ligação e tenta outra vez.');
      if (confirm('Queres descarregar uma cópia de segurança (ficheiro JSON) dos teus dados?')) { try { exportData(); } catch(e) {} }
      return;
    }
    const orphans = SyncManager.unsyncedLocalDays();
    if (orphans.length && !confirm('Há ' + orphans.length + ' dia(s) que só existem neste dispositivo (não estão na nuvem). Se saíres, serão apagados daqui.\n\nSair mesmo assim?')) return;
    try { await supabaseClient.auth.signOut(); } catch(e) {}
  }
  localStorage.removeItem('dvGuestMode');
  if (hadSession) {
    // Tudo confirmado na nuvem: limpa a cópia local para não ficar no dispositivo
    ['dvLifeDiary_v3', 'dvSheetsUrl', 'dvAvatar', 'dvSyncQueue', 'dvSyncMeta', 'diarioVida', 'dvLastUserId',
     'dvReminders', 'dvAiProvider', 'dvOpenRouterModel', 'dvAchievements', 'dvPerfil', 'dvTreadmillPlan', 'dvTreadmillPlanChat', 'dvAiChatHistory'].forEach(k => localStorage.removeItem(k));
    clearByokKeys(false);
    location.reload();
    return;
  }
  document.getElementById('appContent').style.display = 'none';
  document.getElementById('authOverlay').style.display = 'flex';
  document.body.classList.remove('app-ready');
  const emailInput = document.getElementById('authEmail');
  const pwdInput = document.getElementById('authPassword');
  const errEl = document.getElementById('authError');
  if (emailInput) emailInput.value = '';
  if (pwdInput) pwdInput.value = '';
  if (errEl) errEl.textContent = '';
}

// ── SINCRONIZAÇÃO DA BASE DE DADOS COM SUPABASE ──
async function loadFromSupabase() {
  if (!supabaseClient) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !session.user) return;

    let res = await supabaseClient.from('diario_registos').select('data, dados, versao').order('data', { ascending: true });
    if (res.error) {   // coluna «versao» ainda não existe (SQL novo por executar)
      res = await supabaseClient.from('diario_registos').select('data, dados').order('data', { ascending: true });
    }
    if (res.error) {
      console.error('Supabase load error:', res.error);
      return;
    }

    const remoteDates = new Set();
    (res.data || []).forEach(row => {
      if (row.data && row.dados) {
        remoteDates.add(row.data);
        SyncManager.adoptRemote(row.data, row.dados, row.versao);
      }
    });
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch(e) {}
    await SyncManager.reconcileLocal(remoteDates);
    reloadTodayFromDB();
    if (typeof renderStats === 'function') renderStats();
  } catch(e) {
    console.error('Erro ao sincronizar do Supabase:', e);
  }
}

async function saveToSupabase(date, snap) {
  if (!supabaseClient) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !session.user) return;

    const { error } = await supabaseClient
      .from('diario_registos')
      .upsert({
        user_id: session.user.id,
        data: date,
        dados: snap,
        atualizado_em: new Date().toISOString()
      }, { onConflict: 'user_id,data' });

    if (error) {
      console.error('Supabase upsert error:', error);
    }
  } catch(e) {
    console.error('Supabase save error:', e);
  }
}

// ── LINK DO GOOGLE SHEETS GUARDADO NA CONTA (Supabase, tabela diario_perfil) ──
function saveSheetsUrlToCloud(url) {
  return SyncManager.saveProfile({ sheets_url: url || null });
}

async function loadSheetsUrlFromCloud() {
  if (!supabaseClient) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !session.user) return;
    const { data, error } = await supabaseClient
      .from('diario_perfil')
      .select('sheets_url')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) { console.error('Supabase perfil load error:', error); return; }

    const cloudUrl = (data && data.sheets_url) ? data.sheets_url : '';
    const input = document.getElementById('sheetsUrlSettingsInput');
    if (cloudUrl) {
      if (cloudUrl !== sheetsUrl) {
        sheetsUrl = cloudUrl;
        localStorage.setItem(SHEETS_URL_KEY, cloudUrl);
        if (input) input.value = cloudUrl;
        updateSyncStatus('Sheets ligado', 'ok');
        loadFromSheets().then(() => setTimeout(syncAllData, 1000));
      }
    } else if (data) {
      // A conta tem o perfil mas sem link: o link foi removido noutro dispositivo
      sheetsUrl = '';
      localStorage.removeItem(SHEETS_URL_KEY);
      if (input) input.value = '';
      updateSyncStatus('Clica para ligar', 'off');
    } else if (sheetsUrl) {
      // Conta sem perfil ainda: guarda o link que já existia neste dispositivo
      saveSheetsUrlToCloud(sheetsUrl);
    }
  } catch(e) {
    console.error('Erro ao carregar o link do Sheets da conta:', e);
  }
}

// ── VERSÃO DA APP E ATUALIZAÇÃO FORÇADA (limpa a cache do service worker; não apaga registos) ──
var APP_VERSION = '2026.10.30.5';
var APP_BUILT = '30 out 2026';
(function() {
  const el = document.getElementById('appVersionLabel');
  if (el) el.textContent = APP_VERSION + ' · ' + APP_BUILT;
})();

async function forceUpdateApp() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch(e) {
    console.error('Erro ao limpar a cache:', e);
  }
  try {
    const url = new URL(location.href);
    url.searchParams.set('fresh', Date.now().toString(36));
    location.replace(url.toString());
    return;
  } catch (e) {}
  location.reload();
}

// ── PASSADEIRA: registar o treino de qualquer dia (interativo) ──
function tmNum(id) {
  const el = document.getElementById(id);
  const v = el ? parseFloat(el.value) : NaN;
  return isNaN(v) ? 0 : v;
}
function tmDateOffset(n) {
  const p = TODAY.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2] - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tmSetDay(date) {
  document.getElementById('tmDate').value = date;
  loadTreadmillDay();
  const section = document.getElementById('section-treadmill');
  if (section && !section.classList.contains('active')) {
    showSection('treadmill', navBySection('treadmill'));
    const field = document.getElementById('tmDate');
    if (field && field.closest('.card')) field.closest('.card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}
function tmUpdateChips() {
  const cur = document.getElementById('tmDate').value;
  for (let i = 0; i < 3; i++) {
    const c = document.getElementById('tmChip' + i);
    if (c && c.classList) c.classList.toggle('active', cur === tmDateOffset(i));
  }
}
function tmStep(id, delta, min, max, dec) {
  const el = document.getElementById(id);
  let v = parseFloat(el.value); if (isNaN(v)) v = 0;
  const f = Math.pow(10, dec);
  v = Math.min(max, Math.max(min, Math.round((v + delta) * f) / f));
  el.value = v;
  tmUpdateLive();
}
function tmChip(id, v) {
  document.getElementById(id).value = v;
  tmUpdateLive();
}
// Estimativa de energia (equações ACSM, acima do repouso): indicativa, não é uma medição
function tmKcal(t, d, inc) {
  const lw = latestWeightEntry(); const W = lw ? lw.w : 0;
  if (!(W > 0 && t > 0 && d > 0)) return 0;
  const kmh = d / (t / 60), s = kmh * 1000 / 60, g = inc / 100;
  const vo2 = kmh < 7 ? (0.1 * s + 1.8 * s * g) : (0.2 * s + 0.9 * s * g);
  return vo2 * W / 1000 * 5 * t;
}
function tmUpdateLive() {
  const t = tmNum('tmTime'), d = tmNum('tmDist'), inc = tmNum('tmIncl');
  const speed = (t > 0 && d > 0) ? d / (t / 60) : 0;
  const txt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  txt('tmSpeed', speed ? speed.toFixed(1) : '—');
  if (speed) {
    const pace = 60 / speed; let pm = Math.floor(pace), ps = Math.round((pace - pm) * 60);
    if (ps === 60) { pm++; ps = 0; }
    txt('tmPace', pm + ':' + String(ps).padStart(2, '0'));
  } else txt('tmPace', '—');
  const k = tmKcal(t, d, inc);
  txt('tmKcal', k ? Math.round(k) : '—');
  txt('tmInclLabel', 'inclinação ' + (inc || 0) + '%');
  const st = document.getElementById('tmStage');
  if (st && st.style && typeof st.style.setProperty === 'function') {
    st.style.setProperty('--tm-angle', Math.min(inc * 1.6, 30) + 'deg');
    st.style.setProperty('--tm-dur', (speed ? Math.max(0.12, 3.6 / speed) : 1).toFixed(2) + 's');
    st.style.setProperty('--tm-bounce', (speed ? Math.max(0.25, 4.2 / speed) : 0.7).toFixed(2) + 's');
    st.style.setProperty('--tm-play', speed ? 'running' : 'paused');
  }
}
function tmRenderWeek() {
  const bars = document.getElementById('tmBars'); if (!bars) return;
  const sel = document.getElementById('tmDate').value || TODAY;
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(tmDateOffset(i));
  const km = days.map(d => parseFloat((DB[d] || {}).treadmillDistance) || 0);
  const mins = days.map(d => parseFloat((DB[d] || {}).treadmillTime) || 0);
  const sessions = days.filter((d, i) => km[i] > 0 || mins[i] > 0).length;
  const txt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  txt('tmWeekKm', (Math.round(km.reduce((a, b) => a + b, 0) * 10) / 10).toString());
  txt('tmWeekSessions', String(sessions));
  txt('tmWeekMin', String(Math.round(mins.reduce((a, b) => a + b, 0))));
  const max = Math.max.apply(null, km.concat([0.1]));
  bars.innerHTML = days.map((d, i) => {
    const p = d.split('-').map(Number);
    const wd = new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('pt-PT', { weekday: 'short' }).replace('.', '').slice(0, 3);
    const h = km[i] > 0 ? Math.max(6, Math.round(km[i] / max * 80)) : 3;
    return '<button type="button" class="tm-bar' + (d === sel ? ' sel' : '') + '" onclick="tmSetDay(\'' + d + '\')" title="' + p[2] + '/' + p[1] + ' · ' + km[i] + ' km">' +
           '<span>' + (km[i] > 0 ? km[i] : '') + '</span><i style="height:' + h + 'px"></i><span>' + wd + '</span></button>';
  }).join('');
  tmRenderStats();
  tmRenderProgress();
  tmRenderPlanCards();
}
function tmPrevDate(d) {
  const p = d.split('-').map(Number);
  const dt = new Date(p[0], p[1] - 1, p[2] - 1);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function tmComputeStats() {
  const trained = d => DB[d] && (parseFloat(DB[d].treadmillTime) > 0 || parseFloat(DB[d].treadmillDistance) > 0);
  const dates = Object.keys(DB).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && trained(d)).sort();
  let km = 0, min = 0, bestSpeed = 0, longest = 0;
  dates.forEach(d => {
    const t = parseFloat(DB[d].treadmillTime) || 0;
    const k = parseFloat(DB[d].treadmillDistance) || 0;
    km += k; min += t;
    if (t > 0 && k > 0) bestSpeed = Math.max(bestSpeed, k / (t / 60));
    longest = Math.max(longest, t);
  });
  let streak = 0;
  let cursor = trained(TODAY) ? TODAY : tmDateOffset(1);
  while (trained(cursor)) { streak++; cursor = tmPrevDate(cursor); }
  return { sessions: dates.length, km, min, bestSpeed, longest, streak };
}
function tmRenderStats() {
  const s = tmComputeStats();
  const txt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  txt('tmStatSessions', String(s.sessions));
  txt('tmStatKm', String(Math.round(s.km * 10) / 10));
  txt('tmStatMin', String(Math.round(s.min)));
  txt('tmStatBestSpeed', s.bestSpeed ? s.bestSpeed.toFixed(1) : '—');
  txt('tmStatLongest', s.longest ? Math.round(s.longest) + ' min' : '—');
  txt('tmStatStreak', String(s.streak));
}
function tmIsoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tmNextDate(d) {
  const p = d.split('-').map(Number);
  return tmIsoDate(new Date(p[0], p[1] - 1, p[2] + 1));
}
function tmWeeklySeries(weeks) {
  const p = TODAY.split('-').map(Number);
  const base = new Date(p[0], p[1] - 1, p[2]);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay() - i * 7);
    let km = 0, min = 0, sessions = 0;
    for (let j = 0; j < 7; j++) {
      const key = tmIsoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + j));
      const x = DB[key];
      if (!x) continue;
      const t = parseFloat(x.treadmillTime) || 0;
      const k = parseFloat(x.treadmillDistance) || 0;
      if (t > 0 || k > 0) { sessions++; km += k; min += t; }
    }
    out.push({ km, min, sessions, label: String(start.getDate()).padStart(2, '0') + '/' + String(start.getMonth() + 1).padStart(2, '0') });
  }
  return out;
}
function tmBestStreak() {
  const trained = d => DB[d] && (parseFloat(DB[d].treadmillTime) > 0 || parseFloat(DB[d].treadmillDistance) > 0);
  const dates = Object.keys(DB).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && trained(d)).sort();
  let best = 0, cur = 0, prev = null;
  dates.forEach(d => {
    cur = (prev && tmNextDate(prev) === d) ? cur + 1 : 1;
    if (cur > best) best = cur;
    prev = d;
  });
  return best;
}
function tmComputeRecords() {
  let bestSpeed = 0, bestKm = 0, longest = 0, days = 0;
  Object.keys(DB).forEach(d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !DB[d]) return;
    const t = parseFloat(DB[d].treadmillTime) || 0;
    const k = parseFloat(DB[d].treadmillDistance) || 0;
    if (t > 0 || k > 0) days++;
    if (t > 0 && k > 0) bestSpeed = Math.max(bestSpeed, k / (t / 60));
    bestKm = Math.max(bestKm, k);
    longest = Math.max(longest, t);
  });
  const bestWeek = tmWeeklySeries(260).reduce((m, w) => Math.max(m, w.km), 0);
  return { bestSpeed, bestKm, longest, days, bestWeek };
}
function tmRenderRecords() {
  const r = tmComputeRecords();
  const txt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  txt('tmRecSpeed', r.bestSpeed ? r.bestSpeed.toFixed(1) : '—');
  txt('tmRecKm', r.bestKm ? (Math.round(r.bestKm * 10) / 10) + ' km' : '—');
  txt('tmRecLongest', r.longest ? Math.round(r.longest) + ' min' : '—');
  txt('tmRecWeek', r.bestWeek ? (Math.round(r.bestWeek * 10) / 10) + ' km' : '—');
  txt('tmRecSessions', String(tmComputeStats().sessions));
  txt('tmRecDays', String(r.days));
}
function tmWeeklyGoals() {
  const week = tmCurrentWeekStats();
  const items = tmCurrentPlan()
    ? tmParsePlan(tmCurrentPlan().text).filter(it => !it.rest && (it.distance || it.minutes) && tmInCurrentWeek(it.date))
    : [];
  const target = tmGetCriteria().targetKm;
  const plannedKm = items.reduce((s, it) => s + (it.distance || 0), 0);
  return {
    sessionsDone: week.active.length,
    sessionsGoal: items.length || 3,
    kmDone: week.totalDist,
    kmGoal: target > 0 ? target : Math.round(plannedKm * 10) / 10
  };
}
function tmRenderGoals() {
  const g = tmWeeklyGoals();
  const s = tmComputeStats();
  const set = (lbl, pct, bar, done, goal, unit) => {
    const p = goal > 0 ? Math.min(100, Math.round(done / goal * 100)) : 0;
    const l = document.getElementById(lbl); if (l) l.textContent = (Math.round(done * 10) / 10) + ' / ' + goal + ' ' + unit;
    const pe = document.getElementById(pct); if (pe) pe.textContent = p + '%';
    const b = document.getElementById(bar); if (b) b.style.width = p + '%';
  };
  set('tmGoalSessionsLbl', 'tmGoalSessionsPct', 'tmGoalSessionsBar', g.sessionsDone, g.sessionsGoal, 'treinos');
  set('tmGoalKmLbl', 'tmGoalKmPct', 'tmGoalKmBar', g.kmDone, g.kmGoal, 'km');
  const st = document.getElementById('tmGoalStreak'); if (st) st.textContent = String(s.streak);
  const bs = document.getElementById('tmGoalBestStreak'); if (bs) bs.textContent = String(tmBestStreak());
}
function tmAchievements() {
  const s = tmComputeStats();
  const r = tmComputeRecords();
  return [
    { icon: '🏃', label: 'Primeiro treino', done: s.sessions >= 1 },
    { icon: '🔟', label: '10 treinos', done: s.sessions >= 10 },
    { icon: '💪', label: '50 treinos', done: s.sessions >= 50 },
    { icon: '🛣️', label: '50 km', done: s.km >= 50 },
    { icon: '🚀', label: '200 km', done: s.km >= 200 },
    { icon: '⚡', label: '10 km/h', done: r.bestSpeed >= 10 },
    { icon: '🔥', label: '7 dias seguidos', done: tmBestStreak() >= 7 },
    { icon: '⏱️', label: '60 min seguidos', done: r.longest >= 60 }
  ];
}
function tmRenderAchievements() {
  const box = document.getElementById('tmAchievements');
  if (!box) return;
  box.innerHTML = tmAchievements().map(a =>
    '<span class="tm-ach' + (a.done ? ' on' : '') + '" title="' + (a.done ? 'Conquistado' : 'Ainda não conquistado') + '">' +
    a.icon + ' ' + tmEsc(a.label) + '</span>'
  ).join('');
}
function tmRenderWeeklyEvolution() {
  const box = document.getElementById('tmWeekBars');
  if (!box) return;
  const series = tmWeeklySeries(8);
  const max = Math.max.apply(null, series.map(w => w.km).concat([0.1]));
  box.innerHTML = series.map((w, i) => {
    const h = w.km > 0 ? Math.max(6, Math.round(w.km / max * 76)) : 3;
    const kmTxt = Math.round(w.km * 10) / 10;
    return '<div class="tm-week-bar' + (i === series.length - 1 ? ' cur' : '') +
      '" title="semana de ' + w.label + ' · ' + kmTxt + ' km · ' + Math.round(w.min) + ' min · ' + w.sessions + ' treinos">' +
      '<span>' + (w.km > 0 ? kmTxt : '') + '</span>' +
      '<i style="height:' + h + 'px"></i><span>' + w.label + '</span></div>';
  }).join('');
  const trend = document.getElementById('tmWeekTrend');
  if (trend) {
    const last = series[series.length - 1], prev = series[series.length - 2];
    const parts = [];
    parts.push(last && last.sessions
      ? 'esta semana: ' + (Math.round(last.km * 10) / 10) + ' km em ' + last.sessions + ' treino(s)'
      : 'esta semana ainda sem treinos');
    if (prev && prev.km > 0) {
      const diff = Math.round((last.km - prev.km) * 10) / 10;
      parts.push((diff >= 0 ? '+' : '') + diff + ' km vs semana anterior');
    }
    trend.textContent = parts.join(' · ');
  }
}
function tmRenderProgress() {
  tmRenderGoals();
  tmRenderRecords();
  tmRenderAchievements();
  tmRenderWeeklyEvolution();
}
function tmCompletePlanned(date, dist, min) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || date > TODAY) return;
  const D = parseFloat(dist) || 0, M = parseFloat(min) || 0;
  if (!D && !M) { alert('Este dia do plano não tem distância nem tempo definidos. Preenche à mão.'); return; }
  const snap = Object.assign({}, DB[date] || {});
  if (M) snap.treadmillTime = String(M);
  if (D) snap.treadmillDistance = String(D);
  if (!snap.savedAt) snap.savedAt = new Date().toISOString();
  DB[date] = snap;
  if (date === TODAY && typeof DAY === 'object' && DAY) {
    if (M) DAY.treadmillTime = String(M);
    if (D) DAY.treadmillDistance = String(D);
  }
  try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
  const syncP = SyncManager.saveDay(date);
  showSavedBar('⏳ A guardar…');
  syncP.then(r => showSaveResult(r));
  tmCelebrate('✓ Treino do plano registado' + (D ? ' · ' + D + ' km' : '') + (M ? ' · ' + M + ' min' : '') + '!');
  if (document.getElementById('tmDate') && document.getElementById('tmDate').value === date) loadTreadmillDay();
  else renderTreadmillHistory();
  tmRenderWeek();
}
function initTreadmill() {
  const d = document.getElementById('tmDate');
  if (!d) return;
  d.max = TODAY;
  if (!d.value) d.value = TODAY;
  loadTreadmillDay();
  tmLoadCriteriaForm();
  tmRenderSavedPlan();
}
function loadTreadmillDay() {
  const date = document.getElementById('tmDate').value || TODAY;
  const day = DB[date] || {};
  document.getElementById('tmTime').value = day.treadmillTime || '';
  document.getElementById('tmDist').value = day.treadmillDistance || '';
  document.getElementById('tmIncl').value = day.treadmillIncline || '';
  const rec = document.getElementById('tmRecord'); if (rec) rec.style.display = 'none';
  tmUpdateLive(); tmUpdateChips(); tmRenderWeek();
  renderTreadmillHistory();
}
function tmCelebrate(text) {
  const el = document.getElementById('tmRecord'); if (!el) return;
  el.textContent = text; el.style.display = 'block';
  clearTimeout(tmCelebrate._t);
  tmCelebrate._t = setTimeout(() => { el.style.display = 'none'; }, 8000);
}

function saveTreadmill(clear) {
  const date = (document.getElementById('tmDate').value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > TODAY) {
    alert('Escolhe um dia válido (não pode ser no futuro).');
    return;
  }
  const time = clear ? '' : document.getElementById('tmTime').value;
  const dist = clear ? '' : document.getElementById('tmDist').value;
  const incl = clear ? '' : document.getElementById('tmIncl').value;
  if (!clear && !time && !dist && !incl) { alert('Preenche pelo menos um campo.'); return; }

  // recorde pessoal de distância (antes de gravar)
  const prevBest = Object.keys(DB).filter(d => d !== date).reduce((m, d) => Math.max(m, parseFloat((DB[d] || {}).treadmillDistance) || 0), 0);

  const snap = Object.assign({}, DB[date] || {});
  snap.treadmillTime = time; snap.treadmillDistance = dist; snap.treadmillIncline = incl;
  if (!snap.savedAt) snap.savedAt = new Date().toISOString();
  DB[date] = snap;
  if (date === TODAY && typeof DAY === 'object' && DAY) {
    DAY.treadmillTime = time; DAY.treadmillDistance = dist; DAY.treadmillIncline = incl;
  }
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  } catch(e) {
    const keys = Object.keys(DB).sort();
    const old = keys.find(d => d !== date && !SyncManager.isPending(d));
    if (keys.length > 90 && old) delete DB[old];
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch(e2) {}
  }
  const syncP = SyncManager.saveDay(date);
  showSavedBar('⏳ A guardar…');
  syncP.then(r => {
    showSaveResult(r);
    const km = parseFloat(dist) || 0;
    if (!clear && (r === 'cloud' || r === 'local') && km > 0 && km > prevBest && prevBest > 0) {
      tmCelebrate('🏆 Novo recorde de distância: ' + km + ' km!');
    }
  });
  if (typeof sheetsUrl !== 'undefined' && sheetsUrl) setTimeout(syncAllData, 600);
  tmUpdateLive(); tmRenderWeek();
  renderTreadmillHistory();
}

function pickTreadmillDay(date) { tmSetDay(date); }

function renderTreadmillHistory() {
  const box = document.getElementById('tmHistory');
  if (!box) return;
  const rows = Object.keys(DB)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && DB[d] && (parseFloat(DB[d].treadmillDistance) > 0 || parseFloat(DB[d].treadmillTime) > 0))
    .sort().reverse().slice(0, 14);
  if (!rows.length) {
    box.innerHTML = '<div style="color:var(--muted);font-size: calc(13px * var(--font-scale));">Ainda não há treinos registados.</div>';
    return;
  }
  const fmt = v => { const n = parseFloat(v); return n > 0 ? n : '—'; };
  box.innerHTML = rows.map(d => {
    const x = DB[d]; const p = d.split('-');
    const t = parseFloat(x.treadmillTime), k = parseFloat(x.treadmillDistance);
    const sp = (t > 0 && k > 0) ? ' · ' + (k / (t / 60)).toFixed(1) + ' km/h' : '';
    return '<div onclick="pickTreadmillDay(\'' + d + '\')" style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size: calc(13px * var(--font-scale));">' +
      '<span>' + p[2] + '/' + p[1] + '/' + p[0] + '</span>' +
      '<span style="color:var(--text2);">' + fmt(x.treadmillTime) + ' min · ' + fmt(x.treadmillDistance) + ' km · ' + fmt(x.treadmillIncline) + '%' + sp + '</span>' +
      '</div>';
  }).join('');
}

const TM_PLAN_KEY = 'dvTreadmillPlan';
const TM_PLAN_CHAT_KEY = 'dvTreadmillPlanChat';
const TM_CRITERIA_KEY = 'dvTreadmillCriteria';
const TM_GOAL_LABELS = {
  manter: 'manter a forma',
  perder: 'perder peso / queimar calorias',
  resistencia: 'ganhar resistência',
  ritmo: 'melhorar ritmo e velocidade',
  distancia: 'preparar uma distância concreta'
};
const TM_PLAN_CHAT_SYSTEM = 'És um treinador de corrida e fitness em Portugal. Estás a discutir com o utilizador o plano de passadeira que já foi gerado. Responde em PT-PT, de forma prática, calorosa e prudente. Usa o plano e o histórico fornecidos e não inventes dados. O plano tem apenas distância e tempo por dia: quando propuseres alterações, usa só quilómetros e minutos, sem velocidade, inclinação, aquecimento, arrefecimento nem justificações longas. Podes propor ajustes ao plano quando o utilizador pedir, mantendo o aumento de volume semanal abaixo de 10% e respeitando dores ou limitações. Não faças diagnóstico médico; se houver dor persistente ou preocupante, recomenda avaliação profissional. Sê conciso: máximo 200 palavras, exceto quando apresentares um plano ajustado.';
const TM_PLAN_REWRITE_SYSTEM = 'És um treinador de corrida em Portugal. Reescreve o plano de passadeira completo aplicando os ajustes pedidos na conversa e respeitando os critérios do utilizador. Responde em PT-PT com exatamente 7 linhas, uma por dia, no formato "AAAA-MM-DD: X km, Y min" ou "AAAA-MM-DD: Descanso". Não escrevas mais nada: sem títulos, listas, introdução, velocidade, inclinação, RPE, aquecimento, arrefecimento, objetivo nem justificações. Não repitas dias nem uses datas passadas. Respeita o número de sessões e os dias de descanso indicados nos critérios. Aproxima o total semanal da distância-alvo, se estiver definida. Não aumentes o tempo total semanal mais de 10%. Não faças diagnóstico médico nem prometas resultados.';
let tmPlanChatMessages = [];
let tmPlanChatBusy = false;

function tmDayName(date) {
  const p = date.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('pt-PT', { weekday: 'short' }).replace('.', '');
}
function tmFutureDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
function tmWeekStart(dateStr) {
  const p = (dateStr || TODAY).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() - d.getDay());
  return localDateStr(d);
}
function tmWeekEnd(dateStr) {
  const p = tmWeekStart(dateStr).split('-').map(Number);
  return localDateStr(new Date(p[0], p[1] - 1, p[2] + 6));
}
function tmInCurrentWeek(dateStr) {
  if (!dateStr) return false;
  return dateStr >= tmWeekStart(TODAY) && dateStr <= tmWeekEnd(TODAY);
}
function tmStatsForDates(dates) {
  const days = dates.map(date => {
    const d = DB[date] || {};
    const time = parseFloat(d.treadmillTime) || 0;
    const dist = parseFloat(d.treadmillDistance) || 0;
    const incl = parseFloat(d.treadmillIncline) || 0;
    return {
      date, time, dist, incl,
      speed: time > 0 && dist > 0 ? dist / (time / 60) : 0,
      kcal: tmKcal(time, dist, incl)
    };
  });
  const active = days.filter(d => d.time > 0 || d.dist > 0);
  const totalTime = active.reduce((s, d) => s + d.time, 0);
  const totalDist = active.reduce((s, d) => s + d.dist, 0);
  const totalKcal = active.reduce((s, d) => s + d.kcal, 0);
  const avgIncl = active.length ? active.reduce((s, d) => s + d.incl, 0) / active.length : 0;
  return {
    days, active, totalTime, totalDist, totalKcal, avgIncl,
    avgSpeed: totalTime > 0 ? totalDist / (totalTime / 60) : 0
  };
}
function tmWeekStats() {
  const dates = [];
  for (let i = 6; i >= 0; i--) dates.push(tmDateOffset(i));
  return tmStatsForDates(dates);
}
function tmCurrentWeekStats() {
  const p = tmWeekStart(TODAY).split('-').map(Number);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    dates.push(localDateStr(new Date(p[0], p[1] - 1, p[2] + i)));
  }
  return tmStatsForDates(dates);
}
function tmTrainingContext(week) {
  const lw = latestWeightEntry();
  const p = getPerfil();
  const hEl = document.getElementById('height'), gEl = document.getElementById('weightGoal');
  const altura = parseFloat(hEl && hEl.value) || parseFloat(p.altura) || 0;
  const objetivo = parseFloat(gEl && gEl.value) || parseFloat(p.pesoObjetivo) || 0;
  const dec = n => Number(n).toFixed(1).replace('.', ',');
  const lines = [];
  lines.push('Peso mais recente: ' + (lw ? fmtWeight(lw.w) + ' kg' : 'não registado'));
  lines.push('Altura: ' + (altura > 0 ? altura + ' cm' : 'não registada'));
  lines.push('Peso objetivo: ' + (objetivo > 0 ? fmtWeight(objetivo) + ' kg' : 'não definido'));
  lines.push('Resumo dos últimos 7 dias: ' + dec(week.totalDist) + ' km, ' +
    Math.round(week.totalTime) + ' min, ' + week.active.length + ' treino(s), média ' +
    (week.avgSpeed ? dec(week.avgSpeed) + ' km/h' : 'não calculável') + ', inclinação média ' +
    dec(week.avgIncl) + '%, ~' + Math.round(week.totalKcal) + ' kcal.');
  lines.push('Dias:');
  week.days.forEach(d => {
    const detail = (d.time > 0 || d.dist > 0)
      ? d.time + ' min, ' + d.dist + ' km, inclinação ' + d.incl + '%, ' +
        (d.speed ? dec(d.speed) + ' km/h' : 'ritmo não calculável') + ', ~' + Math.round(d.kcal) + ' kcal'
      : 'sem treino registado';
    lines.push('- ' + d.date + ' (' + tmDayName(d.date) + '): ' + detail);
  });
  return lines.join('\n');
}
function tmAiShow(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'ai-response visible';
  el.textContent = text;
}
function tmAiLoading(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'ai-response visible';
  el.innerHTML = '<span class="loading-dots">' + message + '</span>';
}
function tmAiError(e) {
  const msg = e && e.message ? e.message : 'Erro de ligação';
  return msg.includes('configurada') ? '⚙️ ' + msg : '❌ ' + msg;
}
function tmCompactPlan(text) {
  const src = String(text || '');
  const items = tmParsePlan(src).filter(it => it.date);
  const sessions = items.filter(it => !it.rest && (it.distance || it.minutes));
  if (sessions.length < 3) return src;
  items.sort((a, b) => a.date.localeCompare(b.date));
  return items.map(it => {
    if (it.rest) return it.date + ': Descanso';
    const bits = [];
    if (it.distance) bits.push((Math.round(it.distance * 10) / 10) + ' km');
    if (it.minutes) bits.push(Math.round(it.minutes) + ' min');
    return bits.length ? it.date + ': ' + bits.join(', ') : '';
  }).filter(Boolean).join('\n');
}
function tmEnforceRestDays(text) {
  const rest = tmGetCriteria().restDays;
  if (!rest.length) return text;
  return String(text || '').split(/\r?\n/).map(line => {
    const m = line.match(/^(\d{4})-(\d{2})-(\d{2}):/);
    if (!m) return line;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
    return rest.indexOf(day) >= 0 ? m[1] + '-' + m[2] + '-' + m[3] + ': Descanso' : line;
  }).join('\n');
}
function tmSavePlan(text, at) {
  const payload = { text: tmEnforceRestDays(tmCompactPlan(text)), at: at || new Date().toISOString() };
  try {
    localStorage.setItem(TM_PLAN_KEY, JSON.stringify(payload));
    cfgSave(TM_PLAN_KEY, JSON.stringify(payload));
    return true;
  } catch (e) { return false; }
}
function tmCurrentPlan() {
  try {
    const p = JSON.parse(localStorage.getItem(TM_PLAN_KEY) || 'null');
    return p && typeof p.text === 'string' && p.text.trim() ? p : null;
  } catch (e) { return null; }
}
function tmGetCriteria() {
  try {
    const c = JSON.parse(localStorage.getItem(TM_CRITERIA_KEY) || '{}');
    const goal = Object.prototype.hasOwnProperty.call(TM_GOAL_LABELS, c.goal) ? c.goal : 'manter';
    const restDays = Array.isArray(c.restDays)
      ? c.restDays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6).filter((n, i, a) => a.indexOf(n) === i).slice(0, 5)
      : [];
    return { goal, targetKm: parseFloat(c.targetKm) > 0 ? parseFloat(c.targetKm) : 0, restDays };
  } catch (e) { return { goal: 'manter', targetKm: 0, restDays: [] }; }
}
function tmSaveCriteria() {
  const goalEl = document.getElementById('tmPlanGoal');
  const kmEl = document.getElementById('tmPlanTargetKm');
  const goal = goalEl && TM_GOAL_LABELS[goalEl.value] ? goalEl.value : 'manter';
  const targetKm = kmEl ? (parseFloat(kmEl.value) || 0) : 0;
  const box = document.getElementById('tmRestDays');
  const restDays = box
    ? Array.from(box.querySelectorAll('.tm-rest.on')).map(b => Number(b.getAttribute('data-day'))).filter(n => n >= 0 && n <= 6)
    : tmGetCriteria().restDays;
  const payload = { goal, targetKm, restDays, at: new Date().toISOString() };
  try { localStorage.setItem(TM_CRITERIA_KEY, JSON.stringify(payload)); } catch (e) {}
  cfgSave(TM_CRITERIA_KEY, JSON.stringify(payload));
  tmUpdateCriteriaHint();
  tmRenderPlanCards();
}
function tmToggleRestDay(day) {
  const box = document.getElementById('tmRestDays');
  if (!box) return;
  const btn = box.querySelector('.tm-rest[data-day="' + Number(day) + '"]');
  if (!btn) return;
  if (!btn.classList.contains('on') && box.querySelectorAll('.tm-rest.on').length >= 5) {
    alert('Deixa pelo menos 2 dias de treino. Remove um dia de descanso primeiro.');
    return;
  }
  btn.classList.toggle('on');
  tmSaveCriteria();
}
function tmUpdateCriteriaHint() {
  const hint = document.getElementById('tmCriteriaHint');
  if (!hint) return;
  const c = tmGetCriteria();
  if (!c.restDays.length) {
    hint.textContent = 'Sem descanso fixo: a IA escolhe 3 a 5 sessões e os dias de descanso.';
    return;
  }
  const names = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const days = c.restDays.slice().sort((a, b) => a - b).map(d => names[d]);
  hint.textContent = (7 - c.restDays.length) + ' sessões · descanso: ' + days.join(', ') + '.';
}
function tmLoadCriteriaForm() {
  const c = tmGetCriteria();
  const goalEl = document.getElementById('tmPlanGoal');
  const kmEl = document.getElementById('tmPlanTargetKm');
  if (goalEl) goalEl.value = c.goal;
  if (kmEl) kmEl.value = c.targetKm > 0 ? c.targetKm : '';
  document.querySelectorAll('#tmRestDays .tm-rest').forEach(btn => {
    btn.classList.toggle('on', c.restDays.indexOf(Number(btn.getAttribute('data-day'))) >= 0);
  });
  tmUpdateCriteriaHint();
}
function tmCriteriaText() {
  const c = tmGetCriteria();
  const lines = ['Objetivo do utilizador: ' + (TM_GOAL_LABELS[c.goal] || c.goal) + '.'];
  lines.push(c.targetKm > 0
    ? 'Distância-alvo: ' + c.targetKm + ' km no total da semana (aproxima o total das sessões deste valor).'
    : 'Distância-alvo: não definida (escolhe um valor razoável para a semana).');
  const names = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  if (c.restDays.length) {
    const days = c.restDays.slice().sort((a, b) => a - b).map(d => names[d]);
    lines.push('Dias de descanso: ' + days.join(', ') + '. Não incluas treino nesses dias.');
    lines.push('Sessões de treino: exatamente ' + (7 - c.restDays.length) + '.');
  } else {
    lines.push('Dias de descanso: à escolha do treinador (pelo menos 2).');
    lines.push('Sessões de treino: 3 a 5.');
  }
  return lines.join('\n');
}
function tmPlanChatLoad() {
  tmPlanChatMessages = [];
  const plan = tmCurrentPlan();
  if (!plan || !plan.at) return;
  try {
    const saved = JSON.parse(localStorage.getItem(TM_PLAN_CHAT_KEY) || 'null');
    if (saved && saved.at === plan.at && Array.isArray(saved.messages)) {
      tmPlanChatMessages = saved.messages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        .slice(-30);
    }
  } catch (e) {}
}
function tmPlanChatSave() {
  const plan = tmCurrentPlan();
  if (!plan || !plan.at) return;
  try {
    cfgSave(TM_PLAN_CHAT_KEY, JSON.stringify({
      at: plan.at,
      messages: tmPlanChatMessages.slice(-30)
    }));
  } catch (e) {}
}
function tmPlanChatReset() {
  tmPlanChatMessages = [];
  const plan = tmCurrentPlan();
  try { localStorage.removeItem(TM_PLAN_CHAT_KEY); } catch (e) {}
  if (plan && plan.at) {
    try { SyncManager.saveConfig({ treadmillPlanChat: { at: plan.at, messages: [] } }); } catch (e) {}
  }
}
function tmPlanChatRender() {
  const wrap = document.getElementById('tmPlanChat');
  if (!wrap) return;
  const plan = tmCurrentPlan();
  wrap.style.display = plan ? 'block' : 'none';
  if (!plan) return;
  const log = document.getElementById('tmPlanChatLog');
  const empty = document.getElementById('tmPlanChatEmpty');
  const apply = document.getElementById('tmPlanChatApply');
  if (!log) return;
  log.querySelectorAll('.ai-chat-msg').forEach(el => el.remove());
  if (empty) empty.hidden = tmPlanChatMessages.length > 0;
  if (apply) {
    apply.style.display = tmPlanChatMessages.length ? '' : 'none';
    apply.disabled = tmPlanChatBusy;
  }
  tmPlanChatMessages.forEach(m => {
    const row = document.createElement('div');
    row.className = 'ai-chat-msg ' + m.role + (m.error ? ' error' : '');
    const bubble = document.createElement('div');
    bubble.className = 'ai-chat-bubble';
    bubble.innerHTML = formatAiChat(m.text);
    row.appendChild(bubble);
    log.appendChild(row);
  });
  log.scrollTop = log.scrollHeight;
}
function tmPlanChatContext() {
  const plan = tmCurrentPlan();
  return 'CRITÉRIOS:\n' + tmCriteriaText() +
    '\n\nPLANO ATUAL:\n' + (plan ? tmCompactPlan(plan.text) : '') +
    '\n\n' + tmPlanExecutionText() +
    '\n\nHISTÓRICO E MEDIDAS:\n' + tmTrainingContext(tmWeekStats());
}
function tmPlanExecutionText() {
  const plan = tmCurrentPlan();
  const items = plan ? tmParsePlan(plan.text).filter(it => (it.rest || it.distance || it.minutes) && tmInCurrentWeek(it.date)) : [];
  if (!items.length) return 'PLANO VS EXECUÇÃO: sem dias do plano nesta semana.';
  const lines = ['PLANO VS EXECUÇÃO: semana atual (domingo a sábado)'];
  let planned = 0, done = 0, plannedKm = 0, doneKm = 0;
  items.forEach(it => {
    if (it.rest) { lines.push('- ' + (it.date || 'sem data') + ': descanso'); return; }
    planned++;
    plannedKm += it.distance || 0;
    const pl = [it.distance ? it.distance + ' km' : '', it.minutes ? Math.round(it.minutes) + ' min' : ''].filter(Boolean).join(', ');
    const d = it.date ? DB[it.date] : null;
    const t = d ? (parseFloat(d.treadmillTime) || 0) : 0;
    const k = d ? (parseFloat(d.treadmillDistance) || 0) : 0;
    const did = t > 0 || k > 0;
    if (did) { done++; doneKm += k; }
    lines.push('- ' + (it.date || 'sem data') + ' (' + tmPlanLabel(it) + '): planeado ' + (pl || 'sessão') + ' | ' +
      (did ? 'feito ' + k + ' km, ' + Math.round(t) + ' min' : (it.date && it.date < TODAY ? 'não feito' : 'ainda por fazer')));
  });
  lines.push('Resumo: ' + done + ' de ' + planned + ' sessões cumpridas, ' +
    (Math.round(doneKm * 10) / 10) + ' de ' + (Math.round(plannedKm * 10) / 10) + ' km planeados.');
  return lines.join('\n');
}
function tmPlanChatWeekly() {
  tmPlanChatAsk('Faz-me o resumo da semana: compara o plano com o que realmente fiz, diz o que correu bem, o que falhou e uma mudança concreta para a próxima semana.');
}
function tmPlanChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendTmPlanChat();
  }
}
function tmPlanChatAsk(text) {
  if (tmPlanChatBusy) return;
  const input = document.getElementById('tmPlanChatInput');
  if (!input) return;
  input.value = text;
  aiChatAutoGrow(input);
  sendTmPlanChat();
}
function tmPlanChatClear() {
  if (!tmPlanChatMessages.length) return;
  if (!confirm('Limpar esta conversa sobre o plano?')) return;
  tmPlanChatReset();
  tmPlanChatRender();
}
async function tmPlanChatApply() {
  if (tmPlanChatBusy) return;
  const plan = tmCurrentPlan();
  if (!plan || !tmPlanChatMessages.length) return;
  const applyBtn = document.getElementById('tmPlanChatApply');
  const sendBtn = document.getElementById('tmPlanChatSend');
  const status = document.getElementById('tmPlanChatStatus');

  tmPlanChatBusy = true;
  if (applyBtn) applyBtn.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (status) status.textContent = 'A aplicar os ajustes…';
  tmPlanChatRender();

  try {
    const history = tmPlanChatMessages.slice(-6)
      .map(m => (m.role === 'user' ? 'Utilizador' : 'Treinador') + ': ' + m.text)
      .join('\n\n');
    const planDates = tmParsePlan(plan.text).map(it => it.date);
    const datesLine = planDates.length === 7
      ? planDates.join(', ')
      : Array.from({ length: 7 }, (_, i) => tmFutureDate(i)).join(', ');
    const prompt = tmPlanChatContext() + '\n\nConversa até agora:\n' + history +
      '\n\nDatas válidas (uma vez cada, sem datas passadas): ' + datesLine + '.' +
      '\n\nReescreve o plano completo com os ajustes pedidos. Responde apenas com o plano, sem introdução nem comentários.';
    const reply = await callGemini(TM_PLAN_REWRITE_SYSTEM, prompt, 1400, 'plan-rewrite');
    const clean = String(reply || '').trim();
    if (!clean) throw new Error('A IA devolveu um plano vazio.');
    if (!tmSavePlan(clean)) throw new Error('Não foi possível guardar o plano atualizado.');
    tmPlanChatMessages.push({
      role: 'assistant',
      text: 'Plano atualizado com os ajustes da conversa.',
      at: Date.now()
    });
    tmPlanChatSave();
    tmRenderSavedPlan();
  } catch (err) {
    const message = (err && err.message) ? err.message : 'Erro de ligação.';
    const textOut = message.includes('configurada')
      ? '⚙️ ' + message
      : 'Não consegui atualizar o plano. ' + message;
    tmPlanChatMessages.push({ role: 'assistant', text: textOut, error: true, at: Date.now() });
  } finally {
    tmPlanChatBusy = false;
    if (applyBtn) applyBtn.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (status) status.textContent = '';
    tmPlanChatRender();
    tmPlanChatSave();
  }
}
async function sendTmPlanChat(event) {
  if (event) event.preventDefault();
  if (tmPlanChatBusy) return;
  const plan = tmCurrentPlan();
  if (!plan) return;
  const input = document.getElementById('tmPlanChatInput');
  const sendBtn = document.getElementById('tmPlanChatSend');
  const status = document.getElementById('tmPlanChatStatus');
  const text = ((input && input.value) || '').trim();
  if (!text) return;

  tmPlanChatBusy = true;
  if (sendBtn) sendBtn.disabled = true;
  if (status) status.textContent = 'A pensar…';

  tmPlanChatMessages.push({ role: 'user', text, at: Date.now() });
  if (input) { input.value = ''; aiChatAutoGrow(input); }
  tmPlanChatRender();
  tmPlanChatSave();

  try {
    const history = tmPlanChatMessages.slice(-6)
      .map(m => (m.role === 'user' ? 'Utilizador' : 'Treinador') + ': ' + m.text)
      .join('\n\n');
    const prompt = tmPlanChatContext() + '\n\nConversa até agora:\n' + history +
      '\n\nResponde à última mensagem do utilizador. Se ele pedir alterações, diz de forma clara o que muda no plano.';
    const reply = await callGemini(TM_PLAN_CHAT_SYSTEM, prompt, 1200, 'plan-chat');
    const clean = String(reply || '').trim();
    if (!clean) throw new Error('A IA devolveu uma resposta vazia.');
    tmPlanChatMessages.push({ role: 'assistant', text: clean, at: Date.now() });
  } catch (err) {
    const message = (err && err.message) ? err.message : 'Erro de ligação.';
    const textOut = message.includes('configurada')
      ? '⚙️ ' + message
      : 'Não consegui responder agora. ' + message;
    tmPlanChatMessages.push({ role: 'assistant', text: textOut, error: true, at: Date.now() });
  } finally {
    tmPlanChatBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    if (status) status.textContent = '';
    tmPlanChatRender();
    tmPlanChatSave();
    if (input) input.focus();
  }
}
function tmCurrentWeekPlanText(text) {
  return tmCompactPlan(text).split(/\r?\n/).filter(line => {
    const m = line.match(/^(\d{4})-(\d{2})-(\d{2}):/);
    return m && tmInCurrentWeek(m[1] + '-' + m[2] + '-' + m[3]);
  }).join('\n');
}
function tmRenderSavedPlan() {
  const el = document.getElementById('tmPlanResponse');
  if (!el) return;
  const p = tmCurrentPlan();
  if (!p) { tmPlanChatRender(); tmRenderPlanCards(); return; }
  const when = p.at ? new Date(p.at) : null;
  const stamp = when && !isNaN(when) ? '\n\nGerado em ' + when.toLocaleString('pt-PT') + '.' : '';
  const weekText = tmCurrentWeekPlanText(p.text);
  tmAiShow('tmPlanResponse', (weekText ? tmPlanPrettyText(weekText) : 'Sem dias do plano nesta semana (domingo a sábado).') + stamp);
  tmPlanChatLoad();
  tmPlanChatRender();
  tmRenderPlanCards();
}
function tmEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function tmPlanWeekdayIndex(name) {
  const n = String(name).toLowerCase();
  if (n.startsWith('seg')) return 1;
  if (n.startsWith('ter')) return 2;
  if (n.startsWith('qua')) return 3;
  if (n.startsWith('qui')) return 4;
  if (n.startsWith('sex')) return 5;
  if (n.startsWith('sáb') || n.startsWith('sab')) return 6;
  if (n.startsWith('dom')) return 0;
  return -1;
}
function tmPlanDateForWeekday(idx) {
  const p = TODAY.split('-').map(Number);
  for (let i = 0; i < 7; i++) {
    const d = new Date(p[0], p[1] - 1, p[2] + i);
    if (d.getDay() === idx) return localDateStr(d);
  }
  return null;
}
function tmParsePlan(text) {
  if (!text) return [];
  const out = [];
  String(text).split(/\r?\n/).forEach(raw => {
    const line = raw.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '');
    if (!line) return;
    const isRest = /descanso|repouso|folga/i.test(line);
    const nums = re => (line.match(re) || [])
      .map(x => parseFloat(String(x).replace(/[^\d.,]/g, '').replace(',', '.')))
      .filter(n => !isNaN(n));
    const mins = nums(/(\d+(?:[.,]\d+)?)\s*(?:min\b|minuto)/gi);
    const speeds = nums(/(\d+(?:[.,]\d+)?)\s*km\s*\/?\s*h/gi);
    const dists = nums(/(\d+(?:[.,]\d+)?)\s*km(?!\s*\/?\s*h)/gi);
    let date = null;
    const iso = line.match(/(\d{4})-(\d{2})-(\d{2})/);
    const dm = line.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (iso) {
      date = iso[1] + '-' + iso[2] + '-' + iso[3];
    } else if (dm) {
      const mm = String(dm[2]).padStart(2, '0'), dd = String(dm[1]).padStart(2, '0');
      const y = Number(TODAY.slice(0, 4));
      const base = new Date(TODAY + 'T00:00:00');
      let cand = y + '-' + mm + '-' + dd;
      const diff = (new Date(cand + 'T00:00:00') - base) / 86400000;
      if (diff > 183) cand = (y - 1) + '-' + mm + '-' + dd;
      else if (diff < -183) cand = (y + 1) + '-' + mm + '-' + dd;
      date = cand;
    } else {
      const wd = line.match(/\b(segunda|terça|terca|quarta|quinta|sexta|s[áa]bado|domingo)(?:-feira)?\b/i);
      if (wd) { const idx = tmPlanWeekdayIndex(wd[1]); if (idx >= 0) date = tmPlanDateForWeekday(idx); }
    }
    const minutes = mins.length ? Math.max.apply(null, mins) : null;
    const speed = speeds.length ? Math.max.apply(null, speeds) : null;
    const distance = dists.length ? Math.max.apply(null, dists) : null;
    if (!date && minutes == null && speed == null && distance == null && !isRest) return;
    out.push({ label: line, date, minutes, speed, distance, rest: isRest });
  });
  const dated = [];
  out.forEach(it => {
    if (it.date) { dated.push(it); return; }
    const last = dated.length ? dated[dated.length - 1] : null;
    if (!last || it.rest) return;
    if (it.distance != null) last.distance = Math.max(last.distance || 0, it.distance);
    if (it.minutes != null) last.minutes = Math.max(last.minutes || 0, it.minutes);
    if (it.speed != null) last.speed = Math.max(last.speed || 0, it.speed);
  });
  const lo = tmDateOffset(14), hi = tmFutureDate(14);
  const byDate = {};
  dated.forEach(it => {
    if (it.date < lo || it.date > hi) return;
    const cur = byDate[it.date];
    if (!cur) { byDate[it.date] = it; return; }
    if ((it.distance || 0) > (cur.distance || 0)) cur.distance = it.distance;
    if ((it.minutes || 0) > (cur.minutes || 0)) cur.minutes = it.minutes;
    if (it.rest && !cur.distance && !cur.minutes) cur.rest = true;
  });
  let list = Object.keys(byDate).map(d => byDate[d]);
  if (list.length > 7) {
    const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date));
    const idx = sorted.findIndex(it => it.date >= TODAY);
    const start = idx < 0 ? sorted.length - 7 : Math.max(0, Math.min(idx, sorted.length - 7));
    const keep = new Set(sorted.slice(start, start + 7).map(it => it.date));
    list = list.filter(it => keep.has(it.date));
  }
  return list;
}
function tmPlanLabel(it) {
  return it.rest ? 'Descanso' : 'Treino';
}
function tmPlanPrettyText(text) {
  const compact = tmCompactPlan(text);
  return compact.split(/\r?\n/).map(line => {
    const m = line.match(/^(\d{4})-(\d{2})-(\d{2}):\s*(.+)$/);
    if (!m) return line;
    const date = m[1] + '-' + m[2] + '-' + m[3];
    const rest = /descanso/i.test(m[4]);
    return tmDayName(date) + ' ' + m[3] + '/' + m[2] + ' · ' + (rest ? 'Descanso' : m[4]);
  }).join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// CALENDÁRIO — Google Calendar (links + .ics + incorporação pública)
// ═══════════════════════════════════════════════════════════════════

const GOOGLE_CAL_EMBED_KEY = 'dvGoogleCalEmbed';

function calTime(value, fallback) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function calEndDateTime(date, time, minutes) {
  const d = new Date(date + 'T' + time + ':00');
  d.setMinutes(d.getMinutes() + Math.max(5, Number(minutes) || 30));
  return {
    date: localDateStr(d),
    time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  };
}

function calReminderPrefs() {
  try { return JSON.parse(localStorage.getItem('dvReminders') || 'null'); } catch (e) { return null; }
}

function collectCalendarEvents() {
  const events = [];
  const prefs = calReminderPrefs();
  const workoutTime = calTime(prefs && prefs.treino && prefs.treino.hora, '18:00');
  const plan = tmCurrentPlan();
  if (plan) {
    tmParsePlan(plan.text).forEach(it => {
      if (!it.date || it.date < TODAY || it.rest) return;
      const minutes = Math.max(10, Number(it.minutes) || 30);
      const end = calEndDateTime(it.date, workoutTime, minutes);
      const title = it.distance ? 'Treino · ' + it.distance + ' km' : 'Treino';
      const details = [
        it.distance ? it.distance + ' km' : '',
        it.minutes ? it.minutes + ' min' : '',
        'Plano semanal do Diário de Vida'
      ].filter(Boolean).join(' · ');
      events.push({
        kind: 'treino', date: it.date, start: workoutTime,
        end: end.time, endDate: end.date, title, details
      });
    });
  }
  const weigh = prefs && prefs.pesoSemana;
  if (weigh && weigh.enabled !== false) {
    const target = Number(weigh.dia);
    const time = calTime(weigh.hora, '09:00');
    const base = new Date(TODAY + 'T12:00:00');
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      if (d.getDay() !== target) continue;
      const date = localDateStr(d);
      const end = calEndDateTime(date, time, 15);
      events.push({
        kind: 'pesagem', date, start: time,
        end: end.time, endDate: end.date, title: 'Pesagem semanal',
        details: 'Registo do peso no Diário de Vida'
      });
    }
  }
  return events.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 12);
}

function calDateLabel(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('pt-PT', {
    weekday: 'short', day: '2-digit', month: 'short'
  });
}

function googleCalendarUrl(ev) {
  const digits = s => s.replace(/[^0-9]/g, '');
  const dates = ev.date.replace(/-/g, '') + 'T' + digits(ev.start) + '00/' +
    (ev.endDate || ev.date).replace(/-/g, '') + 'T' + digits(ev.end) + '00';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates,
    details: ev.details,
    ctz: 'Europe/Lisbon'
  });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function renderCalendarSection() {
  const box = document.getElementById('calendarEvents');
  if (!box) return;
  const events = collectCalendarEvents();
  if (!events.length) {
    box.innerHTML = '<p class="calendar-note">Ainda não há eventos. Gera um plano semanal ou configura os lembretes para começar.</p>';
  } else {
    box.innerHTML = events.map(ev => `
      <div class="cal-event">
        <div class="cal-event-date">${calDateLabel(ev.date)}<br>${ev.start}–${ev.end}${ev.endDate && ev.endDate !== ev.date ? ' (+1)' : ''}</div>
        <div class="cal-event-body">
          <div class="cal-event-title">${chartEsc(ev.title)}</div>
          <div class="cal-event-meta">${chartEsc(ev.details)}</div>
          <div class="cal-event-actions">
            <a href="${googleCalendarUrl(ev)}" target="_blank" rel="noopener">Adicionar ao Google Calendar</a>
          </div>
        </div>
      </div>`).join('');
  }
  initGoogleCalEmbed();
}

function icsEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function icsStamp() {
  const d = new Date();
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') + 'T' +
    String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') +
    String(d.getUTCSeconds()).padStart(2, '0') + 'Z';
}

function icsFold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  let out = '', chunk = '', bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 74) {
      out += chunk + '\r\n ';
      chunk = '';
      bytes = 0;
    }
    chunk += ch;
    bytes += size;
  }
  return out + chunk;
}

function downloadCalendarIcs() {
  const events = collectCalendarEvents();
  if (!events.length) { alert('Ainda não há eventos para exportar. Gera um plano semanal primeiro.'); return; }
  const blob = new Blob([buildCalendarIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diario-de-vida.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function buildCalendarIcs(events) {
  const stamp = icsStamp();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Diario de Vida//PT-PT',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Diário de Vida',
    'X-WR-TIMEZONE:Europe/Lisbon',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Lisbon',
    'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
    'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:WET', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
    'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:WEST', 'END:DAYLIGHT',
    'END:VTIMEZONE'
  ];
  events.forEach(ev => {
    const start = ev.date.replace(/-/g, '') + 'T' + ev.start.replace(':', '') + '00';
    const end = (ev.endDate || ev.date).replace(/-/g, '') + 'T' + ev.end.replace(':', '') + '00';
    lines.push('BEGIN:VEVENT',
      'UID:dv-' + ev.kind + '-' + ev.date + '@diariodevida.local',
      'DTSTAMP:' + stamp,
      'DTSTART;TZID=Europe/Lisbon:' + start,
      'DTEND;TZID=Europe/Lisbon:' + end,
      'SUMMARY:' + icsEscape(ev.title),
      'DESCRIPTION:' + icsEscape(ev.details),
      'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(ev.title), 'END:VALARM',
      'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

function normalizeGoogleCalEmbed(raw) {
  const htmlMatch = String(raw || '').match(/src=["']([^"']+)["']/i);
  const value = htmlMatch ? htmlMatch[1] : String(raw || '').trim();
  if (!value) throw new Error('Cola o URL de incorporação.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'calendar.google.com' ||
      url.pathname.indexOf('/calendar/') !== 0 || !url.searchParams.get('src')) {
    throw new Error('Usa um URL de incorporação do Google Calendar.');
  }
  return url.toString();
}

function initGoogleCalEmbed() {
  const input = document.getElementById('googleCalEmbedUrl');
  const box = document.getElementById('googleCalEmbedBox');
  const frame = document.getElementById('googleCalEmbed');
  const status = document.getElementById('googleCalStatus');
  if (!input || !box || !frame) return;
  let saved = '';
  try { saved = localStorage.getItem(GOOGLE_CAL_EMBED_KEY) || ''; } catch (e) {}
  if (saved) {
    try { saved = normalizeGoogleCalEmbed(saved); }
    catch (e) { saved = ''; try { localStorage.removeItem(GOOGLE_CAL_EMBED_KEY); } catch (err) {} }
  }
  if (!input.value && saved) input.value = saved;
  if (saved) {
    frame.src = saved;
    box.hidden = false;
    if (status) status.textContent = 'Calendário público ligado. A vista é só de leitura.';
  } else {
    frame.removeAttribute('src');
    box.hidden = true;
    if (status) status.textContent = 'Ainda não há calendário incorporado.';
  }
}

function saveGoogleCalEmbed() {
  const input = document.getElementById('googleCalEmbedUrl');
  const status = document.getElementById('googleCalStatus');
  try {
    const url = normalizeGoogleCalEmbed(input ? input.value : '');
    localStorage.setItem(GOOGLE_CAL_EMBED_KEY, url);
    if (input) input.value = url;
    if (status) status.textContent = 'Calendário público ligado. A vista é só de leitura.';
    initGoogleCalEmbed();
  } catch (e) {
    if (status) status.textContent = e.message;
  }
}

function clearGoogleCalEmbed() {
  localStorage.removeItem(GOOGLE_CAL_EMBED_KEY);
  const input = document.getElementById('googleCalEmbedUrl');
  if (input) input.value = '';
  initGoogleCalEmbed();
}

function tmRenderPlanCards() {
  const card = document.getElementById('tmPlanCard');
  const box = document.getElementById('tmPlanDays');
  const summary = document.getElementById('tmPlanSummary');
  if (!card || !box) return;
  const plan = tmCurrentPlan();
  const allItems = plan ? tmParsePlan(plan.text).filter(it => it.rest || it.distance || it.minutes) : [];
  const items = allItems.filter(it => tmInCurrentWeek(it.date));
  if (!items.length) {
    if (allItems.length) {
      card.style.display = 'block';
      box.innerHTML = '<div style="color:var(--muted);font-size: calc(13px * var(--font-scale));">Não há dias do plano nesta semana (domingo a sábado).</div>';
      if (summary) summary.innerHTML = '';
    } else {
      card.style.display = 'none';
      box.innerHTML = '';
      if (summary) summary.innerHTML = '';
    }
    return;
  }
  card.style.display = 'block';
  let planned = 0, done = 0, plannedKm = 0, plannedMin = 0;
  const rows = items.map(it => {
    const trained = !!(it.date && DB[it.date] &&
      (parseFloat(DB[it.date].treadmillTime) > 0 || parseFloat(DB[it.date].treadmillDistance) > 0));
    let cls = 'plan', status = 'previsto', badge = '•';
    if (it.rest) { cls = 'rest'; status = 'descanso'; badge = '😌'; }
    else if (trained) { cls = 'done'; status = 'feito'; badge = '✓'; }
    else if (it.date === TODAY) { cls = 'today'; status = 'hoje'; badge = '▶'; }
    else if (it.date && it.date < TODAY) { cls = 'miss'; status = 'falhado'; badge = '✕'; }
    if (!it.rest) {
      planned++;
      if (trained) done++;
      plannedKm += it.distance || 0;
      plannedMin += it.minutes || 0;
    }
    // Dias já feitos: mostrar o que foi realmente registado (fallback para o plano)
    const dayData = (trained && DB[it.date]) ? DB[it.date] : {};
    const realKm = parseFloat(dayData.treadmillDistance) || 0;
    const realMin = parseFloat(dayData.treadmillTime) || 0;
    const shownKm = (trained && realKm > 0) ? realKm : it.distance;
    const shownMin = (trained && realMin > 0) ? realMin : it.minutes;
    const metrics = [];
    if (shownKm) metrics.push('<div class="tmp-metric"><b>' + (Math.round(shownKm * 10) / 10) + '</b> <span>km</span></div>');
    if (shownMin) metrics.push('<div class="tmp-metric"><b>' + Math.round(shownMin) + '</b> <span>min</span></div>');
    const statsHtml = it.rest
      ? '<div class="tmp-metrics"><div class="tmp-metric rest"><b>—</b></div></div>'
      : '<div class="tmp-metrics">' + (metrics.join('') || '<div class="tmp-metric rest"><b>—</b> <span>livre</span></div>') + '</div>';
    const weekday = it.date ? tmDayName(it.date) : '';
    const dayNum = it.date ? it.date.slice(8, 10) : '·';
    const clickable = !!(it.date && it.date <= TODAY);
    const canComplete = !!(it.date && it.date <= TODAY && !trained && !it.rest);
    return '<div class="tmp-day ' + cls + (clickable ? ' click' : '') + '"' +
        (it.date ? ' data-date="' + it.date + '"' : '') +
        (clickable ? ' onclick="tmSetDay(\'' + it.date + '\')"' : '') + '>' +
      '<div class="tmp-top">' +
        '<div class="tmp-date"><b>' + dayNum + '</b><span>' + (weekday || '—') + '</span></div>' +
        '<div class="tmp-status ' + cls + '">' + badge + ' ' + status + '</div>' +
      '</div>' +
      '<div class="tmp-info">' + (it.rest ? '' : '<div class="tmp-title">' + tmEsc(tmPlanLabel(it)) + '</div>') + statsHtml + '</div>' +
      (canComplete ? '<button type="button" class="tm-do" title="Registar esta sessão com os valores do plano" onclick="event.stopPropagation();tmCompletePlanned(\'' + it.date + '\',' + (it.distance || 0) + ',' + (it.minutes || 0) + ')">Concluir</button>' : '') +
    '</div>';
  }).join('');
  box.innerHTML = rows;
  if (summary) {
    const target = tmGetCriteria().targetKm;
    const pct = planned ? Math.round(done / planned * 100) : 0;
    const head = planned
      ? '<div class="tmp-head"><div class="tmp-head-main">' + done + ' de ' + planned + ' sessões cumpridas</div>' +
        '<div class="tmp-head-pct">' + pct + '%</div></div>' +
        '<div class="tmp-bar"><i style="width:' + pct + '%"></i></div>'
      : '<div class="tmp-head"><div class="tmp-head-main">Semana de descanso</div></div>';
    const chips = [];
    const ws = tmWeekStart(TODAY), we = tmWeekEnd(TODAY);
    chips.push('<span class="tmp-stat">semana ' + ws.slice(8, 10) + '/' + ws.slice(5, 7) + '–' + we.slice(8, 10) + '/' + we.slice(5, 7) + '</span>');
    if (plannedKm) chips.push('<span class="tmp-stat">' + (Math.round(plannedKm * 10) / 10) + (target > 0 ? ' de ' + target : '') + ' km planeados</span>');
    if (plannedMin) chips.push('<span class="tmp-stat">' + Math.round(plannedMin) + ' min planeados</span>');
    summary.innerHTML = head + (chips.length ? '<div class="tmp-chips">' + chips.join('') + '</div>' : '');
  }
}
async function generateTreadmillCoach() {
  const btn = document.getElementById('tmCoachBtn');
  const week = tmWeekStats();
  if (!week.active.length) {
    tmAiShow('tmCoachResponse', 'Ainda não há treinos nos últimos 7 dias. Regista pelo menos um treino para eu poder analisar.');
    return;
  }
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ A analisar…'; }
  tmAiLoading('tmCoachResponse', 'A analisar os teus treinos');
  try {
    const text = await callGemini(
      'És um treinador de corrida e fitness em Portugal. Analisa o histórico de passadeira fornecido e responde em PT-PT, de forma prática e prudente. Não inventes dados, não faças diagnóstico médico e não prometas resultados. Se faltarem dados, diz o que falta. Estrutura a resposta em: 1) o que está a correr bem; 2) um risco ou ponto de atenção; 3) o próximo treino concreto, com aquecimento, duração, distância, ritmo, inclinação e arrefecimento. Máximo 220 palavras.',
      'Dados dos últimos 7 dias:\n' + tmTrainingContext(week) + '\n\nFaz a análise.',
      900
    );
    tmAiShow('tmCoachResponse', text);
  } catch (e) {
    tmAiShow('tmCoachResponse', tmAiError(e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}
async function generateTreadmillPlan() {
  const btn = document.getElementById('tmPlanBtn');
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ A preparar…'; }
  tmAiLoading('tmPlanResponse', 'A preparar o plano semanal');
  const week = tmWeekStats();
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const date = tmFutureDate(i);
    dates.push(date + ' (' + tmDayName(date) + ')');
  }
  try {
    const text = await callGemini(
      'És um treinador de corrida em Portugal. Cria um plano de passadeira para os próximos 7 dias, incluindo hoje, em PT-PT. Responde com exatamente 7 linhas, uma por dia, na ordem das datas fornecidas. Cada linha tem de seguir este formato: "AAAA-MM-DD: X km, Y min" ou "AAAA-MM-DD: Descanso". Não escrevas mais nada: sem títulos, listas, introdução, conclusão, velocidade, inclinação, aquecimento, arrefecimento, RPE, objetivo nem justificações. Não repitas dias nem uses datas passadas. Respeita o número de sessões e os dias de descanso indicados nos critérios. Se houver distância-alvo semanal, aproxima o total das sessões desse valor. Não aumentes o tempo total semanal mais de 10% em relação à semana anterior. Não faças diagnóstico médico nem prometas resultados.',
      'Critérios do utilizador:\n' + tmCriteriaText() + '\n\nContexto:\n' + tmTrainingContext(week) + '\n\nDatas dos próximos 7 dias (a começar hoje): ' + dates.join(', ') + '.\nUsa exatamente estas datas no formato AAAA-MM-DD, uma vez cada, incluindo hoje; não inventes, repitas nem uses datas passadas.\nCria o plano com apenas distância e tempo.',
      1400
    );
    if (tmSavePlan(text)) {
      tmPlanChatReset();
      tmRenderSavedPlan();
    } else {
      tmAiShow('tmPlanResponse', text);
    }
  } catch (e) {
    tmAiShow('tmPlanResponse', tmAiError(e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

// ── PERFIL: altura, peso atual e peso objetivo (guardados na conta) ──
function getPerfil() {
  try { return JSON.parse(localStorage.getItem('dvPerfil')) || {}; } catch (e) { return {}; }
}
// Entrada de peso mais recente: o valor de hoje (se preenchido) ou o último dia registado
function latestWeightEntry() {
  const el = document.getElementById('weight');
  const cur = el ? parseFloat(el.value) : NaN;
  if (cur > 0) return { w: cur, d: TODAY };
  const days = Object.keys(DB).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const d of days) { const w = parseFloat(DB[d] && DB[d].weight); if (w > 0) return { w: w, d: d }; }
  return null;
}
function firstWeightEntry() {
  const days = Object.keys(DB).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const d of days) { const w = parseFloat(DB[d] && DB[d].weight); if (w > 0) return w; }
  return null;
}

// ── PESO SEMANAL (domingo como início da semana) ──
function weightDateFrom(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const s = String(value || '').slice(0, 10);
  const p = s.split('-').map(Number);
  if (p.length === 3 && p[0] > 1900) return new Date(p[0], p[1] - 1, p[2]);
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function weightWeekStart(value) {
  const d = weightDateFrom(value || new Date());
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function weightWeekEnd(value) {
  const d = weightWeekStart(value);
  d.setDate(d.getDate() + 6);
  return d;
}
function weightWeekKey(value) { return localDateStr(weightWeekStart(value)); }
function weightEntriesInRange(start, end) {
  const s = localDateStr(start), e = localDateStr(end);
  return Object.keys(DB)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= s && d <= e)
    .sort()
    .map(d => ({ d, w: parseFloat(DB[d] && DB[d].weight) }))
    .filter(x => x.w > 0);
}
function weightEntriesForWeek(value) {
  return weightEntriesInRange(weightWeekStart(value), weightWeekEnd(value));
}
function weightDue() {
  return weightEntriesForWeek(new Date()).length === 0;
}
function weightStatus() {
  if (!weightDue()) return 'feita';
  return new Date().getDay() === 0 ? 'em falta' : 'atrasada';
}
function nextWeightDate() {
  const now = new Date();
  const start = weightWeekStart(now);
  if (now.getDay() === 0 && weightDue()) return localDateStr(now);
  start.setDate(start.getDate() + 7);
  return localDateStr(start);
}
function weightDaysAgo(dateStr) {
  if (!dateStr) return null;
  const a = weightDateFrom(dateStr), b = weightDateFrom(new Date());
  return Math.round((b - a) / 86400000);
}
function weightAgoLabel(dateStr) {
  const n = weightDaysAgo(dateStr);
  if (n === null) return '';
  if (n <= 0) return 'hoje';
  return n === 1 ? 'há 1 dia' : 'há ' + n + ' dias';
}
function lastSavedWeightEntry() {
  const days = Object.keys(DB).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const d of days) {
    const w = parseFloat(DB[d] && DB[d].weight);
    if (w > 0) return { w, d };
  }
  return null;
}
function weightWeekSummary(value) {
  const start = weightWeekStart(value);
  const end = weightWeekEnd(value);
  const entries = weightEntriesInRange(start, end);
  const latest = entries.length ? entries[entries.length - 1] : null;
  const sunday = entries.find(x => x.d === localDateStr(start)) || null;
  return {
    start: localDateStr(start),
    end: localDateStr(end),
    entries,
    latest,
    sunday,
    weight: latest ? latest.w : null,
    isExtra: !!latest && latest.d !== localDateStr(start)
  };
}
function weightShortDate(dateStr) {
  if (!dateStr) return '';
  const p = dateStr.split('-');
  return p[2] + '/' + p[1];
}
function weightLongDate(dateStr) {
  if (!dateStr) return '';
  const d = weightDateFrom(dateStr);
  const days = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return days[d.getDay()] + ', ' + d.getDate() + ' de ' + months[d.getMonth()];
}
function fmtWeight(n, dec) {
  if (!(n > 0)) return '—';
  return Number(n).toFixed(dec === undefined ? 1 : dec).replace('.', ',');
}
function fmtWeightDelta(n, dec) {
  return Number(n || 0).toFixed(dec === undefined ? 1 : dec).replace('.', ',');
}
function openWeeklyWeight() {
  showSection('weight', navBySection('weight'));
  setTimeout(() => {
    const el = document.getElementById('weight');
    if (!el) return;
    const wt = document.getElementById('weightTime');
    if (wt && !wt.value) { try { wt.value = getNowTime(); } catch (e) {} }
    el.focus({ preventScroll: true });
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, 150);
}
function weightEntryBeforeWeek(dateStr) {
  const base = weightWeekStart(dateStr);
  for (let i = 1; i <= 12; i++) {
    const start = new Date(base);
    start.setDate(start.getDate() - 7 * i);
    const entries = weightEntriesInRange(start, weightWeekEnd(start));
    if (entries.length) return { w: entries[entries.length - 1].w, d: entries[entries.length - 1].d };
  }
  return null;
}
function renderWeeklyWeight() {
  const card = document.getElementById('weeklyWeightCard');
  if (!card) return;
  const status = weightStatus();
  const summary = weightWeekSummary();
  const last = lastSavedWeightEntry();
  const prev = last ? weightEntryBeforeWeek(last.d) : null;
  const diff = last && prev ? last.w - prev.w : null;
  const next = nextWeightDate();

  card.dataset.status = status;
  const statusEl = document.getElementById('weeklyWeightStatus');
  if (statusEl) {
    statusEl.dataset.status = status;
    statusEl.textContent = status === 'feita' ? 'Feita esta semana' : status === 'atrasada' ? 'Por fazer esta semana' : 'Por fazer';
  }
  const dateEl = document.getElementById('weeklyWeightDate');
  if (dateEl) dateEl.textContent = 'Semana de ' + weightShortDate(summary.start) + ' a ' + weightShortDate(summary.end);

  const valEl = document.getElementById('weeklyWeightValue');
  if (valEl) valEl.innerHTML = last ? fmtWeight(last.w) + '<span>kg</span>' : '—';

  const metaEl = document.getElementById('weeklyWeightMeta');
  if (metaEl) {
    if (!last) {
      metaEl.textContent = 'Ainda não há registos de peso.';
    } else {
      let text = 'Último registo: ' + weightShortDate(last.d) + ' · ' + weightAgoLabel(last.d);
      if (diff !== null) {
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
        text += ' · ' + arrow + ' ' + fmtWeightDelta(Math.abs(diff)) + ' kg vs semana anterior';
      }
      if (summary.isExtra) text += ' · registo extra';
      metaEl.textContent = text;
    }
  }

  const nextEl = document.getElementById('weeklyWeightNext');
  if (nextEl) nextEl.textContent = 'Próxima pesagem: ' + weightLongDate(next);

  const cta = document.getElementById('weeklyWeightCta');
  if (cta) cta.textContent = summary.entries.length ? 'Atualizar peso desta semana' : 'Registar peso desta semana';
}

function renderWeightHistory() {
  const status = weightStatus();
  const statusPage = document.getElementById('weeklyWeightPageStatus');
  const nextPage = document.getElementById('weeklyWeightPageNext');
  if (statusPage) {
    statusPage.dataset.status = status;
    statusPage.textContent = status === 'feita' ? 'Feita esta semana' : status === 'atrasada' ? 'Por fazer esta semana' : 'Por fazer';
  }
  if (nextPage) nextPage.textContent = 'Próxima pesagem: ' + weightLongDate(nextWeightDate());
  const box = document.getElementById('weightWeekHistory');
  if (!box) return;
  const rows = [];
  const current = weightWeekStart();
  for (let i = 0; i < 8; i++) {
    const start = new Date(current);
    start.setDate(start.getDate() - 7 * i);
    const sum = weightWeekSummary(start);
    const prev = (() => {
      const p = new Date(start); p.setDate(p.getDate() - 7);
      return weightWeekSummary(p);
    })();
    const diff = sum.weight !== null && prev.weight !== null ? sum.weight - prev.weight : null;
    rows.push({ sum, diff, current: i === 0 });
  }
  if (!rows.some(r => r.sum.weight !== null)) {
    box.innerHTML = '<div class="weight-history-empty">Ainda não há pesagens registadas. A primeira cria o teu histórico semanal.</div>';
    return;
  }
  box.innerHTML = rows.map(({sum, diff, current}) => {
    const value = sum.weight !== null ? fmtWeight(sum.weight) + ' kg' : '—';
    let sub = sum.latest ? weightShortDate(sum.latest.d) + ' · ' + weightAgoLabel(sum.latest.d) : 'sem registo';
    if (sum.isExtra) sub += ' · <span class="weight-extra">extra</span>';
    if (sum.sunday) sub += ' · domingo';
    const diffTxt = diff === null ? '' : `<span class="weight-diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '↑' : diff < 0 ? '↓' : '→'} ${fmtWeightDelta(Math.abs(diff))} kg</span>`;
    return `<div class="weight-history-row${current ? ' current' : ''}">
      <div><div class="weight-history-week">Semana de ${weightShortDate(sum.start)}</div><div class="weight-history-sub">${sub}</div></div>
      <div class="weight-history-value">${value}${diffTxt}</div>
    </div>`;
  }).join('');
}

// Os campos «altura» e «peso objetivo» da página Peso alimentam vários cálculos: o perfil da conta preenche-os se estiverem vazios
function applyPerfilToForm() {
  const p = getPerfil();
  const h = document.getElementById('height'), g = document.getElementById('weightGoal');
  if (h && !h.value && p.altura) h.value = p.altura;
  if (g && !g.value && p.pesoObjetivo) g.value = p.pesoObjetivo;
}
function renderProfile() {
  const p = getPerfil();
  const hIn = document.getElementById('height').value, gIn = document.getElementById('weightGoal').value;
  document.getElementById('pfHeight').value = hIn || p.altura || '';
  document.getElementById('pfGoal').value = gIn || p.pesoObjetivo || '';
  const lw = latestWeightEntry();
  document.getElementById('pfWeight').value = lw ? lw.w : '';
  const hint = document.getElementById('pfWeightHint');
  if (hint) {
    if (lw) { const q = lw.d.split('-'); hint.textContent = 'Último registo de peso: ' + q[2] + '/' + q[1] + '/' + q[0] + '. Se alterares o valor, fica registado como o peso de hoje.'; }
    else hint.textContent = 'Ainda não registaste o teu peso. O valor que indicares fica registado como o peso de hoje.';
  }
  const msg = document.getElementById('pfSaveMsg'); if (msg) msg.textContent = '';
  pfCalc();
}
function pfCalc() {
  const h = parseFloat(document.getElementById('pfHeight').value);
  const w = parseFloat(document.getElementById('pfWeight').value);
  const g = parseFloat(document.getElementById('pfGoal').value);
  const txt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  let note = '';
  if (h > 0 && w > 0) {
    const bmi = w / Math.pow(h / 100, 2);
    txt('pfBmi', bmi.toFixed(1));
    const cat = bmi < 18.5 ? 'abaixo do intervalo normal' : bmi < 25 ? 'dentro do intervalo normal' : bmi < 30 ? 'acima do intervalo normal' : 'bem acima do intervalo normal';
    note = 'IMC ' + cat + ' (valor indicativo; não substitui a avaliação de um profissional de saúde).';
  } else txt('pfBmi', '—');
  if (w > 0 && g > 0) {
    const diff = w - g;
    txt('pfLeft', Math.abs(diff) < 0.05 ? '🎉' : (diff > 0 ? '−' : '+') + Math.abs(diff).toFixed(1) + ' kg');
    const S = firstWeightEntry() || w;
    let pr = S === g ? 1 : (S - w) / (S - g);
    pr = Math.max(0, Math.min(1, pr));
    txt('pfProgress', Math.round(pr * 100) + '%');
    const bar = document.getElementById('pfBar'); if (bar && bar.style) bar.style.width = Math.round(pr * 100) + '%';
  } else {
    txt('pfLeft', '—'); txt('pfProgress', '—');
    const bar = document.getElementById('pfBar'); if (bar && bar.style) bar.style.width = '0%';
  }
  txt('pfBmiNote', note);
}
function savePerfil(btn) {
  const msg = document.getElementById('pfSaveMsg');
  const hs = document.getElementById('pfHeight').value, ws = document.getElementById('pfWeight').value, gs = document.getElementById('pfGoal').value;
  const h = parseFloat(hs), w = parseFloat(ws), g = parseFloat(gs);
  const bad = [];
  if (hs && !(h >= 100 && h <= 250)) bad.push('altura (100 a 250 cm)');
  if (ws && !(w >= 30 && w <= 300)) bad.push('peso atual (30 a 300 kg)');
  if (gs && !(g >= 30 && g <= 300)) bad.push('peso objetivo (30 a 300 kg)');
  if (bad.length) { if (msg) msg.textContent = '⚠ Verifica: ' + bad.join(', ') + '.'; return; }

  const perfil = { altura: h > 0 ? h : null, pesoObjetivo: g > 0 ? g : null };
  // espelhar nos campos da página Peso (usados pelos cálculos) e no registo de hoje
  document.getElementById('height').value = h > 0 ? h : '';
  document.getElementById('weightGoal').value = g > 0 ? g : '';
  const wi = document.getElementById('weight');
  if (w > 0 && parseFloat(wi.value) !== w) {
    wi.value = w;
    const wt = document.getElementById('weightTime');
    if (wt && !wt.value) { try { wt.value = getNowTime(); } catch (e) {} }
  }
  if (msg) msg.textContent = '⏳ a guardar…';
  const p1 = cfgSave('dvPerfil', JSON.stringify(perfil));
  const p2 = saveData();   // o registo de hoje leva altura, peso objetivo e peso
  Promise.all([p1, p2]).then(rs => {
    const bad2 = rs.find(x => x !== 'cloud' && x !== 'local' && x !== 'none');
    const r = bad2 || (rs.includes('cloud') ? 'cloud' : 'local');
    if (msg) msg.textContent = saveMsgText(r, '').replace('guardado', 'perfil guardado');
    pfCalc();
    if (typeof calcBMI === 'function') { try { calcBMI(); } catch (e) {} }
  });
}

let _compIsAdmin = false, _compIsParticipant = false;

function _escComp(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function initCompetition() {
  const navC = document.getElementById('navCompeticao');
  const navA = document.getElementById('navCompAdmin');
  if (navC) navC.style.display = 'none';
  if (navA) navA.style.display = 'none';
  _compIsAdmin = false; _compIsParticipant = false;
  if (!supabaseClient) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !session.user) return;
    const uid = session.user.id;
    const [adm, par] = await Promise.all([
      supabaseClient.from('admins').select('user_id').eq('user_id', uid).maybeSingle(),
      supabaseClient.from('competicao_participantes').select('ativo').eq('user_id', uid).maybeSingle()
    ]);
    _compIsAdmin = !!(adm && adm.data);
    _compIsParticipant = !!(par && par.data && par.data.ativo);
    if (navC && (_compIsAdmin || _compIsParticipant)) navC.style.display = '';
    if (navA && _compIsAdmin) navA.style.display = '';
  } catch(e) {
    console.error('Erro ao verificar a competição:', e);
  }
}

async function renderCompetition() {
  const box = document.getElementById('compTable');
  if (!box) return;
  const summary = document.getElementById('compSummary');
  const podium = document.getElementById('compPodium');
  const meBox = document.getElementById('compMe');
  const updated = document.getElementById('compUpdated');
  const metric = document.getElementById('compMetric').value;
  const period = document.getElementById('compPeriod').value;
  const metricLabel = metric === 'km' ? 'Distância' : metric === 'min' ? 'Tempo' : 'Dias com registo';
  const periodLabel = period === 'semana' ? 'Esta semana' : 'Este mês';
  const unit = metric === 'km' ? ' km' : metric === 'min' ? ' min' : ' dia(s)';
  const medals = ['🥇', '🥈', '🥉'];
  const clear = (html) => {
    if (summary) summary.innerHTML = '';
    if (podium) podium.innerHTML = '';
    if (meBox) meBox.innerHTML = '';
    if (updated) updated.textContent = '';
    box.innerHTML = html;
  };
  if (!supabaseClient) { clear('<div class="comp-empty">Disponível apenas com conta.</div>'); return; }
  clear('<div class="comp-empty">A carregar...</div>');
  try {
    const { data, error } = await supabaseClient.rpc('ranking', { p_metrica: metric, p_periodo: period });
    if (error) {
      console.error('Erro no ranking:', error);
      clear('<div class="comp-empty">Não foi possível carregar o ranking.</div>');
      return;
    }
    const rows = (data || []).map((r, i) => Object.assign({}, r, { pos: Number(r.pos) || i + 1 }));
    if (updated) updated.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    if (summary) {
      summary.innerHTML = '<span class="comp-pill">' + rows.length + ' participante(s)</span>' +
        '<span class="comp-pill">' + metricLabel + '</span>' +
        '<span class="comp-pill">' + periodLabel + '</span>';
    }
    if (!rows.length) {
      clear('<div class="comp-empty">Ainda não há participantes com atividade neste período.</div>');
      if (summary) summary.innerHTML = '<span class="comp-pill">0 participante(s)</span><span class="comp-pill">' + metricLabel + '</span><span class="comp-pill">' + periodLabel + '</span>';
      return;
    }
    const valueText = (v) => {
      const n = Number(v);
      if (!isFinite(n)) return _escComp(v) + unit;
      return (metric === 'km' ? n.toFixed(1).replace('.', ',') : String(Math.round(n))) + unit;
    };
    if (podium) {
      podium.innerHTML = rows.slice(0, 3).map((r, i) => {
        const cls = ['first', 'second', 'third'][i];
        return '<div class="comp-podium-card ' + cls + '">' +
          '<div class="comp-podium-medal">' + medals[i] + '</div>' +
          '<div class="comp-podium-name">' + _escComp(r.nome) + ' <span style="color:var(--muted);font-size: calc(10px * var(--font-scale));">' + r.pos + 'º</span></div>' +
          '<div class="comp-podium-value">' + valueText(r.valor) + '</div>' +
          '</div>';
      }).join('');
    }
    const mine = rows.find(r => r.eu);
    if (meBox) {
      if (mine) {
        const posLabel = mine.pos <= 3 ? medals[mine.pos - 1] : mine.pos + 'º';
        meBox.innerHTML = '<div class="comp-me"><span>' + posLabel + ' · ' + _escComp(mine.nome) + ' <span style="color:var(--muted);font-size: calc(11px * var(--font-scale));">(tu)</span></span>' +
          '<strong style="font-family:\'JetBrains Mono\',monospace;">' + valueText(mine.valor) + '</strong></div>';
      } else {
        meBox.innerHTML = '<div class="comp-me comp-me-empty">A tua conta ainda não tem atividade neste período.</div>';
      }
    }
    const rowsHtml = rows.map(r => {
      const pos = r.pos <= 3 ? medals[r.pos - 1] : r.pos + 'º';
      const hl = r.eu ? 'background:rgba(var(--accent-rgb),0.10);font-weight:600;' : '';
      return '<tr style="' + hl + '">' +
        '<td style="padding:10px 8px;width:48px;">' + pos + '</td>' +
        '<td style="padding:10px 8px;">' + _escComp(r.nome) + (r.eu ? ' <span style="color:var(--muted);font-size: calc(11px * var(--font-scale));">(tu)</span>' : '') + '</td>' +
        '<td style="padding:10px 8px;text-align:right;font-family:\'JetBrains Mono\',monospace;">' + valueText(r.valor) + '</td>' +
        '</tr>';
    }).join('');
    box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size: calc(14px * var(--font-scale));">' +
      '<thead><tr style="color:var(--muted);font-size: calc(11px * var(--font-scale));text-transform:uppercase;letter-spacing:1px;text-align:left;border-bottom:1px solid var(--border);">' +
      '<th style="padding:6px 8px;">#</th><th style="padding:6px 8px;">Nome</th><th style="padding:6px 8px;text-align:right;">Total</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table>';
  } catch(e) {
    console.error('Erro ao carregar o ranking:', e);
    clear('<div class="comp-empty">Não foi possível carregar o ranking.</div>');
  }
}

async function renderCompAdmin() {
  const box = document.getElementById('compAdminList');
  if (!box) return;
  if (!supabaseClient || !_compIsAdmin) { box.textContent = 'Sem acesso.'; return; }
  box.textContent = 'A carregar...';
  try {
    const [perf, part] = await Promise.all([
      supabaseClient.from('perfis').select('user_id,email,nome').order('email'),
      supabaseClient.from('competicao_participantes').select('user_id,nome_exibicao,ativo')
    ]);
    if (perf.error || part.error) {
      console.error('Erro ao listar utilizadores:', perf.error || part.error);
      box.textContent = 'Não foi possível carregar a lista de utilizadores.';
      return;
    }
    const map = {};
    (part.data || []).forEach(p => { map[p.user_id] = p; });
    if (!perf.data || !perf.data.length) { box.textContent = 'Ainda não há utilizadores.'; return; }
    box.innerHTML = perf.data.map(u => {
      const p = map[u.user_id];
      const nome = p ? p.nome_exibicao : (u.nome || '');
      const ativo = !!(p && p.ativo);
      const id = _escComp(u.user_id);
      return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border);">' +
        '<div style="flex:1 1 180px;min-width:0;font-size: calc(12px * var(--font-scale));color:var(--text2);word-break:break-all;">' + _escComp(u.email) + '</div>' +
        '<div class="field" style="flex:1 1 140px;margin:0;"><input type="text" id="compName-' + id + '" value="' + _escComp(nome) + '" placeholder="Nome a mostrar"></div>' +
        '<label style="display:flex;gap:6px;align-items:center;font-size: calc(12px * var(--font-scale));color:var(--text2);"><input type="checkbox" id="compOn-' + id + '"' + (ativo ? ' checked' : '') + '> Participa</label>' +
        '<button class="btn btn-secondary" style="font-size: calc(12px * var(--font-scale));padding:6px 12px;" onclick="saveCompUser(\'' + id + '\', this)">Guardar</button>' +
        '</div>';
    }).join('');
  } catch(e) {
    console.error('Erro ao carregar a gestão da competição:', e);
    box.textContent = 'Não foi possível carregar a lista de utilizadores.';
  }
}

async function saveCompUser(uid, btn) {
  if (!supabaseClient || !_compIsAdmin) return;
  const nome = (document.getElementById('compName-' + uid).value || '').trim();
  const ativo = document.getElementById('compOn-' + uid).checked;
  if (!nome) { alert('Indica o nome que aparece no ranking.'); return; }
  const { error } = await supabaseClient
    .from('competicao_participantes')
    .upsert({ user_id: uid, nome_exibicao: nome, ativo: ativo }, { onConflict: 'user_id' });
  if (error) { console.error('Erro ao guardar participante:', error); alert('Não foi possível guardar.'); return; }
  if (btn) { const old = btn.textContent; btn.textContent = '✓ Guardado'; setTimeout(() => { btn.textContent = old; }, 1800); }
}

// ── RECURSOS DE PALAVRA-PASSE / HASH (RETROCOMPATIBILIDADE) ──
const AUTH_KEY = 'dvAuthHash';
const FIXED_HASH = 'df5d9527c178963afb034ac6250903cae0d066858191287761a9e10438005225';
function getActiveAuthHash() { return localStorage.getItem(AUTH_KEY) || FIXED_HASH; }
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function changePassword() {
  const cur = (document.getElementById('currentPwdSettings')?.value || '').trim();
  const next = (document.getElementById('newPwdSettings')?.value || '').trim();
  const conf = (document.getElementById('confirmPwdSettings')?.value || '').trim();
  const st = document.getElementById('pwdSettingsStatus');
  if (!st) return;
  if (!cur || !next || !conf) {
    st.innerHTML = '<span style="color:var(--rose);">Preenche todos os campos.</span>';
    return;
  }
  const curHash = await sha256(cur);
  if (curHash !== getActiveAuthHash()) {
    st.innerHTML = '<span style="color:var(--rose);">Palavra-passe atual incorreta.</span>';
    return;
  }
  if (next.length < 4) {
    st.innerHTML = '<span style="color:var(--rose);">A nova palavra-passe deve ter pelo menos 4 caracteres.</span>';
    return;
  }
  if (next !== conf) {
    st.innerHTML = '<span style="color:var(--rose);">As novas palavras-passe não coincidem.</span>';
    return;
  }
  localStorage.setItem(AUTH_KEY, await sha256(next));
  if (document.getElementById('currentPwdSettings')) document.getElementById('currentPwdSettings').value = '';
  if (document.getElementById('newPwdSettings')) document.getElementById('newPwdSettings').value = '';
  if (document.getElementById('confirmPwdSettings')) document.getElementById('confirmPwdSettings').value = '';
  st.innerHTML = '<span style="color:var(--sage-l);">✓ Palavra-passe local alterada com sucesso!</span>';
}
function resetPassword() {
  const st = document.getElementById('pwdSettingsStatus');
  if (!confirm('Desejas repor a palavra-passe original pré-definida?')) return;
  localStorage.removeItem(AUTH_KEY);
  if (st) st.innerHTML = '<span style="color:var(--sage-l);">✓ Palavra-passe reposta para a predefinição original.</span>';
}

async function initAuth() {
  if (supabaseClient) {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session && session.user) {
        onUserAuthenticated(session.user);
        return;
      }
    } catch(e) {
      console.error('Erro ao verificar sessão Supabase:', e);
    }
  }

  if (localStorage.getItem('dvGuestMode') === 'true') {
    showApp({ email: 'Convidado' });
    return;
  }

  document.getElementById('authOverlay').style.display = 'flex';
  const emailInput = document.getElementById('authEmail');
  if (emailInput) emailInput.focus();
}

initAuth();

// ── FORCE 24H FORMAT ON ALL TIME INPUTS ──
// Windows ignores lang="pt" and shows AM/PM - this fixes it
function force24hInputs() {
  document.querySelectorAll('input[type="time"]').forEach(input => {
    // Convert existing value if in 12h format
    input.addEventListener('change', function() {
      // Ensure value is stored internally as HH:MM (browsers do this, but let's be safe)
    });
    // For Windows: override the displayed format by switching type temporarily
    try {
      // Test if browser respects 24h
      const test = document.createElement('input');
      test.type = 'time';
      test.value = '13:00';
      if (test.value !== '13:00') {
        // Browser is using 12h - replace with text input that validates
        const clone = document.createElement('input');
        clone.type = 'text';
        clone.placeholder = 'HH:MM';
        clone.pattern = '[0-2][0-9]:[0-5][0-9]';
        clone.maxLength = 5;
        clone.value = input.value;
        clone.id = input.id;
        clone.className = input.className;
        clone.style.cssText = input.style.cssText;
        clone.onchange = input.onchange;
        clone.oninput = function() {
          // Auto-insert colon
          let v = this.value.replace(/\D/g,'');
          if (v.length >= 3) v = v.slice(0,2) + ':' + v.slice(2,4);
          this.value = v;
          if (input.onchange) input.onchange.call(this);
        };
        input.parentNode.replaceChild(clone, input);
      }
    } catch(e) {}
  });
}



// ═══════════════════════════════════════════════════════════════════
// 1. PWA — Service Worker + Notificações
// ═══════════════════════════════════════════════════════════════════
let swRegistration = null;

async function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(APP_VERSION));
  } catch(e) { console.log('SW falhou:', e); }
}

async function requestNotifications() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

async function sendNotification(title, body) {
  if (Notification.permission !== 'granted') return;
  if (swRegistration && swRegistration.active) {
    swRegistration.active.postMessage({ type: 'SHOW_NOTIFICATION', title, body });
  } else {
    new Notification(title, { body });
  }
}

function scheduleReminders() {
  const prefs = JSON.parse(localStorage.getItem('dvReminders') || '{}');
  if (!prefs.enabled) return;
  const now = new Date();
  const check = (hourStr, title, body) => {
    if (!hourStr) return;
    const [h, m] = hourStr.split(':').map(Number);
    const target = new Date(); target.setHours(h, m, 0, 0);
    const diff = target - now;
    if (diff > 0 && diff < 60000) sendNotification(title, body);
  };
  check(prefs.manha, 'Bom dia!', 'Nao te esquecas de registar o sono.');
  check(prefs.almoco, 'Hora de almoco!', 'Regista o que comeste.');
  check(prefs.noite, 'Boa noite!', 'Completa o teu diario de hoje.');
  const sem = prefs.pesoSemana || { enabled: true, dia: 0, hora: '09:00' };
  const semDia = sem.dia === undefined || sem.dia === null ? 0 : Number(sem.dia);
  if (sem.enabled !== false && now.getDay() === semDia) {
    check(sem.hora || '09:00', 'Pesagem semanal', 'Hoje e dia de pesagem. Regista o teu peso no Diario de Vida.');
  }
  const tr = prefs.treino || { enabled: true, hora: '18:00' };
  if (tr.enabled !== false && !tmReminderSentToday('treino')) {
    const plan = tmCurrentPlan();
  const items = plan ? tmParsePlan(plan.text).filter(it => it.rest || it.distance || it.minutes) : [];
  items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const todayItem = items.find(it => it.date === TODAY && !it.rest);
    const done = DB[TODAY] && (parseFloat(DB[TODAY].treadmillTime) > 0 || parseFloat(DB[TODAY].treadmillDistance) > 0);
    if (todayItem && !done) {
      check(tr.hora || '18:00', '🏃 Treino de hoje', (tmPlanReminderText(todayItem)) + ' Abre o Diario de Vida para registar.');
      const [th, tm2] = (tr.hora || '18:00').split(':').map(Number);
      const tgt = new Date(); tgt.setHours(th, tm2, 0, 0);
      const d = tgt - now;
      if (d > 0 && d < 60000) tmReminderMarkSent('treino');
    }
  }
}
function tmReminderSentToday(kind) {
  try { const s = JSON.parse(localStorage.getItem('dvReminderSent') || '{}'); return s[kind] === TODAY; } catch (e) { return false; }
}
function tmReminderMarkSent(kind) {
  try {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('dvReminderSent') || '{}'); } catch (e) {}
    s[kind] = TODAY;
    localStorage.setItem('dvReminderSent', JSON.stringify(s));
  } catch (e) {}
}
function tmPlanReminderText(it) {
  const bits = [];
  if (it.distance) bits.push(it.distance + ' km');
  if (it.minutes) bits.push(Math.round(it.minutes) + ' min');
  return bits.length ? 'Hoje: ' + bits.join(' · ') + '.' : 'Tens uma sessão planeada para hoje.';
}
setInterval(scheduleReminders, 60000);

// ═══════════════════════════════════════════════════════════════════
// 2. TENDÊNCIAS
// ═══════════════════════════════════════════════════════════════════
function getSleepH(day) {
  if (!day || !day.bedtime || !day.waketime) return 0;
  const [bh,bm] = day.bedtime.split(':').map(Number);
  const [wh,wm] = day.waketime.split(':').map(Number);
  let bM=bh*60+bm, wM=wh*60+wm;
  if (wM<bM) wM+=24*60;
  return (wM-bM)/60;
}

function calcWeekAvg(metric, weeksAgo) {
  const vals = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - (weeksAgo*7) - i);
    const day = DB[localDateStr(d)];
    if (!day) continue;
    let val = null;
    if (metric === 'sleep') val = getSleepH(day) || null;
    else if (metric === 'weight') val = day.weight ? +day.weight : null;
    else if (metric === 'water') val = day.waterCount || null;
    else if (metric === 'habits') val = day.habitsDone ? Object.values(day.habitsDone).filter(Boolean).length || null : null;
    if (val !== null) vals.push(val);
  }
  return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
}

function renderTrends() {
  const el = document.getElementById('trendsPanel');
  if (!el) return;
  const metrics = [
    {key:'sleep', label:'Sono', unit:'h', icon:'🌙', invertGood:false},
    {key:'weight', label:'Peso', unit:'kg', icon:'⚖️', invertGood:true},
  ];
  el.innerHTML = metrics.map(m => {
    const curr = calcWeekAvg(m.key, 0);
    const prev = calcWeekAvg(m.key, 1);
    const pct = (curr !== null && prev !== null && prev !== 0) ? ((curr-prev)/Math.abs(prev)*100) : null;
    const val = curr !== null ? curr.toFixed(1) : '—';
    let arrow = '';
    if (pct !== null) {
      const good = m.invertGood ? pct < 0 : pct > 0;
      arrow = `<span style="color:${good?'var(--moss-l)':'#f87171'};font-size: calc(11px * var(--font-scale));">${pct>0?'↑':'↓'} ${Math.abs(pct).toFixed(0)}%</span>`;
    }
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;">
      <span style="font-size: calc(22px * var(--font-scale));">${m.icon}</span>
      <div style="flex:1;">
        <div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--muted);text-transform:uppercase;letter-spacing:1px;">${m.label}</div>
        <div style="font-size: calc(18px * var(--font-scale));color:var(--text);">${val}${curr!==null?'<span style="font-size: calc(11px * var(--font-scale));color:var(--muted);"> '+m.unit+'</span>':''}</div>
      </div>
      <div style="text-align:right;">${arrow}<div style="font-size: calc(10px * var(--font-scale));color:var(--faint);font-family:'JetBrains Mono',monospace;">vs sem. ant.</div></div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// 3. CONQUISTAS
// ═══════════════════════════════════════════════════════════════════
const ACHIEVEMENTS = [
  {id:'first_save',    icon:'🌱', title:'Primeiro registo',  desc:'Guardaste o teu primeiro dia',               check:()=>Object.keys(DB).length>=1},
  {id:'week_streak',   icon:'🔥', title:'7 dias seguidos',   desc:'Registaste 7 dias consecutivos',             check:()=>checkStreak(7)},
  {id:'month_streak',  icon:'💎', title:'30 dias seguidos',  desc:'Registaste 30 dias consecutivos',            check:()=>checkStreak(30)},
  {id:'sleep_week',    icon:'🌙', title:'Dorminhoco',        desc:'7+ horas de sono durante 5 dias',            check:()=>countDaysWhere(d=>getSleepH(d)>=7,7)>=5},
  {id:'weight_loss_1', icon:'⚖️', title:'Primeiro kg',      desc:'Perdeste 1kg desde o início',                check:()=>checkWeightLoss(1)},
  {id:'weight_loss_5', icon:'🏆', title:'5kg perdidos',      desc:'Perdeste 5kg desde o início',                check:()=>checkWeightLoss(5)},
  {id:'perfect_day',   icon:'⭐', title:'Dia perfeito',      desc:'7+ horas de sono e treino de passadeira no mesmo dia', check:()=>countDaysWhere(d=>getSleepH(d)>=7&&parseFloat(d.treadmillDistance)>0,30)>=1},
];

function checkStreak(days) {
  let streak = 0;
  for (let i = 0; i <= days+5; i++) {
    const d = new Date(); d.setDate(d.getDate()-i);
    if (DB[localDateStr(d)]?.savedAt) streak++; else break;
  }
  return streak >= days;
}

function countDaysWhere(fn, lastN) {
  let count = 0;
  for (let i = 0; i < lastN; i++) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const day = DB[localDateStr(d)];
    if (day && fn(day)) count++;
  }
  return count;
}

function checkWeightLoss(kg) {
  const days = Object.keys(DB).sort();
  if (days.length < 2) return false;
  const first = +DB[days[0]].weight;
  const last = +DB[days[days.length-1]].weight;
  return first && last && (first-last) >= kg;
}

function showAchievementToast(a) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;right:20px;background:var(--card);border:1px solid var(--moss);border-radius:14px;padding:14px 18px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.5);display:flex;align-items:center;gap:12px;';
  t.innerHTML = `<span style="font-size: calc(28px * var(--font-scale));">${a.icon}</span><div><div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--moss-l);letter-spacing:1px;">CONQUISTA</div><div style="font-size: calc(14px * var(--font-scale));color:var(--text);">${a.title}</div></div>`;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 4000);
}

function checkAchievements() {
  const unlocked = JSON.parse(localStorage.getItem('dvAchievements')||'[]');
  const newUnlocks = [];
  ACHIEVEMENTS.forEach(a => { try { if (!unlocked.includes(a.id) && a.check()) { unlocked.push(a.id); newUnlocks.push(a); } } catch (e) {} });
  if (newUnlocks.length) {
    cfgSave('dvAchievements', JSON.stringify(unlocked));
    newUnlocks.forEach(a => showAchievementToast(a));
  }
  renderAchievements();
}

function renderAchievements() {
  const el = document.getElementById('achievementsPanel');
  if (!el) return;
  const unlocked = JSON.parse(localStorage.getItem('dvAchievements')||'[]');
  el.innerHTML = ACHIEVEMENTS.map(a => {
    const done = unlocked.includes(a.id);
    return `<div style="background:${done?'var(--surface)':'transparent'};border:1px solid ${done?'rgba(var(--accent-rgb),0.3)':'var(--border)'};border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px;">
      <span style="font-size: calc(26px * var(--font-scale));filter:${done?'none':'grayscale(1)'};">${a.icon}</span>
      <div><div style="font-size: calc(13px * var(--font-scale));color:${done?'var(--text)':'var(--muted)'};">${a.title}</div>
      <div style="font-size: calc(11px * var(--font-scale));color:var(--muted);">${a.desc}</div>
      ${done?'<div style="font-size: calc(10px * var(--font-scale));color:var(--moss-l);font-family:\'JetBrains Mono\',monospace;margin-top:3px;">✓ desbloqueada</div>':''}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// 4. RESUMO SEMANAL COM IA
// ═══════════════════════════════════════════════════════════════════
async function generateWeeklySummary(force) {
  const lastKey = 'dvLastWeeklySummary';
  const now = new Date();
  if (!force) {
    const last = localStorage.getItem(lastKey);
    if (now.getDay() !== 1) return;
    if (last && new Date(last).toDateString() === now.toDateString()) return;
  }
  const el = document.getElementById('weeklySummaryResponse');
  const btn = document.getElementById('weeklySummaryBtn');
  const tools = document.getElementById('weeklyShareTools');
  if (!el) return;
  el.style.display='block';
  if (tools) tools.hidden = true;
  el.innerHTML='<span style="color:var(--muted);font-style:italic;">A gerar resumo semanal...</span>';
  if (btn) btn.disabled=true;

  const stats=[];
  for (let i=1;i<=7;i++) {
    const d=new Date(); d.setDate(d.getDate()-i);
    const key=localDateStr(d);
    const day=DB[key]; if(!day) continue;
    let cal=0;
    if(day.meals){const mv=typeof day.meals==='object'&&!Array.isArray(day.meals)?Object.values(day.meals).flat():day.meals;cal=mv.reduce((s,m)=>s+(parseInt(m.cal)||0),0);}
    const ex=QUICK_EXERCISES.filter(e=>day.habitsDone&&day.habitsDone[e.id]).length;
    stats.push(`${key}: sono=${getSleepH(day).toFixed(1)}h, peso=${day.weight||'?'}kg, cal=${cal}kcal, passadeira=${day.treadmillDistance||0}km`);
  }
  if (!stats.length) { el.innerHTML='<span style="color:var(--muted);">Sem dados suficientes.</span>'; if(btn) btn.disabled=false; return; }

  try {
    const txt = await callGemini(
      'Coach de saude holistica em Portugal. Tom caloroso e direto.',
      'Dados da semana:\n'+stats.join('\n')+'\n\nFaz um resumo motivador com pontos positivos, areas a melhorar e 3 sugestoes concretas para a proxima semana. Max 250 palavras.',
      900
    );
    el.innerHTML = txt.replace(/\n/g,'<br>');
    if (tools) tools.hidden = false;
    localStorage.setItem(lastKey, now.toISOString());
  } catch(err) {
    el.innerHTML='<span style="color:var(--rose);">Erro ao gerar resumo. Verifica a chave Groq.</span>';
  }
  if (btn) btn.disabled=false;
}

function weeklySummaryText() {
  const el = document.getElementById('weeklySummaryResponse');
  return el ? el.innerText.trim() : '';
}

function weeklyShareFeedback(btn, text) {
  if (!btn) return;
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1800);
}

async function copyWeeklySummary(btn) {
  const text = weeklySummaryText();
  if (!text) { alert('Gera primeiro o resumo semanal.'); return; }
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (e) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { copied = document.execCommand('copy'); } catch (err) {}
    area.remove();
  }
  if (copied) weeklyShareFeedback(btn, 'Copiado!');
  else alert('Não foi possível copiar o resumo.');
}

async function shareWeeklySummary(btn) {
  const text = weeklySummaryText();
  if (!text) { alert('Gera primeiro o resumo semanal.'); return; }
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Resumo semanal · Diário de Vida', text });
      return;
    } catch (e) {}
  }
  copyWeeklySummary(btn);
}

// ═══════════════════════════════════════════════════════════════════
// 5. LEMBRETES — Modal de configuração
// ═══════════════════════════════════════════════════════════════════
function openRemindersModal() {
  const modal = document.getElementById('remindersModal');
  if (!modal) return;
  const prefs = JSON.parse(localStorage.getItem('dvReminders')||'{}');
  document.getElementById('remManha').value = prefs.manha||'08:00';
  document.getElementById('remAlmoco').value = prefs.almoco||'13:00';
  document.getElementById('remNoite').value = prefs.noite||'22:00';
  const sem = prefs.pesoSemana || { enabled: true, dia: 0, hora: '09:00' };
  const semHora = document.getElementById('remPesoHora');
  const semDia = document.getElementById('remPesoDia');
  const semEnabled = document.getElementById('remPesoEnabled');
  if (semHora) semHora.value = sem.hora || '09:00';
  if (semDia) semDia.value = String(sem.dia === undefined || sem.dia === null ? 0 : sem.dia);
  if (semEnabled) semEnabled.checked = sem.enabled !== false;
  const tr = prefs.treino || { enabled: true, hora: '18:00' };
  const trHora = document.getElementById('remTreinoHora');
  const trEnabled = document.getElementById('remTreinoEnabled');
  if (trHora) trHora.value = tr.hora || '18:00';
  if (trEnabled) trEnabled.checked = tr.enabled !== false;
  const maxEl = document.getElementById('remMaxDia');
  if (maxEl) maxEl.value = String(hxNotifMax());
  document.getElementById('remEnabled').checked = prefs.enabled!==false;
  try { hxPushStatus(); } catch (e) {}
  try { hxSyncStatus(); } catch (e) {}
  modal.classList.add('open');
}

function closeRemindersModal() {
  document.getElementById('remindersModal')?.classList.remove('open');
}

async function saveReminders() {
  const granted = await requestNotifications();
  let old = {};
  try { old = JSON.parse(localStorage.getItem('dvReminders') || '{}'); } catch (e) {}
  const prefs = Object.assign({}, old, {
    enabled: document.getElementById('remEnabled').checked,
    manha: document.getElementById('remManha').value,
    almoco: document.getElementById('remAlmoco').value,
    noite: document.getElementById('remNoite').value,
    pesoSemana: {
      enabled: document.getElementById('remPesoEnabled') ? document.getElementById('remPesoEnabled').checked : true,
      dia: parseInt(document.getElementById('remPesoDia') && document.getElementById('remPesoDia').value, 10) || 0,
      hora: (document.getElementById('remPesoHora') && document.getElementById('remPesoHora').value) || '09:00'
    },
    treino: {
      enabled: document.getElementById('remTreinoEnabled') ? document.getElementById('remTreinoEnabled').checked : true,
      hora: (document.getElementById('remTreinoHora') && document.getElementById('remTreinoHora').value) || '18:00'
    }
  });
  cfgSave('dvReminders', JSON.stringify(prefs));
  const maxEl = document.getElementById('remMaxDia');
  hxWrite(HX_NOTIF_MAX_KEY, maxEl ? Math.max(1, Math.min(5, parseInt(maxEl.value, 10) || 3)) : hxNotifMax());

  // guarda na nuvem mesmo sem autorização de notificações: são coisas diferentes
  const sync = await hxPushSyncSettings().catch(() => ({ ok: false, msg: 'falha de rede' }));
  if (granted && hxRead(HX_PUSH_FLAG, false) === true) { try { await hxPushSubscribe(); } catch (e) {} }
  closeRemindersModal();

  if (!sync.ok) {
    hxToast('Guardado neste dispositivo. A nuvem não recebeu: ' + sync.msg + '.');
    return;
  }
  if (!granted) {
    hxToast('Preferências guardadas. Falta autorizar as notificações no browser para receberes os avisos.');
    return;
  }
  sendNotification('🔔 Lembretes ativados!', 'Vais receber lembretes diários, no máximo ' + hxNotifMax() + ' por dia.', true);
}

// Inicializar
// ═══════════════════════════════════════════════════════════════════
// SETTINGS PAGE — funções
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// ÚLTIMOS 5 DIAS
// ═══════════════════════════════════════════════════════════════════


function n90GetState() {
  const raw = localStorage.getItem('n90State');
  return raw ? JSON.parse(raw) : null;
}

function n90SaveState(state) {
  localStorage.setItem('n90State', JSON.stringify(state));
}

function n90Init() {
  if (!confirm('Iniciar o teu plano de 90 dias a partir de hoje?')) return;
  const state = {
    startDate: TODAY,
    weekFocus: {},   // { 'YYYY-Www': { text, date } }
    dailyChecks: {}, // { 'YYYY-MM-DD': [checked ids] }
  };
  n90SaveState(state);
  renderN90();
}

function n90Reset() {
  if (!confirm('Tens a certeza? Perdes o progresso guardado.')) return;
  localStorage.removeItem('n90State');
  renderN90();
}

function n90DayNum(startDate) {
  const start = new Date(startDate + 'T12:00:00');
  const now   = new Date(TODAY + 'T12:00:00');
  return Math.max(1, Math.min(90, Math.round((now - start) / 86400000) + 1));
}

function n90WeekNum(dayNum) {
  return Math.min(13, Math.ceil(dayNum / 7));
}

function renderN90() {
  const state = n90GetState();
  document.getElementById('n90-start-screen').style.display  = state ? 'none' : '';
  document.getElementById('n90-active-screen').style.display = state ? ''     : 'none';
  if (!state) return;

  const dayNum  = n90DayNum(state.startDate);
  const weekNum = n90WeekNum(dayNum);
  const pct     = Math.round((dayNum / 90) * 100);

  // Progresso
  document.getElementById('n90-day-num').textContent      = dayNum;
  document.getElementById('n90-week-num').textContent      = weekNum;
  document.getElementById('n90-progress-bar').style.width = pct + '%';

  // Datas início/fim
  const startD = new Date(state.startDate + 'T12:00:00');
  const endD   = new Date(startD); endD.setDate(endD.getDate() + 89);
  document.getElementById('n90-start-label').textContent = state.startDate;
  document.getElementById('n90-end-label').textContent   = localDateStr(endD);
  document.getElementById('n90-subtitle').textContent    = `dia ${dayNum} de 90 · semana ${weekNum}`;

  // Fase atual
  const phase = N90_PHASES.find(p => dayNum >= p.days[0] && dayNum <= p.days[1]) || N90_PHASES[0];
  document.getElementById('n90-phase-icon').textContent  = phase.icon;
  document.getElementById('n90-phase-name').textContent  = phase.name;
  document.getElementById('n90-phase-label').textContent = phase.label;
  document.getElementById('n90-phase-desc').textContent  = phase.desc;
  const phaseCard = document.getElementById('n90-phase-card');
  phaseCard.style.background = phase.color;
  phaseCard.style.borderColor = phase.border;

  // Foco da semana guardado
  const weekKey = getISOWeek(new Date(TODAY + 'T12:00:00'));
  const savedFocus = state.weekFocus && state.weekFocus[weekKey];
  if (savedFocus) {
    document.getElementById('n90-week-content').innerHTML = n90WeekHtml(savedFocus.text);
  }

  // Checklist diária
  n90RenderDailyChecks(state);

  // Roadmap
  n90RenderRoadmap(weekNum);
}

function n90WeekHtml(text) {
  // Converte markdown simples em HTML
  const lines = text.split('\n').filter(l => l.trim());
  let html = '';
  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('##')) {
      html += `<div style="font-family:'Source Serif 4',serif;font-size: calc(15px * var(--font-scale));color:var(--text);margin:14px 0 6px;font-weight:600;">${trimmed.replace(/^##\s*/,'')}</div>`;
    } else if (trimmed.startsWith('#')) {
      html += `<div style="font-family:'Source Serif 4',serif;font-size: calc(17px * var(--font-scale));color:var(--moss-l);margin:0 0 10px;font-weight:600;">${trimmed.replace(/^#\s*/,'')}</div>`;
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      html += `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);"><span style="color:var(--moss);flex-shrink:0;">▸</span><span style="font-size: calc(12px * var(--font-scale));color:var(--text2);line-height:1.5;">${trimmed.replace(/^[-•]\s*/,'')}</span></div>`;
    } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      html += `<div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin:10px 0 4px;">${trimmed.replace(/\*\*/g,'')}</div>`;
    } else if (trimmed) {
      html += `<p style="font-size: calc(12px * var(--font-scale));color:var(--text2);line-height:1.6;margin:6px 0;">${trimmed}</p>`;
    }
  });
  return html || text;
}

function n90RenderDailyChecks(state) {
  const container = document.getElementById('n90-daily-checks');
  // Preferir dados da DB (sincronizados) sobre localStorage
  const dbChecks = DB[TODAY] && DB[TODAY].n90Checks ? DB[TODAY].n90Checks.split(',').filter(Boolean) : null;
  const saved     = dbChecks || (state.dailyChecks && state.dailyChecks[TODAY]) || [];
  const allChecks = [
    ...N90_DAILY_CHECKS.mindset.map((t,i)    => ({ id:`m${i}`, cat:'🧠 Mindset',     text:t })),
    ...N90_DAILY_CHECKS.fisico.map((t,i)     => ({ id:`f${i}`, cat:'💪 Físico',      text:t })),
    ...N90_DAILY_CHECKS.trabalho.map((t,i)   => ({ id:`w${i}`, cat:'💼 Trabalho',    text:t })),
    ...N90_DAILY_CHECKS.alimentacao.map((t,i)=> ({ id:`a${i}`, cat:'🥗 Alimentação', text:t })),
  ];

  let lastCat = '';
  let html = '';
  allChecks.forEach(c => {
    if (c.cat !== lastCat) {
      html += `<div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-top:10px;margin-bottom:4px;">${c.cat}</div>`;
      lastCat = c.cat;
    }
    const done = saved.includes(c.id);
    html += `
      <div onclick="n90ToggleCheck('${c.id}')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;background:${done ? 'rgba(var(--accent-rgb),0.08)' : 'var(--surface)'};border:1px solid ${done ? 'rgba(var(--accent-rgb),0.3)' : 'var(--border)'};transition:all 0.15s;">
        <div style="width:18px;height:18px;border-radius:5px;border:2px solid ${done ? 'var(--moss)' : 'var(--border)'};background:${done ? 'var(--moss)' : 'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size: calc(11px * var(--font-scale));color:#0f172a;font-weight:700;">${done ? '✓' : ''}</div>
        <span style="font-size: calc(12px * var(--font-scale));color:${done ? 'var(--muted)' : 'var(--text2)'};text-decoration:${done ? 'line-through' : 'none'};">${c.text}</span>
      </div>`;
  });

  const doneCount = allChecks.filter(c => saved.includes(c.id)).length;
  const total     = allChecks.length;
  const pct       = Math.round((doneCount/total)*100);
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <div style="flex:1;background:var(--surface);border-radius:99px;height:6px;overflow:hidden;">
        <div style="height:100%;background:linear-gradient(90deg,var(--moss-d),var(--moss-l));border-radius:99px;width:${pct}%;transition:width 0.3s;"></div>
      </div>
      <span style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--moss-l);">${doneCount}/${total}</span>
    </div>
    ${html}`;
}

function n90ToggleCheck(id) {
  const state = n90GetState(); if (!state) return;
  if (!state.dailyChecks) state.dailyChecks = {};
  if (!state.dailyChecks[TODAY]) state.dailyChecks[TODAY] = [];
  const arr = state.dailyChecks[TODAY];
  const idx = arr.indexOf(id);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
  n90SaveState(state);

  // Guardar também na DB principal para sync com Sheets
  if (!DB[TODAY]) DB[TODAY] = {};
  DB[TODAY].n90Checks = arr.join(',');
  DB[TODAY].n90Score  = arr.length;
  saveData();

  n90RenderDailyChecks(state);
}

function n90RenderRoadmap(currentWeek) {
  const container = document.getElementById('n90-roadmap');
  let html = '';
  let lastPhase = 0;

  N90_WEEKS.forEach(w => {
    if (w.phase !== lastPhase) {
      const p = N90_PHASES[w.phase - 1];
      html += `<div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin:12px 0 6px;padding-left:4px;">${p.icon} ${p.name.toUpperCase()}</div>`;
      lastPhase = w.phase;
    }
    const isCurrent  = w.w === currentWeek;
    const isPast     = w.w < currentWeek;
    const bg     = isCurrent ? 'rgba(var(--accent-rgb),0.1)' : isPast ? 'rgba(100,116,139,0.06)' : 'var(--surface)';
    const border = isCurrent ? '1.5px solid var(--moss)' : '1px solid var(--border)';
    const numCol = isCurrent ? 'var(--moss-l)' : isPast ? 'var(--muted)' : 'var(--text2)';
    html += `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;background:${bg};border:${border};">
        <div style="font-family:'JetBrains Mono',monospace;font-size: calc(11px * var(--font-scale));font-weight:700;color:${numCol};min-width:24px;padding-top:1px;">W${w.w}</div>
        <div style="flex:1;">
          <div style="font-size: calc(12px * var(--font-scale));font-weight:600;color:${isCurrent ? 'var(--text)' : isPast ? 'var(--muted)' : 'var(--text2)'};margin-bottom:2px;">${w.theme} ${w.focus}</div>
          <div style="font-size: calc(11px * var(--font-scale));color:var(--muted);line-height:1.5;">${w.desc}</div>
        </div>
        ${isPast ? '<div style="font-size: calc(14px * var(--font-scale));">✓</div>' : ''}
        ${isCurrent ? '<div style="font-family:\'JetBrains Mono\',monospace;font-size: calc(10px * var(--font-scale));background:var(--moss);color:#0f172a;border-radius:4px;padding:2px 6px;font-weight:700;white-space:nowrap;align-self:center;">AGORA</div>' : ''}
      </div>`;
  });
  container.innerHTML = html;
}

async function n90GenerateWeek() {
  const state  = n90GetState(); if (!state) return;
  const btn    = document.getElementById('n90-gen-btn');
  const status = document.getElementById('n90-ai-status');
  const content= document.getElementById('n90-week-content');
  const groqKey = getGroqKey();
  if (!groqKey) { alert('Configura a chave Groq em ⚙️ Configurações primeiro.'); return; }

  const dayNum  = n90DayNum(state.startDate);
  const weekNum = n90WeekNum(dayNum);
  const weekDef = N90_WEEKS[weekNum - 1] || N90_WEEKS[0];

  // Recolher dados reais dos últimos 7 dias
  const last7 = getLastNDays(7);
  const stats = { sonoMedio:0, pesoAtual:'—', humorMedio:0, aguaMedia:0, diasTrabalhados:0, diasCount:0 };
  last7.forEach(date => {
    const d = DB[date]; if (!d) return;
    stats.diasCount++;
    if (d.bedtime && d.waketime) {
      const [bh,bm]=d.bedtime.split(':').map(Number),[wh,wm]=d.waketime.split(':').map(Number);
      let bM=bh*60+bm,wM=wh*60+wm; if(wM<bM) wM+=24*60;
      stats.sonoMedio += (wM-bM)/60;
    }
    if (d.weight) stats.pesoAtual = d.weight + 'kg';
    if (d.selectedMood) stats.humorMedio++;
    if (d.waterCount) stats.aguaMedia += parseInt(d.waterCount)||0;
    if (d.workStart && d.workEnd) stats.diasTrabalhados++;
  });
  if (stats.diasCount > 0) {
    stats.sonoMedio  = (stats.sonoMedio / stats.diasCount).toFixed(1);
    stats.aguaMedia  = (stats.aguaMedia / stats.diasCount).toFixed(1);
  }

  btn.textContent = '⏳ a gerar...';
  btn.disabled = true;
  status.style.display = 'block';
  status.textContent = 'A analisar os teus dados e gerar plano personalizado...';

  const systemPrompt = `És um coach de alta performance. Responde sempre em português de Portugal. Sê direto, prático e motivador. Usa listas curtas com ações concretas.`;

  const userPrompt = `Estou no Dia ${dayNum} (Semana ${weekNum}/13) do meu plano de 90 dias de alta performance.

FASE ATUAL: ${N90_PHASES.find(p=>dayNum>=p.days[0]&&dayNum<=p.days[1])?.name} — ${weekDef.focus}

DADOS REAIS DOS ÚLTIMOS 7 DIAS:
- Sono médio: ${stats.sonoMedio}h (objetivo: 7-8h)
- Peso atual: ${stats.pesoAtual}
- Copos de água/dia: ${stats.aguaMedia} (objetivo: 8)
- Dias de trabalho registados: ${stats.diasTrabalhados}/7

Gera o FOCO DESTA SEMANA com:
# Semana ${weekNum} — ${weekDef.focus}

**PRIORIDADE 1**
- [1 ação específica de mindset/disciplina]

**PRIORIDADE 2**
- [1 ação de performance física baseada nos meus dados]

**PRIORIDADE 3**
- [1 ação de trabalho/produtividade]

**ALIMENTAÇÃO**
- [1 ação de nutrição]

**ALERTA DA SEMANA**
- [1 frase direta sobre o que precisas de melhorar com base nos dados]

Máximo 200 palavras. Sem fluff. Ações concretas e mensuráveis.`;

  try {
    const text = await callGemini(systemPrompt, userPrompt, 600);
    const weekKey = getISOWeek(new Date(TODAY + 'T12:00:00'));
    if (!state.weekFocus) state.weekFocus = {};
    state.weekFocus[weekKey] = { text, date: TODAY };
    n90SaveState(state);
    content.innerHTML = n90WeekHtml(text);
    status.textContent = '✓ gerado em ' + new Date().toLocaleTimeString('pt-PT', {hour:'2-digit',minute:'2-digit'});
    setTimeout(() => { status.style.display = 'none'; }, 3000);
  } catch(err) {
    status.textContent = '✗ erro: ' + err.message;
  }
  btn.textContent = '🤖 gerar com IA';
  btn.disabled = false;
}

function renderLast5Days() {
  const container = document.getElementById('last5Container');
  if (!container) return;

  const days = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(localDateStr(d));
  }

  const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  let html = '';

  days.forEach(dateStr => {
    const data = DB[dateStr] || {};
    const isToday = dateStr === TODAY;
    const d = new Date(dateStr + 'T12:00:00');
    const label = isToday ? 'Hoje' : dayNames[d.getDay()];
    const dateLabel = d.getDate() + ' ' + monthNames[d.getMonth()];

    // ── SONO ──
    let sonoTxt = '—';
    let sonoSub = '';
    let sonoColor = 'var(--muted)';
    if (data.bedtime && data.waketime) {
      const [bh,bm] = data.bedtime.split(':').map(Number);
      const [wh,wm] = data.waketime.split(':').map(Number);
      let bMin = bh*60+bm, wMin = wh*60+wm;
      if (wMin < bMin) wMin += 24*60;
      const h = ((wMin - bMin)/60);
      sonoTxt = h.toFixed(1) + 'h';
      sonoSub = data.bedtime + ' → ' + data.waketime;
      sonoColor = h >= 7 ? 'var(--moss-l)' : h >= 6 ? 'var(--amber, #f59e0b)' : '#f87171';
    } else if (isToday) {
      sonoTxt = 'por registar';
    }

    // ── PESO ──
    let pesoTxt = '—';
    let pesoSub = '';
    let pesoColor = 'var(--muted)';
    if (data.weight) {
      pesoTxt = data.weight + ' kg';
      if (data.weightGoal) {
        const diff = (parseFloat(data.weight) - parseFloat(data.weightGoal)).toFixed(1);
        pesoSub = diff > 0 ? '↑ ' + diff + 'kg acima da meta' : diff < 0 ? '✓ abaixo da meta' : '= na meta';
        pesoColor = diff <= 0 ? 'var(--moss-l)' : 'var(--muted)';
      }
    } else if (isToday) {
      pesoTxt = 'por registar';
    }

    // ── TRABALHO ──
    let trabalhoTxt = '—';
    let trabalhoSub = '';
    let trabalhoColor = 'var(--muted)';
    if (data.workStart && data.workEnd) {
      const [sh,sm] = data.workStart.split(':').map(Number);
      const [eh,em] = data.workEnd.split(':').map(Number);
      let sMin = sh*60+sm, eMin = eh*60+em;
      if (eMin < sMin) eMin += 24*60;
      const totalMin = eMin - sMin;
      const lunchMin = 60; // pausa almoço
      const netMin = totalMin - lunchMin;
      const netH = (netMin/60).toFixed(1);
      const stdMin = 8*60; // 8h standard
      const diffMin = netMin - stdMin;
      trabalhoTxt = netH + 'h';
      trabalhoSub = data.workStart + ' → ' + data.workEnd;
      if (diffMin > 0) {
        const extraH = Math.floor(diffMin/60), extraM = diffMin%60;
        trabalhoSub += ' · +' + extraH + 'h' + (extraM ? extraM+'m' : '') + ' extra';
        trabalhoColor = '#f87171';
      } else if (diffMin < 0) {
        const faltaH = Math.floor(-diffMin/60), faltaM = (-diffMin)%60;
        trabalhoSub += ' · -' + faltaH + 'h' + (faltaM ? faltaM+'m' : '') + ' em falta';
        trabalhoColor = 'var(--amber, #f59e0b)';
      } else {
        trabalhoColor = 'var(--moss-l)';
      }
    } else if (data.workStart) {
      trabalhoTxt = data.workStart + ' →';
      trabalhoSub = 'saída não registada';
      trabalhoColor = 'var(--amber, #f59e0b)';
    } else if (isToday) {
      trabalhoTxt = 'por registar';
    }

    html += `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:14px;${isToday ? 'border-color:var(--moss);' : ''}">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px;">
        <span style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size: calc(15px * var(--font-scale));color:${isToday ? 'var(--moss-l)' : 'var(--text1)'};">${label}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--muted);">${dateLabel}</span>
        ${isToday ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size: calc(10px * var(--font-scale));background:var(--moss);color:#0a0d13;padding:2px 7px;border-radius:20px;margin-left:auto;">hoje</span>' : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">

        <div style="background:var(--bg);border-radius:10px;padding:12px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">🌙 Sono</div>
          <div style="font-size: calc(18px * var(--font-scale));font-weight:700;color:${sonoColor};font-family:'JetBrains Mono',monospace;overflow-wrap:anywhere;">${sonoTxt}</div>
          <div style="font-size: calc(10px * var(--font-scale));color:var(--muted);margin-top:3px;font-family:'JetBrains Mono',monospace;">${sonoSub}</div>
        </div>

        <div style="background:var(--bg);border-radius:10px;padding:12px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">⚖️ Peso</div>
          <div style="font-size: calc(18px * var(--font-scale));font-weight:700;color:${pesoColor};font-family:'JetBrains Mono',monospace;overflow-wrap:anywhere;">${pesoTxt}</div>
          <div style="font-size: calc(10px * var(--font-scale));color:var(--muted);margin-top:3px;font-family:'JetBrains Mono',monospace;">${pesoSub}</div>
        </div>

        <div style="background:var(--bg);border-radius:10px;padding:12px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size: calc(10px * var(--font-scale));color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">💼 Trabalho</div>
          <div style="font-size: calc(18px * var(--font-scale));font-weight:700;color:${trabalhoColor};font-family:'JetBrains Mono',monospace;overflow-wrap:anywhere;">${trabalhoTxt}</div>
          <div style="font-size: calc(10px * var(--font-scale));color:var(--muted);margin-top:3px;font-family:'JetBrains Mono',monospace;">${trabalhoSub}</div>
        </div>

      </div>
    </div>`;
  });

  if (!html) {
    html = '<div style="text-align:center;color:var(--muted);padding:40px;font-family:\'JetBrains Mono\',monospace;font-size: calc(12px * var(--font-scale));">Sem registos nos últimos 5 dias.</div>';
  }

  container.innerHTML = html;
}

// ── PREFERÊNCIAS DE APARÊNCIA (fonte + cor) ──
const UI_PREF_KEY = 'dvUiPrefs';
const UI_FONTS = {
  serif:   { label: 'Clássica', css: "'Lora', Georgia, serif" },
  sans:    { label: 'Moderna',  css: "'Inter', system-ui, sans-serif" },
  rounded: { label: 'Redonda',  css: "'Nunito', system-ui, sans-serif" },
  mono:    { label: 'Técnica',  css: "'JetBrains Mono', monospace" }
};
const UI_TEXT_SIZES = {
  normal: { label: 'Normal',       scale: 1 },
  large:  { label: 'Grande',       scale: 1.12 },
  xlarge: { label: 'Muito grande', scale: 1.25 }
};
const UI_ACCENTS = {
  teal:   { label: 'Turquesa', c: '#2dd4bf', l: '#5eead4', d: '#0f9588', rgb: '45, 212, 191' },
  sky:    { label: 'Azul',     c: '#60a5fa', l: '#93c5fd', d: '#2563eb', rgb: '96, 165, 250' },
  violet: { label: 'Violeta',  c: '#a78bfa', l: '#c4b5fd', d: '#7c3aed', rgb: '167, 139, 250' },
  rose:   { label: 'Rosa',     c: '#f472b6', l: '#f9a8d4', d: '#db2777', rgb: '244, 114, 182' },
  green:  { label: 'Verde',    c: '#4ade80', l: '#86efac', d: '#16a34a', rgb: '74, 222, 128' },
  amber:  { label: 'Âmbar',    c: '#f59e0b', l: '#fcd34d', d: '#b45309', rgb: '245, 158, 11' }
};
function uiGetPrefs() {
  try { return JSON.parse(localStorage.getItem(UI_PREF_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function uiSavePrefs(p) {
  try { localStorage.setItem(UI_PREF_KEY, JSON.stringify(p)); } catch (e) {}
}
function uiFontScale() {
  const p = uiGetPrefs();
  return (UI_TEXT_SIZES[p.textSize] || UI_TEXT_SIZES.normal).scale;
}
function chartFont(px, family) {
  return (px * uiFontScale()).toFixed(2) + 'px ' + family;
}
function applyUiPrefs() {
  const p = uiGetPrefs();
  const font = UI_FONTS[p.font] ? p.font : 'serif';
  const textSize = UI_TEXT_SIZES[p.textSize] ? p.textSize : 'normal';
  const accent = UI_ACCENTS[p.accent] ? p.accent : 'teal';
  const root = document.documentElement;
  root.dataset.font = font;
  root.dataset.textSize = textSize;
  root.style.setProperty('--font-scale', UI_TEXT_SIZES[textSize].scale);
  const a = UI_ACCENTS[accent];
  root.style.setProperty('--moss', a.c);
  root.style.setProperty('--moss-l', a.l);
  root.style.setProperty('--moss-d', a.d);
  root.style.setProperty('--accent-rgb', a.rgb);
  document.querySelectorAll('[data-ui-font]').forEach(b => b.classList.toggle('active', b.dataset.uiFont === font));
  document.querySelectorAll('[data-ui-size]').forEach(b => {
    const active = b.dataset.uiSize === textSize;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-ui-accent]').forEach(b => b.classList.toggle('active', b.dataset.uiAccent === accent));
  const st = document.getElementById('uiAppearanceStatus');
  if (st) st.textContent = `Tipo de letra: ${UI_FONTS[font].label} · tamanho: ${UI_TEXT_SIZES[textSize].label} · cor: ${a.label}.`;
  try { hxApplyDayTheme(); } catch (e) {}
}
function setUiFont(key) {
  if (!UI_FONTS[key]) return;
  const p = uiGetPrefs(); p.font = key; uiSavePrefs(p); applyUiPrefs();
}
function setUiTextSize(key) {
  if (!UI_TEXT_SIZES[key]) return;
  const p = uiGetPrefs(); p.textSize = key; uiSavePrefs(p); applyUiPrefs();
  const stats = document.getElementById('section-stats');
  if (stats && stats.classList.contains('active') && typeof renderAllCharts === 'function') renderAllCharts();
}
function setUiAccent(key) {
  if (!UI_ACCENTS[key]) return;
  const p = uiGetPrefs(); p.accent = key; uiSavePrefs(p); applyUiPrefs();
}
function resetUiPrefs() {
  try { localStorage.removeItem(UI_PREF_KEY); } catch (e) {}
  applyUiPrefs();
}

function initSettingsPage() {
  initMascotSettings();
  applyUiPrefs();
  // Sheets URL
  const urlInput = document.getElementById('sheetsUrlSettingsInput');
  if (urlInput && sheetsUrl) urlInput.value = sheetsUrl;

  // AI mode, provider & OpenRouter
  const mode = getAiMode();
  const modeSel = document.getElementById('aiModeSelect');
  if (modeSel) modeSel.value = mode;
  const provider = getAiProvider();
  const providerSel = document.getElementById('aiProviderSelect');
  if (providerSel) providerSel.value = provider;
  applyAiModeUI();
  if (mode === 'app') refreshAiUsage();

  const orKeysTextarea = document.getElementById('openrouterKeysSettingsInput');
  const orKeysBadge = document.getElementById('openrouterKeysBadge');
  const orKeys = getOpenRouterKeys();
  // Só mostra chaves se não for a default (evitar expor em texto claro)
  const isDefault = orKeys.length === 1 && orKeys[0] === DEFAULT_OPENROUTER_KEY;
  if (orKeysTextarea && !isDefault && orKeys.length > 0) {
    orKeysTextarea.value = orKeys.join('\n');
  }
  if (orKeysBadge && orKeys.length > 0) {
    const n = orKeys.length;
    orKeysBadge.textContent = isDefault
      ? '🔑 1 chave default configurada'
      : `🔑 ${n} chave${n>1?'s':''} configurada${n>1?'s':''}`;
  }

  const orModel = getOpenRouterModel();
  const modelSel = document.getElementById('openrouterModelSelect');
  const customBox = document.getElementById('customModelBox');
  const customInput = document.getElementById('customModelInput');
  if (modelSel) {
    const predefined = Array.from(modelSel.options).map(o => o.value);
    if (predefined.includes(orModel)) {
      modelSel.value = orModel;
      if (customBox) customBox.style.display = 'none';
    } else {
      modelSel.value = 'custom';
      if (customBox) customBox.style.display = 'block';
      if (customInput) customInput.value = orModel;
    }
  }

  // Groq keys
  const groqTextarea = document.getElementById('groqKeysSettingsInput');
  const groqBadge = document.getElementById('groqKeysBadge');
  const groqKeys = getGroqKeys();
  if (groqTextarea && groqKeys.length > 0) groqTextarea.value = groqKeys.join('\n');
  if (groqBadge && groqKeys.length > 0) {
    const n = groqKeys.length;
    groqBadge.textContent = `🔑 ${n} chave${n>1?'s':''} configurada${n>1?'s':''}`;
  }

  // HF keys
  const hfTextarea = document.getElementById('hfKeysSettingsInput');
  const hfBadge = document.getElementById('hfKeysBadge');
  const hfKeys = getHFKeys();
  const hfIsDefault = hfKeys.length === 1 && hfKeys[0] === DEFAULT_HF_KEY;
  if (hfTextarea && !hfIsDefault && hfKeys.length > 0) hfTextarea.value = hfKeys.join('\n');
  if (hfBadge) {
    const n = hfKeys.length;
    hfBadge.textContent = hfIsDefault ? '🔑 1 chave default configurada' : `🔑 ${n} chave${n>1?'s':''} configurada${n>1?'s':''}`;
  }

  // Gemini keys
  const geminiTextarea = document.getElementById('geminiKeysSettingsInput');
  const geminiBadge = document.getElementById('geminiKeysBadge');
  const geminiKeys = getGeminiKeys();
  const geminiIsDefault = geminiKeys.length === 1 && geminiKeys[0] === DEFAULT_GEMINI_KEY;
  if (geminiTextarea && !geminiIsDefault && geminiKeys.length > 0) geminiTextarea.value = geminiKeys.join('\n');
  if (geminiBadge) {
    const n = geminiKeys.length;
    geminiBadge.textContent = geminiIsDefault ? '🔑 1 chave default configurada' : `🔑 ${n} chave${n>1?'s':''} configurada${n>1?'s':''}`;
  }

  // Reminders
  const prefs = JSON.parse(localStorage.getItem('dvReminders') || '{}');
  const en = document.getElementById('remEnabledSettings');
  const mh = document.getElementById('remManhaSettings');
  const al = document.getElementById('remAlmocoSettings');
  const nt = document.getElementById('remNoiteSettings');
  if (en) en.checked = prefs.enabled !== false;
  if (mh) mh.value = prefs.manha || '08:00';
  if (al) al.value = prefs.almoco || '13:00';
  if (nt) nt.value = prefs.noite || '22:00';
  const sem = prefs.pesoSemana || { enabled: true, dia: 0, hora: '09:00' };
  const semEn = document.getElementById('remPesoEnabledSettings');
  const semDia = document.getElementById('remPesoDiaSettings');
  const semHora = document.getElementById('remPesoHoraSettings');
  if (semEn) semEn.checked = sem.enabled !== false;
  if (semDia) semDia.value = String(sem.dia === undefined || sem.dia === null ? 0 : sem.dia);
  if (semHora) semHora.value = sem.hora || '09:00';
  const tr = prefs.treino || { enabled: true, hora: '18:00' };
  const trEn = document.getElementById('remTreinoEnabledSettings');
  const trHora = document.getElementById('remTreinoHoraSettings');
  if (trEn) trEn.checked = tr.enabled !== false;
  if (trHora) trHora.value = tr.hora || '18:00';
}

function changeAiMode() {
  const sel = document.getElementById('aiModeSelect');
  const val = sel && sel.value === 'byok' ? 'byok' : 'app';
  cfgSave('dvAiMode', val);
  applyAiModeUI();
  if (val === 'app') refreshAiUsage();
}

function applyAiModeUI() {
  const appMode = getAiMode() === 'app';
  const field = document.getElementById('aiProviderField');
  const status = document.getElementById('aiModeStatus');
  const usage = document.getElementById('aiUsageBadge');
  if (field) field.style.display = appMode ? 'none' : 'block';
  if (status) {
    status.textContent = appMode
      ? '✨ Chaves geridas pela app. Não precisas de configurar nada.'
      : '🔑 As chaves ficam apenas neste dispositivo.';
  }
  if (usage && !appMode) usage.textContent = '';
  if (appMode) {
    ['openrouterSettingsBox', 'groqSettingsBox', 'hfSettingsBox', 'geminiSettingsBox'].forEach(id => {
      const box = document.getElementById(id);
      if (box) box.style.display = 'none';
    });
  } else {
    changeAiProvider();
  }
}

async function refreshAiUsage() {
  const el = document.getElementById('aiUsageBadge');
  if (!el || getAiMode() !== 'app') return;
  if (!supabaseClient) {
    el.textContent = 'Entra na conta para usar a IA incluída.';
    el.style.color = 'var(--muted)';
    return;
  }
  const session = await getAiAuthSession();
  if (!session) {
    el.textContent = 'Entra na conta para usar a IA incluída.';
    el.style.color = 'var(--muted)';
    return;
  }
  el.textContent = '⏳ a verificar o limite diário…';
  el.style.color = 'var(--muted)';
  try {
    const { data, error } = await supabaseClient.functions.invoke('ai-proxy', {
      body: { action: 'status' }
    });
    if (error) {
      let message = '';
      let status = 0;
      try {
        status = error.context && error.context.status ? error.context.status : 0;
        if (error.context && typeof error.context.json === 'function') {
          const body = await error.context.json();
          message = body && body.error ? body.error : '';
        }
      } catch(e) {}
      if (status === 404) {
        el.textContent = '⚠ IA incluída ainda não está publicada no servidor.';
      } else {
        el.textContent = '⚠ ' + (message || error.message || 'Limite indisponível.');
      }
      el.style.color = '#fbbf24';
      return;
    }
    if (!data || data.available === false) {
      el.textContent = '⚠ IA incluída ainda não está configurada no servidor.';
      el.style.color = '#fbbf24';
      return;
    }
    const used = Number(data.used) || 0;
    const limit = Number(data.limit) || 0;
    const remaining = Math.max(limit - used, 0);
    el.textContent = `📊 Hoje: ${used}/${limit} pedidos · ${remaining} restantes`;
    el.style.color = 'var(--moss-l)';
  } catch(e) {
    el.textContent = '⚠ Não foi possível verificar o limite da IA.';
    el.style.color = '#fbbf24';
  }
}

function changeAiProvider() {
  const sel = document.getElementById('aiProviderSelect');
  const val = sel ? sel.value : 'auto';
  cfgSave('dvAiProvider', val);
  if (getAiMode() === 'app') {
    ['openrouterSettingsBox', 'groqSettingsBox', 'hfSettingsBox', 'geminiSettingsBox'].forEach(id => {
      const box = document.getElementById(id);
      if (box) box.style.display = 'none';
    });
    return;
  }
  const orBox     = document.getElementById('openrouterSettingsBox');
  const groqBox   = document.getElementById('groqSettingsBox');
  const hfBox     = document.getElementById('hfSettingsBox');
  const geminiBox = document.getElementById('geminiSettingsBox');
  // Esconde todos primeiro
  [orBox, groqBox, hfBox, geminiBox].forEach(b => { if (b) b.style.display = 'none'; });
  // Mostra o box correto
  if (val === 'auto') {
    // Em modo auto, mostra todos para o utilizador poder gerir as chaves de cada um
    [orBox, groqBox, hfBox, geminiBox].forEach(b => { if (b) b.style.display = 'block'; });
  } else if (val === 'openrouter' && orBox)   orBox.style.display = 'block';
  else if (val === 'groq' && groqBox)         groqBox.style.display = 'block';
  else if (val === 'huggingface' && hfBox)    hfBox.style.display = 'block';
  else if (val === 'gemini' && geminiBox)     geminiBox.style.display = 'block';
}

function handleModelSelectChange() {
  const sel = document.getElementById('openrouterModelSelect');
  const customBox = document.getElementById('customModelBox');
  if (!sel) return;
  if (sel.value === 'custom') {
    if (customBox) customBox.style.display = 'block';
  } else {
    if (customBox) customBox.style.display = 'none';
    cfgSave('dvOpenRouterModel', sel.value);
  }
}

function saveSettingsOpenRouter() {
  const keysTextarea = document.getElementById('openrouterKeysSettingsInput');
  const modelSel = document.getElementById('openrouterModelSelect');
  const customInput = document.getElementById('customModelInput');
  const status = document.getElementById('openrouterSettingsStatus');
  const badge = document.getElementById('openrouterKeysBadge');

  // Processa múltiplas chaves (uma por linha)
  const rawKeys = (keysTextarea?.value || '').split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 10 && !k.startsWith('#'));

  if (rawKeys.length > 0) {
    setOpenRouterKeys(rawKeys);
    localStorage.setItem('dvOpenRouterKeyIdx', '0'); // reset rotation
  }

  let chosenModel = modelSel?.value || 'meta-llama/llama-3.3-70b-instruct:free';
  if (chosenModel === 'custom') {
    chosenModel = (customInput?.value || '').trim() || 'meta-llama/llama-3.3-70b-instruct:free';
  }
  cfgSave('dvOpenRouterModel', chosenModel);

  const n = rawKeys.length || getOpenRouterKeys().length;
  if (badge) badge.textContent = n > 0 ? `🔑 ${n} chave${n>1?'s':''} configurada${n>1?'s':''}` : '';
  if (status) {
    status.textContent = rawKeys.length > 0
      ? `✓ ${rawKeys.length} chave${rawKeys.length>1?'s':''} OpenRouter guardada${rawKeys.length>1?'s':''}! Rotação automática ativa.`
      : '✓ Modelo guardado!';
    status.style.color = 'var(--sage-l)';
  }
}

function clearSettingsOpenRouterKey() {
  if (!confirm('Remover todas as chaves OpenRouter?')) return;
  localStorage.removeItem('dvOpenRouterKey');
  localStorage.removeItem('dvOpenRouterKeys');
  localStorage.removeItem('dvOpenRouterKeyIdx');
  const keysTextarea = document.getElementById('openrouterKeysSettingsInput');
  const status = document.getElementById('openrouterSettingsStatus');
  const badge = document.getElementById('openrouterKeysBadge');
  if (keysTextarea) keysTextarea.value = '';
  if (badge) badge.textContent = '';
  if (status) {
    status.textContent = 'Chaves OpenRouter removidas';
    status.style.color = 'var(--muted)';
  }
}

function saveSettingsSheetsUrl() {
  const input = document.getElementById('sheetsUrlSettingsInput');
  const status = document.getElementById('sheetsSettingsStatus');
  const url = (input?.value || '').trim();
  if (!url || !url.includes('script.google.com')) {
    if (status) { status.textContent = '⚠ URL inválido'; status.style.color = '#f87171'; }
    return;
  }
  sheetsUrl = url;
  localStorage.setItem(SHEETS_URL_KEY, url);
  saveSheetsUrlToCloud(url);
  updateSyncStatus('Sheets configurado', 'ok');
  if (status) { status.textContent = '✓ URL guardado! A sincronizar...'; status.style.color = 'var(--moss-l)'; }
  setTimeout(() => syncAllData(), 800);
}

function clearSheetsUrl() {
  if (!confirm('Remover o URL do Sheets?')) return;
  sheetsUrl = '';
  localStorage.removeItem(SHEETS_URL_KEY);
  saveSheetsUrlToCloud('');
  const input = document.getElementById('sheetsUrlSettingsInput');
  const status = document.getElementById('sheetsSettingsStatus');
  if (input) input.value = '';
  if (status) { status.textContent = 'URL removido'; status.style.color = 'var(--muted)'; }
  updateSyncStatus('Clica para ligar', 'off');
}

function saveSettingsGroqKey() {
  const textarea = document.getElementById('groqKeysSettingsInput');
  const status = document.getElementById('groqSettingsStatus');
  const badge = document.getElementById('groqKeysBadge');

  const rawKeys = (textarea?.value || '').split('\n')
    .map(k => k.trim())
    .filter(k => k.startsWith('gsk_') && k.length > 10);

  const invalid = (textarea?.value || '').split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 3 && !k.startsWith('gsk_'));

  if (invalid.length > 0) {
    if (status) { status.textContent = `⚠ ${invalid.length} linha(s) inválida(s): as chaves Groq começam com gsk_`; status.style.color = '#f87171'; }
    return;
  }
  if (rawKeys.length === 0) {
    if (status) { status.textContent = '⚠ Cola pelo menos uma chave Groq (gsk_...)'; status.style.color = '#f87171'; }
    return;
  }
  setGroqKeys(rawKeys);
  localStorage.setItem('dvGroqKeyIdx', '0'); // reset rotation
  const n = rawKeys.length;
  if (badge) badge.textContent = `🔑 ${n} chave${n>1?'s':''} configurada${n>1?'s':''}`;
  if (status) { status.textContent = `✓ ${n} chave${n>1?'s':''} Groq guardada${n>1?'s':''}! Rotação automática ativa.`; status.style.color = 'var(--moss-l)'; }
}

function clearSettingsGroqKey() {
  if (!confirm('Remover todas as chaves Groq?')) return;
  localStorage.removeItem('dvGroqKey');
  localStorage.removeItem('dvGroqKeys');
  localStorage.removeItem('dvGroqKeyIdx');
  const textarea = document.getElementById('groqKeysSettingsInput');
  const status = document.getElementById('groqSettingsStatus');
  const badge = document.getElementById('groqKeysBadge');
  if (textarea) textarea.value = '';
  if (badge) badge.textContent = '';
  if (status) { status.textContent = 'Chaves removidas'; status.style.color = 'var(--muted)'; }
}

function saveSettingsHFKey() {
  const textarea = document.getElementById('hfKeysSettingsInput');
  const status = document.getElementById('hfSettingsStatus');
  const badge = document.getElementById('hfKeysBadge');
  const rawKeys = (textarea?.value || '').split('\n')
    .map(k => k.trim())
    .filter(k => k.startsWith('hf_') && k.length > 10);
  const invalid = (textarea?.value || '').split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 3 && !k.startsWith('hf_'));
  if (invalid.length > 0) {
    if (status) { status.textContent = `⚠ ${invalid.length} chave(s) inválida(s): tokens HF começam com hf_`; status.style.color = '#f87171'; }
    return;
  }
  if (rawKeys.length === 0) {
    if (status) { status.textContent = '⚠ Cola pelo menos uma chave HF (hf_...)'; status.style.color = '#f87171'; }
    return;
  }
  setHFKeys(rawKeys);
  localStorage.setItem('dvHFKeyIdx', '0');
  const n = rawKeys.length;
  if (badge) badge.textContent = `🔑 ${n} chave${n>1?'s':''} configurada${n>1?'s':''}`;
  if (status) { status.textContent = `✓ ${n} chave${n>1?'s':''} HF guardada${n>1?'s':''}! Rotação automática ativa.`; status.style.color = 'var(--moss-l)'; }
}

function clearSettingsHFKey() {
  if (!confirm('Remover todas as chaves Hugging Face?')) return;
  localStorage.removeItem('dvHFKey');
  localStorage.removeItem('dvHFKeys');
  localStorage.removeItem('dvHFKeyIdx');
  const textarea = document.getElementById('hfKeysSettingsInput');
  const status = document.getElementById('hfSettingsStatus');
  const badge = document.getElementById('hfKeysBadge');
  if (textarea) textarea.value = '';
  if (badge) badge.textContent = '';
  if (status) { status.textContent = 'Chaves removidas'; status.style.color = 'var(--muted)'; }
}

function saveSettingsGeminiKey() {
  const textarea = document.getElementById('geminiKeysSettingsInput');
  const status = document.getElementById('geminiSettingsStatus');
  const badge = document.getElementById('geminiKeysBadge');
  const rawKeys = (textarea?.value || '').split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 10);
  if (rawKeys.length === 0) {
    if (status) { status.textContent = '⚠ Cola pelo menos uma chave Gemini'; status.style.color = '#f87171'; }
    return;
  }
  setGeminiKeys(rawKeys);
  localStorage.setItem('dvGeminiKeyIdx', '0');
  const n = rawKeys.length;
  if (badge) badge.textContent = `🔑 ${n} chave${n>1?'s':''} configurada${n>1?'s':''}`;
  if (status) { status.textContent = `✓ ${n} chave${n>1?'s':''} Gemini guardada${n>1?'s':''}! Rotação automática ativa.`; status.style.color = 'var(--moss-l)'; }
}

function clearSettingsGeminiKey() {
  if (!confirm('Remover todas as chaves Gemini?')) return;
  localStorage.removeItem('dvGeminiKey');
  localStorage.removeItem('dvGeminiKeys');
  localStorage.removeItem('dvGeminiKeyIdx');
  const textarea = document.getElementById('geminiKeysSettingsInput');
  const status = document.getElementById('geminiSettingsStatus');
  const badge = document.getElementById('geminiKeysBadge');
  if (textarea) textarea.value = '';
  if (badge) badge.textContent = '';
  if (status) { status.textContent = 'Chaves removidas'; status.style.color = 'var(--muted)'; }
}

async function saveSettingsReminders() {
  const granted = await requestNotifications();
  if (!granted) { alert('Precisas de permitir notificações primeiro.'); return; }
  let old = {};
  try { old = JSON.parse(localStorage.getItem('dvReminders') || '{}'); } catch (e) {}
  const prefs = Object.assign({}, old, {
    enabled: document.getElementById('remEnabledSettings')?.checked,
    manha:   document.getElementById('remManhaSettings')?.value,
    almoco:  document.getElementById('remAlmocoSettings')?.value,
    noite:   document.getElementById('remNoiteSettings')?.value,
    pesoSemana: {
      enabled: document.getElementById('remPesoEnabledSettings') ? document.getElementById('remPesoEnabledSettings').checked : true,
      dia: parseInt(document.getElementById('remPesoDiaSettings')?.value, 10) || 0,
      hora: document.getElementById('remPesoHoraSettings')?.value || '09:00'
    },
    treino: {
      enabled: document.getElementById('remTreinoEnabledSettings') ? document.getElementById('remTreinoEnabledSettings').checked : true,
      hora: document.getElementById('remTreinoHoraSettings')?.value || '18:00'
    }
  });
  const cfgP = cfgSave('dvReminders', JSON.stringify(prefs));
  const status = document.getElementById('remSettingsStatus');
  if (status) {
    status.textContent = '⏳ a guardar…';
    cfgP.then(r => { status.textContent = saveMsgText(r, '').replace('guardado', 'lembretes guardados'); });
  }
  sendNotification('🔔 Lembretes ativados!', 'Vais receber lembretes diários.');
}

function exportData() {
  const config = {};
  Object.keys(_CFG_MAP).forEach(lk => {
    const ck = _CFG_MAP[lk];
    const raw = localStorage.getItem(lk);
    if (raw == null) return;
    try { config[ck] = _CFG_JSON[ck] ? JSON.parse(raw) : raw; } catch (e) { config[ck] = raw; }
  });
  const data = { version: 2, exportedAt: new Date().toISOString(), days: DB, config };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diario-de-vida-' + localDateStr() + '.json';
  a.click();
}

function importData(event) {
  const file = event.target.files && event.target.files[0];
  const st = document.getElementById('importStatusMsg');
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      const incomingConfig = (parsed && typeof parsed === 'object' && parsed.config && typeof parsed.config === 'object') ? parsed.config : null;
      const incomingDays = (parsed && typeof parsed === 'object' && parsed.days && typeof parsed.days === 'object') ? parsed.days : (incomingConfig ? {} : parsed);
      if (!incomingDays || typeof incomingDays !== 'object') {
        throw new Error('Ficheiro JSON não tem formato reconhecido.');
      }

      const validKeys = Object.keys(incomingDays).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
      if (!validKeys.length && !incomingConfig) {
        throw new Error('Nenhum dia válido (formato AAAA-MM-DD) encontrado no ficheiro.');
      }

      const extra = incomingConfig ? '\n\nAs preferências, o perfil e o plano do backup também serão aplicados.' : '';
      const doMerge = confirm(`Foram encontrados ${validKeys.length} dias no ficheiro de backup.${extra}\n\nClica em "OK" para JUNTAR aos teus dados existentes.\nClica em "Cancelar" para cancelar a importação.`);
      if (!doMerge) {
        event.target.value = '';
        return;
      }

      let count = 0;
      validKeys.forEach(k => {
        DB[k] = incomingDays[k];
        count++;
      });
      if (count) localStorage.setItem(DB_KEY, JSON.stringify(DB));

      let cfgPatch = null;
      if (incomingConfig) {
        cfgPatch = {};
        Object.keys(_CFG_MAP).forEach(lk => {
          const ck = _CFG_MAP[lk];
          if (incomingConfig[ck] === undefined) return;
          const val = incomingConfig[ck];
          try { localStorage.setItem(lk, typeof val === 'string' ? val : JSON.stringify(val)); } catch (e) {}
          cfgPatch[ck] = val;
        });
      }

      if (st) st.innerHTML = '<span style="color:var(--moss-l);">⏳ ' + count + ' dias importados. A enviar para a nuvem…</span>';
      const results = count ? await Promise.all(validKeys.map(k => SyncManager.saveDay(k))) : [];
      if (cfgPatch && Object.keys(cfgPatch).length) {
        try { await SyncManager.saveConfig(cfgPatch); } catch (e) {}
      }
      const failed = results.filter(r => r !== 'cloud' && r !== 'local' && r !== 'none').length;
      const msgTxt = failed
        ? ('⚠ ' + count + ' dias importados neste dispositivo; ' + failed + ' ainda por enviar para a nuvem (vão ser enviados automaticamente).')
        : ('✓ ' + count + ' dias e ' + (cfgPatch ? Object.keys(cfgPatch).length : 0) + ' preferências importados' + (results.includes('cloud') ? ' na nuvem' : ' neste dispositivo'));
      if (st) st.innerHTML = '<span style="color:' + (failed ? 'var(--rose)' : 'var(--sage-l)') + ';">' + msgTxt + ' A recarregar...</span>';
      showSavedBar(msgTxt, failed ? 'warn' : '');
      setTimeout(() => { location.reload(); }, failed ? 3000 : 1500);
    } catch(err) {
      console.error('Erro na importação:', err);
      if (st) st.innerHTML = '<span style="color:var(--rose);">Erro ao importar: ' + err.message + '</span>';
      alert('Erro ao importar backup: ' + err.message);
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

const BYOK_STORAGE_KEYS = [
  'dvGeminiKey', 'dvGeminiKeys', 'dvGeminiKeyIdx',
  'dvGroqKey', 'dvGroqKeys', 'dvGroqKeyIdx',
  'dvOpenRouterKey', 'dvOpenRouterKeys', 'dvOpenRouterKeyIdx',
  'dvHFKey', 'dvHFKeys', 'dvHFKeyIdx'
];
function clearByokKeys(showMsg) {
  BYOK_STORAGE_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  if (showMsg) {
    try { if (typeof initSettingsPage === 'function') initSettingsPage(); } catch (e) {}
    const st = document.getElementById('aiClearKeysStatus');
    if (st) st.textContent = '✓ Chaves removidas deste dispositivo.';
    if (typeof showSavedBar === 'function') showSavedBar('Chaves de IA removidas', '');
  }
}
function clearLocalData() {
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(AI_CHAT_KEY);
  Object.keys(_CFG_MAP).forEach(lk => localStorage.removeItem(lk));
  clearByokKeys(false);
}
function clearAllData() {
  if (!confirm('Apagar TODOS os dados? Esta ação é irreversível.')) return;
  if (!confirm('Tens a certeza? Todos os registos serão eliminados permanentemente.')) return;
  clearLocalData();
  location.reload();
}

// Inicializar página de configurações ao abrir
// Monkey-patch showSection depois de definida
(function() {
  const _orig = showSection;
  showSection = function(id, el, fromHistory) {
    _orig(id, el, fromHistory);
    if (id === 'settings') initSettingsPage();
    if (id === 'last5') renderLast5Days();
    if (id === 'work')     { initWorkDatePicker(); renderWorkCalendar(); }
    if (id === 'noventa')   renderN90();
    if (id === 'treadmill')   initTreadmill();
    if (id === 'profile')     renderProfile();
    if (id === 'ai')          { initAiChat(); setTimeout(() => { const inp = document.getElementById('aiChatInput'); if (inp && window.innerWidth > 700) inp.focus(); }, 120); }
    if (id === 'competition') renderCompetition();
    if (id === 'compadmin')   renderCompAdmin();
    if (id === 'stats')       renderAchievements();
    if (id === 'calendar')    renderCalendarSection();
    if (id === 'meals')       { try { hxMealSuggestAll(); } catch (e) {} }
    if (id === 'report')      { try { hxRenderReport(); } catch (e) {} }
    if (id === 'shopping')    { try { hxShopRender(); } catch (e) {} }
    try { hxFoldApply(); } catch (e) {}
  };
})();

initSectionA11y();
applyUiPrefs();
setTimeout(applyHashSection, 0);
initPWA();
initAiChat();
setTimeout(() => {
  try { checkAchievements(); } catch (e) {}
  try { renderAchievements(); } catch (e) {}
  try { renderTrends(); } catch (e) {}
  try { generateWeeklySummary(false); } catch (e) {}
}, 2000);
setTimeout(renderMascot, 300);
setTimeout(renderMascot, 2500);
setInterval(renderMascot, 60000);

/* ═══════════════════════════════════════════════════════════════════
   AÇÕES RÁPIDAS + CHECK-IN DE HUMOR — camada aditiva do Resumo
   Não substitui nada: usa o mesmo DB[TODAY], o mesmo saveData() e as
   mesmas chaves locais. Sem sessão, guarda só no dispositivo.
   ═══════════════════════════════════════════════════════════════════ */
var HX_MOOD_KEY   = 'dvHomeMood';    // espelho local: { 'YYYY-MM-DD': {mood, trigger, note, at} }
var HX_DAYOFF_KEY = 'dvHomeDayOff';  // modo «dia difícil»

var HX_MOODS = [
  { v: 1, emoji: '😞', label: 'em baixo' },
  { v: 2, emoji: '🙁', label: 'assim assim' },
  { v: 3, emoji: '😐', label: 'neutro' },
  { v: 4, emoji: '🙂', label: 'bem' },
  { v: 5, emoji: '😄', label: 'muito bem' }
];

var HX_TRIGGERS = [
  'Não falei com ninguém hoje',
  'Dia sem sair de casa',
  'Muito tempo ao ecrã',
  'Trabalho a invadir o serão',
  'Dia desorganizado',
  'Pouca luz natural'
];

var _hxPick = 0;
var _hxTrigger = '';
var _hxSavedId = '';
var _hxRows = null;
var _hxChain = Promise.resolve();

function hxRead(k, f) {
  try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? f : v; }
  catch (e) { return f; }
}
function hxWrite(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
}
function hxEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function hxPickMsg(list) { return list[Math.floor(Math.random() * list.length)]; }

function hxToast(msg) {
  var el = document.getElementById('hxToast');
  if (!el) { return; }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(hxToast._t);
  hxToast._t = setTimeout(function () { el.classList.remove('show'); }, 3600);
}
function hxPop(btn) {
  if (!btn) { return; }
  btn.classList.remove('hx-pop');
  void btn.offsetWidth;
  btn.classList.add('hx-pop');
}

/* ── ações de 1 toque ───────────────────────────────────────────── */

function hxWater(btn) {
  hxPop(btn);
  try { hxNotifAck(); } catch (e) {}
  if (waterCount >= waterGoal) {
    hxToast('Já chegaste à meta de hoje. Um copo a mais também conta 💧');
    return;
  }
  waterCount++;
  try { renderWaterDrops(); } catch (e) {}
  try { updateWaterProgress(); } catch (e) {}
  try { saveData(true); } catch (e) {}
  hxMetaUpdate();
  hxToast(hxPickMsg([
    'Um copo a mais. O corpo agradece 💧',
    'Feito. Sem pressa, ao teu ritmo.',
    'Boa. Um gole de cada vez.'
  ]));
}

function hxBreak(btn) {
  hxPop(btn);
  try { hxNotifAck(); } catch (e) {}
  counters.pausas = (counters.pausas || 0) + 1;
  try { saveData(true); } catch (e) {}
  hxMetaUpdate();
  hxToast(hxPickMsg([
    'Pausa registada. O trabalho espera um bocadinho ☕',
    'Boa ideia. Levanta os ombros e respira.',
    'Pausa conta como trabalho feito.'
  ]));
}

function hxLight(btn) {
  hxPop(btn);
  try { hxNotifAck(); } catch (e) {}
  if (!DB[TODAY]) { DB[TODAY] = {}; }
  var d = DB[TODAY];
  d.lightCount = (parseFloat(d.lightCount) || 0) + 1;
  if (!Array.isArray(d.lightAt)) { d.lightAt = []; }
  d.lightAt.push(new Date().toISOString());
  d.lightAt = d.lightAt.slice(-20);
  try { saveData(true); } catch (e) {}
  hxMetaUpdate();
  hxToast(hxPickMsg([
    'Luz natural registada. Cinco minutos junto à janela já contam 🌤️',
    'Feito. Se puderes, olha para longe por 20 segundos.',
    'Anotado. A luz lá fora também mexe com o ânimo.'
  ]));
}

function hxMetaUpdate() {
  try {
    var w = document.getElementById('hxMetaWater');
    if (w) { w.textContent = waterCount + ' / ' + waterGoal + ' copos'; }
    var b = document.getElementById('hxBtnWater');
    if (b) { b.classList.toggle('on', waterCount > 0 && waterCount >= waterGoal); }

    var p = document.getElementById('hxMetaBreak');
    if (p) { p.textContent = (counters.pausas || 0) + ' hoje'; }

    var day = DB[TODAY] || {};
    var l = document.getElementById('hxMetaLight');
    if (l) { l.textContent = (parseFloat(day.lightCount) || 0) + ' hoje'; }

    var m = document.getElementById('hxMetaMood');
    if (m) {
      var e = hxMoodFor(TODAY);
      var info = e ? hxMoodInfo(e.mood) : null;
      m.textContent = info ? (info.emoji + ' ' + info.label) : 'como te sentes?';
    }
  } catch (err) {}
}

/* manter a meta dos botões sincronizada quando a água é registada nos copos */
(function () {
  if (typeof updateWaterProgress !== 'function') { return; }
  var _origWaterProgress = updateWaterProgress;
  updateWaterProgress = function () {
    var r = _origWaterProgress.apply(this, arguments);
    try { hxMetaUpdate(); } catch (e) {}
    return r;
  };
})();

/* ── humor: guardar, ler e mostrar ──────────────────────────────── */

function hxMoodInfo(v) {
  for (var i = 0; i < HX_MOODS.length; i++) {
    if (Number(HX_MOODS[i].v) === Number(v)) { return HX_MOODS[i]; }
  }
  return null;
}
function hxMoodsLocal() {
  var all = hxRead(HX_MOOD_KEY, {});
  return (all && typeof all === 'object') ? all : {};
}
function hxSaveMoodLocal(date, entry) {
  var all = hxMoodsLocal();
  all[date] = entry;
  hxWrite(HX_MOOD_KEY, all);
}
function hxMoodFor(date) {
  var all = hxMoodsLocal();
  if (all[date]) { return all[date]; }
  var d = DB[date] || {};
  return d.moodCheckin || null;
}
function hxMoodMap() {
  var map = {};
  var local = hxMoodsLocal();
  Object.keys(local).forEach(function (d) { map[d] = local[d]; });
  (_hxRows || []).forEach(function (r) {
    if (r && r.date && !map[r.date]) { map[r.date] = r; }
  });
  try {
    Object.keys(DB).forEach(function (d) {
      if (!map[d] && DB[d] && DB[d].moodCheckin) { map[d] = DB[d].moodCheckin; }
    });
  } catch (e) {}
  return map;
}

function hxRenderMoodSheet() {
  var grid = document.getElementById('hxMoods');
  if (grid && !grid.children.length) {
    grid.innerHTML = HX_MOODS.map(function (m) {
      return '<button type="button" class="hx-mood" data-mood="' + m.v + '" aria-label="' + hxEsc(m.label) + '">' +
        '<span class="em" aria-hidden="true">' + m.emoji + '</span>' +
        '<span class="nm">' + hxEsc(m.label) + '</span></button>';
    }).join('');
    grid.querySelectorAll('.hx-mood').forEach(function (b) {
      b.addEventListener('click', function () { hxPickMood(Number(b.getAttribute('data-mood'))); });
    });
  }
  var trg = document.getElementById('hxTrigs');
  if (trg && !trg.children.length) {
    trg.innerHTML = HX_TRIGGERS.map(function (t) {
      return '<button type="button" class="hx-trig" data-trigger="' + hxEsc(t) + '">' + hxEsc(t) + '</button>';
    }).join('');
    trg.querySelectorAll('.hx-trig').forEach(function (b) {
      b.addEventListener('click', function () {
        var val = b.getAttribute('data-trigger');
        _hxTrigger = (_hxTrigger === val) ? '' : val;
        trg.querySelectorAll('.hx-trig').forEach(function (x) {
          x.classList.toggle('sel', x.getAttribute('data-trigger') === _hxTrigger);
        });
      });
    });
  }
}

function hxOpenMood() {
  try { hxNotifAck(); } catch (e) {}
  hxRenderMoodSheet();
  _hxPick = 0;
  _hxTrigger = '';
  _hxSavedId = '';
  var note = document.getElementById('hxNote');
  if (note) { note.value = ''; }
  var step2 = document.getElementById('hxStep2');
  if (step2) { step2.hidden = true; }
  var sub = document.getElementById('hxSheetSub');
  if (sub) { sub.textContent = 'Um toque chega. O resto é opcional.'; }
  var grid = document.getElementById('hxMoods');
  if (grid) { grid.querySelectorAll('.hx-mood').forEach(function (b) { b.classList.remove('sel'); }); }
  var trg = document.getElementById('hxTrigs');
  if (trg) { trg.querySelectorAll('.hx-trig').forEach(function (b) { b.classList.remove('sel'); }); }
  var sheet = document.getElementById('hxSheet');
  if (sheet) { sheet.classList.add('open'); }
  document.body.style.overflow = 'hidden';
  setTimeout(function () {
    var first = document.querySelector('#hxMoods .hx-mood');
    if (first) { first.focus(); }
  }, 80);
}

function hxCloseMood() {
  var sheet = document.getElementById('hxSheet');
  if (sheet) { sheet.classList.remove('open'); }
  document.body.style.overflow = '';
}

function hxPickMood(v) {
  _hxPick = v;
  var grid = document.getElementById('hxMoods');
  if (grid) {
    grid.querySelectorAll('.hx-mood').forEach(function (b) {
      b.classList.toggle('sel', Number(b.getAttribute('data-mood')) === v);
    });
  }
  var step2 = document.getElementById('hxStep2');
  if (step2) { step2.hidden = false; }

  var info = hxMoodInfo(v);
  var entry = { mood: v, trigger: '', note: '', at: new Date().toISOString() };
  hxSaveMoodLocal(TODAY, entry);
  if (!DB[TODAY]) { DB[TODAY] = {}; }
  DB[TODAY].moodCheckin = entry;
  try { selectedMood = String(v); } catch (e) {}
  try { saveData(true); } catch (e) {}
  hxMetaUpdate();
  hxRenderDays();
  hxRenderObs();

  var sub = document.getElementById('hxSheetSub');
  if (sub) {
    sub.textContent = 'Anotado' + (info ? ' · ' + info.label : '') +
      '. Se quiseres, diz o que contribuiu — ou fecha e fica assim.';
  }

  _hxChain = _hxChain.then(function () {
    return hxPushCloud(entry, _hxSavedId || '');
  }).then(function (id) {
    if (id) { _hxSavedId = id; }
  }).catch(function () {});
}

function hxSaveMood() {
  if (!_hxPick) { return; }
  var noteEl = document.getElementById('hxNote');
  var note = String((noteEl && noteEl.value) || '').trim().slice(0, 120);
  var trigger = _hxTrigger || '';
  if (!note && !trigger) { hxCloseMood(); return; }

  var entry = { mood: _hxPick, trigger: trigger, note: note, at: new Date().toISOString() };
  hxSaveMoodLocal(TODAY, entry);
  if (!DB[TODAY]) { DB[TODAY] = {}; }
  DB[TODAY].moodCheckin = entry;
  try { selectedMood = String(_hxPick); } catch (e) {}
  try { saveData(true); } catch (e) {}
  hxCloseMood();
  hxMetaUpdate();
  hxRenderDays();
  hxRenderObs();
  hxToast('Anotado. Obrigado por contares mais um pouco.');

  _hxChain = _hxChain.then(function () {
    return hxPushCloud(entry, _hxSavedId || '');
  }).then(function (id) {
    if (id) { _hxSavedId = id; }
  }).catch(function () {});
}

async function hxPushCloud(entry, updateId) {
  try {
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      var res = await supabaseClient.auth.getSession();
      var session = res && res.data ? res.data.session : null;
      if (session && session.user) {
        if (updateId) {
          var up = await supabaseClient.from('mood_checkins')
            .update({ mood: entry.mood, trigger: entry.trigger || null, note: entry.note || null })
            .eq('id', updateId).eq('user_id', session.user.id);
          if (!up.error) { return updateId; }
          console.warn('mood_checkins update:', up.error.message);
        }
        var ins = await supabaseClient.from('mood_checkins')
          .insert({
            user_id: session.user.id,
            mood: entry.mood,
            trigger: entry.trigger || null,
            note: entry.note || null
          })
          .select('id')
          .maybeSingle();
        if (!ins.error && ins.data) { return ins.data.id; }
        if (ins.error) { console.warn('mood_checkins:', ins.error.message); }
      }
    }
  } catch (e) { console.warn('mood_checkins offline:', e && e.message); }
  return '';
}

async function hxLoadRows(force) {
  if (_hxRows && !force) { return _hxRows; }
  var rows = [];
  try {
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      var res = await supabaseClient.auth.getSession();
      var session = res && res.data ? res.data.session : null;
      if (session && session.user) {
        var q = await supabaseClient
          .from('mood_checkins')
          .select('mood,trigger,note,created_at')
          .order('created_at', { ascending: false })
          .limit(120);
        if (!q.error && Array.isArray(q.data)) {
          rows = q.data.map(function (r) {
            var at = r.created_at ? new Date(r.created_at) : null;
            return {
              mood: r.mood, trigger: r.trigger, note: r.note, at: r.created_at,
              date: (at && !isNaN(at.getTime())) ? localDateStr(at) : String(r.created_at || '').slice(0, 10)
            };
          });
        } else if (q.error) {
          console.warn('mood_checkins select:', q.error.message);
        }
      }
    }
  } catch (e) { console.warn('mood_checkins offline:', e && e.message); }
  _hxRows = rows;
  return rows;
}

function hxRenderDays() {
  var boxes = document.querySelectorAll('[data-hx-days]');
  if (!boxes.length) { return; }
  var map = hxMoodMap();
  var out = '';
  for (var i = 13; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    var key = localDateStr(d);
    var row = map[key];
    var info = row ? hxMoodInfo(row.mood) : null;
    var cls = 'hx-day' + (info ? '' : ' is-empty') + (i === 0 ? ' is-today' : '');
    var label = key + (info ? ' · ' + info.label : ' · sem registo') +
      (row && row.trigger ? ' · ' + row.trigger : '') +
      (row && row.note ? ' · ' + row.note : '');
    out += '<div class="' + cls + '" role="listitem" aria-label="' + hxEsc(label) + '" title="' + hxEsc(label) + '">' +
      '<span class="hx-dot" aria-hidden="true">' + (info ? info.emoji : '·') + '</span>' +
      '<span class="hx-day-num">' + key.slice(8, 10) + '</span>' +
      '</div>';
  }
  boxes.forEach(function (b) { b.innerHTML = out; });
}

function hxRenderObs() {
  var boxes = document.querySelectorAll('[data-hx-obs]');
  if (!boxes.length) { return; }
  var map = hxMoodMap();
  var rows = [];
  for (var i = 0; i < 14; i++) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    var key = localDateStr(d);
    if (map[key] && map[key].mood) { rows.push(map[key]); }
  }
  if (rows.length < 3) {
    hxSetObs(rows.length === 0
      ? 'Ainda não há registos. Quando quiseres, um toque em Humor chega.'
      : 'Já tenho ' + rows.length + ' registo(s). Com mais alguns consigo dizer algo que preste — sem pressa.');
    return;
  }
  var avg = rows.reduce(function (s, r) { return s + Number(r.mood); }, 0) / rows.length;

  var best = null;
  HX_TRIGGERS.forEach(function (t) {
    var withT = rows.filter(function (r) { return r.trigger === t; });
    var without = rows.filter(function (r) { return r.trigger !== t; });
    if (withT.length < 2 || without.length < 2) { return; }
    var a = withT.reduce(function (s, r) { return s + Number(r.mood); }, 0) / withT.length;
    var b = without.reduce(function (s, r) { return s + Number(r.mood); }, 0) / without.length;
    var delta = b - a;
    if (delta >= 0.4 && (!best || delta > best.delta)) { best = { t: t, a: a, b: b, delta: delta }; }
  });

  var msg;
  if (best) {
    msg = 'Reparei que nos dias em que assinalaste «' + best.t + '» o teu humor ficou em média ' +
      best.a.toFixed(1) + '/5, contra ' + best.b.toFixed(1) + '/5 nos outros. ' +
      'É só o que os teus registos mostram — não é um diagnóstico.';
  } else if (avg >= 3.6) {
    msg = 'Estes 14 dias andaram mais para o alto: média de ' + avg.toFixed(1) + '/5 em ' + rows.length + ' registos. ' +
      'Vale a pena reparar no que tem ajudado.';
  } else if (avg <= 2.4) {
    msg = 'Tem sido uma quinzena mais pesada (média ' + avg.toFixed(1) + '/5). ' +
      'Fica registado. Não tens de fazer mais do que estás a fazer.';
  } else {
    msg = 'Altos e baixos, como é normal: média de ' + avg.toFixed(1) + '/5 em ' + rows.length + ' registos. ' +
      'Só te mostro o que escreveste.';
  }
  hxSetObs(msg);
}

function hxSetObs(msg) {
  document.querySelectorAll('[data-hx-obs]').forEach(function (b) { b.textContent = msg; });
}

/* ── «dia difícil»: só água e humor durante 24 h ─────────────────── */

function hxDayOffState() {
  var s = hxRead(HX_DAYOFF_KEY, null);
  if (!s || !s.until) { return null; }
  if (Date.now() > s.until) { hxWrite(HX_DAYOFF_KEY, null); return null; }
  return s;
}
function hxApplyDayOff() {
  var s = hxDayOffState();
  var on = !!s;
  document.body.classList.toggle('hx-dayoff', on);
  var btn = document.getElementById('hxCalmBtn');
  if (btn) {
    if (on) {
      btn.innerHTML = '<span aria-hidden="true">🌧️</span> <b>Modo calmo ligado.</b> Só água e humor até amanhã. Toca para voltar ao normal.';
    } else {
      btn.innerHTML = '<span aria-hidden="true">🌧️</span> <b>Dia difícil.</b> Fico só com água e humor, sem te chatear com o resto durante 24 h.';
    }
  }
}
function hxDayOff() {
  if (hxDayOffState()) {
    hxWrite(HX_DAYOFF_KEY, null);
    hxApplyDayOff();
    hxToast('Voltei ao normal. Sem pressa, como sempre.');
    return;
  }
  hxWrite(HX_DAYOFF_KEY, { until: Date.now() + 24 * 60 * 60 * 1000 });
  hxApplyDayOff();
  hxToast('Está bem. Fico só com água e humor até amanhã. 🌧️');
}

/* ── privacidade: exportar e apagar ─────────────────────────────── */

var HX_UNDO_KEY = 'dvUndoSnapshot';
var HX_UNDO_MS = 20000;

function hxPrivStatus(msg) {
  var el = document.getElementById('hxPrivStatus');
  if (el) { el.textContent = msg; }
  hxToast(msg);
}

/* barra de anulação, sobrevive ao recarregar */
function hxShowUndo(msg, ms, onUndo, onExpire) {
  var bar = document.getElementById('hxUndoBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'hxUndoBar';
    bar.className = 'hx-undo';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="hx-undo-msg"></span>' +
      '<button type="button" class="hx-undo-btn">Anular</button>' +
      '<span class="hx-undo-count" aria-hidden="true"></span>';
    document.body.appendChild(bar);
  }
  var left = Math.max(0, Math.round(ms / 1000));
  bar.querySelector('.hx-undo-msg').textContent = msg;
  bar.querySelector('.hx-undo-count').textContent = left + 's';
  bar.classList.add('show');
  bar.querySelector('.hx-undo-btn').onclick = function () {
    clearInterval(hxShowUndo._t);
    bar.classList.remove('show');
    try { onUndo(); } catch (e) {}
  };
  clearInterval(hxShowUndo._t);
  hxShowUndo._t = setInterval(function () {
    left--;
    if (left <= 0) {
      clearInterval(hxShowUndo._t);
      bar.classList.remove('show');
      try { if (onExpire) { onExpire(); } } catch (e) {}
      return;
    }
    bar.querySelector('.hx-undo-count').textContent = left + 's';
  }, 1000);
}

/* ── apagar tudo, com 20 segundos para voltar atrás ─────────────── */

function clearAllData() {
  var ok = confirm(
    'Apagar todos os dados deste dispositivo?\n\n' +
    'Ficam de fora a tua sessão e as chaves da IA. Os dias, o perfil, as preferências, o humor e as notas são apagados.\n\n' +
    'Tens 20 segundos para anular, por isso respira.'
  );
  if (!ok) { return; }

  var snap = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k === HX_UNDO_KEY) { continue; }
      snap[k] = localStorage.getItem(k);
    }
  } catch (e) {}

  var kept = {};
  Object.keys(snap).forEach(function (k) {
    var keep = k.indexOf('sb-') === 0 || k === 'dvGuestMode' || k === HX_UNDO_KEY;
    if (keep) { kept[k] = snap[k]; return; }
    try { localStorage.removeItem(k); } catch (e) {}
  });

  try {
    localStorage.setItem(HX_UNDO_KEY, JSON.stringify({ at: Date.now(), data: snap }));
  } catch (e) {
    // sem espaço para o snapshot: avisa em vez de apagar às cegas
    alert('Não consegui preparar a anulação (o browser está sem espaço). Não apaguei nada.');
    Object.keys(kept).forEach(function (k) { try { localStorage.setItem(k, kept[k]); } catch (e2) {} });
    return;
  }
  location.reload();
}

function hxUndoCheck() {
  var s = hxRead(HX_UNDO_KEY, null);
  if (!s || !s.at || !s.data) { return; }
  var left = HX_UNDO_MS - (Date.now() - s.at);
  if (left <= 0) { try { localStorage.removeItem(HX_UNDO_KEY); } catch (e) {} return; }
  hxShowUndo('Apagaste os teus dados.', left, function () {
    try {
      Object.keys(s.data).forEach(function (k) { localStorage.setItem(k, s.data[k]); });
      localStorage.removeItem(HX_UNDO_KEY);
    } catch (e) {}
    location.reload();
  }, function () {
    try { localStorage.removeItem(HX_UNDO_KEY); } catch (e) {}
  });
}

function hxExportMood() {
  try {
    var map = hxMoodMap();
    var rows = Object.keys(map).sort().map(function (k) {
      var r = map[k] || {};
      return {
        data: k,
        humor: (r.mood === undefined || r.mood === null) ? null : Number(r.mood),
        gatilho: r.trigger || '',
        nota: r.note || '',
        registado_em: r.at || ''
      };
    });
    var payload = { aplicacao: 'Diário de Vida', exportado_em: new Date().toISOString(), registos: rows };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'diario-humor-' + localDateStr() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1500);
    hxPrivStatus(rows.length
      ? 'Exportei ' + rows.length + ' registo(s). O ficheiro ficou nas tuas transferências.'
      : 'Ainda não há registos para exportar. Um toque em Humor chega para começar.');
  } catch (e) {
    hxPrivStatus('Não consegui exportar agora. Tenta outra vez.');
  }
}

async function hxDeleteMood() {
  var local = hxMoodsLocal();
  var nLocal = Object.keys(local).length;
  var daySnap = {};
  try {
    Object.keys(DB).forEach(function (k) {
      if (DB[k] && typeof DB[k] === 'object' && DB[k].moodCheckin) { daySnap[k] = DB[k].moodCheckin; }
    });
  } catch (e) {}

  var ok = confirm(
    'Apagar o humor e as notas?\n\n' +
    'São ' + nLocal + ' registo(s) neste dispositivo' +
    (typeof supabaseClient !== 'undefined' && supabaseClient ? ' e os que estiverem na tua conta' : '') +
    '.\n\nTens 20 segundos para anular. O resto do diário fica como está.'
  );
  if (!ok) { return; }

  hxWrite(HX_MOOD_KEY, {});
  try {
    Object.keys(daySnap).forEach(function (k) { delete DB[k].moodCheckin; });
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
  } catch (e) {}
  _hxRows = null;
  _hxSavedId = '';
  hxRenderDays();
  hxRenderObs();
  hxMetaUpdate();

  // nuvem: só depois da janela de anulação
  var cloudTimer = null;
  var hadSession = false;
  try {
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      var res = await supabaseClient.auth.getSession();
      var session = res && res.data ? res.data.session : null;
      if (session && session.user) {
        hadSession = true;
        var uid = session.user.id;
        cloudTimer = setTimeout(function () {
          supabaseClient.from('mood_checkins').delete().eq('user_id', uid).then(function (del) {
            if (del && del.error) { console.warn('mood_checkins delete:', del.error.message); }
          }).catch(function () {});
        }, HX_UNDO_MS);
      }
    }
  } catch (e) { console.warn('mood_checkins delete offline:', e && e.message); }

  hxShowUndo(
    'Apagaste ' + nLocal + ' registo(s) de humor.',
    HX_UNDO_MS,
    function () {
      if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; }
      try {
        hxWrite(HX_MOOD_KEY, local);
        Object.keys(daySnap).forEach(function (k) {
          if (!DB[k]) { DB[k] = {}; }
          DB[k].moodCheckin = daySnap[k];
        });
        try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
      } catch (e) {}
      _hxRows = null;
      hxRenderDays();
      hxRenderObs();
      hxMetaUpdate();
      hxPrivStatus('Repus os teus registos de humor.');
    },
    function () {
      if (hadSession) {
        hxPrivStatus('Apagado: ' + nLocal + ' neste dispositivo e na conta.');
      } else {
        hxPrivStatus('Apagado deste dispositivo. O resto do diário ficou como estava.');
      }
    }
  );

  hxPrivStatus(hadSession
    ? 'Apagado deste dispositivo. Na conta, apago em 20 segundos se não anulares.'
    : 'Apagado deste dispositivo. Tens 20 segundos para anular.');
}

/* ── cor do dia (só decorativa) ─────────────────────────────────── */

function hxApplyDayTheme() {
  var p = (typeof uiGetPrefs === 'function') ? uiGetPrefs() : {};
  var on = p.dayTheme === true;
  try {
    if (on) { document.documentElement.setAttribute('data-hxday', String(new Date().getDay())); }
    else { document.documentElement.removeAttribute('data-hxday'); }
  } catch (e) {}
  var box = document.getElementById('uiDayTheme');
  if (box) { box.checked = on; }
}

function setUiDayTheme(on) {
  var p = (typeof uiGetPrefs === 'function') ? uiGetPrefs() : {};
  p.dayTheme = !!on;
  if (typeof uiSavePrefs === 'function') { uiSavePrefs(p); }
  hxApplyDayTheme();
  hxToast(on ? 'Cada dia traz uma cor diferente. 🌿' : 'Fico com a cor que escolheste.');
}

/* ── orçamento de notificações ─────────────────────────────────── */

var HX_NOTIF_KEY = 'dvNotifState';
var HX_NOTIF_MAX_KEY = 'dvNotifMax';

function hxNotifStateRead() {
  var s = hxRead(HX_NOTIF_KEY, null);
  var today = localDateStr();
  if (!s || typeof s !== 'object' || s.day !== today) {
    s = { day: today, sent: 0, ignored: 0, lastAt: 0, pendingAck: false };
  }
  if (typeof s.sent !== 'number') { s.sent = 0; }
  if (typeof s.ignored !== 'number') { s.ignored = 0; }
  return s;
}
function hxNotifMax() {
  var n = parseInt(hxRead(HX_NOTIF_MAX_KEY, 3), 10);
  if (!(n > 0)) { n = 3; }
  return Math.max(1, Math.min(6, n));
}
function hxNotifAck() {
  var s = hxNotifStateRead();
  if (s.pendingAck) { s.pendingAck = false; hxWrite(HX_NOTIF_KEY, s); }
}

(function () {
  if (typeof sendNotification !== 'function') { return; }
  var _origSend = sendNotification;
  sendNotification = function (title, body, force) {
    try {
      var s = hxNotifStateRead();
      if (!force && s.pendingAck) { s.ignored++; s.pendingAck = false; hxWrite(HX_NOTIF_KEY, s); }
      if (!force) {
        if (hxDayOffState()) { return; }
        var max = hxNotifMax();
        if (s.ignored >= 3) { max = 1; }
        if (s.sent >= max) { return; }
        if (s.lastAt && (Date.now() - s.lastAt) < 45 * 60 * 1000) { return; }
      }
      s.sent++;
      s.lastAt = Date.now();
      s.pendingAck = true;
      hxWrite(HX_NOTIF_KEY, s);
      return _origSend.apply(this, arguments);
    } catch (e) {
      return _origSend.apply(this, arguments);
    }
  };
})();

/* ── versão ────────────────────────────────────────────────────── */

function hxRenderVersion() {
  var el = document.getElementById('appVersionLine');
  if (el) { el.textContent = 'Versão ' + APP_VERSION + ' · ' + APP_BUILT; }
  var meta = document.getElementById('appVersionMeta');
  if (meta) { meta.setAttribute('content', APP_VERSION); }
  var lab = document.getElementById('appVersionLabel');
  if (lab) { lab.textContent = APP_VERSION + ' · ' + APP_BUILT; }
}

/* ── diagnóstico: prova de que a app está inteira ──────────────── */

var HX_DIAG = { rows: [], running: false };

var HX_DIAG_FNS = [
  'showSection', 'saveData', 'updateOverview', 'renderWaterDrops', 'updateWaterProgress',
  'mascotStreak', 'renderMascot', 'renderDailyFlow', 'openRemindersModal', 'saveReminders',
  'applyUiPrefs', 'exportData', 'importData', 'clearAllData', 'initPWA', 'sendNotification',
  'hxWater', 'hxBreak', 'hxLight', 'hxOpenMood', 'hxSaveMood', 'hxRenderDays', 'hxRenderObs',
  'hxDayOff', 'hxExportMood', 'hxDeleteMood', 'hxApplyDayTheme', 'setUiDayTheme'
];

function hxDiagRow(kind, txt, det) {
  HX_DIAG.rows.push({ kind: kind, txt: txt, det: det == null ? '' : String(det) });
}

function hxDiagOverlay() {
  var el = document.getElementById('hxDiag');
  if (el) { return el; }
  el = document.createElement('div');
  el.id = 'hxDiag';
  el.className = 'hx-diag';
  el.innerHTML =
    '<div class="hx-diag-panel" role="dialog" aria-modal="true" aria-labelledby="hxDiagTitle">' +
      '<div class="hx-diag-head">' +
        '<div><div class="hx-diag-title" id="hxDiagTitle">Diagnóstico</div>' +
        '<div class="hx-diag-sub" id="hxDiagSub">a verificar…</div></div>' +
        '<div class="hx-diag-acts">' +
          '<button type="button" class="hx-mini" id="hxDiagCopy">Copiar</button>' +
          '<button type="button" class="hx-close" onclick="hxCloseDiag()" aria-label="Fechar">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="hx-diag-body" id="hxDiagBody"></div>' +
    '</div>';
  document.body.appendChild(el);
  return el;
}

function hxCloseDiag() {
  var el = document.getElementById('hxDiag');
  if (el) { el.remove(); }
}

function hxDiagPaint(final) {
  var body = document.getElementById('hxDiagBody');
  if (!body) { return; }
  var bad = HX_DIAG.rows.filter(function (r) { return r.kind === 'bad'; }).length;
  var warn = HX_DIAG.rows.filter(function (r) { return r.kind === 'warn'; }).length;
  var ok = HX_DIAG.rows.filter(function (r) { return r.kind === 'ok'; }).length;

  var sub = document.getElementById('hxDiagSub');
  if (sub) {
    if (!final) { sub.textContent = 'a verificar…'; }
    else if (bad) { sub.textContent = bad + ' problema(s), ' + warn + ' aviso(s), ' + ok + ' tudo bem'; }
    else { sub.textContent = ok + ' verificações passaram' + (warn ? ' · ' + warn + ' aviso(s)' : '') + ' · versão ' + APP_VERSION; }
  }

  body.innerHTML = HX_DIAG.rows.map(function (r) {
    var mark = r.kind === 'ok' ? '✓' : r.kind === 'warn' ? '!' : '✕';
    return '<div class="hx-diag-row ' + r.kind + '">' +
      '<span class="hx-diag-mark" aria-hidden="true">' + mark + '</span>' +
      '<span class="hx-diag-txt">' + hxEsc(r.txt) + (r.det ? ' <span class="hx-diag-det">' + hxEsc(r.det) + '</span>' : '') + '</span>' +
      '</div>';
  }).join('');
}

async function hxRunDiagnostic() {
  if (HX_DIAG.running) { return; }
  HX_DIAG.running = true;
  HX_DIAG.rows = [];
  hxDiagOverlay();
  hxDiagPaint(false);

  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // 1) secções
  var secs = [].slice.call(document.querySelectorAll('[id^="section-"]'));
  var nada = [];
  var antes = document.querySelector('.section.active');
  var antesId = antes ? antes.id.replace('section-', '') : 'overview';
  for (var i = 0; i < secs.length; i++) {
    var id = secs[i].id.replace('section-', '');
    try {
      showSection(id, null, true);
      if (secs[i].offsetHeight < 40) { nada.push(id); }
    } catch (e) { nada.push(id + ' (' + e.message + ')'); }
  }
  try { showSection(antesId, null, true); } catch (e) {}
  hxDiagRow(nada.length ? 'bad' : 'ok',
    nada.length ? 'Secções que não abrem' : 'Todas as secções abrem',
    nada.length ? nada.join(', ') : secs.length + ' secções');

  // 2) erros desde o arranque
  var errs = (window.__hxErr || []).slice(0, 5);
  hxDiagRow(errs.length ? 'bad' : 'ok',
    errs.length ? 'Erros de JavaScript' : 'Sem erros de JavaScript',
    errs.length ? errs.join(' | ') : 'zero desde o arranque');

  // 3) ids duplicados
  var seen = {}, dup = [];
  [].forEach.call(document.querySelectorAll('[id]'), function (el) {
    if (seen[el.id]) { if (dup.indexOf(el.id) === -1) { dup.push(el.id); } } else { seen[el.id] = 1; }
  });
  hxDiagRow(dup.length ? 'bad' : 'ok',
    dup.length ? 'IDs duplicados' : 'Sem IDs duplicados',
    dup.length ? dup.join(', ') : Object.keys(seen).length + ' ids únicos');

  // 4) funções essenciais
  var falta = HX_DIAG_FNS.filter(function (f) { return typeof window[f] !== 'function'; });
  hxDiagRow(falta.length ? 'bad' : 'ok',
    falta.length ? 'Funções em falta' : 'Todas as funções respondem',
    falta.length ? falta.join(', ') : HX_DIAG_FNS.length + ' funções');

  // 5) dados locais
  var dias = 0, horas = 0;
  try { dias = Object.keys(DB).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }).length; } catch (e) {}
  try { horas = Object.keys(hxMoodsLocal()).length; } catch (e) {}
  var jsonRoto = [];
  ['dvLifeDiary_v3', 'dvUiPrefs', 'dvReminders', 'dvHomeMood', 'dvNotifState'].forEach(function (k) {
    var raw = null;
    try { raw = localStorage.getItem(k); } catch (e) { return; }
    if (raw == null) { return; }
    try { JSON.parse(raw); } catch (e) { jsonRoto.push(k); }
  });
  hxDiagRow(jsonRoto.length ? 'bad' : 'ok',
    jsonRoto.length ? 'Dados locais ilegíveis' : 'Dados locais legíveis',
    (jsonRoto.length ? jsonRoto.join(', ') + ' · ' : '') + dias + ' dias · ' + horas + ' registos de humor');

  // 6) transbordo a várias larguras
  var larguras = [360, 768, 1280];
  var resultados = [];
  for (var w = 0; w < larguras.length; w++) {
    var larg = larguras[w];
    var res = await hxDiagWidth(larg, wait);
    resultados.push({ larg: larg, over: res });
  }
  var maus = resultados.filter(function (r) { return r.over.length; });
  hxDiagRow(maus.length ? 'bad' : 'ok',
    maus.length ? 'Transbordo horizontal' : 'Nada transborda',
    maus.length
      ? maus.map(function (r) { return r.larg + 'px: ' + r.over.join(', '); }).join(' · ')
      : larguras.join(', ') + ' px');

  // 7) Supabase
  var sb = await hxDiagCloud();
  hxDiagRow(sb.kind, sb.txt, sb.det);

  // 7b) lembretes na nuvem
  var rem = await hxDiagReminders();
  hxDiagRow(rem.kind, rem.txt, rem.det);

  // 8) contexto
  var sessao = 'sem sessão (só este dispositivo)';
  try {
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      var s = await supabaseClient.auth.getSession();
      if (s && s.data && s.data.session) { sessao = 'sessão iniciada'; }
    }
  } catch (e) {}
  hxDiagRow('ok', 'Versão e contexto', APP_VERSION + ' · ' + sessao);

  HX_DIAG.running = false;
  hxDiagPaint(true);

  var btn = document.getElementById('hxDiagCopy');
  if (btn) {
    btn.onclick = function () {
      var txt = 'Diagnóstico ' + APP_VERSION + '\n' + HX_DIAG.rows.map(function (r) {
        return (r.kind === 'ok' ? 'OK  ' : r.kind === 'warn' ? 'AVISO ' : 'ERRO ') + r.txt + (r.det ? ' — ' + r.det : '');
      }).join('\n');
      try {
        navigator.clipboard.writeText(txt);
        btn.textContent = 'Copiado';
      } catch (e) { btn.textContent = 'Não deu'; }
      setTimeout(function () { btn.textContent = 'Copiar'; }, 2000);
    };
  }
  return HX_DIAG.rows;
}

function hxDiagWidth(larg, wait) {
  return new Promise(function (resolve) {
    var f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + larg + 'px;height:800px;border:0;visibility:hidden';
    f.src = 'index.html?diag=embed&w=' + larg;
    var done = false;
    var fim = function (over) {
      if (done) { return; }
      done = true;
      try { f.remove(); } catch (e) {}
      resolve(over);
    };
    var t = setTimeout(function () { fim(['tempo esgotado']); }, 12000);
    f.onload = function () {
      setTimeout(function () {
        var over = [];
        try {
          var w = f.contentWindow, d = f.contentDocument;
          if (w && typeof w.showApp === 'function' && d.getElementById('appContent')) {
            try { w.showApp(null); } catch (e) {}
          }
          var base = d.documentElement.scrollWidth - d.documentElement.clientWidth;
          if (base > 1) { over.push('documento +' + base + 'px'); }
          [].forEach.call(d.querySelectorAll('[id^="section-"]'), function (s) {
            var id = s.id.replace('section-', '');
            try { w.showSection(id, null, true); } catch (e) {}
            var dif = Math.round(s.scrollWidth - s.clientWidth);
            if (dif > 1) { over.push(id + ' +' + dif + 'px'); }
          });
        } catch (e) { over.push('não consegui medir'); }
        clearTimeout(t);
        fim(over);
      }, 600);
    };
    document.body.appendChild(f);
  });
}

async function hxDiagReminders() {
  var session = null;
  try { session = await hxPushSession(); } catch (e) {}
  if (!session) {
    return { kind: 'warn', txt: 'Lembretes na nuvem por confirmar', det: 'sem sessão iniciada — só este dispositivo' };
  }
  try {
    var s = await supabaseClient.from('reminder_settings')
      .select('enabled,manha,almoco,noite,max_dia')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (s.error) { return { kind: 'bad', txt: 'Não consegui ler as preferências', det: s.error.message }; }
    if (!s.data) { return { kind: 'warn', txt: 'Ainda não guardaste os lembretes na nuvem', det: 'Lembretes → Guardar' }; }
    if (s.data.enabled === false) { return { kind: 'warn', txt: 'Lembretes desligados na nuvem', det: 'liga o toggle e Guardar' }; }

    var p = await supabaseClient.from('push_subscriptions').select('id').eq('user_id', session.user.id);
    var n = (p && !p.error && Array.isArray(p.data)) ? p.data.length : 0;
    var horas = 'manhã ' + (s.data.manha || '—') + ' · almoço ' + (s.data.almoco || '—') + ' · noite ' + (s.data.noite || '—');
    if (!n) {
      return { kind: 'warn', txt: 'Preferências na nuvem, sem push', det: horas + ' · falta Ativar' };
    }
    return { kind: 'ok', txt: 'Lembretes sincronizados', det: n + (n === 1 ? ' dispositivo' : ' dispositivos') + ' · ' + horas };
  } catch (e) {
    return { kind: 'warn', txt: 'Não consegui verificar a nuvem', det: String((e && e.message) || e) };
  }
}

async function hxDiagCloud() {
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/mood_checkins?select=id&limit=1', {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    });
    if (r.status === 200) { return { kind: 'ok', txt: 'Supabase responde', det: 'mood_checkins acessível' }; }
    if (r.status === 401 || r.status === 403) { return { kind: 'ok', txt: 'Supabase responde', det: 'tabela existe, protegida por RLS (' + r.status + ')' }; }
    return { kind: 'warn', txt: 'Supabase respondeu ' + r.status, det: 'pode ser temporário' };
  } catch (e) {
    if (navigator.onLine === false) { return { kind: 'warn', txt: 'Sem rede agora', det: 'a app guarda no dispositivo' }; }
    return { kind: 'warn', txt: 'Não consegui falar com o Supabase', det: String(e && e.message || e) };
  }
}

/* ── refeições: memória do que já registaste ────────────────────── */

function hxMealDb(slot) {
  var counts = {};
  var push = function (items, dayKey) {
    (items || []).forEach(function (m) {
      var name = String((m && m.name) || '').trim();
      if (!name) { return; }
      var key = name.toLowerCase();
      if (!counts[key]) { counts[key] = { name: name, cal: 0, n: 0, last: '' }; }
      counts[key].n++;
      if (!counts[key].cal && m.cal) { counts[key].cal = Number(m.cal) || 0; }
      if (dayKey > counts[key].last) { counts[key].last = dayKey; }
    });
  };
  try {
    Object.keys(DB).forEach(function (d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d === TODAY) { return; }
      var day = DB[d];
      if (!day || !day.meals) { return; }
      push(day.meals[slot], d);
    });
  } catch (e) {}
  push(meals[slot] || [], TODAY);
  return Object.keys(counts).map(function (k) { return counts[k]; })
    .sort(function (a, b) { return (b.n - a.n) || (a.last < b.last ? 1 : -1); });
}

function hxMealYesterday(slot) {
  try {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    var k = localDateStr(d);
    var day = DB[k];
    if (!day || !day.meals) { return null; }
    var items = day.meals[slot] || [];
    return items.length ? { date: k, items: items } : null;
  } catch (e) { return null; }
}

function hxMealBox(slot) {
  var body = document.querySelector('#slot-' + slot + ' .meal-slot-body');
  if (!body) { return null; }
  var box = body.querySelector('.hx-meal-hist');
  if (!box) {
    box = document.createElement('div');
    box.className = 'hx-meal-hist';
    body.appendChild(box);
  }
  return box;
}

function hxMealSuggest(slot) {
  var box = hxMealBox(slot);
  if (!box) { return; }
  var hoje = {};
  (meals[slot] || []).forEach(function (m) { hoje[String(m.name || '').toLowerCase()] = 1; });

  var recentes = hxMealDb(slot).filter(function (m) { return !hoje[m.name.toLowerCase()]; }).slice(0, 4);
  var ontem = hxMealYesterday(slot);
  var out = [];

  if (ontem) {
    var totalOntem = ontem.items.reduce(function (s, m) { return s + (Number(m.cal) || 0); }, 0);
    out.push('<button type="button" class="hx-meal-chip hx-meal-repeat" data-slot="' + slot + '" data-repeat="1">' +
      '↺ Repetir ontem' + (totalOntem ? ' · ' + totalOntem + ' kcal' : '') + '</button>');
  }
  recentes.forEach(function (m) {
    out.push('<button type="button" class="hx-meal-chip" data-slot="' + slot + '" data-name="' + hxEsc(m.name) + '" data-cal="' + (m.cal || 0) + '"' +
      ' title="' + hxEsc(m.name) + (m.cal ? ' · ' + m.cal + ' kcal' : '') + '">' +
      hxEsc(m.name) + (m.cal ? ' · ' + m.cal : '') + '</button>');
  });

  box.innerHTML = out.length
    ? '<div class="hx-meal-lbl">Do teu histórico</div><div class="hx-meal-chips">' + out.join('') + '</div>'
    : '';
}

function hxMealSuggestAll() {
  Object.keys(SLOTS).forEach(function (slot) {
    try { hxMealSuggest(slot); } catch (e) {}
  });
}

function hxMealAdd(slot, name, cal) {
  if (!name) { return; }
  meals[slot] = meals[slot] || [];
  meals[slot].push({ name: name, cal: Number(cal) || 0, aiCalc: false });
  try { renderMeals(); } catch (e) {}
  try { updateSidebarCals(); } catch (e) {}
  try { saveData(true); } catch (e) {}
  hxToast('Adicionado: ' + name + '.');
}

function hxMealRepeat(slot) {
  var ontem = hxMealYesterday(slot);
  if (!ontem) { return; }
  var hoje = {};
  (meals[slot] || []).forEach(function (m) { hoje[String(m.name || '').toLowerCase()] = 1; });
  var add = 0;
  ontem.items.forEach(function (m) {
    var key = String(m.name || '').toLowerCase();
    if (!key || hoje[key]) { return; }
    hoje[key] = 1;
    meals[slot] = meals[slot] || [];
    meals[slot].push({ name: m.name, cal: Number(m.cal) || 0, aiCalc: false });
    add++;
  });
  if (!add) { hxToast('Ontem já estava tudo igual. Nada a repetir.'); return; }
  try { renderMeals(); } catch (e) {}
  try { updateSidebarCals(); } catch (e) {}
  try { saveData(true); } catch (e) {}
  hxToast(add + (add === 1 ? ' refeição repetida de ontem.' : ' refeições repetidas de ontem.'));
}

document.addEventListener('click', function (ev) {
  var chip = ev.target && ev.target.closest ? ev.target.closest('.hx-meal-chip') : null;
  if (!chip) { return; }
  ev.preventDefault();
  var slot = chip.getAttribute('data-slot');
  if (chip.getAttribute('data-repeat')) { hxMealRepeat(slot); return; }
  hxMealAdd(slot, chip.getAttribute('data-name'), chip.getAttribute('data-cal'));
});

(function hxMealPatch() {
  if (typeof renderMeals !== 'function') { return; }
  var orig = renderMeals;
  renderMeals = function () {
    var r = orig.apply(this, arguments);
    try { hxMealSuggestAll(); } catch (e) {}
    return r;
  };
})();

/* ── paleta de comandos (Ctrl+K) ───────────────────────────────── */

var HX_PALETTE = [];

function hxPaletteItems() {
  var out = [];
  Object.keys(SECTION_LABELS).forEach(function (id) {
    if (id === 'competition' || id === 'compadmin') { return; }
    if (!document.getElementById('section-' + id)) { return; }
    out.push({ group: 'Ir para', label: SECTION_LABELS[id], run: function () {
      if (id === 'shopping') { hxOpenShopping(); return; }
      showSection(id, navBySection(id));
    } });
  });
  out.push({ group: 'Fazer', label: 'Registar um copo de água', run: function () { showSection('overview', navBySection('overview')); hxWater(document.getElementById('hxBtnWater')); } });
  out.push({ group: 'Fazer', label: 'Registar uma pausa', run: function () { showSection('overview', navBySection('overview')); hxBreak(document.getElementById('hxBtnBreak')); } });
  out.push({ group: 'Fazer', label: 'Registar luz natural', run: function () { showSection('overview', navBySection('overview')); hxLight(document.getElementById('hxBtnLight')); } });
  out.push({ group: 'Fazer', label: 'Check-in de humor', run: function () { hxOpenMood(); } });
  out.push({ group: 'Fazer', label: 'Dia difícil (só água e humor)', run: function () { hxDayOff(); } });
  out.push({ group: 'Fazer', label: 'Lembretes e notificações', run: function () { openRemindersModal(); } });
  out.push({ group: 'Fazer', label: 'Exportar os meus dados', run: function () { exportData(); } });
  out.push({ group: 'Fazer', label: 'Exportar só o humor', run: function () { hxExportMood(); } });
  out.push({ group: 'Fazer', label: 'Correr diagnóstico', run: function () { hxRunDiagnostic(); } });
  out.push({ group: 'Ver', label: 'Versão: ' + APP_VERSION, run: function () { showSection('settings', navBySection('settings')); hxToast('Versão ' + APP_VERSION + ' · ' + APP_BUILT); } });
  return out;
}

function hxPaletteOpen() {
  var el = document.getElementById('hxPalette');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hxPalette';
    el.className = 'hx-pal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Comandos');
    el.innerHTML =
      '<div class="hx-pal-box">' +
        '<input type="text" class="hx-pal-input" id="hxPalInput" autocomplete="off" spellcheck="false" ' +
          'placeholder="Onde queres ir?  ·  Esc fecha" aria-controls="hxPalList" aria-autocomplete="list">' +
        '<div class="hx-pal-list" id="hxPalList" role="listbox" aria-label="Sugestões"></div>' +
      '</div>';
    el.addEventListener('click', function (ev) {
      if (ev.target === el) { hxPaletteClose(); }
    });
    document.body.appendChild(el);
    el.querySelector('.hx-pal-input').addEventListener('input', function () { hxPaletteRender(this.value); });
    el.querySelector('.hx-pal-list').addEventListener('click', function (ev) {
      var b = ev.target.closest('.hx-pal-item');
      if (!b) { return; }
      hxPaletteRun(Number(b.getAttribute('data-i')));
    });
  }
  HX_PALETTE = hxPaletteItems();
  hxPaletteRender('');
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
  var inp = document.getElementById('hxPalInput');
  if (inp) { inp.value = ''; inp.focus(); }
}

function hxPaletteClose() {
  var el = document.getElementById('hxPalette');
  if (el) { el.classList.remove('open'); }
  document.body.style.overflow = '';
}

function hxNorm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function hxPaletteFilter(q) {
  var nq = hxNorm(q).trim();
  if (!nq) { return HX_PALETTE.slice(0, 12); }
  return HX_PALETTE
    .filter(function (it) { return hxNorm(it.label).indexOf(nq) !== -1 || hxNorm(it.group).indexOf(nq) !== -1; })
    .slice(0, 12);
}

function hxPaletteRender(q) {
  var list = document.getElementById('hxPalList');
  if (!list) { return; }
  var items = hxPaletteFilter(q);
  window.__hxPalItems = items;
  window.__hxPalSel = 0;
  if (!items.length) {
    list.innerHTML = '<div class="hx-pal-empty">Nada com «' + hxEsc(q) + '».</div>';
    return;
  }
  list.innerHTML = items.map(function (it, i) {
    return '<button type="button" class="hx-pal-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '" role="option" aria-selected="' + (i === 0) + '">' +
      '<span class="hx-pal-grp">' + hxEsc(it.group) + '</span>' +
      '<span class="hx-pal-lbl">' + hxEsc(it.label) + '</span></button>';
  }).join('');
}

function hxPaletteMove(delta) {
  var items = window.__hxPalItems || [];
  if (!items.length) { return; }
  var sel = (window.__hxPalSel || 0) + delta;
  if (sel < 0) { sel = items.length - 1; }
  if (sel >= items.length) { sel = 0; }
  window.__hxPalSel = sel;
  var nodes = document.querySelectorAll('#hxPalList .hx-pal-item');
  nodes.forEach(function (n, i) {
    n.classList.toggle('sel', i === sel);
    n.setAttribute('aria-selected', String(i === sel));
  });
  if (nodes[sel] && nodes[sel].scrollIntoView) { nodes[sel].scrollIntoView({ block: 'nearest' }); }
}

function hxPaletteRun(i) {
  var items = window.__hxPalItems || [];
  var it = items[i];
  hxPaletteClose();
  if (it && typeof it.run === 'function') { setTimeout(function () { it.run(); }, 60); }
}

document.addEventListener('keydown', function (ev) {
  var pal = document.getElementById('hxPalette');
  var open = pal && pal.classList.contains('open');
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) {
    ev.preventDefault();
    if (open) { hxPaletteClose(); } else { hxPaletteOpen(); }
    return;
  }
  if (!open) { return; }
  if (ev.key === 'Escape') { ev.preventDefault(); hxPaletteClose(); return; }
  if (ev.key === 'ArrowDown') { ev.preventDefault(); hxPaletteMove(1); return; }
  if (ev.key === 'ArrowUp') { ev.preventDefault(); hxPaletteMove(-1); return; }
  if (ev.key === 'Enter') {
    ev.preventDefault();
    hxPaletteRun(window.__hxPalSel || 0);
  }
});

/* ── cartões do Resumo que se fecham e lembram ─────────────────── */

var HX_FOLD_KEY = 'dvFoldedCards';
var HX_FOLD_KEEP = { hxQuick: 1, waterMini: 1 };

function hxFolded() { return hxRead(HX_FOLD_KEY, {}) || {}; }

function hxFoldTargets() {
  var out = [];
  ['overview', 'stats', 'settings', 'meals', 'work'].forEach(function (sid) {
    var sec = document.getElementById('section-' + sid);
    if (!sec) { return; }
    [].forEach.call(sec.querySelectorAll(':scope > .card'), function (card, i) {
      if (card.id && HX_FOLD_KEEP[card.id]) { return; }
      var head = card.querySelector('.card-title') || card.querySelector('.hx-hist-head');
      if (!head) { return; }
      if (!card.id) { card.id = 'hxf-' + sid + '-' + i; }
      out.push({ card: card, head: head });
    });
  });
  return out;
}

function hxFoldApply() {
  var st = hxFolded();
  hxFoldTargets().forEach(function (t) {
    var card = t.card, head = t.head, id = card.id;
    head.classList.add('hx-fold-head');
    if (!head.querySelector('.hx-fold-btn')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hx-fold-btn';
      btn.innerHTML = '<span class="hx-fold-t">' + head.innerHTML + '</span><span class="hx-fold-i" aria-hidden="true">⌄</span>';
      head.innerHTML = '';
      head.appendChild(btn);
      btn.addEventListener('click', function () { hxFoldToggle(id); });
    }
    var folded = st[id] === true;
    card.classList.toggle('hx-folded', folded);
    var b = head.querySelector('.hx-fold-btn');
    if (b) {
      b.setAttribute('aria-expanded', String(!folded));
      b.setAttribute('aria-label', (folded ? 'Abrir ' : 'Fechar ') + b.querySelector('.hx-fold-t').textContent.trim());
    }
  });
}

function hxFoldToggle(id) {
  var st = hxFolded();
  st[id] = !(st[id] === true);
  hxWrite(HX_FOLD_KEY, st);
  hxFoldApply();
}

/* ── push: avisos com a app fechada ────────────────────────────── */

var HX_VAPID_PUBLIC = 'BGwDndPahI6fqWBTjfz7i3pcCPS_e7933tdYXYmBaVxfKZyI_K4ATv59Pzn5SrMppROIGqD0lUzNR8sCd4SqSqk';
var HX_PUSH_FLAG = 'dvPushOn';
var HX_SYNC_LAST = { at: 0, ok: null, msg: '' };

function hxSyncStatus() {
  var el = document.getElementById('hxSyncStatus');
  if (!el) { return; }
  if (!HX_SYNC_LAST.at) {
    el.textContent = 'Preferências na nuvem: por confirmar.';
    el.style.color = 'var(--muted)';
    return;
  }
  if (HX_SYNC_LAST.ok) {
    el.textContent = 'Preferências guardadas na nuvem às ' +
      new Date(HX_SYNC_LAST.at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) + '.';
    el.style.color = 'var(--moss-l)';
  } else {
    el.textContent = 'A nuvem não recebeu: ' + HX_SYNC_LAST.msg + '.';
    el.style.color = 'var(--sand)';
  }
}

function hxPushSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}

function hxB64ToBytes(b64) {
  var pad = new Array(((4 - (b64.length % 4)) % 4) + 1).join('=');
  var s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(s);
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) { out[i] = raw.charCodeAt(i); }
  return out;
}

async function hxPushSession() {
  try {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) { return null; }
    var res = await supabaseClient.auth.getSession();
    return (res && res.data && res.data.session) ? res.data.session : null;
  } catch (e) { return null; }
}

async function hxPushSubscribe() {
  if (!hxPushSupported()) { return { ok: false, msg: 'Este browser não suporta avisos em segundo plano.' }; }
  var granted = await requestNotifications();
  if (!granted) { return { ok: false, msg: 'Falta autorizar as notificações no browser.' }; }

  var reg = swRegistration;
  if (!reg) {
    try { reg = await navigator.serviceWorker.ready; } catch (e) { reg = null; }
  }
  if (!reg) { return { ok: false, msg: 'O service worker ainda não arrancou. Recarrega a página.' }; }

  var sub = null;
  try { sub = await reg.pushManager.getSubscription(); } catch (e) {}
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: hxB64ToBytes(HX_VAPID_PUBLIC)
      });
    } catch (e) {
      return { ok: false, msg: 'O browser recusou a subscrição: ' + (e && e.message || 'sem detalhe') };
    }
  }

  var session = await hxPushSession();
  if (!session) {
    hxWrite(HX_PUSH_FLAG, true);
    return { ok: true, msg: 'Subscrito neste dispositivo. Inicia sessão para o servidor poder enviar.' };
  }

  try {
    var j = sub.toJSON();
    var up = await supabaseClient.from('push_subscriptions').upsert({
      user_id: session.user.id,
      endpoint: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
      user_agent: String(navigator.userAgent || '').slice(0, 180),
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (up.error) { return { ok: true, msg: 'Subscrito, mas a conta recusou: ' + up.error.message }; }
  } catch (e) {
    return { ok: true, msg: 'Subscrito só neste dispositivo (servidor indisponível).' };
  }

  hxWrite(HX_PUSH_FLAG, true);
  return { ok: true, msg: 'Ligado. Os lembretes chegam mesmo com a app fechada.' };
}

async function hxPushUnsubscribe() {
  hxWrite(HX_PUSH_FLAG, false);
  var session = await hxPushSession();
  try {
    var reg = swRegistration || (await navigator.serviceWorker.ready);
    var sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      var ep = sub.endpoint;
      try { await sub.unsubscribe(); } catch (e) {}
      if (session && supabaseClient) {
        await supabaseClient.from('push_subscriptions').delete().eq('endpoint', ep);
      }
    }
  } catch (e) { console.warn('push off:', e && e.message); }
  return { ok: true, msg: 'Desligado. Os lembretes ficam só com a app aberta.' };
}

async function hxPushStatus() {
  var el = document.getElementById('hxPushStatus');
  var btn = document.getElementById('hxPushBtn');
  if (!el || !btn) { return; }
  var on = hxRead(HX_PUSH_FLAG, false) === true;

  if (!hxPushSupported()) {
    el.textContent = 'Este browser não suporta avisos com a app fechada.';
    btn.textContent = 'Indisponível';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  if ('Notification' in window && Notification.permission === 'denied') {
    el.textContent = 'As notificações estão bloqueadas nas definições do browser.';
    btn.textContent = 'Bloqueado';
    return;
  }
  if (!on) {
    el.textContent = 'Opcional: um toque para receberes no telemóvel, sem abrires a app.';
    btn.textContent = 'Ativar';
    return;
  }
  var session = await hxPushSession();
  el.textContent = session
    ? 'Ligado. Chega ao telemóvel mesmo com a app fechada.'
    : 'Ligado neste dispositivo. Inicia sessão para o servidor enviar.';
  btn.textContent = 'Desligar';
}

async function hxPushToggle(btn) {
  if (btn) { btn.disabled = true; }
  var on = hxRead(HX_PUSH_FLAG, false) === true;
  var r = on ? await hxPushUnsubscribe() : await hxPushSubscribe();
  if (btn) { btn.disabled = false; }
  await hxPushStatus();
  hxToast(r.msg);
}

/* envia as preferências para o servidor (só com sessão) */
async function hxPushSyncSettings() {
  var session = await hxPushSession();
  if (!session) {
    HX_SYNC_LAST = { at: Date.now(), ok: false, msg: 'sem sessão iniciada' };
    hxSyncStatus();
    return { ok: false, msg: 'sem sessão iniciada' };
  }
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('dvReminders') || '{}'); } catch (e) {}
  var tz = 'Europe/Lisbon';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
  var sem = prefs.pesoSemana || {};
  var tr = prefs.treino || {};
  try {
    var r = await supabaseClient.from('reminder_settings').upsert({
      user_id: session.user.id,
      enabled: prefs.enabled !== false,
      manha: prefs.manha || null,
      almoco: prefs.almoco || null,
      noite: prefs.noite || null,
      peso_enabled: sem.enabled !== false,
      peso_dia: Number(sem.dia == null ? 0 : sem.dia),
      peso_hora: sem.hora || '09:00',
      treino_enabled: tr.enabled !== false,
      treino_hora: tr.hora || '18:00',
      max_dia: hxNotifMax(),
      tz: tz,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (r.error) {
      console.warn('reminder_settings:', r.error.message);
      HX_SYNC_LAST = { at: Date.now(), ok: false, msg: r.error.message };
      hxSyncStatus();
      return { ok: false, msg: r.error.message };
    }
    HX_SYNC_LAST = { at: Date.now(), ok: true, msg: '' };
    hxSyncStatus();
    return { ok: true, msg: 'preferências na nuvem' };
  } catch (e) {
    var m = (e && e.message) || 'sem rede';
    console.warn('reminder_settings:', m);
    HX_SYNC_LAST = { at: Date.now(), ok: false, msg: m };
    hxSyncStatus();
    return { ok: false, msg: m };
  }
}

(function hxPushBoot() {
  try {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'PUSH_RESUBSCRIBE') { hxPushSubscribe(); }
    });
  } catch (e) {}
  setTimeout(function () {
    try { hxPushStatus(); } catch (e) {}
    if (hxRead(HX_PUSH_FLAG, false) === true && hxPushSupported()) {
      hxPushSubscribe().then(function (r) { if (!r.ok) { console.warn('push:', r.msg); } }).catch(function () {});
    }
  }, 3200);
})();

/* ── lista de compras (mensal) ────────────────────────────────── */

var HX_SHOP_KEY = 'dvShopping';
var HX_SHOP_MAX = 300;
var HX_SHOP_BUY_MAX = 200;
var HX_SHOP_STORE_KEY = 'dvShoppingLastStore';

/* mês em visualização */
var HX_SHOP = { y: 0, m: 0 };
var HX_SHOP_STORE = 'normal';

var HX_SHOP_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

var HX_SHOP_STORES = [
  { id: 'normal',     label: 'Normal' },
  { id: 'continente', label: 'Continente' },
  { id: 'mercadona',  label: 'Mercadona' }
];

var HX_SHOP_CATS = [
  { id: 'frescos',    label: 'Frescos',    icon: '🥬' },
  { id: 'padaria',    label: 'Padaria',    icon: '🥖' },
  { id: 'mercearia',  label: 'Mercearia',  icon: '🥫' },
  { id: 'congelados', label: 'Congelados', icon: '🧊' },
  { id: 'higiene',    label: 'Higiene',    icon: '🧼' },
  { id: 'casa',       label: 'Casa',       icon: '🧹' },
  { id: 'outros',     label: 'Outros',     icon: '🛒' }
];

/* ordem importa: o primeiro grupo que casar ganha */
var HX_SHOP_GUESS = [
  ['congelados', ['congelad', 'gelado', 'gelados', 'pizza']],
  ['padaria', ['pao', 'broa', 'croissant', 'bolo', 'tosta', 'baguete', 'bolachas']],
  ['higiene', ['champu', 'sabao', 'gel de banho', 'pasta de dentes', 'escova', 'desodorizante', 'papel higienico', 'fralda', 'creme', 'absorvente']],
  ['casa', ['detergente', 'lixivia', 'sacos', 'esponja', 'papel de cozinha', 'velas', 'pilhas', 'toalhas de papel']],
  ['mercearia', ['arroz', 'massa', 'esparguete', 'atum', 'grao', 'feijao', 'azeite', 'oleo', 'sal', 'acucar', 'cafe', 'cha', 'cereais', 'farinha', 'mel', 'manteiga de amendoim', 'molho', 'vinagre']],
  ['frescos', ['leite', 'iogurte', 'queijo', 'manteiga', 'ovos', 'ovo', 'frango', 'carne', 'peixe', 'fruta', 'maca', 'banana', 'tomate', 'alface', 'cebola', 'batata', 'cenoura', 'legumes', 'salada', 'sumo', 'agua']]
];

function hxShopPad2(n) { return (n < 10 ? '0' : '') + n; }
function hxShopId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function hxShopBuyId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function hxShopNow() {
  var d = new Date();
  return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() };
}
function hxShopMonthKey(y, m) { return y + '-' + hxShopPad2(m + 1); }
function hxShopLastDay(y, m) { return new Date(y, m + 1, 0).getDate(); }
function hxShopMonthLabel(y, m) {
  var n = HX_SHOP_MONTHS[m] || '';
  return n.charAt(0).toUpperCase() + n.slice(1) + ' de ' + y;
}
function hxShopEnsureState() {
  if (!HX_SHOP.y) {
    var n = hxShopNow();
    HX_SHOP.y = n.y;
    HX_SHOP.m = n.m;
  }
}
function hxShopViewKey() {
  hxShopEnsureState();
  return hxShopMonthKey(HX_SHOP.y, HX_SHOP.m);
}

function hxShopCatOk(id) {
  return HX_SHOP_CATS.some(function (c) { return c.id === id; });
}
function hxShopCatLabel(id) {
  var c = HX_SHOP_CATS.filter(function (x) { return x.id === id; })[0];
  return c ? c.label : 'Outros';
}
function hxShopGuess(name) {
  var k = hxNorm(name);
  for (var i = 0; i < HX_SHOP_GUESS.length; i++) {
    var cat = HX_SHOP_GUESS[i][0];
    var words = HX_SHOP_GUESS[i][1];
    for (var j = 0; j < words.length; j++) {
      if (k.indexOf(words[j]) !== -1) { return cat; }
    }
  }
  return 'outros';
}
function hxShopStoreOk(id) {
  return HX_SHOP_STORES.some(function (s) { return s.id === id; });
}
function hxShopStoreLabel(id) {
  var s = HX_SHOP_STORES.filter(function (x) { return x.id === id; })[0];
  return s ? s.label : 'Normal';
}
function hxShopEur(cents) {
  var v = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v);
  } catch (e) {
    return v.toFixed(2).replace('.', ',') + ' €';
  }
}
/* aceita 12,50 · 12.50 · 1.234,56 · 12 € */
function hxShopParseAmount(v) {
  var s = String(v == null ? '' : v).replace(/[€\s\u00a0]/g, '');
  if (!s || !/^[0-9.,]+$/.test(s)) { return null; }
  if (s.indexOf(',') !== -1) { s = s.replace(/\./g, '').replace(',', '.'); }
  if (!/^\d*\.?\d{0,2}$/.test(s)) { return null; }
  var n = Number(s);
  if (!isFinite(n) || n <= 0 || n > 100000) { return null; }
  return Math.round(n * 100);
}
function hxShopSum(buys) {
  return (buys || []).reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
}
function hxShopDateShort(date) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  return m ? m[3] + '/' + m[2] : '';
}

function hxShopItemNorm(it) {
  if (!it || typeof it.name !== 'string' || !it.name.trim()) { return null; }
  return {
    id: String(it.id || hxShopId()),
    name: String(it.name).trim().slice(0, 60),
    qty: String(it.qty == null ? '' : it.qty).replace(/\s+/g, ' ').trim().slice(0, 14),
    cat: hxShopCatOk(it.cat) ? it.cat : 'outros',
    done: !!it.done,
    at: Number(it.at) || Date.now(),
    doneAt: Number(it.doneAt) || 0
  };
}
function hxShopBuyNorm(b) {
  if (!b || typeof b !== 'object') { return null; }
  var amount = Number(b.amount);
  if (!isFinite(amount) || amount <= 0) { return null; }
  var date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : '';
  return {
    id: String(b.id || hxShopBuyId()),
    date: date,
    amount: Math.round(amount),
    store: hxShopStoreOk(b.store) ? b.store : 'normal',
    note: String(b.note == null ? '' : b.note).replace(/\s+/g, ' ').trim().slice(0, 60),
    at: Number(b.at) || Date.now()
  };
}

function hxShopLoad() {
  var raw = hxRead(HX_SHOP_KEY, null);
  var out = { months: {}, seen: {}, updatedAt: 0 };
  if (!raw || typeof raw !== 'object') { return out; }

  if (raw.months && typeof raw.months === 'object') {
    Object.keys(raw.months).forEach(function (k) {
      if (!/^\d{4}-\d{2}$/.test(k)) { return; }
      var src = raw.months[k];
      if (!src || typeof src !== 'object') { return; }
      var rec = { items: [], buys: [] };
      if (Array.isArray(src.items)) {
        src.items.forEach(function (it) {
          var n = hxShopItemNorm(it);
          if (n) { rec.items.push(n); }
        });
      }
      if (Array.isArray(src.buys)) {
        src.buys.forEach(function (b) {
          var n = hxShopBuyNorm(b);
          if (n) { rec.buys.push(n); }
        });
      }
      if (rec.items.length || rec.buys.length) { out.months[k] = rec; }
    });
  }

  /* migração da lista antiga, que não tinha meses */
  if (!Object.keys(out.months).length && Array.isArray(raw.items)) {
    var n0 = hxShopNow();
    var k0 = hxShopMonthKey(n0.y, n0.m);
    var rec0 = { items: [], buys: [] };
    raw.items.forEach(function (it) {
      var n = hxShopItemNorm(it);
      if (n) { rec0.items.push(n); }
    });
    if (rec0.items.length) { out.months[k0] = rec0; }
  }

  if (raw.seen && typeof raw.seen === 'object') {
    Object.keys(raw.seen).forEach(function (k) {
      var s = raw.seen[k];
      if (!s || !s.name) { return; }
      out.seen[k] = {
        name: String(s.name).slice(0, 60),
        cat: hxShopCatOk(s.cat) ? s.cat : 'outros',
        n: Math.max(1, Number(s.n) || 1),
        last: Number(s.last) || 0
      };
    });
  }
  out.updatedAt = Number(raw.updatedAt) || 0;
  return out;
}

function hxShopSave(d) {
  if (!d || !d.months) { return; }
  Object.keys(d.months).forEach(function (k) {
    var rec = d.months[k];
    if (!rec || !Array.isArray(rec.items)) { return; }
    while (rec.items.length > HX_SHOP_MAX) {
      var idx = -1;
      rec.items.forEach(function (x, i) {
        if (x.done && (idx < 0 || x.doneAt < rec.items[idx].doneAt)) { idx = i; }
      });
      if (idx < 0) { idx = 0; }
      rec.items.splice(idx, 1);
    }
    if (Array.isArray(rec.buys) && rec.buys.length > HX_SHOP_BUY_MAX) {
      rec.buys = rec.buys.slice(rec.buys.length - HX_SHOP_BUY_MAX);
    }
    if (!rec.items.length && (!rec.buys || !rec.buys.length)) { delete d.months[k]; }
  });
  d.updatedAt = Date.now();
  hxWrite(HX_SHOP_KEY, d);
}

function hxShopRec(d, key, create) {
  d = d || hxShopLoad();
  key = key || hxShopViewKey();
  if (!d.months[key]) {
    if (!create) { return { items: [], buys: [] }; }
    d.months[key] = { items: [], buys: [] };
  }
  if (!Array.isArray(d.months[key].items)) { d.months[key].items = []; }
  if (!Array.isArray(d.months[key].buys)) { d.months[key].buys = []; }
  return d.months[key];
}

function hxShopSeen(d, name, cat) {
  var k = hxNorm(name);
  if (!k) { return; }
  var s = d.seen[k] || { name: name, cat: cat, n: 0, last: 0 };
  s.name = name;
  s.cat = cat;
  s.n = (Number(s.n) || 0) + 1;
  s.last = Date.now();
  d.seen[k] = s;
  var keys = Object.keys(d.seen);
  if (keys.length > 120) {
    keys.sort(function (a, b) {
      return (d.seen[a].n - d.seen[b].n) || (d.seen[a].last - d.seen[b].last);
    });
    keys.slice(0, keys.length - 120).forEach(function (k2) { delete d.seen[k2]; });
  }
}

function hxShopStoreRender() {
  var box = document.getElementById('hxShopStores');
  if (!box) { return; }
  box.innerHTML = HX_SHOP_STORES.map(function (s) {
    var sel = s.id === HX_SHOP_STORE;
    return '<button type="button" class="hx-shop-store st-' + s.id + (sel ? ' sel' : '') + '"' +
      ' role="radio" aria-checked="' + (sel ? 'true' : 'false') + '"' +
      ' data-store="' + s.id + '" onclick="hxShopBuyStore(this.getAttribute(\'data-store\'))">' +
      hxEsc(s.label) + '</button>';
  }).join('');
}

function hxShopInit() {
  hxShopEnsureState();
  var sel = document.getElementById('hxShopCat');
  if (sel && sel.options.length <= 1) {
    HX_SHOP_CATS.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.icon + ' ' + c.label;
      sel.appendChild(o);
    });
  }
  try {
    var last = localStorage.getItem(HX_SHOP_STORE_KEY);
    if (last && hxShopStoreOk(last)) { HX_SHOP_STORE = last; }
  } catch (e) {}
  hxShopStoreRender();
  try { hxShopRender(); } catch (e) {}
}

function hxOpenShopping() {
  hxShopEnsureState();
  var n = hxShopNow();
  HX_SHOP.y = n.y;
  HX_SHOP.m = n.m;
  showSection('shopping', navBySection('shopping'));
  hxShopRender();
  if (window.innerWidth > 768) {
    setTimeout(function () {
      var el = document.getElementById('hxShopName');
      if (el) { try { el.focus(); } catch (e) {} }
    }, 80);
  }
}

function hxShopMoveMonth(delta) {
  hxShopEnsureState();
  var alvo = new Date(HX_SHOP.y, HX_SHOP.m + delta, 1);
  var now = new Date();
  var limite = new Date(now.getFullYear(), now.getMonth(), 1);
  if (alvo.getTime() > limite.getTime()) { return; }
  if (alvo.getFullYear() < 2020) { return; }
  HX_SHOP.y = alvo.getFullYear();
  HX_SHOP.m = alvo.getMonth();
  hxShopRender();
}

function hxShopThisMonth() {
  var n = hxShopNow();
  HX_SHOP.y = n.y;
  HX_SHOP.m = n.m;
  hxShopRender();
}

function hxShopCarry() {
  hxShopEnsureState();
  var curKey = hxShopViewKey();
  var pd = new Date(HX_SHOP.y, HX_SHOP.m - 1, 1);
  var prevKey = hxShopMonthKey(pd.getFullYear(), pd.getMonth());
  var d = hxShopLoad();
  var prev = hxShopRec(d, prevKey, false);
  var cur = hxShopRec(d, curKey, true);
  var have = {};
  cur.items.forEach(function (x) { have[hxNorm(x.name)] = 1; });
  var add = prev.items.filter(function (x) {
    return !x.done && !have[hxNorm(x.name)];
  });
  if (!add.length) { hxToast('Não há nada por comprar no mês anterior.'); return; }
  var ids = [];
  add.forEach(function (x) {
    var nid = hxShopId();
    ids.push(nid);
    cur.items.push({
      id: nid, name: x.name, qty: x.qty, cat: x.cat,
      done: false, at: Date.now(), doneAt: 0
    });
  });
  hxShopSave(d);
  hxShopRender();
  var mes = HX_SHOP_MONTHS[pd.getMonth()] || '';
  hxShowUndo(add.length + (add.length === 1 ? ' item trazido de ' : ' itens trazidos de ') + mes, 20000, function () {
    var dd = hxShopLoad();
    var rr = hxShopRec(dd, curKey, false);
    rr.items = rr.items.filter(function (x) { return ids.indexOf(x.id) === -1; });
    hxShopSave(dd);
    hxShopRender();
    hxToast('Itens removidos.');
  });
}

function hxShopAdd() {
  var el = document.getElementById('hxShopName');
  if (!el) { return; }
  var name = String(el.value || '').replace(/\s+/g, ' ').trim();
  if (!name) { el.focus(); return; }
  var qtyEl = document.getElementById('hxShopQty');
  var catEl = document.getElementById('hxShopCat');
  var qty = qtyEl ? String(qtyEl.value || '').replace(/\s+/g, ' ').trim() : '';
  var cat = catEl ? catEl.value : 'auto';
  if (cat === 'auto' || !hxShopCatOk(cat)) { cat = hxShopGuess(name); }

  var d = hxShopLoad();
  var rec = hxShopRec(d, hxShopViewKey(), true);
  var key = hxNorm(name);
  var existente = rec.items.filter(function (x) {
    return !x.done && hxNorm(x.name) === key;
  })[0];

  if (existente) {
    if (qty && !existente.qty) { existente.qty = qty.slice(0, 14); }
    hxShopSave(d);
    el.value = '';
    if (qtyEl) { qtyEl.value = ''; }
    hxShopRender();
    hxShopFlash(existente.name);
    hxToast('“' + existente.name + '” já está na lista.');
    el.focus();
    return;
  }

  rec.items.push({
    id: hxShopId(),
    name: name.slice(0, 60),
    qty: qty.slice(0, 14),
    cat: cat,
    done: false,
    at: Date.now(),
    doneAt: 0
  });
  hxShopSeen(d, name, cat);
  hxShopSave(d);
  el.value = '';
  if (qtyEl) { qtyEl.value = ''; }
  if (catEl) { catEl.value = 'auto'; }
  hxShopRender();
  el.focus();
  hxToast('Adicionado: ' + name + '.');
}

function hxShopQuick(name, cat) {
  var el = document.getElementById('hxShopName');
  if (!el) { return; }
  el.value = name;
  var catEl = document.getElementById('hxShopCat');
  if (catEl && hxShopCatOk(cat)) { catEl.value = cat; }
  hxShopAdd();
}

function hxShopToggle(id) {
  var d = hxShopLoad();
  var rec = hxShopRec(d, hxShopViewKey(), true);
  var it = rec.items.filter(function (x) { return x.id === id; })[0];
  if (!it) { return; }
  it.done = !it.done;
  it.doneAt = it.done ? Date.now() : 0;
  hxShopSave(d);
  hxShopRender();
}

function hxShopDel(id) {
  var d = hxShopLoad();
  var rec = hxShopRec(d, hxShopViewKey(), false);
  var idx = -1;
  rec.items.forEach(function (x, i) { if (x.id === id) { idx = i; } });
  if (idx < 0) { return; }
  var removed = rec.items[idx];
  var key = hxShopViewKey();
  rec.items.splice(idx, 1);
  hxShopSave(d);
  hxShopRender();
  hxShowUndo('Removido: ' + removed.name, 20000, function () {
    var dd = hxShopLoad();
    var rr = hxShopRec(dd, key, true);
    rr.items.splice(Math.min(idx, rr.items.length), 0, removed);
    hxShopSave(dd);
    hxShopRender();
    hxToast('De volta: ' + removed.name + '.');
  });
}

function hxShopClearDone() {
  var d = hxShopLoad();
  var key = hxShopViewKey();
  var rec = hxShopRec(d, key, false);
  var done = rec.items.filter(function (x) { return x.done; });
  if (!done.length) { hxToast('Ainda não há nada no carrinho.'); return; }
  rec.items = rec.items.filter(function (x) { return !x.done; });
  hxShopSave(d);
  hxShopRender();
  hxShowUndo(done.length === 1 ? '1 comprado removido' : done.length + ' comprados removidos', 20000, function () {
    var dd = hxShopLoad();
    var rr = hxShopRec(dd, key, true);
    rr.items = rr.items.concat(done);
    hxShopSave(dd);
    hxShopRender();
    hxToast('Lista reposta.');
  });
}

function hxShopFlash(name) {
  var key = hxNorm(name).replace(/"/g, '');
  var node = document.querySelector('#hxShopList .hx-shop-item[data-key="' + key + '"]');
  if (!node) { return; }
  node.classList.add('flash');
  setTimeout(function () { node.classList.remove('flash'); }, 1200);
  try { node.scrollIntoView({ block: 'nearest' }); } catch (e) {}
}

function hxShopItemHTML(x) {
  return '<div class="hx-shop-item' + (x.done ? ' done' : '') + '" role="listitem" data-key="' + hxEsc(hxNorm(x.name)).replace(/"/g, '') + '">' +
    '<button type="button" class="hx-shop-check" aria-pressed="' + (x.done ? 'true' : 'false') + '"' +
    ' aria-label="' + (x.done ? 'Marcar como por comprar: ' : 'Marcar como comprado: ') + hxEsc(x.name) + '"' +
    ' onclick="hxShopToggle(\'' + x.id + '\')">' + (x.done ? '✓' : '') + '</button>' +
    '<div class="hx-shop-main">' +
      '<span class="hx-shop-name">' + hxEsc(x.name) + '</span>' +
      (x.qty ? '<span class="hx-shop-qty">' + hxEsc(x.qty) + '</span>' : '') +
    '</div>' +
    '<button type="button" class="hx-shop-del" aria-label="Remover ' + hxEsc(x.name) + '"' +
    ' onclick="hxShopDel(\'' + x.id + '\')">×</button>' +
  '</div>';
}

function hxShopSpendRender(rec) {
  var box = document.getElementById('hxShopSpend');
  if (!box) { return; }
  var mes = HX_SHOP_MONTHS[HX_SHOP.m] || '';
  var total = hxShopSum(rec.buys);
  if (!rec.buys.length) {
    box.innerHTML = '<div class="hx-shop-spend-empty">' +
      'Sem compras registadas em ' + hxEsc(mes) + '. Quando acabares, carrega em <b>Registar compra</b> e põe o valor.' +
    '</div>';
    return;
  }
  var byStore = {};
  rec.buys.forEach(function (b) { byStore[b.store] = (byStore[b.store] || 0) + b.amount; });
  var lojas = HX_SHOP_STORES.filter(function (s) { return byStore[s.id]; }).map(function (s) {
    return '<span class="hx-shop-storechip st-' + s.id + '">' + hxEsc(s.label) + ' · ' + hxShopEur(byStore[s.id]) + '</span>';
  }).join('');

  box.innerHTML =
    '<div class="hx-shop-spend-main">' +
      '<div class="hx-shop-spend-k">Gasto em ' + hxEsc(mes) + '</div>' +
      '<div class="hx-shop-spend-v">' + hxShopEur(total) + '</div>' +
      '<div class="hx-shop-spend-s">' + rec.buys.length + (rec.buys.length === 1 ? ' compra' : ' compras') + '</div>' +
    '</div>' +
    '<div class="hx-shop-spend-stores">' + lojas + '</div>';
}

function hxShopBuysRender(rec) {
  var box = document.getElementById('hxShopBuys');
  if (!box) { return; }
  if (!rec.buys.length) { box.innerHTML = ''; return; }

  var lista = rec.buys.slice().sort(function (a, b) {
    return (a.date === b.date) ? (b.at - a.at) : (a.date < b.date ? 1 : -1);
  });

  box.innerHTML = '<section class="hx-shop-buys" aria-label="Compras do mês">' +
    '<div class="hx-shop-gh">Compras do mês <span>' + rec.buys.length + '</span></div>' +
    lista.map(function (b) {
      return '<div class="hx-shop-buy">' +
        '<span class="hx-shop-buy-date">' + hxEsc(hxShopDateShort(b.date)) + '</span>' +
        '<div class="hx-shop-buy-main">' +
          '<span class="hx-shop-buy-store st-' + b.store + '">' + hxEsc(hxShopStoreLabel(b.store)) + '</span>' +
          (b.note ? '<span class="hx-shop-buy-note">' + hxEsc(b.note) + '</span>' : '') +
        '</div>' +
        '<span class="hx-shop-buy-amount">' + hxShopEur(b.amount) + '</span>' +
        '<button type="button" class="hx-shop-buy-del" aria-label="Remover compra de ' + hxEsc(hxShopEur(b.amount)) + '"' +
        ' onclick="hxShopBuyDel(\'' + b.id + '\')">×</button>' +
      '</div>';
    }).join('') +
  '</section>';
}

function hxShopRender() {
  var box = document.getElementById('hxShopList');
  if (!box) { return; }
  hxShopEnsureState();
  var d = hxShopLoad();
  var key = hxShopViewKey();
  var rec = hxShopRec(d, key, false);
  var pend = rec.items.filter(function (x) { return !x.done; });
  var done = rec.items.filter(function (x) { return x.done; });
  var n = hxShopNow();
  var atual = (HX_SHOP.y === n.y && HX_SHOP.m === n.m);

  var rotulo = document.getElementById('hxShopMonth');
  if (rotulo) { rotulo.textContent = hxShopMonthLabel(HX_SHOP.y, HX_SHOP.m); }
  var thisBtn = document.getElementById('hxShopThisBtn');
  if (thisBtn) { thisBtn.style.display = atual ? 'none' : ''; }
  var nextBtn = document.getElementById('hxShopNext');
  if (nextBtn) {
    nextBtn.disabled = atual;
    nextBtn.setAttribute('aria-disabled', atual ? 'true' : 'false');
  }

  var count = document.getElementById('hxShopCount');
  if (count) {
    count.textContent = !rec.items.length
      ? 'A lista está vazia.'
      : (pend.length ? pend.length + ' por comprar' : 'Tudo comprado') +
        (done.length ? ' · ' + done.length + ' no carrinho' : '');
  }

  /* o cartão de entrada mostra sempre o mês corrente */
  var entry = document.getElementById('hxShopEntryCount');
  if (entry) {
    var cur = d.months[hxShopMonthKey(n.y, n.m)] || { items: [], buys: [] };
    var curPend = cur.items.filter(function (x) { return !x.done; }).length;
    var curSpent = hxShopSum(cur.buys);
    entry.textContent = curPend
      ? curPend + (curPend === 1 ? ' item por comprar' : ' itens por comprar') +
        (curSpent ? ' · ' + hxShopEur(curSpent) + ' este mês' : '') + '.'
      : (curSpent ? 'Compras do mês: ' + hxShopEur(curSpent) + '.' : 'O que falta comprar, num sítio só.');
  }

  var html = '';
  HX_SHOP_CATS.forEach(function (c) {
    var items = pend.filter(function (x) { return x.cat === c.id; });
    if (!items.length) { return; }
    html += '<section class="hx-shop-group" role="group" aria-label="' + hxEsc(c.label) + '">' +
      '<div class="hx-shop-gh">' + c.icon + ' ' + hxEsc(c.label) + ' <span>' + items.length + '</span></div>' +
      items.map(hxShopItemHTML).join('') +
    '</section>';
  });

  if (!pend.length) {
    var carry = '';
    if (!rec.items.length) {
      var pd = new Date(HX_SHOP.y, HX_SHOP.m - 1, 1);
      var prev = d.months[hxShopMonthKey(pd.getFullYear(), pd.getMonth())];
      var prevPend = prev ? prev.items.filter(function (x) { return !x.done; }).length : 0;
      if (prevPend) {
        carry = '<div class="hx-shop-carry"><button type="button" class="hx-mini" onclick="hxShopCarry()">Trazer ' +
          prevPend + (prevPend === 1 ? ' item por comprar de ' : ' itens por comprar de ') +
          hxEsc(HX_SHOP_MONTHS[pd.getMonth()]) + '</button></div>';
      }
    }
    html += '<div class="hx-shop-empty">' + (rec.items.length
      ? 'Nada por comprar. A lista está em dia.'
      : (atual
        ? 'Ainda não tens nada na lista deste mês. Escreve acima e carrega em Adicionar.'
        : 'Não há itens neste mês. Podes voltar atrás ou passar para o mês seguinte.')) + carry + '</div>';
  }

  if (done.length) {
    html += '<section class="hx-shop-group hx-shop-done" role="group" aria-label="Comprados">' +
      '<div class="hx-shop-gh">✓ Comprados <span>' + done.length + '</span></div>' +
      done.map(hxShopItemHTML).join('') +
    '</section>';
  }

  box.innerHTML = html;
  hxShopSpendRender(rec);
  hxShopBuysRender(rec);
  hxShopSugRender(d);
}

function hxShopSugRender(d) {
  var box = document.getElementById('hxShopSug');
  if (!box) { return; }
  d = d || hxShopLoad();
  var rec = hxShopRec(d, hxShopViewKey(), false);
  var pend = {};
  rec.items.forEach(function (x) { if (!x.done) { pend[hxNorm(x.name)] = 1; } });

  var sug = Object.keys(d.seen)
    .map(function (k) { return d.seen[k]; })
    .filter(function (s) { return s && s.name && !pend[hxNorm(s.name)]; })
    .sort(function (a, b) { return (b.n - a.n) || (b.last - a.last); })
    .slice(0, 6);

  if (!sug.length) { box.innerHTML = ''; return; }

  box.innerHTML = '<div class="hx-shop-lbl">Do teu histórico</div><div class="hx-shop-chips">' +
    sug.map(function (s) {
      return '<button type="button" class="hx-shop-chip" data-name="' + hxEsc(s.name) + '" data-cat="' + s.cat + '"' +
        ' title="' + hxEsc(s.name) + '"' +
        ' onclick="hxShopQuick(this.getAttribute(\'data-name\'), this.getAttribute(\'data-cat\'))">' +
        hxEsc(s.name) + '</button>';
    }).join('') + '</div>';
}

function hxShopBuyOpen() {
  hxShopEnsureState();
  var m = document.getElementById('hxShopBuyModal');
  if (!m) { return; }
  var n = hxShopNow();
  var y = HX_SHOP.y, mo = HX_SHOP.m;
  var atual = (y === n.y && mo === n.m);
  var maxDia = atual ? n.day : hxShopLastDay(y, mo);
  var mm = hxShopMonthKey(y, mo);

  var dateEl = document.getElementById('hxShopBuyDate');
  if (dateEl) {
    dateEl.min = mm + '-01';
    dateEl.max = mm + '-' + hxShopPad2(maxDia);
    dateEl.value = mm + '-' + hxShopPad2(Math.min(atual ? n.day : maxDia, maxDia));
  }
  var sub = document.getElementById('hxShopBuySub');
  if (sub) {
    sub.textContent = 'Compra de ' + (HX_SHOP_MONTHS[mo] || '') + ' de ' + y + '.';
  }
  var rec = hxShopRec(hxShopLoad(), hxShopViewKey(), false);
  var doneN = rec.items.filter(function (x) { return x.done; }).length;
  var doneEl = document.getElementById('hxShopBuyDoneN');
  if (doneEl) { doneEl.textContent = doneN; }
  var rem = document.getElementById('hxShopBuyRemove');
  if (rem) {
    rem.checked = doneN > 0;
    rem.disabled = doneN === 0;
  }
  var remWrap = document.getElementById('hxShopBuyRemoveWrap');
  if (remWrap) {
    remWrap.style.display = doneN ? '' : 'none';
    remWrap.classList.toggle('off', doneN === 0);
  }

  var amt = document.getElementById('hxShopBuyAmount');
  if (amt) { amt.value = ''; }
  var note = document.getElementById('hxShopBuyNote');
  if (note) { note.value = ''; }
  var err = document.getElementById('hxShopBuyErr');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  hxShopStoreRender();

  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  document.body.classList.add('hx-shop-lock');
  setTimeout(function () {
    if (amt) { try { amt.focus(); } catch (e) {} }
  }, 80);
}

function hxShopBuyClose() {
  var m = document.getElementById('hxShopBuyModal');
  if (!m) { return; }
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('hx-shop-lock');
  var btn = document.querySelector('.hx-shop-buybtn');
  if (btn) { try { btn.focus(); } catch (e) {} }
}

function hxShopBuyStore(id) {
  if (!hxShopStoreOk(id)) { return; }
  HX_SHOP_STORE = id;
  hxShopStoreRender();
}

function hxShopBuySave() {
  var err = document.getElementById('hxShopBuyErr');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  var showErr = function (msg, focusEl) {
    if (err) { err.textContent = msg; err.style.display = 'block'; }
    if (focusEl) { try { focusEl.focus(); } catch (e) {} }
  };
  var amtEl = document.getElementById('hxShopBuyAmount');
  var cents = hxShopParseAmount(amtEl ? amtEl.value : '');
  if (cents === null) {
    showErr('Escreve o valor gasto, por exemplo 12,50.', amtEl);
    return;
  }

  var dateEl = document.getElementById('hxShopBuyDate');
  var date = dateEl ? String(dateEl.value || '') : '';
  var mm = hxShopViewKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== mm) {
    showErr('A data tem de ser em ' + (HX_SHOP_MONTHS[HX_SHOP.m] || '') + ' de ' + HX_SHOP.y + '.', dateEl);
    return;
  }

  var noteEl = document.getElementById('hxShopBuyNote');
  var note = noteEl ? String(noteEl.value || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '';

  var d = hxShopLoad();
  var rec = hxShopRec(d, mm, true);
  var buy = {
    id: hxShopBuyId(),
    date: date,
    amount: cents,
    store: HX_SHOP_STORE,
    note: note,
    at: Date.now()
  };
  rec.buys.push(buy);

  var removed = [];
  var remEl = document.getElementById('hxShopBuyRemove');
  if (remEl && remEl.checked) {
    removed = rec.items.filter(function (x) { return x.done; });
    rec.items = rec.items.filter(function (x) { return !x.done; });
  }

  hxShopSave(d);
  try { localStorage.setItem(HX_SHOP_STORE_KEY, HX_SHOP_STORE); } catch (e) {}
  hxShopBuyClose();
  hxShopRender();
  hxShowUndo('Compra registada: ' + hxShopEur(cents) + ' · ' + hxShopStoreLabel(HX_SHOP_STORE), 20000, function () {
    var dd = hxShopLoad();
    var rr = hxShopRec(dd, mm, false);
    rr.buys = rr.buys.filter(function (b) { return b.id !== buy.id; });
    if (removed.length) { rr.items = rr.items.concat(removed); }
    hxShopSave(dd);
    hxShopRender();
    hxToast('Compra anulada.');
  });
}

function hxShopBuyDel(id) {
  var d = hxShopLoad();
  var key = hxShopViewKey();
  var rec = hxShopRec(d, key, false);
  var idx = -1;
  rec.buys.forEach(function (b, i) { if (b.id === id) { idx = i; } });
  if (idx < 0) { return; }
  var removed = rec.buys.splice(idx, 1)[0];
  hxShopSave(d);
  hxShopRender();
  hxShowUndo('Compra removida: ' + hxShopEur(removed.amount), 20000, function () {
    var dd = hxShopLoad();
    var rr = hxShopRec(dd, key, true);
    rr.buys.splice(Math.min(idx, rr.buys.length), 0, removed);
    hxShopSave(dd);
    hxShopRender();
    hxToast('Compra reposta.');
  });
}

function hxShopText() {
  var d = hxShopLoad();
  var rec = hxShopRec(d, hxShopViewKey(), false);
  var pend = rec.items.filter(function (x) { return !x.done; });
  var total = hxShopSum(rec.buys);
  if (!pend.length && !rec.buys.length) { return ''; }

  var linhas = ['Lista de compras — ' + hxShopMonthLabel(HX_SHOP.y, HX_SHOP.m), ''];
  HX_SHOP_CATS.forEach(function (c) {
    var items = pend.filter(function (x) { return x.cat === c.id; });
    if (!items.length) { return; }
    linhas.push(c.label);
    items.forEach(function (x) {
      linhas.push('• ' + x.name + (x.qty ? ' (' + x.qty + ')' : ''));
    });
    linhas.push('');
  });
  if (!pend.length) { linhas.push('Nada por comprar.', ''); }
  if (rec.buys.length) {
    linhas.push('Gasto registado: ' + hxShopEur(total) + ' (' + rec.buys.length +
      (rec.buys.length === 1 ? ' compra' : ' compras') + ')');
  }
  return linhas.join('\n').trim();
}

function hxShopCopy() {
  var txt = hxShopText();
  if (!txt) { hxToast('A lista está vazia.'); return; }
  var feito = function () { hxToast('Lista copiada. Cola onde precisares.'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(feito, function () { hxShopCopyFallback(txt, feito); });
    return;
  }
  hxShopCopyFallback(txt, feito);
}

function hxShopCopyFallback(txt, feito) {
  try {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    feito();
  } catch (e) {
    hxToast('Não consegui copiar. Seleciona o texto à mão.');
  }
}

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') { return; }
  var m = document.getElementById('hxShopBuyModal');
  if (m && m.classList.contains('open')) { hxShopBuyClose(); }
});

/* ── relatório do mês ─────────────────────────────────────────── */

var HX_REP = { y: 0, m: 0 };
var HX_REP_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function hxRepPad2(n) { return (n < 10 ? '0' : '') + n; }
function hxRepNum(v, d) { return Number(v).toFixed(d).replace('.', ','); }
function hxRepHM(h) {
  var mins = Math.round(h * 60);
  return Math.floor(mins / 60) + 'h' + hxRepPad2(mins % 60);
}
function hxRepAvg(a) {
  if (!a || !a.length) { return null; }
  return a.reduce(function (s, x) { return s + x; }, 0) / a.length;
}
function hxRepDias(n) { return n + (n === 1 ? ' dia' : ' dias'); }

function hxRepInit() {
  if (!HX_REP.y) {
    var now = new Date();
    HX_REP.y = now.getFullYear();
    HX_REP.m = now.getMonth();
  }
}

function hxOpenReport() {
  hxRepInit();
  showSection('report', navBySection('report'));
  hxRenderReport();
}

function hxReportMonth(delta) {
  hxRepInit();
  var alvo = new Date(HX_REP.y, HX_REP.m + delta, 1);
  var now = new Date();
  var limite = new Date(now.getFullYear(), now.getMonth(), 1);
  if (alvo.getTime() > limite.getTime()) { return; }
  if (alvo.getFullYear() < 2020) { return; }
  HX_REP.y = alvo.getFullYear();
  HX_REP.m = alvo.getMonth();
  hxRenderReport();
}

function hxRepData(y, m) {
  var last = new Date(y, m + 1, 0).getDate();
  var out = {
    last: last, records: 0, moodDays: 0, mealDays: 0, waterDays: 0, trainDays: 0,
    sleep: [], weights: [], waters: [], kcals: [],
    moods: [0, 0, 0, 0, 0], triggers: {},
    mealsCount: 0, trainMin: 0, trainKm: 0, trainSessions: 0
  };

  for (var d = 1; d <= last; d++) {
    var key = y + '-' + hxRepPad2(m + 1) + '-' + hxRepPad2(d);
    var day = DB[key];
    if (!day) { continue; }
    var any = false;

    var h = 0;
    try { h = (typeof getSleepH === 'function') ? getSleepH(day) : 0; } catch (e) { h = 0; }
    if (h > 0) { out.sleep.push(h); any = true; }

    var w = parseFloat(day.weight);
    if (w > 0) { out.weights.push({ key: key, v: w }); any = true; }

    var wc = parseInt(day.waterCount, 10) || 0;
    if (wc > 0) { out.waters.push(wc); out.waterDays++; any = true; }

    if (day.meals) {
      var mv = (typeof day.meals === 'object' && !Array.isArray(day.meals))
        ? Object.values(day.meals).flat()
        : day.meals;
      mv = (mv || []).filter(function (x) { return x && x.name; });
      if (mv.length) {
        out.mealsCount += mv.length;
        out.mealDays++;
        any = true;
      }
      var kc = mv.reduce(function (s, x) { return s + (Number(x.cal) || 0); }, 0);
      if (kc > 0) { out.kcals.push(kc); }
    }

    var tm = parseFloat(day.treadmillTime) || 0;
    var tk = parseFloat(day.treadmillDistance) || 0;
    if (tm > 0 || tk > 0) {
      out.trainSessions++;
      out.trainMin += tm;
      out.trainKm += tk;
      out.trainDays++;
      any = true;
    }

    var mc = day.moodCheckin;
    if (mc && mc.mood) {
      out.moodDays++;
      var mi = Math.round(Number(mc.mood)) - 1;
      if (mi >= 0 && mi <= 4) { out.moods[mi]++; }
      if (mc.trigger) {
        var t = String(mc.trigger);
        out.triggers[t] = (out.triggers[t] || 0) + 1;
      }
      any = true;
    }

    if (any) { out.records++; }
  }
  return out;
}

function hxRenderReport() {
  hxRepInit();
  var body = document.getElementById('hxReportBody');
  var rotulo = document.getElementById('hxRepMonth');
  if (!body) { return; }

  var y = HX_REP.y, m = HX_REP.m;
  var nomeMes = HX_REP_MONTHS[m];
  var nome = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1) + ' de ' + y;
  if (rotulo) { rotulo.textContent = nome; }

  var now = new Date();
  var gerado = hxRepPad2(now.getDate()) + '/' + hxRepPad2(now.getMonth() + 1) + '/' + now.getFullYear();
  var emCurso = (y === now.getFullYear() && m === now.getMonth());
  var r = hxRepData(y, m);

  var topo =
    '<div class="hx-rep-top">' +
      '<div><div class="hx-rep-kicker">Diário de Vida</div>' +
      '<div class="hx-rep-h1">' + hxEsc(nome) + '</div></div>' +
      '<div class="hx-rep-meta">gerado a ' + gerado + '</div>' +
    '</div>';

  if (!r.records) {
    body.innerHTML = '<div class="hx-rep-sheet">' + topo +
      '<div class="hx-rep-empty">Não há registos em ' + hxEsc(nome) + '.</div>' +
      '<p class="hx-rep-hint">Quando registares sono, peso, água, refeições, treino ou humor, este relatório preenche-se sozinho.</p>' +
      '</div>';
    return;
  }

  var avgSleep = hxRepAvg(r.sleep);
  var avgWater = hxRepAvg(r.waters);
  var avgKcal = hxRepAvg(r.kcals);
  var w0 = r.weights.length ? r.weights[0] : null;
  var w1 = r.weights.length ? r.weights[r.weights.length - 1] : null;
  var deltaW = (r.weights.length > 1) ? (w1.v - w0.v) : null;
  var topTrigger = Object.keys(r.triggers).sort(function (a, b) {
    return r.triggers[b] - r.triggers[a];
  })[0] || null;

  var card = function (titulo, grande, pequeno, extra) {
    return '<section class="hx-rep-card"><h3>' + hxEsc(titulo) + '</h3>' +
      '<div class="hx-rep-big">' + grande + '</div>' +
      (pequeno ? '<div class="hx-rep-sub">' + pequeno + '</div>' : '') +
      (extra || '') + '</section>';
  };

  var presenca = card(
    'Presença',
    r.records + ' <span>de ' + r.last + ' dias</span>',
    'com pelo menos um registo' + (emCurso ? ' · mês a decorrer' : ''),
    '<dl class="hx-rep-dl">' +
      '<div><dt>humor</dt><dd>' + hxRepDias(r.moodDays) + '</dd></div>' +
      '<div><dt>refeições</dt><dd>' + hxRepDias(r.mealDays) + '</dd></div>' +
      '<div><dt>treino</dt><dd>' + hxRepDias(r.trainDays) + '</dd></div>' +
    '</dl>'
  );

  var sono = card(
    'Sono',
    avgSleep === null ? '—' : hxRepHM(avgSleep) + ' <span>por noite</span>',
    r.sleep.length
      ? r.sleep.length + (r.sleep.length === 1 ? ' noite' : ' noites') +
        ' · mín ' + hxRepHM(Math.min.apply(null, r.sleep)) +
        ' · máx ' + hxRepHM(Math.max.apply(null, r.sleep))
      : 'sem noites registadas'
  );

  var peso = card(
    'Peso',
    deltaW === null ? '—' : (deltaW > 0 ? '+' : '') + hxRepNum(deltaW, 1) + ' <span>kg</span>',
    r.weights.length
      ? r.weights.length + (r.weights.length === 1 ? ' pesagem' : ' pesagens') +
        (r.weights.length > 1 ? ' · ' + hxRepNum(w0.v, 1) + ' → ' + hxRepNum(w1.v, 1) + ' kg' : '')
      : 'sem pesagens'
  );

  var agua = card(
    'Água',
    avgWater === null ? '—' : hxRepNum(avgWater, 1) + ' <span>copos/dia</span>',
    r.waterDays
      ? r.waterDays + (r.waterDays === 1 ? ' dia com registo' : ' dias com registo') +
        ' · ' + r.waters.reduce(function (s, x) { return s + x; }, 0) + ' no total'
      : 'sem registos de água'
  );

  var refeicoes = card(
    'Refeições',
    avgKcal === null ? '—' : Math.round(avgKcal) + ' <span>kcal/dia</span>',
    r.mealsCount
      ? r.mealsCount + (r.mealsCount === 1 ? ' refeição' : ' refeições') +
        ' · ' + (r.kcals.length === 1
          ? 'num dia com calorias'
          : 'média em ' + r.kcals.length + ' dias com calorias')
      : 'sem refeições registadas'
  );

  var passadeira = card(
    'Passadeira',
    r.trainSessions + ' <span>' + (r.trainSessions === 1 ? 'sessão' : 'sessões') + '</span>',
    r.trainSessions
      ? Math.round(r.trainMin) + ' min · ' + hxRepNum(r.trainKm, 1) + ' km'
      : 'sem sessões registadas'
  );

  var barras = HX_MOODS.map(function (mo, i) {
    var n = r.moods[i];
    var pct = r.moodDays ? Math.round(n * 100 / r.moodDays) : 0;
    return '<div class="hx-rep-mrow">' +
      '<span class="hx-rep-mlbl">' + mo.emoji + ' ' + hxEsc(mo.label) + '</span>' +
      '<span class="hx-rep-mbar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="hx-rep-mn">' + n + '</span></div>';
  }).join('');

  var humor =
    '<section class="hx-rep-card hx-rep-wide"><h3>Humor</h3>' +
      (r.moodDays
        ? barras + '<div class="hx-rep-note">' + r.moodDays + (r.moodDays === 1 ? ' check-in' : ' check-ins') +
          (topTrigger ? ' · gatilho mais anotado: ' + hxEsc(topTrigger) + ' (' + r.triggers[topTrigger] + ')' : '') +
          '</div>'
        : '<div class="hx-rep-sub">sem check-ins de humor neste mês.</div>') +
      '<div class="hx-rep-note">O humor é o que registaste, não uma avaliação.</div>' +
    '</section>';

  body.innerHTML = '<div class="hx-rep-sheet">' + topo +
    '<div class="hx-rep-grid">' + presenca + sono + peso + agua + refeicoes + passadeira + '</div>' +
    '<div class="hx-rep-grid" style="margin-top:12px;">' + humor + '</div>' +
    '</div>';
}

function hxReportSheetHTML() {
  var el = document.querySelector('#hxReportBody .hx-rep-sheet');
  return el ? el.outerHTML : '';
}

var HX_REP_PRINT_CSS = [
  'body{margin:0;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
  '.hx-rep-sheet{max-width:780px;margin:0 auto;padding:26px}',
  '.hx-rep-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px}',
  '.hx-rep-kicker{font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#555}',
  '.hx-rep-h1{font-family:Georgia,serif;font-size:25px;font-weight:700;margin-top:2px}',
  '.hx-rep-meta{font-size:10.5px;color:#555}',
  '.hx-rep-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}',
  '.hx-rep-card{border:1px solid #ccc;border-radius:8px;padding:11px 13px;break-inside:avoid;background:#fff}',
  '.hx-rep-card h3{font-size:9.5px;letter-spacing:1px;text-transform:uppercase;color:#555;margin:0 0 6px;font-weight:600}',
  '.hx-rep-big{font-size:23px;font-weight:700;line-height:1.15}',
  '.hx-rep-big span{font-size:11px;font-weight:400;color:#555}',
  '.hx-rep-sub{font-size:11px;color:#555;margin-top:3px}',
  '.hx-rep-dl{margin:9px 0 0;display:flex;flex-direction:column;gap:3px}',
  '.hx-rep-dl div{display:flex;justify-content:space-between;gap:10px;font-size:11px}',
  '.hx-rep-dl dt{color:#555}.hx-rep-dl dd{margin:0}',
  '.hx-rep-wide{grid-column:1 / -1}',
  '.hx-rep-mrow{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:11px}',
  '.hx-rep-mlbl{flex:0 0 108px;color:#333}',
  '.hx-rep-mbar{flex:1;height:6px;background:#eee;border-radius:3px;overflow:hidden}',
  '.hx-rep-mbar i{display:block;height:100%;background:#0f766e}',
  '.hx-rep-mn{flex:0 0 22px;text-align:right;color:#555}',
  '.hx-rep-note{margin-top:8px;font-size:10.5px;color:#555}',
  '.hx-rep-empty{padding:16px 2px;color:#333;font-size:13px}',
  '.hx-rep-hint{margin-top:4px;color:#555;font-size:11px}',
  '@page{margin:15mm}',
  '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
].join('\n');

function hxReportPrint() {
  var sheet = hxReportSheetHTML();
  if (!sheet) { hxToast('Abre o relatório de um mês com registos primeiro.'); return; }
  if (!document.querySelector('#hxReportBody .hx-rep-card')) {
    hxToast('Este mês ainda não tem registos para imprimir.');
    return;
  }
  var rotulo = (document.getElementById('hxRepMonth') || {}).textContent || 'Relatório';
  var titulo = 'Relatório ' + rotulo + ' · Diário de Vida';
  var w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  if (!w) { hxToast('O browser bloqueou a janela. Permite pop-ups para imprimir.'); return; }
  try {
    w.document.open();
    w.document.write('<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8">' +
      '<title>' + hxEsc(titulo) + '</title><style>' + HX_REP_PRINT_CSS + '</style></head>' +
      '<body>' + sheet + '</body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
  } catch (e) {
    hxToast('Não consegui preparar a impressão: ' + ((e && e.message) || 'erro') + '.');
  }
}

/* ── arranque ───────────────────────────────────────────────────── */

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') { return; }
  var pal = document.getElementById('hxPalette');
  if (pal && pal.classList.contains('open')) { return; }
  var sheet = document.getElementById('hxSheet');
  if (sheet && sheet.classList.contains('open')) {
    hxCloseMood();
    var btn = document.getElementById('hxBtnMood');
    if (btn) { btn.focus(); }
  }
});
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) { try { hxMetaUpdate(); } catch (e) {} }
});

(function hxBoot() {
  var run = function () {
    try { hxRenderMoodSheet(); } catch (e) {}
    try { hxMetaUpdate(); } catch (e) {}
    try { hxApplyDayOff(); } catch (e) {}
    try { hxRenderDays(); } catch (e) {}
    try { hxRenderObs(); } catch (e) {}
    try { hxApplyDayTheme(); } catch (e) {}
    try { hxRenderVersion(); } catch (e) {}
    try { hxShopInit(); } catch (e) {}
    try { hxUndoCheck(); } catch (e) {}
    try { hxFoldApply(); } catch (e) {}
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', run); }
  else { run(); }
  setTimeout(run, 400);
  setTimeout(function () {
    try {
      hxLoadRows(true).then(function () { hxRenderDays(); hxRenderObs(); });
    } catch (e) {}
  }, 1500);
  if (window.self === window.top && /[?&]check=1/.test(location.search)) {
    setTimeout(function () { hxRunDiagnostic(); }, 900);
  }
})();
