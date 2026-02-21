/*
  Bloomora
  - Local-only study tracker
  - Two gamification modes: Island & Garden
  - Single-page app (hash routing)
*/

(() => {
  const STORAGE_KEY = 'bloomora_v1';
  const CUSTOM_BG_KEY = 'bloomora_custom_bg_v1';

  // localStorage can be blocked in some browsers when opening via file://
  // (especially on Windows/Edge). We guard all storage calls so the UI still loads.
  let storageBlocked = false;
  const storage = {
    getItem(key){
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        storageBlocked = true;
        return null;
      }
    },
    setItem(key, value){
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {
        // Quota errors shouldn't permanently disable saving for the whole app.
        // We'll fail this write but allow future smaller writes to continue.
        const name = String(e && (e.name || e.constructor?.name) || '');
        const msg = String(e && e.message || '');
        const isQuota = /QuotaExceeded/i.test(name) || /quota/i.test(msg);
        if (!isQuota) storageBlocked = true;
      }
    },
    removeItem(key){
      try {
        window.localStorage.removeItem(key);
      } catch (e) {
        storageBlocked = true;
      }
    },
  };



// ─────────────────────────────────────────────────────────────
// Supabase (Auth + Sync) — client-side only (SAFE: anon/publishable key)
// Never use service role keys in the browser.
//
// Configure by creating `supabase-config.js` (see supabase-config.example.js)
// which sets:
//   window.BLOOMORA_SUPABASE_URL
//   window.BLOOMORA_SUPABASE_ANON_KEY   (or publishable key)
const SUPABASE_URL = (window.BLOOMORA_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (window.BLOOMORA_SUPABASE_ANON_KEY || '').trim();
const SYNC_META_KEY = 'bloomora_sync_meta_v1'; // localStorage meta (last sync time, etc.)

/** @type {{client:any, user:any, syncing:boolean, lastSyncMs:number, ready:boolean}} */
const sb = {
  client: null,
  user: null,
  syncing: false,
  lastSyncMs: 0,
  ready: false,
  // one-shot flag used after importing a backup: push local to cloud without pulling remote first
  forcePushOnce: false,
  // label deletions to apply remotely on next sync
  deletedLabelIds: [],
};

function sbInit() {
  try {
    if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;

    const createClient = window.supabase.createClient || window.supabase;
    sb.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }
    });

    sb.ready = true;

    // restore last sync time
    const metaRaw = storage.getItem(SYNC_META_KEY);
    const meta = safeParseJson(metaRaw);
    if (meta.ok && meta.value) {
      if (typeof meta.value.lastSyncMs === 'number') sb.lastSyncMs = meta.value.lastSyncMs;
      if (meta.value.forcePushOnce === true) sb.forcePushOnce = true;
      if (Array.isArray(meta.value.deletedLabelIds)) sb.deletedLabelIds = meta.value.deletedLabelIds.map(String);
    }

    sb.client.auth.getSession().then(({ data }) => {
      sb.user = data?.session?.user || null;
      renderAuthUi();
      if (sb.user) queueSyncSoon(50);
    });

    sb.client.auth.onAuthStateChange((_event, session) => {
      sb.user = session?.user || null;
      renderAuthUi();
      if (sb.user) queueSyncSoon(50);
    });

    return true;
  } catch (e) {
    console.warn('Supabase init failed', e);
    sb.ready = false;
    sb.client = null;
    sb.user = null;
    return false;
  }
}

function sbSaveMeta() {
  try {
    storage.setItem(SYNC_META_KEY, JSON.stringify({ lastSyncMs: sb.lastSyncMs, forcePushOnce: sb.forcePushOnce, deletedLabelIds: sb.deletedLabelIds }));
  } catch {}
}

function sbSignedIn() {
  return !!(sb.ready && sb.client && sb.user);
}

function setSyncStatus(pillText, detailText, kind='muted') {
  const pill = document.getElementById('syncStatusPill');
  const txt = document.getElementById('syncStatusText');
  const apill = document.getElementById('accountSyncPill');
  const atxt = document.getElementById('accountSyncText');

  const apply = (p, t) => {
    if (p) {
      p.textContent = pillText;
      p.classList.remove('pill--muted','pill--ok','pill--warn');
      p.classList.add(kind === 'ok' ? 'pill--ok' : (kind === 'warn' ? 'pill--warn' : 'pill--muted'));
    }
    if (t) t.textContent = detailText || '';
  };

  apply(pill, txt);
  apply(apill, atxt);
}


function renderAuthUi() {
  const aso = document.getElementById('accountSignedOut');
  const asi = document.getElementById('accountSignedIn');
  const aEmailLabel = document.getElementById('accountEmailLabel');

  if (!sb.ready) {
    setSyncStatus('Unavailable', 'Supabase is not configured.', 'warn');
    if (aso) aso.classList.remove('hidden');
    if (asi) asi.classList.add('hidden');
    return;
  }

  if (!sb.user) {
    setSyncStatus('Offline', 'Sign in to sync your progress across devices.', 'muted');
    if (aso) aso.classList.remove('hidden');
    if (asi) asi.classList.add('hidden');
    return;
  }

  const email = sb.user.email || 'Signed in';
  if (aEmailLabel) aEmailLabel.textContent = email;

  if (aso) aso.classList.add('hidden');
  if (asi) asi.classList.remove('hidden');

  const last = sb.lastSyncMs ? new Date(sb.lastSyncMs).toLocaleString() : 'Never';
  setSyncStatus(sb.syncing ? 'Syncing' : 'Online',
    sb.syncing ? 'Syncing…' : ('Last sync: ' + last),
    sb.syncing ? 'warn' : 'ok'
  );
}

  async function authSignIn(email, password) {
  if (!sb.ready) return toast('Sync unavailable', 'Supabase is not ready.');
  const { error } = await sb.client.auth.signInWithPassword({ email, password });
  if (error) toast('Sign in failed', error.message || String(error));
  else toast('Signed in', 'Sync is now enabled.');
}

async function authSignUp(email, password) {
  if (!sb.ready) return toast('Sync unavailable', 'Supabase is not ready.');
  const { error } = await sb.client.auth.signUp({ email, password });
  if (error) toast('Sign up failed', error.message || String(error));
  else toast('Account created', 'Check your email if confirmation is enabled, then sign in.');
}

async function authSignOut() {
  if (!sb.ready) return;
  await sb.client.auth.signOut();
}

  function ensureClientIds() {
    // Ensure every local session and label has stable IDs for syncing.
    for (const s of (state.sessions || [])) {
      if (!s) continue;
      if (!s.clientId) s.clientId = String(s.id || '');
      if (!s.clientId) s.clientId = 's_' + Math.random().toString(16).slice(2) + '_' + Date.now();
    }
    for (const l of (state.labels?.items || [])) {
      if (!l) continue;
      if (!l.id) l.id = uid('lbl');
    }
  }

  function localSessionToRow(s) {
    const start = typeof s.startTs === 'number' ? new Date(s.startTs).toISOString() : null;
    const end = typeof s.endTs === 'number' ? new Date(s.endTs).toISOString() : null;
    return {
      user_id: sb.user.id,
      client_id: String(s.clientId || s.id),
      started_at: start,
      ended_at: end,
      duration_sec: Number(s.durationSec || 0),
      label_name: String(s.label || ''),
      source: String(s.method || ''),
      reward_mode: String(s.rewardMode || ''),
      updated_at: new Date().toISOString(),
    };
  }

  function rowToLocalSession(r) {
    const startTs = r.started_at ? Date.parse(r.started_at) : null;
    const endTs = r.ended_at ? Date.parse(r.ended_at) : null;
    return {
      id: String(r.client_id),
      clientId: String(r.client_id),
      startTs: startTs || (endTs ? (endTs - Number(r.duration_sec||0)*1000) : now()),
      endTs: endTs || (startTs ? (startTs + Number(r.duration_sec||0)*1000) : now()),
      durationSec: Number(r.duration_sec || 0),
      method: String(r.source || 'manual'),
      rewardMode: String(r.reward_mode || state.ui.worldView || 'island'),
      label: String(r.label_name || ''),
    };
  }

  function localLabelToRow(l) {
    return {
      local_id: String(l.id),
      user_id: sb.user.id,
      name: String(l.name || ''),
      color: String(l.color || '#a855f7'),
      favorite: !!l.favorite,
      created_ts: l.createdTs ? new Date(l.createdTs).toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  function rowToLocalLabel(r) {
    return {
      id: (r.local_id || r.id),
      name: String(r.name || ''),
      color: String(r.color || '#a855f7'),
      favorite: !!r.favorite,
      createdTs: r.created_ts ? Date.parse(r.created_ts) : now(),
    };
  }

  function localProfileToRow() {
    const p = state.profile || {};
    return {
      id: sb.user.id,
      display_name: String(p.name || 'Student'),
      weekly_goal_hours: Number(p.weeklyGoalHours || 0),
      theme: String(p.theme || 'midnight'),
      stopwatch_cap_on: (p.stopwatchCapOn !== false),
      stopwatch_cap_hours: Number(p.stopwatchCapHours || 6),
      session_ambient_type: String(p.sessionAmbient?.type || 'off'),
      session_ambient_volume: Number(p.sessionAmbient?.volume ?? 0.4),

      island_xp_sec: Number(state.island?.xpSec || 0),
      garden_growth_sec: Number(state.garden?.growthSec || 0),
      garden_tree_type: String(state.garden?.treeType || 'Apple'),
      garden_harvested_on_tree: Number(state.garden?.harvestedOnThisTree || 0),
      fruit_collection: state.fruitCollection || {},

      updated_at: new Date().toISOString(),
    };
  }

  function applyProfileRow(r) {
    if (!r) return;
    state.profile.name = String(r.display_name || state.profile.name || 'Student');
    state.profile.weeklyGoalHours = Number(r.weekly_goal_hours ?? state.profile.weeklyGoalHours ?? 10);
    state.profile.theme = String(r.theme || state.profile.theme || 'midnight');

    state.profile.stopwatchCapOn = (r.stopwatch_cap_on !== false);
    state.profile.stopwatchCapHours = clamp(Number(r.stopwatch_cap_hours ?? state.profile.stopwatchCapHours ?? 6), 1, 24);

    state.profile.sessionAmbient = {
      type: String(r.session_ambient_type || state.profile.sessionAmbient?.type || 'off'),
      volume: clamp01(Number(r.session_ambient_volume ?? state.profile.sessionAmbient?.volume ?? 0.4)),
    };

    state.island.xpSec = Number(r.island_xp_sec ?? state.island.xpSec ?? 0);
    state.garden.growthSec = Number(r.garden_growth_sec ?? state.garden.growthSec ?? 0);
    state.garden.treeType = String(r.garden_tree_type || state.garden.treeType || 'Apple');
    state.garden.harvestedOnThisTree = Number(r.garden_harvested_on_tree ?? state.garden.harvestedOnThisTree ?? 0);
    if (r.fruit_collection && typeof r.fruit_collection === 'object') {
      state.fruitCollection = { ...state.fruitCollection, ...r.fruit_collection };
    }
  }

  let syncTimer = null;
  function queueSyncSoon(ms=500) {
    if (!sbSignedIn()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      fullSync().catch(e => {
        console.warn('Sync failed', e);
        setSyncStatus('Online', 'Sync error (see console).', 'warn');
        sb.syncing = false;
        renderAuthUi();
      });
    }, ms);
  }

  async function fullSync() {
    if (!sbSignedIn() || sb.syncing) return;
    sb.syncing = true;
    renderAuthUi();

    ensureClientIds();

    // apply queued remote deletions (labels)
    if (sb.deletedLabelIds.length) {
      const del = await sbDeleteLabelsNow(sb.deletedLabelIds);
      if (del.ok) {
        sb.deletedLabelIds = [];
        sbSaveMeta();
      } else {
        console.warn(del.error);
        toast('Sync push failed', 'Labels delete: ' + (del.error?.message || del.error?.details || 'unknown error'));
      }
    }

    const skipPull = sb.forcePushOnce === true;

    if (!skipPull) {
// 1) Pull remote profile
    const profRes = await sb.client.from('profiles').select('*').eq('id', sb.user.id).maybeSingle();
    if (profRes.error) { console.warn(profRes.error); toast('Sync pull failed', 'Profiles: ' + (profRes.error.message || profRes.error.details || 'unknown error')); }
    if (!profRes.error && profRes.data) {
      applyProfileRow(profRes.data);
    }

    // 2) Pull remote labels + sessions (full pull; small data)
    const lblRes = await sb.client.from('labels').select('*').eq('user_id', sb.user.id);
    if (lblRes.error) { console.warn(lblRes.error); toast('Sync pull failed', 'Labels: ' + (lblRes.error.message || lblRes.error.details || 'unknown error')); }
    if (!lblRes.error && Array.isArray(lblRes.data)) {
      const deleted = new Set((sb.deletedLabelIds || []).map(String));
      const remoteLabels = lblRes.data.map(rowToLocalLabel).filter(l => !deleted.has(String(l.id)));
      const byId = new Map((state.labels?.items || []).map(l => [String(l.id), l]));
      for (const rl of remoteLabels) byId.set(String(rl.id), rl);
      state.labels.items = Array.from(byId.values());
    }

    const sesRes = await sb.client.from('sessions').select('*').eq('user_id', sb.user.id).order('ended_at', { ascending: false });
    if (sesRes.error) { console.warn(sesRes.error); toast('Sync pull failed', 'Sessions: ' + (sesRes.error.message || sesRes.error.details || 'unknown error')); }
    if (!sesRes.error && Array.isArray(sesRes.data)) {
      const remoteSessions = sesRes.data.map(rowToLocalSession);
      const byClient = new Map((state.sessions || []).map(s => [String(s.clientId || s.id), s]));
      for (const rs of remoteSessions) {
        const key = String(rs.clientId || rs.id);
        if (!byClient.has(key)) byClient.set(key, rs);
      }
      state.sessions = Array.from(byClient.values()).sort((a,b) => (Number(b.endTs||0) - Number(a.endTs||0)));
    }

    
    }

    // After an import, we do a one-shot push-first sync
    if (sb.forcePushOnce) { sb.forcePushOnce = false; sbSaveMeta(); }

// 3) Push local profile + labels + sessions
    { const r = await sb.client.from('profiles').upsert(localProfileToRow(), { onConflict: 'id' }); if (r?.error) { console.warn(r.error); toast('Sync push failed', 'Profiles: ' + (r.error.message || r.error.details || 'unknown error')); } }

    const labelRows = (state.labels?.items || []).map(localLabelToRow);
    if (labelRows.length) { const r = await sb.client.from('labels').upsert(labelRows, { onConflict: 'user_id,local_id' }); if (r?.error) { console.warn(r.error); toast('Sync push failed', 'Labels: ' + (r.error.message || r.error.details || 'unknown error')); } }

    const sessionRows = (state.sessions || []).map(localSessionToRow);
    if (sessionRows.length) { const r = await sb.client.from('sessions').upsert(sessionRows, { onConflict: 'user_id,client_id' }); if (r?.error) { console.warn(r.error); toast('Sync push failed', 'Sessions: ' + (r.error.message || r.error.details || 'unknown error')); } }

    sb.lastSyncMs = Date.now();
    sbSaveMeta();

    saveState();
    renderAll();

    sb.syncing = false;
    renderAuthUi();
  }

  
  async function sbDeleteLabelsNow(localIds) {
    if (!sbSignedIn()) return { ok: false };
    const ids = (localIds || []).map(String).filter(Boolean);
    if (!ids.length) return { ok: true };
    try {
      const r = await sb.client.from('labels').delete().eq('user_id', sb.user.id).in('local_id', ids);
      if (r?.error) return { ok: false, error: r.error };
      return { ok: true };
    } catch (e) { return { ok: false, error: e }; }
  }

  function sbQueueDeleteLabel(localId) {
    const id = String(localId);
    if (!id) return;
    if (!sb.deletedLabelIds.includes(id)) sb.deletedLabelIds.push(id);
    sbSaveMeta();
    // if online, try immediately
    if (sbSignedIn()) sbDeleteLabelsNow([id]).then(res => {
      if (res.ok) {
        sb.deletedLabelIds = sb.deletedLabelIds.filter(x => x !== id);
        sbSaveMeta();
      }
    });
  }

async function sbDeleteSession(clientId) {
    if (!sbSignedIn()) return;
    try {
      await sb.client.from('sessions').delete().eq('user_id', sb.user.id).eq('client_id', String(clientId));
    } catch (e) { console.warn(e); }
  }

  async function sbDeleteAllSessions() {
    if (!sbSignedIn()) return;
    try {
      await sb.client.from('sessions').delete().eq('user_id', sb.user.id);
    } catch (e) { console.warn(e); }
  }

  function sbUpsertSoon() {
    queueSyncSoon(250);
  }
  // ─────────────────────────────────────────────────────────────

  const LEVEL_SEC = 5 * 60 * 60; // 5 hours per island level
  const STOPWATCH_CAP_SEC = 6 * 60 * 60; // UI-only cap bar (6 hours)
  const MAX_HABITS = 3;

  const TREE_STAGES = [
  { id: 'seed',    name: 'Seed',    minSec: 0 },
  { id: 'sprout',  name: 'Sprout',  minSec: 10 * 60 },
  { id: 'plant',   name: 'Plant',   minSec: 30 * 60 },
  { id: 'sapling', name: 'Sapling', minSec: 60 * 60 },
  { id: 'tree',    name: 'Tree',    minSec: 2 * 60 * 60 }, // 2 hours to become a tree
];

  const FRUIT_RATE_SEC = 30 * 60; // 1 fruit per 30 minutes AFTER reaching Tree stage

  const ISLAND_UPGRADES = [
  { level: 1,  title: 'Palm tree',        desc: 'A little shade appears on the beach.' },
  { level: 2,  title: 'Cozy hut',         desc: 'A place to rest between study sessions.' },
  { level: 3,  title: 'Wooden dock',      desc: 'A dock extends into the water.' },
  { level: 4,  title: 'Lighthouse',       desc: 'A beacon lights up the horizon.' },
  { level: 5,  title: 'Garden patch',     desc: 'A small patch of green appears.' },
  { level: 6,  title: 'Campfire',         desc: 'A warm glow for late-night study.' },
  { level: 7,  title: 'Sailboat',         desc: 'A tiny boat drifts by.' },
  { level: 8,  title: 'Windmill',         desc: 'A breeze starts doing work for you.' },
  { level: 9,  title: 'Stone path',       desc: 'Paths connect your upgrades.' },
  { level: 10, title: 'Fruit grove',      desc: 'A grove starts to bloom.' },
  { level: 11, title: 'Market stall',     desc: 'Trade stories (and snacks).' },
  { level: 12, title: 'Hot air balloon',  desc: 'A view from above—big dreams.' },
  { level: 13, title: 'Bridge',           desc: 'A bridge reaches over the shore.' },
  { level: 14, title: 'Observatory',      desc: 'Plan your next goal under the stars.' },
  { level: 15, title: 'Festival lights',  desc: 'Your island celebrates your streak.' },
  { level: 16, title: 'Castle tower',     desc: 'A signature landmark rises.' },
];

  const CLOCK_QUOTES = [
    { quote: '“Time is what we want most, but what we use worst.”', author: 'William Penn' },
    { quote: '“It always seems impossible until it’s done.”', author: 'Nelson Mandela' },
    { quote: '“The secret of getting ahead is getting started.”', author: 'Mark Twain' },
    { quote: '“Small steps every day.”', author: 'Unknown' },
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  // Safe event binding helper (no-op if element is missing)
  function on(sel, ev, fn, root = document) {
    const el = $(sel, root);
    if (el) el.addEventListener(ev, fn);
  }


  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const clamp01 = (n) => clamp(n, 0, 1);

  function getThemeAccentRGB() {
    const s = getComputedStyle(document.body);
    const v = (s.getPropertyValue('--accent-rgb') || '168,85,247').trim();
    const parts = v.split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x));
    if (parts.length === 3) return parts;
    return [168,85,247];
  }

  function rgbaFromRGB(rgb, a) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  }


  const pad2 = (n) => String(n).padStart(2, '0');

const now = () => Date.now();

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}


  function toDateKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function startOfWeek(ts) {
    // Monday start (ISO-ish)
    const d = new Date(ts);
    const day = d.getDay(); // 0 Sun .. 6 Sat
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function startOfMonth(ts) {
    const d = new Date(ts);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  
  function formatHM(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h ${m}m`;
  }

function formatHMS(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }

  function formatMMSS(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${pad2(m)}:${pad2(s)}`;
  }

  // Keep the browser/tab title in sync with any running timer (updates each second).
  const BASE_DOC_TITLE = document.title;
  let lastTitleText = null;

  const setDocTitle = (text) => {
    if (!text) {
      document.title = BASE_DOC_TITLE;
      lastTitleText = null;
      return;
    }
    if (text === lastTitleText) return;
    document.title = `${text} — Bloomora`;
    lastTitleText = text;
  };

  const getStopwatchElapsedSec = () => {
    if (typeof swRunning === 'undefined') return 0;
    if (!swRunning) return swElapsedSec || 0;
    return (swElapsedSec || 0) + (now() - swStartTs) / 1000;
  };

  const refreshRunningTitle = () => {
    // Priority: stopwatch > timer > pomodoro
    if (typeof swRunning !== 'undefined' && swRunning) return setDocTitle(formatHMS(getStopwatchElapsedSec()));
    if (typeof cd !== 'undefined' && cd?.running) return setDocTitle(formatHMS(cd.remainingSec));
    if (typeof pom !== 'undefined' && pom?.running) return setDocTitle(formatMMSS(pom.remainingSec));
    setDocTitle(null);
  };


  function prettyDateTime(ts) {
    const d = new Date(ts);
    const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${date} • ${time}`;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function safeParseJson(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  function defaultState() {
    const currentYear = new Date().getFullYear();
    return {
      version: 3,
      profile: {
        name: 'Student',
        weeklyGoalHours: 10,
        theme: 'midnight',
        lastYearViewed: currentYear,
        stopwatchCapOn: true,
        stopwatchCapHours: 6,
              sessionAmbient: { type: 'off', volume: 0.4 },
},

      ui: {
        worldView: 'island',
      },

tasks: [],
audio: {
  master: 0.6,
  ambient: {
    fire:   { on: false, vol: 0.45 },
    wind:   { on: false, vol: 0.35 },
    sea:    { on: false, vol: 0.35 },
    nature: { on: false, vol: 0.35 },
  },
  // LoFi Girl presets (YouTube).
  lofiVideoId: 'CFGLoQIhmow',
  lofiEmbedUrl: 'https://www.youtube.com/embed/CFGLoQIhmow?autoplay=0&rel=0&modestbranding=1',
  // Optional video background (muted, dimmed).
  videoBgOn: false,
  videoBgOpacity: 0.22,
  // Overlay darkness (0..1). Lower = clearer video.
  videoOverlayOpacity: 0.55,
  // Top bar volume (0..100)
  ytVolume: 60,
  // Runtime state (not meant to persist as "playing on load").
  isPlaying: false,
},

pomodoro: {
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
},
      sessions: [],
      island: {
        xpSec: 0,
      },
      garden: {
        treeType: 'Apple',
        growthSec: 0,
        harvestedOnThisTree: 0,
      },
      fruitCollection: {
        Apple: 0,
        Orange: 0,
        Cherry: 0,
        Mango: 0,
        Peach: 0,
      },
      labels: {
        items: [],
        view: 'grid',
        sort: 'name',
      },
      habits: {
        items: [],
        completions: {},
      },
    };
  }

  function loadState() {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = safeParseJson(raw);
    if (!parsed.ok) return defaultState();

    const st = parsed.value;
    // shallow migration/repair
    const d = defaultState();
    const merged = {
      ...d,
      ...st,
      profile: { ...d.profile, ...(st.profile || {}) },
      ui: { ...d.ui, ...(st.ui || {}) },
      tasks: Array.isArray(st.tasks) ? st.tasks : d.tasks,
      audio: {
        ...d.audio,
        ...(st.audio || {}),
        ambient: { ...d.audio.ambient, ...((st.audio || {}).ambient || {}) },
      },
      pomodoro: { ...d.pomodoro, ...(st.pomodoro || {}) },
      island: { ...d.island, ...(st.island || {}) },
      garden: { ...d.garden, ...(st.garden || {}) },
      fruitCollection: { ...d.fruitCollection, ...(st.fruitCollection || {}) },
      labels: { ...d.labels, ...(st.labels || {}) },
      habits: { ...d.habits, ...(st.habits || {}) },
      tasks: Array.isArray(st.tasks) ? st.tasks : [],
      audio: {
        ...d.audio,
        ...(st.audio || {}),
        ambient: { ...d.audio.ambient, ...(((st.audio || {}).ambient) || {}) },
      },
      sessions: Array.isArray(st.sessions) ? st.sessions : [],
    };


// Migrate legacy custom background (stored inside state) into its own key to avoid quota issues.
try {
  if (merged?.profile?.backgroundCustomData && !storage.getItem(CUSTOM_BG_KEY)) {
    storage.setItem(CUSTOM_BG_KEY, String(merged.profile.backgroundCustomData));
  }
  if (merged?.profile && 'backgroundCustomData' in merged.profile) delete merged.profile.backgroundCustomData;
} catch {}

    // Fix obvious type issues
    merged.profile.weeklyGoalHours = Number(merged.profile.weeklyGoalHours ?? 10);
    merged.profile.theme = String(merged.profile.theme || 'midnight');
    merged.profile.stopwatchCapOn = (merged.profile.stopwatchCapOn !== false);
    merged.profile.stopwatchCapHours = clamp(Number(merged.profile.stopwatchCapHours ?? 6), 1, 24);

    merged.island.xpSec = Number(merged.island.xpSec ?? 0);
    merged.garden.growthSec = Number(merged.garden.growthSec ?? 0);
    merged.garden.harvestedOnThisTree = Number(merged.garden.harvestedOnThisTree ?? 0);

    // Migration: older builds used profile.defaultRewardMode as a "default view".
    // We no longer expose a default view setting; instead we remember the last world view.
    const legacyMode = (st.profile || {}).defaultRewardMode;
    if (legacyMode && !st.ui) merged.ui.worldView = legacyMode;
    merged.ui.worldView = normalizeRewardMode(merged.ui.worldView || 'island');

    const allowedThemes = new Set(['midnight','violet','emerald','ocean','sunset']);
    if (!allowedThemes.has(merged.profile.theme)) merged.profile.theme = 'midnight';

    // LoFi (YouTube)
    // We store the selected video id and derive the embed URL from it.
    // (Some browsers block YouTube embeds on file:// pages; if that happens, open via http://localhost.)

    // Tasks
merged.tasks = Array.isArray(merged.tasks) ? merged.tasks : [];
merged.tasks = merged.tasks
  .filter(t => t && typeof t === 'object')
  .map(t => ({
    id: String(t.id || uid()),
    text: String(t.text || '').slice(0, 80),
    done: !!t.done,
    createdTs: Number(t.createdTs || Date.now()),
  }));

// Audio
merged.audio = (merged.audio && typeof merged.audio === 'object') ? merged.audio : d.audio;
merged.audio.master = clamp01(Number(merged.audio.master ?? d.audio.master));
merged.audio.ambient = (merged.audio.ambient && typeof merged.audio.ambient === 'object') ? merged.audio.ambient : d.audio.ambient;
for (const k of ['fire','wind','sea','nature']) {
  const def = d.audio.ambient[k];
  const cur = merged.audio.ambient[k] || {};
  merged.audio.ambient[k] = {
    on: !!cur.on,
    vol: clamp01(Number(cur.vol ?? def.vol)),
  };
}
// LoFi (YouTube)
const defaultLofiId = 'CFGLoQIhmow';
let vid = String(merged.audio.lofiVideoId || '').trim();
const rawUrl = String(merged.audio.lofiEmbedUrl || '').trim();
if (!vid && rawUrl) {
  const m1 = rawUrl.match(/\/embed\/([a-zA-Z0-9_-]{6,})/i);
  const m2 = rawUrl.match(/[?&]v=([a-zA-Z0-9_-]{6,})/i);
  const m3 = rawUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/i);
  vid = (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]) || '';
}
if (!vid) vid = defaultLofiId;
merged.audio.lofiVideoId = vid;
merged.audio.lofiEmbedUrl = `https://www.youtube.com/embed/${vid}?autoplay=0&rel=0&modestbranding=1`;
merged.audio.videoBgOn = !!merged.audio.videoBgOn;
merged.audio.videoBgOpacity = clamp01(Number(merged.audio.videoBgOpacity ?? 0.22));
merged.audio.videoOverlayOpacity = clamp01(Number(merged.audio.videoOverlayOpacity ?? 0.55));
merged.audio.ytVolume = clamp(Number(merged.audio.ytVolume ?? 60), 0, 100);



    // Labels
    merged.labels = (merged.labels && typeof merged.labels === 'object') ? merged.labels : { items: [], view: 'grid', sort: 'name' };
    merged.labels.items = Array.isArray(merged.labels.items) ? merged.labels.items : [];
    merged.labels.view = (merged.labels.view === 'list') ? 'list' : 'grid';
    merged.labels.sort = (merged.labels.sort === 'date') ? 'date' : 'name';

    // Habits
    merged.habits = (merged.habits && typeof merged.habits === 'object') ? merged.habits : { items: [], completions: {} };
    merged.habits.items = Array.isArray(merged.habits.items) ? merged.habits.items : [];
    merged.habits.completions = (merged.habits.completions && typeof merged.habits.completions === 'object') ? merged.habits.completions : {};

    // Never treat the app as "playing" on boot.
    if (merged.audio) merged.audio.isPlaying = false;
    return merged;
  }

  // ------------------ STATE ------------------
  // Must be initialized early (before timer defaults that depend on it)
  let state = loadState();


  function saveState() {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // Backwards-compatible helper: some code paths call `persist(...)`.
  // If undefined, the app crashes and SPA navigation stops working.
  function persist() {
    saveState();
  }

  function toast(title, msg) {
    let host = $('#toasts');
    if (!host) {
      // Create a toast host on the fly (prevents hard crashes if the container is missing)
      host = document.createElement('div');
      host.id = 'toasts';
      host.className = 'toasts';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'true');
      document.body.appendChild(host);
    }

    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast__title">${escapeHtml(title)}</div><div class="toast__msg">${escapeHtml(msg)}</div>`;
    host.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(4px)';
      el.style.transition = 'opacity 250ms ease, transform 250ms ease';
      setTimeout(() => el.remove(), 280);
    }, 4200);
  }


  // ------------------ NOTIFICATION SOUNDS ------------------
  // Simple, local chimes (no external assets).
  let __audioCtx = null;
  function playNotifyTone(kind = 'default') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!__audioCtx) __audioCtx = new AudioContext();
      const ctx = __audioCtx;

      const nowT = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();

      // Different little patterns
      const base = (kind === 'hour') ? 660 : (kind === 'pom') ? 784 : (kind === 'timer') ? 523 : 698;

      o.type = 'sine';
      o.frequency.setValueAtTime(base, nowT);
      o.frequency.exponentialRampToValueAtTime(base * 1.25, nowT + 0.12);

      g.gain.setValueAtTime(0.0001, nowT);
      g.gain.exponentialRampToValueAtTime(0.25, nowT + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, nowT + 0.25);

      o.connect(g);
      g.connect(ctx.destination);

      o.start(nowT);
      o.stop(nowT + 0.28);

      // tiny second ping for pom/timer
      if (kind === 'pom' || kind === 'timer') {
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(base * 1.5, nowT + 0.30);
        g2.gain.setValueAtTime(0.0001, nowT + 0.30);
        g2.gain.exponentialRampToValueAtTime(0.22, nowT + 0.32);
        g2.gain.exponentialRampToValueAtTime(0.0001, nowT + 0.52);
        o2.connect(g2);
        g2.connect(ctx.destination);
        o2.start(nowT + 0.30);
        o2.stop(nowT + 0.56);
      }
    } catch {
      // ignore (autoplay policies etc.)
    }
  }

  // ------------------ SESSION AMBIENT SOUNDS (HTMLAudio) ------------------
  // Plays ONLY while a timer / pomodoro / stopwatch is actively running.
  // Uses built-in looping audio files in index.html:
  //   #aud_fire, #aud_wind, #aud_sea, #aud_nature

  let __sessAmbGraph = null;
  let __sessAmbWarned = false;

  function sessEnsureCtx() {
    // Kept for backward compatibility with older calls; HTMLAudio doesn't need AudioContext.
    return true;
  }

  function sessGetAudioEl(key) {
    if (key === 'ocean') key = 'sea';
    return document.getElementById(`aud_${key}`);
  }

  function sessStopAmbient() {
    const keys = ['fire','wind','sea','nature'];
    for (const k of keys) {
      const el = sessGetAudioEl(k);
      if (!el) continue;
      try { el.pause(); } catch {}
      try { el.currentTime = 0; } catch {}
    }
    __sessAmbGraph = null;
  }

  function sessStartAmbient(type, volume01) {
    sessStopAmbient();
    type = String(type || 'off');
    if (type === 'off') return;

    const vol = clamp01(volume01 ?? 0.4);

    // Map UI types -> audio layers
    let layers = [];
    if (type === 'fire') layers = [{ k: 'fire', v: 1.0 }];
    else if (type === 'wind') layers = [{ k: 'wind', v: 1.0 }];
    else if (type === 'ocean') layers = [{ k: 'sea', v: 1.0 }];
    else if (type === 'nature') layers = [{ k: 'nature', v: 1.0 }];
    else if (type === 'ambient') {
      // Soft blend
      layers = [
        { k: 'sea', v: 0.55 },
        { k: 'wind', v: 0.35 },
        { k: 'nature', v: 0.25 },
      ];
    } else {
      return;
    }

    for (const layer of layers) {
      const el = sessGetAudioEl(layer.k);
      if (!el) continue;
      try {
        el.muted = false;
        el.loop = true;
        el.volume = clamp01(vol * layer.v);
        if (typeof el.load === 'function') el.load();
        const p = el.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            if (!__sessAmbWarned) {
              __sessAmbWarned = true;
              toast('Audio blocked', 'Click the 🔊 ambient button once, then start the timer again.');
            }
          });
        }
      } catch {
      }
    }

    __sessAmbGraph = { type, layers, stop: sessStopAmbient };
  }


  function sessIsStudyActive() {
    return !!(cd?.running || pom?.running || swRunning);
  }

  function sessGetCfg() {
    const cfg = state.profile?.sessionAmbient || {};
    return {
      type: cfg.type || 'off',
      volume: clamp01(Number(cfg.volume ?? 0.4)),
    };
  }

  function sessSyncAmbient() {
    const cfg = sessGetCfg();
    const active = sessIsStudyActive();
    if (!active || cfg.type === 'off') {
      sessStopAmbient();
      return;
    }
    // Keep playing the chosen sound
    if (!__sessAmbGraph || __sessAmbGraph.type !== cfg.type) {
      sessStartAmbient(cfg.type, cfg.volume);
    } else {
      // adjust volume by rebuilding master gain (simple: restart)
      sessStartAmbient(cfg.type, cfg.volume);
    }
  }

  
  function initAmbientPanel() {
    const fab = $('#ambientFab');
    const panel = $('#ambientPanel');
    if (!fab || !panel) return;

    const row = $('#ambTypeRow');
    const vol = $('#ambVol');
    const volPct = $('#ambVolPct');

    const setActiveUI = () => {
      const cfg = sessGetCfg();
      if (vol) vol.value = String(cfg.volume ?? 0.4);
      if (volPct) volPct.textContent = `${Math.round((cfg.volume ?? 0.4)*100)}%`;
      $$('#ambTypeRow .ambChip').forEach(btn => {
        const t = btn.getAttribute('data-amb');
        btn.classList.toggle('active', t === (cfg.type || 'off'));
      });
    };

    const togglePanel = () => {
      panel.classList.toggle('open');
      // user gesture: unlock audio context
      sessEnsureCtx();
      setActiveUI();
      sessSyncAmbient();
    };

    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('open')) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      panel.classList.remove('open');
    });

    if (row) {
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('.ambChip');
        if (!btn) return;
        const t = btn.getAttribute('data-amb') || 'off';
        state.profile = state.profile || {};
        state.profile.sessionAmbient = state.profile.sessionAmbient || {};
        state.profile.sessionAmbient.type = t;
        saveState();
        sessEnsureCtx(); // unlock on gesture
        setActiveUI();
        sessSyncAmbient();
        if (!sessIsStudyActive() && t !== 'off') {
          toast('Ambient set', 'Sound will play while a session is running.');
        }
      });
    }

    if (vol) {
      vol.addEventListener('input', () => {
        const v = clamp01(Number(vol.value));
        if (volPct) volPct.textContent = `${Math.round(v*100)}%`;
        state.profile = state.profile || {};
        state.profile.sessionAmbient = state.profile.sessionAmbient || {};
        state.profile.sessionAmbient.volume = v;
        saveState();
        sessEnsureCtx();
        sessSyncAmbient();
      });
    }

    // Keep UI synced on navigation / renders
    setActiveUI();
  }


function sessOpenModal() {
    const m = $('#sessionSoundModal');
    if (!m) return;
    m.classList.remove('hidden');

    const cfg = sessGetCfg();
    const vol = $('#sessAmbVol');
    if (vol) vol.value = String(cfg.volume);

    $$('input[name="sessAmbType"]').forEach(r => {
      r.checked = (r.value === cfg.type);
    });
  }

  function sessCloseModal() {
    const m = $('#sessionSoundModal');
    if (!m) return;
    m.classList.add('hidden');
  }


  // ------------------ AMBIENT DOCK (SIDE PANEL) ------------------
  function ambientDockOpen() {
    const panel = $('#ambientPanel');
    const btn = $('#ambientToggle');
    if (!panel || !btn) return;
    panel.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  }
  function ambientDockClose() {
    const panel = $('#ambientPanel');
    const btn = $('#ambientToggle');
    if (!panel || !btn) return;
    panel.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }
  function ambientDockInit() {
    const btn = $('#ambientToggle');
    const panel = $('#ambientPanel');
    const close = $('#ambientClose');
    const vol = $('#sessAmbVolDock');
    if (!btn || !panel || !vol) return;

    // Toggle open/close
    btn.addEventListener('click', () => {
      if (panel.classList.contains('hidden')) ambientDockOpen();
      else ambientDockClose();
    });
    if (close) close.addEventListener('click', ambientDockClose);

    // Hydrate UI from state
    const cfg = sessGetCfg();
    vol.value = String(cfg.volume);
    $$('input[name="sessAmbTypeDock"]').forEach(r => {
      r.checked = (r.value === cfg.type);
    });

    // Persist changes
    $$('input[name="sessAmbTypeDock"]').forEach(r => {
      r.addEventListener('change', () => {
        state.profile.sessionAmbient = state.profile.sessionAmbient || { type:'off', volume:0.4 };
        state.profile.sessionAmbient.type = r.value;
        saveState();
        sessEnsureCtx();
        sessSyncAmbient();
      });
    });

    vol.addEventListener('input', () => {
      state.profile.sessionAmbient = state.profile.sessionAmbient || { type:'off', volume:0.4 };
      state.profile.sessionAmbient.volume = clamp01(Number(vol.value));
      saveState();
      sessEnsureCtx();
      sessSyncAmbient();
    });

    // Clicking outside closes
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('hidden')) return;
      const t = e.target;
      if (!panel.contains(t) && t !== btn) {
        ambientDockClose();
      }
    });
  }



  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getTotals(sessions, range) {
    const tNow = now();
    let from = 0;
    let to = tNow;

    if (range === 'today') from = startOfDay(tNow);
    else if (range === 'week') from = startOfWeek(tNow);
    else if (range === 'month') from = startOfMonth(tNow);
    else if (range === 'all') from = 0;

    const filtered = sessions.filter(s => s.endTs >= from && s.endTs <= to);
    const totalSec = filtered.reduce((acc, s) => acc + (Number(s.durationSec) || 0), 0);

    const byMode = {
      island: totalSec,
      garden: totalSec,
    };

    return {
      from,
      to,
      sessions: filtered,
      totalSec,
      byMode,
    };
  }

  function uniqueDays(sessions) {
    const set = new Set();
    for (const s of sessions) set.add(toDateKey(s.endTs));
    return set.size;
  }

  function computeStreak(sessions) {
    // streak based on days with >= 1 minute of study
    const minPerDaySec = 60;

    const dayTotals = new Map();
    for (const s of sessions) {
      const k = toDateKey(s.endTs);
      const prev = dayTotals.get(k) || 0;
      dayTotals.set(k, prev + (Number(s.durationSec) || 0));
    }

    const studiedDays = new Set();
    for (const [k, sec] of dayTotals.entries()) {
      if (sec >= minPerDaySec) studiedDays.add(k);
    }

    const todayKey = toDateKey(now());

    // current streak
    let current = 0;
    let cursor = startOfDay(now());
    while (true) {
      const key = toDateKey(cursor);
      if (!studiedDays.has(key)) break;
      current++;
      cursor -= 24 * 3600 * 1000;
    }

    // longest streak
    let longest = 0;
    // sort keys
    const keys = Array.from(studiedDays).sort();
    let run = 0;
    let prevDate = null;
    for (const k of keys) {
      const d = new Date(k + 'T00:00:00');
      if (!prevDate) {
        run = 1;
      } else {
        const diffDays = Math.round((d.getTime() - prevDate.getTime()) / (24*3600*1000));
        run = (diffDays === 1) ? (run + 1) : 1;
      }
      longest = Math.max(longest, run);
      prevDate = d;
    }

    return { current, longest, todayKey };
  }

  function computeLevel(totalSec) {
    const level = Math.floor(totalSec / LEVEL_SEC);
    const inLevel = totalSec - level * LEVEL_SEC;
    const pct = clamp(Math.floor((inLevel / LEVEL_SEC) * 100), 0, 100);
    const remainingSec = Math.max(0, LEVEL_SEC - inLevel);
    return { level, pct, remainingSec, inLevel };
  }

  function getTreeStage(growthSec) {
    let current = TREE_STAGES[0];
    for (const st of TREE_STAGES) {
      if (growthSec >= st.minSec) current = st;
    }
    const currentIdx = TREE_STAGES.findIndex(s => s.id === current.id);
    const next = TREE_STAGES[currentIdx + 1] || null;

    let pct = 100;
    let toNextSec = 0;
    if (next) {
      const span = next.minSec - current.minSec;
      const into = growthSec - current.minSec;
      pct = clamp(Math.floor((into / span) * 100), 0, 100);
      toNextSec = Math.max(0, next.minSec - growthSec);
    }
    return { current, next, pct, toNextSec };
  }

  function computeFruitsReady(garden) {
    const treeMin = TREE_STAGES.find(s => s.id === 'tree').minSec;
    if (garden.growthSec < treeMin) return 0;
    const total = Math.floor((garden.growthSec - treeMin) / FRUIT_RATE_SEC);
    const ready = Math.max(0, total - (garden.harvestedOnThisTree || 0));
    return ready;
  }

  function sumFruitCollection(collection) {
    return Object.values(collection || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  }

  function normalizeRewardMode(mode) {
    return (mode === 'garden') ? 'garden' : 'island';
  }

  function applyTheme(theme) {
    const t = String(theme || 'midnight').toLowerCase();
    const allowed = new Set(['midnight','violet','emerald','ocean','sunset']);
    document.body.dataset.theme = allowed.has(t) ? t : 'midnight';
  }

  function saveSession({ durationSec, method, rewardMode, label, startedAt, endedAt }) {
    const dur = Math.max(0, Math.round(durationSec));
    if (dur < 60) {
      toast('Session not saved', 'Study sessions under 1 minute are ignored to keep your stats clean.');
      return false;
    }

    const endTs = endedAt || now();
    const startTs = startedAt || (endTs - dur * 1000);

    const session = {
      id: `s_${Math.random().toString(16).slice(2)}_${Date.now()}`,
      startTs,
      endTs,
      durationSec: dur,
      method,
      rewardMode: normalizeRewardMode(rewardMode || state.ui.worldView || 'island'),
      label: (label || '').trim().slice(0, 24),
    };

        session.clientId = String(session.id);
state.sessions.unshift(session);

    // Progress is synced: every session levels up both the Island and the Garden.
    state.island.xpSec += dur;
    state.garden.growthSec += dur;

    saveState();
    sbUpsertSoon();
    renderAll();

    toast('Session saved', `${formatDuration(dur)}${session.label ? ' • ' + session.label : ''}`);
    return true;
  }

  function restartTree(newType) {
    state.garden.treeType = newType || state.garden.treeType;
    state.garden.growthSec = 0;
    state.garden.harvestedOnThisTree = 0;
    saveState();
    renderGarden();
    renderStats();
    toast('Garden restarted', `New tree type: ${state.garden.treeType}`);
  }

  function harvestFruits() {
    const ready = computeFruitsReady(state.garden);
    if (ready <= 0) return;

    const type = state.garden.treeType;
    state.fruitCollection[type] = (Number(state.fruitCollection[type]) || 0) + ready;
    state.garden.harvestedOnThisTree = (Number(state.garden.harvestedOnThisTree) || 0) + ready;

    saveState();
    renderGarden();
    renderStats();

    toast('Harvested!', `+${ready} ${type}${ready === 1 ? '' : 's'} added to your collection.`);
  }

  // ------------------ ROUTER ------------------
  function getRoute() {
    const hash = (location.hash || '#/dashboard').replace('#', '');
    const parts = hash.split('/').filter(Boolean);
    return parts[0] || 'dashboard';
  }

  function setRoute(route) {
    location.hash = `#/${route}`;
  }

  function renderRoute() {
    const route = getRoute();

    // Remember which world view the user last visited.
    // This replaces the old "default view" setting.
    if (route === 'island' || route === 'garden') {
      if ((state.ui && state.ui.worldView) !== route) {
        state.ui.worldView = route;
        saveState();
      }
    }

    $$('.page').forEach(p => p.classList.toggle('active', p.dataset.route === route));

    // nav highlight (do not depend on a specific container id)
    const navRoot = document.getElementById('navLinks') || document.querySelector('nav.nav') || document;
    navRoot.querySelectorAll('.nav__link[data-link]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const r = href.startsWith('#/') ? href.slice(2) : href.replace('#', '');
      a.classList.toggle('active', r === route);
    });

    // some pages need a reflow/update (guarded so one broken view can't kill navigation)
    try {
      if (route === 'timer') updateTimerHeaderClock();
      if (route === 'dashboard') renderDashboardActivity();
      if (route === 'stats') renderStats();
      if (route === 'island') renderIsland();
      if (route === 'garden') renderGarden();
    } catch (err) {
      console.error('[Bloomora] Route update failed:', route, err);
    }
  }

  // ------------------ DASHBOARD ------------------

  function renderDashboard() {
    const name = state.profile.name?.trim() || 'Your';
    $('#dashName').textContent = name;

    // avatar
    // The top-right control is the music button; keep its icon stable.
    $('#avatarLetter').textContent = '♪';

    const totalsAll = getTotals(state.sessions, 'all');
    const totalsWeek = getTotals(state.sessions, 'week');
    const totalsMonth = getTotals(state.sessions, 'month');
    const totalsToday = getTotals(state.sessions, 'today');

    const streak = computeStreak(state.sessions);
    $('#dashStreak').textContent = String(streak.current);
    const dashToday = $('#dashTodayText');
    if (dashToday) {
      const t = getTotals(state.sessions, 'today');
      dashToday.textContent = `${formatHM(t.totalSec)} today`;
    }

    // Study level (overall)
    const lvl = computeLevel(totalsAll.totalSec);
    $('#studyLevelText').textContent = `Level ${lvl.level}`;
    $('#studyTotalText').textContent = `${formatDuration(totalsAll.totalSec)} total`;
    $('#studyNextPercent').textContent = `${lvl.pct}%`;
    $('#studyLevelFill').style.width = `${lvl.pct}%`;
    $('#studyLevelMeta').textContent = `${formatDuration(lvl.remainingSec)} left to level ${lvl.level + 1}`;

    // KPI cards
    $('#kpiTotal').textContent = formatDuration(totalsAll.totalSec);
    $('#kpiSessions').textContent = String(totalsAll.sessions.length);

    $('#kpiWeek').textContent = formatDuration(totalsWeek.totalSec);
    $('#kpiActiveDaysWeek').textContent = String(uniqueDays(totalsWeek.sessions));

    $('#kpiMonth').textContent = formatDuration(totalsMonth.totalSec);
    $('#kpiActiveDaysMonth').textContent = String(uniqueDays(totalsMonth.sessions));

    const avg = totalsAll.sessions.length ? (totalsAll.totalSec / totalsAll.sessions.length) : 0;
    $('#kpiAvg').textContent = formatDuration(avg);

    // Default view chip (optional UI)
    const defaultChip = $('#defaultModeChip');
    if (defaultChip) {
      defaultChip.textContent = (state.ui.worldView === 'garden') ? 'Garden' : 'Island';
    }

    // Weekly goal progress (optional UI)
    const weeklyGoalText = $('#weeklyGoalText');
    const weeklyGoalFill = $('#weeklyGoalFill');
    const weeklyGoalMeta = $('#weeklyGoalMeta');
    if (weeklyGoalText && weeklyGoalFill && weeklyGoalMeta) {
      const goalH = Number(state.profile.weeklyGoalHours || 0);
      const goalSec = goalH * 3600;
      const pctGoal = goalSec > 0 ? clamp((totalsWeek.totalSec / goalSec) * 100, 0, 100) : 0;
      weeklyGoalText.textContent = goalH ? `${goalH}h` : 'Not set';
      weeklyGoalFill.style.width = `${pctGoal}%`;

      if (!goalH) {
        weeklyGoalMeta.textContent = 'Set a goal in Settings';
      } else {
        const remaining = Math.max(0, goalSec - totalsWeek.totalSec);
        weeklyGoalMeta.textContent = `${Math.floor(pctGoal)}% • ${formatDuration(remaining)} left`;
      }
    }

    // Recent sessions
    renderRecentSessions();

    // Activity year selector
    populateYearSelect();

    renderDashboardActivity();
  }

  function populateYearSelect() {
    const select = $('#yearSelect');
    const years = new Set(state.sessions.map(s => new Date(s.endTs).getFullYear()));
    years.add(new Date().getFullYear());

    const sorted = Array.from(years).sort((a, b) => b - a);
    select.innerHTML = '';
    for (const y of sorted) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      select.appendChild(opt);
    }

    const savedYear = state.profile.lastYearViewed;
    const yearToUse = sorted.includes(savedYear) ? savedYear : sorted[0];
    select.value = String(yearToUse);
  }

  let dashboardChartView = 'months'; // or 'days'

  function renderDashboardActivity() {
    const year = Number($('#yearSelect').value || new Date().getFullYear());
    state.profile.lastYearViewed = year;
    saveState();

    $('#yearLabel').textContent = String(year);

    const yearSessions = state.sessions.filter(s => new Date(s.endTs).getFullYear() === year);
    const totalSec = yearSessions.reduce((a, s) => a + (Number(s.durationSec) || 0), 0);
    $('#yearTotalText').textContent = formatDuration(totalSec);
    $('#yearSessionText').textContent = String(yearSessions.length);
    $('#yearActiveDaysText').textContent = String(uniqueDays(yearSessions));

    renderHeatmap(yearSessions, year);

    if (dashboardChartView === 'months') {
      renderMonthlyChart(yearSessions, year, $('#chartArea'));
    } else {
      renderDailyChart(lastNDaysTotals(state.sessions, 14), $('#chartArea'), { labelEvery: 1 });
    }

    // toggle chips
    $$('[data-month-view]').forEach(btn => {
      btn.classList.toggle('chipBtn--active', btn.dataset.monthView === dashboardChartView);
    });
  }

  function renderHeatmap(sessions, year) {
    const host = $('#heatmap');
    host.innerHTML = '';

    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    start.setHours(0,0,0,0);
    end.setHours(0,0,0,0);

    // Map day -> seconds
    const totals = new Map();
    for (const s of sessions) {
      const key = toDateKey(s.endTs);
      totals.set(key, (totals.get(key) || 0) + (Number(s.durationSec) || 0));
    }

    // Build weeks columns (like GitHub): start from the Monday of the week containing Jan 1
    const cursor = new Date(start);
    const day = cursor.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    cursor.setDate(cursor.getDate() + diff);

    const cells = [];
    const last = new Date(end);

    while (cursor.getTime() <= last.getTime()) {
      // 7 rows per column
      for (let r = 0; r < 7; r++) {
        const d = new Date(cursor);
        d.setDate(d.getDate() + r);

        const inYear = d.getFullYear() === year;
        const key = toDateKey(d.getTime());
        const sec = inYear ? (totals.get(key) || 0) : 0;
        const level = inYear ? heatLevel(sec) : 0;

        cells.push({ inYear, key, sec, level });
      }
      cursor.setDate(cursor.getDate() + 7);
    }

    const grid = document.createElement('div');
    grid.className = 'heatmap';

    for (const c of cells) {
      const cell = document.createElement('div');
      cell.className = `hmCell ${c.level ? `lv${c.level}` : ''}`;
      if (!c.inYear) {
        cell.style.opacity = '0.18';
      }
      const mins = Math.round(c.sec / 60);
      cell.title = `${c.key}: ${mins} min`;
      grid.appendChild(cell);
    }

    host.appendChild(grid);
  }

  function heatLevel(sec) {
    // 0..4 based on minutes
    const m = sec / 60;
    if (m <= 0) return 0;
    if (m < 30) return 1;
    if (m < 60) return 2;
    if (m < 120) return 3;
    return 4;
  }

  function renderMonthlyChart(sessions, year, host) {
    const totals = new Array(12).fill(0);
    for (const s of sessions) {
      const d = new Date(s.endTs);
      const m = d.getMonth();
      totals[m] += (Number(s.durationSec) || 0);
    }

    const values = totals.map(sec => sec / 3600); // hours
    const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    renderLineChart({
      host,
      values,
      labels,
      yLabel: 'Hours',
      tooltipFormatter: (v, i) => `${labels[i]}: ${v.toFixed(1)}h`,
    });
  }

  function lastNDaysTotals(sessions, days) {
    const end = startOfDay(now());
    const start = end - (days - 1) * 24 * 3600 * 1000;

    const totals = new Map();
    for (let i = 0; i < days; i++) {
      const ts = start + i * 24*3600*1000;
      totals.set(toDateKey(ts), 0);
    }

    for (const s of sessions) {
      const key = toDateKey(s.endTs);
      if (totals.has(key)) totals.set(key, totals.get(key) + (Number(s.durationSec) || 0));
    }

    const keys = Array.from(totals.keys());
    const values = keys.map(k => (totals.get(k) || 0) / 3600);
    const labels = keys.map(k => {
      const d = new Date(k + 'T00:00:00');
      return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
    });

    return { keys, values, labels };
  }

  function renderDailyChart(data, host, opts = {}) {
    renderLineChart({
      host,
      values: data.values,
      labels: data.labels,
      yLabel: 'Hours',
      tooltipFormatter: (v, i) => `${data.labels[i]}: ${v.toFixed(2)}h`,
      labelEvery: opts.labelEvery ?? 2,
    });
  }

  function renderLineChart({ host, values, labels, yLabel, tooltipFormatter, labelEvery = 1 }) {
    host.innerHTML = '';

    const w = host.clientWidth || 800;
    const h = 240;

    const padding = { l: 42, r: 18, t: 18, b: 42 };
    const iw = w - padding.l - padding.r;
    const ih = h - padding.t - padding.b;

    const maxV = Math.max(0.5, ...values);
    const minV = 0;

    const x = (i) => padding.l + (values.length === 1 ? iw/2 : (i / (values.length - 1)) * iw);
    const y = (v) => padding.t + (1 - (v - minV) / (maxV - minV)) * ih;

    const pts = values.map((v, i) => [x(i), y(v)]);

    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

    // area fill
    const areaPath = `${path} L ${pts[pts.length - 1][0].toFixed(1)} ${(padding.t + ih).toFixed(1)} L ${pts[0][0].toFixed(1)} ${(padding.t + ih).toFixed(1)} Z`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    // grid lines
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const gy = padding.t + (i / gridCount) * ih;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(padding.l));
      line.setAttribute('x2', String(padding.l + iw));
      line.setAttribute('y1', String(gy));
      line.setAttribute('y2', String(gy));
      line.setAttribute('stroke', 'rgba(255,255,255,0.06)');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(10));
      label.setAttribute('y', String(gy + 4));
      label.setAttribute('fill', 'rgba(255,255,255,0.45)');
      label.setAttribute('font-size', '11');
      label.textContent = `${((1 - i / gridCount) * maxV).toFixed(1)}h`;
      svg.appendChild(label);
    }

    // area
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', areaPath);
    area.setAttribute('fill', 'rgba(0,0,0,0)'); // removed purple area highlight
    svg.appendChild(area);

    // line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', path);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', rgbaFromRGB(getThemeAccentRGB(),0.92));
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);

    // points
    pts.forEach((p, i) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', String(p[0]));
      c.setAttribute('cy', String(p[1]));
      c.setAttribute('r', '4');
      c.setAttribute('fill', '#050505');
      c.setAttribute('stroke', rgbaFromRGB(getThemeAccentRGB(),0.9));
      c.setAttribute('stroke-width', '2');
      c.style.cursor = 'pointer';
      c.addEventListener('mouseenter', () => showTooltip(i, p[0], p[1]));
      c.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(c);
    });

    // x labels
    labels.forEach((lab, i) => {
      if (labelEvery > 1 && i % labelEvery !== 0 && i !== labels.length - 1) return;
      const tx = x(i);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(tx));
      t.setAttribute('y', String(padding.t + ih + 26));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', 'rgba(255,255,255,0.45)');
      t.setAttribute('font-size', '11');
      t.textContent = lab;
      svg.appendChild(t);
    });

    // y axis label (offset from tick labels so it doesn't collide at small scales)
    const yl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yl.setAttribute('x', String(padding.l));
    yl.setAttribute('y', String(12));
    yl.setAttribute('fill', 'rgba(255,255,255,0.45)');
    yl.setAttribute('font-size', '11');
    yl.textContent = yLabel || '';
    svg.appendChild(yl);

    host.appendChild(svg);

    // tooltip
    let tooltipEl = null;
    function ensureTooltip() {
      if (tooltipEl) return tooltipEl;
      tooltipEl = document.createElement('div');
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.padding = '8px 10px';
      tooltipEl.style.borderRadius = '12px';
      tooltipEl.style.border = '1px solid rgba(255,255,255,0.12)';
      tooltipEl.style.background = 'rgba(0,0,0,0.72)';
      tooltipEl.style.backdropFilter = 'blur(10px)';
      tooltipEl.style.color = 'rgba(255,255,255,0.92)';
      tooltipEl.style.fontSize = '12px';
      tooltipEl.style.whiteSpace = 'nowrap';
      tooltipEl.style.zIndex = '5';
      tooltipEl.style.display = 'none';
      host.style.position = 'relative';
      host.appendChild(tooltipEl);
      return tooltipEl;
    }

    function showTooltip(i, px, py) {
      const el = ensureTooltip();
      el.textContent = tooltipFormatter(values[i], i);
      el.style.display = 'block';
      const rect = host.getBoundingClientRect();
      const xPos = clamp(px + 10, 10, (rect.width - 10));
      const yPos = clamp(py - 10, 10, (rect.height - 10));
      el.style.left = `${xPos}px`;
      el.style.top = `${yPos}px`;
    }

    function hideTooltip() {
      if (!tooltipEl) return;
      tooltipEl.style.display = 'none';
    }
  }

  function renderRecentSessions() {
    const host = $('#recentSessions');
    host.innerHTML = '';

    const list = state.sessions.slice(0, 10);
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No sessions yet. Start a timer to log your first session.';
      host.appendChild(empty);
      return;
    }

    for (const s of list) {
      const item = document.createElement('div');
      item.className = 'sessionItem';
      item.setAttribute('role', 'listitem');

      const lbl = s.label ? getLabelByName(s.label) : null;
      const label = s.label
        ? `<span class="tagPill tagPill--label" ${lbl?.color ? `style="--pill:${escapeAttr(lbl.color)}"` : ''}>
             <span class="tagDot" aria-hidden="true"></span>
             ${escapeHtml(s.label)}
           </span>`
        : '';

      item.innerHTML = `
        <div class="sessionItem__left">
          <div class="sessionItem__title">${formatDuration(s.durationSec)} <span class="muted">•</span> ${escapeHtml(capitalize(s.method || 'session'))}</div>
          <div class="sessionItem__meta">${escapeHtml(prettyDateTime(s.endTs))}</div>
        </div>
        <div class="sessionTag">
          ${label}
          <button class="sessionDeleteBtn sessionDeleteBtn--x" data-session-id="${escapeAttr(s.id)}" title="Delete session" aria-label="Delete session">✕</button>
        </div>
      `;
      host.appendChild(item);
    }
  }

  
function deleteSessionById(sessionId) {
  sessionId = String(sessionId || '');
  if (!sessionId) return false;

  const idx = state.sessions.findIndex(s => String(s.id) === sessionId);
  if (idx === -1) return false;

  const [removed] = state.sessions.splice(idx, 1);
  const dur = Number(removed?.durationSec || 0);

  // Keep progression consistent with history edits.
  state.island.xpSec = Math.max(0, Number(state.island.xpSec || 0) - dur);
  state.garden.growthSec = Math.max(0, Number(state.garden.growthSec || 0) - dur);

  saveState();
  renderAll();
  toast('Deleted', 'Study session removed.');
    sbDeleteSession(String(removed?.clientId || removed?.id || sessionId));
return true;
}

function resetStats() {
  // Reset study history + progression, keep labels + settings.
  state.sessions = [];
  state.island.xpSec = 0;
  state.garden.growthSec = 0;
  state.garden.harvestedOnThisTree = 0;

  // Optional: reset fruit collection (it represents progress rewards).
  state.fruitCollection = { Apple: 0, Orange: 0, Cherry: 0, Mango: 0, Peach: 0 };

  saveState();
  sbDeleteAllSessions();
  sbUpsertSoon();

  renderAll();
  toast('Reset', 'All study stats have been cleared.');
}

function capitalize(s) {
    s = String(s || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ------------------ ISLAND ------------------

  function renderIsland() {
    const total = state.island.xpSec || 0;
    const lvl = computeLevel(total);

    $('#islandLevelText').textContent = `Level ${lvl.level}`;
    $('#islandTotalText').textContent = formatDuration(total);
    $('#islandNextPercent').textContent = `${lvl.pct}%`;
    $('#islandFill').style.width = `${lvl.pct}%`;
    $('#islandMeta').textContent = `${formatDuration(lvl.remainingSec)} left to level ${lvl.level + 1}`;

    // upgrades
    const host = $('#islandUpgrades');
    host.innerHTML = '';
    for (const up of ISLAND_UPGRADES) {
      const el = document.createElement('div');
      const unlocked = lvl.level >= up.level;
      el.className = `upgradeItem ${unlocked ? 'unlocked' : ''}`;
      el.innerHTML = `
        <div class="upgradeItem__left">
          <div class="upgradeItem__title">Level ${up.level} • ${escapeHtml(up.title)}</div>
          <div class="upgradeItem__meta">${escapeHtml(up.desc)}</div>
        </div>
        <div class="upgradeItem__status">${unlocked ? 'Unlocked ✅' : 'Locked 🔒'}</div>
      `;
      host.appendChild(el);
    }

    // Sprite island art (PNG)
    const sprite = $('#islandSprite');
    if (sprite) {
      const n = clamp(lvl.level, 1, 16);
      sprite.src = `assets/images/island_${String(n).padStart(2,'0')}.png`;
    }
    const unlockedCount = ISLAND_UPGRADES.filter(u => lvl.level >= u.level).length;
    $('#islandUnlocked').textContent = `${unlockedCount}/${ISLAND_UPGRADES.length}`;

    // Island recap (sessions overlay)
    const recapText = $('#islandRecapText');
    const recapArt = $('#islandRecapArt');
    const recapChips = $('#islandRecapChips');

    if (recapText) {
      const sessionsCount = state.sessions.length;
      const totalSecAll = state.sessions.reduce((acc, s) => acc + (s.durationSec || 0), 0);
      recapText.textContent = `You've logged ${sessionsCount} session${sessionsCount === 1 ? '' : 's'} totalling ${formatDuration(totalSecAll)}.`;
    }

    if (recapArt) {
      const n = clamp(lvl.level, 1, 16);
      recapArt.innerHTML = `<div class="recapArtIsland"><img class="recapSprite" src="assets/images/island_${String(n).padStart(2,'0')}.png" alt="Island"/></div>`;
    }

    if (recapChips) {
      const recent = [...state.sessions].sort((a, b) => b.endTs - a.endTs).slice(0, 6);
      recapChips.innerHTML = recent.map((s) => {
        const label = (s.label && s.label.trim()) ? s.label.trim() : (s.method || 'Session');
        const when = new Date(s.endTs);
        const whenStr = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<span class="sessionChip" title="${label} • ${whenStr}"><strong>${formatDuration(s.durationSec)}</strong>${label}</span>`;
      }).join('');
    }
}

  // ------------------ GARDEN ------------------

  function renderGarden() {
    $('#treeTypeText').textContent = state.garden.treeType;
    $('#treeTypeSelect').value = state.garden.treeType;

    const stage = getTreeStage(state.garden.growthSec);
    $('#treeStageText').textContent = stage.current.name;

    $('#treeFill').style.width = `${stage.pct}%`;
    if (stage.next) {
      $('#treeMeta').textContent = `${stage.pct}% to ${stage.next.name} • ${formatDuration(stage.toNextSec)} left`;
    } else {
      // at tree stage (or beyond)
      const ready = computeFruitsReady(state.garden);
      $('#treeMeta').textContent = `Tree grown • Fruits appear every ${Math.round(FRUIT_RATE_SEC/60)} minutes of extra study`;
    }

    const gTimeEl = $('#gardenTimeText');
    if (gTimeEl) gTimeEl.textContent = formatDuration(state.garden.growthSec);

    const ready = computeFruitsReady(state.garden);
    $('#fruitReadyText').textContent = String(ready);

    const harvestBtn = $('#harvestBtn');
    const hint = $('#harvestHint');
    const treeMin = TREE_STAGES.find(s => s.id === 'tree').minSec;

    if (state.garden.growthSec < treeMin) {
      harvestBtn.disabled = true;
      if (hint) hint.textContent = `Grow to a tree (${formatDuration(treeMin)}) to unlock fruit.`;
    } else {
      harvestBtn.disabled = ready <= 0;
      if (hint) hint.textContent = ready > 0 ? `Harvest your ${state.garden.treeType}${ready === 1 ? '' : 's'}!` : `No fruit ready yet — study a bit more.`;
    }

    // Render collection
    const collectionHost = $('#fruitCollection');
    collectionHost.innerHTML = '';

    const order = ['Apple', 'Orange', 'Cherry', 'Mango', 'Peach'];
    for (const k of order) {
      const card = document.createElement('div');
      card.className = 'collectCard';
      card.innerHTML = `
        <div class="collectCard__left">
          <div class="fruitIcon" aria-hidden="true">${fruitEmoji(k)}</div>
          <div>
            <div class="collectName">${escapeHtml(k)}</div>
            <div class="muted small">Collected</div>
          </div>
        </div>
        <div class="collectCount mono">${Number(state.fruitCollection[k] || 0)}</div>
      `;
      collectionHost.appendChild(card);
    }

    // Tree SVG stage
    const sprite = $('#treeSprite');
    const stageId = stage.current.id;
    // Use fruit sprite if fruit available, otherwise stage sprite
    const spriteStage = (ready && stageId === 'Fruit') ? 'fruit' : stageId.toLowerCase();
    if (sprite) sprite.src = `assets/images/plant_${spriteStage}.png`;
  }

  // (SVG fruit rendering removed; PNG sprite used instead)
  function fruitEmoji(type) {
    switch (type) {
      case 'Apple': return '🍎';
      case 'Orange': return '🍊';
      case 'Cherry': return '🍒';
      case 'Mango': return '🥭';
      case 'Peach': return '🍑';
      default: return '🍏';
    }
  }

  function renderTreeFruits(ready) {
    const layer = $('#fruitLayer');
    if (!layer) return;
    layer.innerHTML = '';

    const n = Math.min(ready, 6);
    const positions = [
      [260, 110],
      [232, 126],
      [288, 126],
      [246, 148],
      [274, 148],
      [214, 118],
      [306, 118],
      [244, 100],
      [276, 100],
    ];

    for (let i = 0; i < n; i++) {
      const [x, y] = positions[i];
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', String(x));
      c.setAttribute('cy', String(y));
      c.setAttribute('r', '7');
            c.setAttribute('fill', rgbaFromRGB(getThemeAccentRGB(),0.95));
      c.setAttribute('stroke', 'rgba(0,0,0,0.35)');
      c.setAttribute('stroke-width', '2');
      layer.appendChild(c);
    }

    if (ready > 6) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', '360');
      t.setAttribute('y', '95');
      t.setAttribute('fill', 'rgba(255,255,255,0.85)');
      t.setAttribute('font-size', '14');
      t.textContent = `+${ready - 6}`;
      layer.appendChild(t);
    }
  }

// ------------------ LABELS ------------------

function getLabelById(id) {
  return (state.labels?.items || []).find(l => l.id === id) || null;
}

function getLabelByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return (state.labels?.items || []).find(l => String(l.name || '').trim().toLowerCase() === n) || null;
}

function labelNameFromId(id) {
  const lbl = getLabelById(id);
  return lbl ? lbl.name : '';
}

function getLabelsSorted() {
  const items = Array.isArray(state.labels?.items) ? [...state.labels.items] : [];
  const sort = state.labels?.sort === 'date' ? 'date' : 'name';
  if (sort === 'date') {
    items.sort((a, b) => (Number(b.createdTs || 0) - Number(a.createdTs || 0)));
  } else {
    items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  return items;
}

function renderLabelSelects() {
  const labels = getLabelsSorted();

  ['swLabel', 'pomLabel', 'cdLabel'].forEach(id => {
    const sel = $('#' + id);
    if (!sel) return;

    const prev = sel.value;
    sel.innerHTML = '';

    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = labels.length ? 'Select label' : 'No labels (create one)';
    sel.appendChild(opt0);

    for (const l of labels) {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      sel.appendChild(opt);
    }

    // restore if still valid
    sel.value = labels.some(l => l.id === prev) ? prev : '';
  });
}

function renderLabels() {
  const items = getLabelsSorted();

  // toolbar active states
  if ($('#labelsViewGrid') && $('#labelsViewList')) {
    $('#labelsViewGrid').classList.toggle('chipBtn--active', state.labels.view !== 'list');
    $('#labelsViewList').classList.toggle('chipBtn--active', state.labels.view === 'list');
  }
  if ($('#labelsSortName') && $('#labelsSortDate')) {
    $('#labelsSortName').classList.toggle('chipBtn--active', state.labels.sort !== 'date');
    $('#labelsSortDate').classList.toggle('chipBtn--active', state.labels.sort === 'date');
  }

  const empty = $('#labelsEmpty');
  const grid = $('#labelsGrid');
  if (!grid) return;

  const view = state.labels.view === 'list' ? 'list' : 'grid';
  grid.classList.toggle('labelsGrid--list', view === 'list');

  if (items.length === 0) {
    if (empty) empty.classList.remove('hidden');
    grid.innerHTML = '';
    renderLabelSelects();
    return;
  }

  if (empty) empty.classList.add('hidden');

  grid.innerHTML = '';
  for (const l of items) {
    const card = document.createElement('div');
    card.className = 'labelCard';
    card.innerHTML = `
      <div class="labelDot" style="background:${escapeAttr(l.color || '#a855f7')}"></div>
      <div class="labelMain">
        <div class="labelName">${escapeHtml(l.name || 'Untitled')}</div>
        <div class="muted small mono">${formatDateShort(l.createdTs || 0)}</div>
      </div>
      <div class="labelActions">
        <button class="iconMini" data-label-action="fav" data-label-id="${escapeAttr(l.id)}" title="Favorite">${l.favorite ? '★' : '☆'}</button>
        <button class="iconMini iconMini--danger" data-label-action="del" data-label-id="${escapeAttr(l.id)}" title="Delete">✕</button>
      </div>
    `;
    grid.appendChild(card);
  }

  renderLabelSelects();
}

function createLabel({ name, color }) {
  const n = (name || '').trim();
  if (!n) {
    toast('Label name required', 'Give your label a short name (e.g., Maths).');
    return false;
  }

  const label = {
    id: uid('lbl'),
    name: n.slice(0, 24),
    color: color || '#a855f7',
    favorite: false,
    createdTs: now(),
  };

  state.labels.items.push(label);
  saveState();
  sbUpsertSoon();
  renderAll();
  toast('Label created', label.name);
  return true;
}

function deleteLabel(id) {
  const idx = (state.labels.items || []).findIndex(l => String(l.id) === String(id));
  if (idx === -1) return;
  const name = state.labels.items[idx].name;
  const localId = String(state.labels.items[idx].id);
  state.labels.items.splice(idx, 1);
  // queue remote deletion so it doesn't come back on next pull
  sbQueueDeleteLabel(localId);
  saveState();
  sbUpsertSoon();
  renderAll();
  toast('Label deleted', name || 'Label');
}

function toggleLabelFavorite(id) {
  const l = getLabelById(id);
  if (!l) return;
  l.favorite = !l.favorite;
  saveState();
  renderAll();
}

// ------------------ SMALL HELPERS ------------------

function formatDateShort(ts) {
  const d = new Date(ts || now());
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}


  // ------------------ STATS ------------------
  let statsRange = 'all';
  let statsDays = 14;

  function renderStats() {
    // highlight range tab
    $$('[data-stats-range]').forEach(btn => {
      btn.classList.toggle('tab--active', btn.dataset.statsRange === statsRange);
    });

    const totals = getTotals(state.sessions, statsRange);
    const streak = computeStreak(state.sessions);

    $('#statsStreakBig').textContent = `${streak.current} ${streak.current === 1 ? 'Day' : 'Days'}`;
    $('#statsLongest').textContent = `${streak.longest} ${streak.longest === 1 ? 'Day' : 'Days'}`;
    $('#statsLongestHint').textContent = streak.current >= streak.longest && streak.longest > 0 ? 'New record energy ✨' : 'Keep going.';

    $('#statsTotal').textContent = formatDuration(totals.totalSec);
    $('#statsSessions').textContent = String(totals.sessions.length);

    // Stats cards: Study time today + Island level
    const todayTotals = getTotals(state.sessions, 'today');
    const islandVal = $('#statsIsland');
    if (islandVal) islandVal.textContent = formatHM(todayTotals.totalSec);
    const islandHint = $('#statsIslandLvl');
    if (islandHint) islandHint.textContent = `${todayTotals.sessions.length} session${todayTotals.sessions.length===1?'':'s'} today`;

    const islandLvl = computeLevel(state.island.xpSec || 0);
    const gardenVal = $('#statsGarden');
    if (gardenVal) gardenVal.textContent = `Level ${islandLvl.level}`;
    const gardenHint = $('#statsGardenStage');
    if (gardenHint) gardenHint.textContent = `${islandLvl.pct}% to next`;



    const avg = totals.sessions.length ? totals.totalSec / totals.sessions.length : 0;
    $('#statsAvg').textContent = formatDuration(avg);

    const fruitTotal = sumFruitCollection(state.fruitCollection);
    $('#statsFruits').textContent = String(fruitTotal);

    // activity chart
    renderStatsActivityChart();

    // weekly goal
    const goalH = Number(state.profile.weeklyGoalHours || 0);
    const weekTotals = getTotals(state.sessions, 'week');
    $('#weeklyGoalNumber').textContent = goalH ? `${goalH}h` : 'Not set';
    $('#weeklyGoalCurrent').textContent = `${(weekTotals.totalSec/3600).toFixed(1)}h`;
    const pctGoal = goalH ? clamp((weekTotals.totalSec / (goalH*3600)) * 100, 0, 100) : 0;
    $('#weeklyGoalFill2').style.width = `${pctGoal}%`;
    $('#weeklyGoalMeta2').textContent = goalH ? `${Math.floor(pctGoal)}%` : 'Set a goal in Settings';
    renderCalendarWidget();
    renderWeekRadar();
    renderAdvancedStats();
}

  

  
function renderAdvancedStats(){
  // Guard: only when elements exist
  const heat = document.getElementById('heatmapCanvas');
  const hourly = document.getElementById('hourlyCanvas');
  const dist = document.getElementById('distCanvas');
  const trend = document.getElementById('trendCanvas');
  const breakdown = document.getElementById('labelBreakdown');
  const course = document.getElementById('courseCanvas');
  if(!heat && !hourly && !dist && !trend && !breakdown && !course) return;

  const sessions = state.sessions || [];
  // Build aggregates
  const byDay = new Map(); // yyyy-mm-dd -> sec
  const byDow = Array(7).fill(0);
  const byHour = Array(24).fill(0);
  let longest = 0;

  const byLabel = new Map();

  for(const s of sessions){
    const sec = Number(s.durationSec||0);
    if(!sec) continue;
    longest = Math.max(longest, sec);
    const d = new Date(s.startTs || s.ts || Date.now());
    const dayKey = d.toISOString().slice(0,10);
    byDay.set(dayKey, (byDay.get(dayKey)||0)+sec);
    byDow[d.getDay()] += sec;
    byHour[d.getHours()] += sec;

    const label = (s.label || 'Unlabeled').trim() || 'Unlabeled';
    byLabel.set(label, (byLabel.get(label)||0) + sec);
  }

  // Best day/hour
  const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const bestDowIdx = byDow.reduce((a,v,i)=> v>byDow[a]?i:a, 0);
  const bestHourIdx = byHour.reduce((a,v,i)=> v>byHour[a]?i:a, 0);

  const elBestDay = document.getElementById('bestDay');
  if(elBestDay) elBestDay.textContent = byDow[bestDowIdx] ? dowNames[bestDowIdx] : '—';
  const elBestHour = document.getElementById('bestHour');
  if(elBestHour) elBestHour.textContent = byHour[bestHourIdx] ? `${String(bestHourIdx).padStart(2,'0')}:00` : '—';
  const elLongest = document.getElementById('longestSession');
  if(elLongest) elLongest.textContent = longest ? formatDuration(longest) : '—';

  // Consistency (7d): how many of last 7 days studied
  const today = new Date();
  let studiedDays = 0;
  for(let i=0;i<7;i++){
    const d = new Date(today);
    d.setDate(today.getDate()-i);
    const key = d.toISOString().slice(0,10);
    if((byDay.get(key)||0) > 0) studiedDays++;
  }
  const elCons = document.getElementById('consistency7d');
  if(elCons) elCons.textContent = `${studiedDays}/7 days`;

  // Heatmap (last 12 months)
  if(heat){
    const ctx = heat.getContext('2d');
    const w = heat.width, h = heat.height;
    ctx.clearRect(0,0,w,h);
    ctx.globalAlpha = 1;
    ctx.font = '12px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.fillText('Mon', 8, 28);
    ctx.fillText('Wed', 8, 64);
    ctx.fillText('Fri', 8, 100);

    const cell = 12, gap = 3;
    const left = 44, top = 14;
    // Build 52 weeks approx ending today
    const end = new Date();
    end.setHours(0,0,0,0);
    const start = new Date(end);
    start.setDate(end.getDate()-7*52);
    // find max
    let maxSec = 0;
    byDay.forEach(v => { maxSec = Math.max(maxSec, v); });
    maxSec = Math.max(maxSec, 1);

    const day = new Date(start);
    for(let wk=0; wk<53; wk++){
      for(let dow=0; dow<7; dow++){
        const key = day.toISOString().slice(0,10);
        const sec = byDay.get(key)||0;
        const t = sec/maxSec;
        const alpha = sec ? (0.15 + 0.75*Math.min(1,t)) : 0.06;
                const aRGB = getThemeAccentRGB();
        ctx.fillStyle = `rgba(${aRGB[0]},${aRGB[1]},${aRGB[2]},${alpha})`;
        const x = left + wk*(cell+gap);
        const y = top + dow*(cell+gap);
        ctx.fillRect(x,y,cell,cell);
        day.setDate(day.getDate()+1);
      }
    }
  }

  // Hourly bar chart
  function drawBars(canvas, data, maxVal, labelEvery=4, opts={}) {
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    const padL=40, padR=14, padT=10, padB=46;
    const innerW=W-padL-padR, innerH=H-padT-padB;

    const accent = getThemeAccentRGB();

    // grid
    ctx.strokeStyle='rgba(255,255,255,.08)';
    for(let i=0;i<=4;i++){
      const y=padT + (innerH*i/4);
      ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke();
    }

    const n=data.length;
    const barW=innerW/n;

    for(let i=0;i<n;i++){
      const v=data[i];
      const bh = maxVal? (v/maxVal)*innerH : 0;
      const x=padL + i*barW + barW*0.18;
      const y=padT + (innerH-bh);
      const w=barW*0.64;

      // Theme gradient bar
      const grad = ctx.createLinearGradient(0, y, 0, y+Math.max(1,bh));
      grad.addColorStop(0, rgbaFromRGB(accent, 0.95));
      grad.addColorStop(1, rgbaFromRGB(accent, 0.55));
      ctx.fillStyle = grad;
      ctx.fillRect(x,y,w,bh);

      // Value labels inside bars (for distributions)
      if (opts && opts.showValues) {
        const txt = (opts.valueFormatter ? opts.valueFormatter(v, i) : String(v));
        ctx.font = '12px system-ui';
        const tw = ctx.measureText(txt).width;
        let tx = x + (w - tw)/2;
        let ty = y + 16;
        // If bar is too short, place above it
        if (bh < 22) {
          ty = y - 6;
          ctx.fillStyle = 'rgba(255,255,255,.72)';
          ctx.fillText(txt, Math.max(6, tx), ty);
        } else {
          // inside bar
          ctx.fillStyle = 'rgba(0,0,0,.45)';
          ctx.fillRect(x+6, y+6, w-12, 18);
          ctx.fillStyle = 'rgba(255,255,255,.92)';
          ctx.fillText(txt, x + (w - tw)/2, y + 19);
        }
      }

      // x tick labels
      if(!opts || !opts.suppressTicks){
        if(i%labelEvery===0){
          ctx.fillStyle='rgba(255,255,255,.55)';
          ctx.font='11px system-ui';
          ctx.fillText(String(i).padStart(2,'0'), x, H-10);
        }
      }
    }
  }
  const maxHour = Math.max(1, ...byHour);
  drawBars(hourly, byHour.map(v=>v/60), maxHour/60, 3);

  // Session length distribution buckets (minutes)
  if(dist){
    const buckets = [0,15,30,45,60,90,120,180,9999];
    const counts = Array(buckets.length-1).fill(0);
    for(const s of sessions){
      const m = (Number(s.durationSec||0))/60;
      if(!m) continue;
      for(let i=0;i<buckets.length-1;i++){
        if(m>=buckets[i] && m<buckets[i+1]){ counts[i]++; break; }
      }
    }
    const maxC = Math.max(1, ...counts);
    drawBars(dist, counts, maxC, 1, { showValues: true, suppressTicks: true, valueFormatter:(v)=>String(v) });
    // write bucket labels (rotate slightly to avoid overlap)
    const ctx = dist.getContext('2d');
    const W = dist.width, H = dist.height;
    const padL=40, padR=14, padT=10, padB=46;
    const innerW=W-padL-padR;
    const barW=innerW/counts.length;
    ctx.fillStyle='rgba(255,255,255,.55)';
    ctx.font='11px system-ui';
    for(let i=0;i<counts.length;i++){
      const label = (buckets[i+1]===9999) ? `${buckets[i]}m+` : `${buckets[i]}-${buckets[i+1]}m`;
      const x=padL + i*barW + 6;
      const y=H-10;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI/4);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  // 30-day trend line
  if(trend){
    const ctx = trend.getContext('2d');
    const W = trend.width, H = trend.height;
    ctx.clearRect(0,0,W,H);
    const padL=40, padR=14, padT=14, padB=30;
    const innerW=W-padL-padR, innerH=H-padT-padB;
    const end = new Date(); end.setHours(0,0,0,0);
    const pts=[];
    let max=1;
    for(let i=29;i>=0;i--){
      const d=new Date(end); d.setDate(end.getDate()-i);
      const key=d.toISOString().slice(0,10);
      const v=(byDay.get(key)||0)/3600;
      pts.push(v);
      max=Math.max(max,v);
    }
    // grid
    ctx.strokeStyle='rgba(255,255,255,.08)';
    for(let i=0;i<=4;i++){
      const y=padT + (innerH*i/4);
      ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke();
    }
    // line
    ctx.strokeStyle=rgbaFromRGB(getThemeAccentRGB(),0.92);
    ctx.lineWidth=2;
    ctx.beginPath();
    pts.forEach((v,i)=>{
      const x=padL + (innerW*(i/(pts.length-1)));
      const y=padT + (innerH - (v/max)*innerH);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    // y label
    ctx.fillStyle='rgba(255,255,255,.55)';
    ctx.font='11px system-ui';
    ctx.fillText('Hours', 6, 20);
  }

  // Label breakdown
  if(breakdown){
    breakdown.innerHTML = '';
    const entries = Array.from(byLabel.entries()).sort((a,b)=>b[1]-a[1]);
    const total = entries.reduce((s,e)=>s+e[1],0) || 1;
    for(const [label, sec] of entries.slice(0,12)){
      const pct = sec/total;
      const row = document.createElement('div');
      row.className='breakdown__row';
      row.innerHTML = `
        <div class="breakdown__name">${escapeHtml(label)}</div>
        <div class="breakdown__bar" aria-hidden="true"><div style="width:${Math.round(pct*100)}%"></div></div>
        <div class="breakdown__time">${formatDuration(sec)}</div>`;
      breakdown.appendChild(row);
    }
    if(!entries.length){
      const empty = document.createElement('div');
      empty.className='muted';
      empty.textContent = 'No sessions yet — start a timer to build stats.';
      breakdown.appendChild(empty);
    }
  }

  // Study time by course (horizontal bars)
  if(course){
    const ctx = course.getContext('2d');
    const W = course.width, H = course.height;
    ctx.clearRect(0,0,W,H);

    const entries = Array.from(byLabel.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 10);
    if(!entries.length){
      ctx.fillStyle='rgba(255,255,255,.55)';
      ctx.font='12px system-ui';
      ctx.fillText('No sessions yet — start a timer to build stats.', 14, 22);
      return;
    }

    const maxHrs = Math.max(1, ...entries.map(e => e[1]/3600));
    const padL = 190, padR = 18, padT = 18, padB = 18;
    const innerW = W - padL - padR;
    const rowH = Math.max(22, Math.floor((H - padT - padB) / entries.length));
    const barH = Math.max(10, Math.floor(rowH * 0.52));

    // grid lines
    ctx.strokeStyle='rgba(255,255,255,.08)';
    for(let i=0;i<=4;i++){
      const x = padL + innerW*(i/4);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H-padB); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.45)';
      ctx.font='11px system-ui';
      ctx.fillText(`${(maxHrs*(i/4)).toFixed(i===0?0:1)}h`, x-10, padT-6);
    }

    entries.forEach(([label, sec], i) => {
      const hrs = sec/3600;
      const y = padT + i*rowH + Math.floor((rowH - barH)/2);
      const w = Math.max(2, Math.round((hrs/maxHrs)*innerW));

      // label text
      ctx.fillStyle='rgba(255,255,255,.78)';
      ctx.font='12px system-ui';
      const safeName = String(label||'').slice(0, 24);
      ctx.fillText(safeName, 14, y + barH - 2);

      // bar color from label (use a subtle gradient so it matches the active theme style)
      const lblObj = getLabelByName(label);
      const baseHex = (lblObj && lblObj.color) ? lblObj.color : null;

      const parseHex = (hex) => {
        const h = String(hex||'').replace('#','').trim();
        if (h.length === 3) {
          const r = parseInt(h[0]+h[0],16), g = parseInt(h[1]+h[1],16), b = parseInt(h[2]+h[2],16);
          return [r,g,b];
        }
        if (h.length === 6) {
          const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
          return [r,g,b];
        }
        return null;
      };

      const rgb = parseHex(baseHex) || getThemeAccentRGB();
      const grad = ctx.createLinearGradient(padL, 0, padL + Math.max(2,w), 0);
      grad.addColorStop(0, rgbaFromRGB(rgb, 0.55));
      grad.addColorStop(1, rgbaFromRGB(rgb, 0.92));
      ctx.fillStyle = grad;
      ctx.fillRect(padL, y, w, barH);
      ctx.globalAlpha = 1;

      // value text
      ctx.fillStyle='rgba(255,255,255,.70)';
      ctx.font='11px system-ui';
      const val = `${hrs.toFixed(2)}h`;
      const tw = ctx.measureText(val).width;
      let vx = padL + w + 8;
      const maxX = W - padR - tw;
      if (vx > maxX) {
        // draw inside bar near the end if it would overflow
        vx = Math.max(padL + 6, W - padR - tw);
        ctx.fillStyle='rgba(0,0,0,.55)';
        ctx.fillRect(vx - 4, y + 1, tw + 8, barH - 2);
        ctx.fillStyle='rgba(255,255,255,.85)';
      }
      ctx.fillText(val, vx, y + barH - 2);
    });
  }
}


function formatCompactHM(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h >= 1) return `${h}h`;
    if (m >= 1) return `${m}m`;
    return '0m';
  }


  function getAccentRgb() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
    const parts = raw.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
    if (parts.length >= 3) return parts.slice(0, 3);
    // Final fallback (neutral teal)
    return [0, 200, 160];
  }

  function getSecondaryRgb() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--secondary-rgb').trim();
    const parts = raw.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
    if (parts.length >= 3) return parts.slice(0, 3);
    // Never fall back to random green; use accent instead.
    return getAccentRgb();
  }


  function renderCalendarWidget() {
    const host = $('#calendarWidget');
    if (!host) return;

    const monthLabel = $('#calendarMonthLabel');

    const nowTs = now();
    const d = new Date(nowTs);
    const year = d.getFullYear();
    const month = d.getMonth();

    try {
      if (monthLabel) monthLabel.textContent = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    } catch {
      if (monthLabel) monthLabel.textContent = `${year}-${pad2(month + 1)}`;
    }

    const dayTotals = new Map();
    for (const s of state.sessions) {
      const k = toDateKey(s.endTs);
      dayTotals.set(k, (dayTotals.get(k) || 0) + s.durationSec);
    }

    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startIndex = (first.getDay() + 6) % 7; // Monday = 0

    const totalCells = Math.ceil((startIndex + daysInMonth) / 7) * 7;

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    let out = '<div class="calWeekdays">';
    out += weekdays.map((w) => `<div class="calWeekday">${w}</div>`).join('');
    out += '</div>';

    out += '<div class="calGrid">';
    const todayKey = toDateKey(nowTs);

    for (let cell = 0; cell < totalCells; cell++) {
      const dayNum = cell - startIndex + 1;

      if (dayNum < 1 || dayNum > daysInMonth) {
        out += '<div class="calCell calCell--empty"></div>';
        continue;
      }

      const dayTs = new Date(year, month, dayNum).getTime();
      const key = toDateKey(dayTs);
      const sec = dayTotals.get(key) || 0;

      const studied = sec >= 60;
      const isToday = key === todayKey;

      const cls = [
        'calCell',
        studied ? 'calCell--studied' : '',
        isToday ? 'calCell--today' : '',
      ].filter(Boolean).join(' ');

      const valueStr = studied ? formatCompactHM(sec) : '';

      out += `<div class="${cls}" title="${studied ? `${formatDuration(sec)} studied` : 'No study logged'}">
        <div class="calCell__day">${dayNum}</div>
        ${studied ? `<div class="calCell__value">${valueStr}</div>` : ''}
      </div>`;
    }

    out += '</div>';

    host.innerHTML = out;
  }

  function renderWeekRadar() {
    const canvas = $('#weekRadar');
    if (!canvas) return;

    const avgEl = $('#weekAvgText');
    const sessionsEl = $('#weekSessionsText');

    const weekStart = startOfWeek(now());
    const weekEnd = weekStart + 7 * 86400000;

    const totals = new Array(7).fill(0); // Mon..Sun
    let sessionsCount = 0;

    for (const s of state.sessions) {
      if (s.endTs >= weekStart && s.endTs < weekEnd) {
        sessionsCount++;
        const dayIdx = Math.floor((startOfDay(s.endTs) - weekStart) / 86400000);
        if (dayIdx >= 0 && dayIdx < 7) totals[dayIdx] += s.durationSec;
      }
    }

    const totalWeek = totals.reduce((a, b) => a + b, 0);
    if (avgEl) avgEl.textContent = sessionsCount ? formatDuration(Math.round(totalWeek / sessionsCount)) : '0m';
    if (sessionsEl) sessionsEl.textContent = String(sessionsCount);

    // Radar order (to match the mock): Sun at top, then Mon..Sat clockwise
    const values = [totals[6], totals[0], totals[1], totals[2], totals[3], totals[4], totals[5]];
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(420, Math.max(280, canvas.clientWidth || 360));
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;

    const radius = size * 0.33; // leave room for labels
    const ringCount = 5;
    const angleStep = (Math.PI * 2) / labels.length;
    const startAngle = -Math.PI / 2; // top

    const [ar, ag, ab] = getAccentRgb();
    const accentStroke = `rgba(${ar}, ${ag}, ${ab}, 0.95)`;
    const accentFill = `rgba(${ar}, ${ag}, ${ab}, 0.16)`;

    const gridStroke = 'rgba(255,255,255,0.28)';
    const axisStroke = 'rgba(255,255,255,0.22)';
    const labelFill = 'rgba(255,255,255,0.62)';
    const labelFillStrong = 'rgba(255,255,255,0.82)';

    const maxVal = Math.max(3600, ...values);

    const polyPoint = (angle, r) => [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];

    // Rings
    ctx.lineWidth = 1;
    for (let ring = 1; ring <= ringCount; ring++) {
      const rr = (radius * ring) / ringCount;
      ctx.beginPath();
      for (let i = 0; i < labels.length; i++) {
        const a = startAngle + i * angleStep;
        const [x, y] = polyPoint(a, rr);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = gridStroke;
      ctx.stroke();
    }

    // Axes
    for (let i = 0; i < labels.length; i++) {
      const a = startAngle + i * angleStep;
      const [x, y] = polyPoint(a, radius);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = axisStroke;
      ctx.stroke();
    }

    // Data polygon
    ctx.beginPath();
    for (let i = 0; i < labels.length; i++) {
      const a = startAngle + i * angleStep;
      const v = values[i] / maxVal;
      const rr = radius * v;
      const [x, y] = polyPoint(a, rr);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = accentFill;
    ctx.fill();
    ctx.strokeStyle = accentStroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Points
    for (let i = 0; i < labels.length; i++) {
      const a = startAngle + i * angleStep;
      const v = values[i] / maxVal;
      const rr = radius * v;
      const [x, y] = polyPoint(a, rr);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = accentStroke;
      ctx.fill();
    }

    // Labels
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < labels.length; i++) {
      const a = startAngle + i * angleStep;
      const [x, y] = polyPoint(a, radius + 24);
      ctx.fillStyle = (labels[i] === 'Sun') ? labelFillStrong : labelFill;
      ctx.fillText(labels[i], x, y);
    }
  }

function renderStatsActivityChart() {
    // compute last N days totals
    const data = lastNDaysTotals(state.sessions, statsDays);

    // label density
    const labelEvery = statsDays <= 14 ? 2 : (statsDays <= 30 ? 5 : 10);

    renderLineChart({
      host: $('#statsChart'),
      values: data.values,
      labels: data.labels,
      yLabel: 'Hours',
      tooltipFormatter: (v, i) => `${data.labels[i]}: ${v.toFixed(2)}h`,
      labelEvery,
    });

    // toggle chips
    $$('[data-days]').forEach(btn => {
      btn.classList.toggle('chipBtn--active', Number(btn.dataset.days) === statsDays);
    });
  }

  // ------------------ SETTINGS MODAL ------------------

  // Legacy entry point used by the top-bar music button.
  // Route it to the current music modal implementation.
  function openSettings() {
    openMusicModal();
  }


  function closeSettings() {
    closeMusicModal();
  }

  
  // ------------------ ACCOUNT MODAL ------------------

  function openAccountModal() {
    const m = $('#accountModal');
    if (!m) return;
    m.classList.remove('hidden');
    document.body.classList.add('modalOpen');
  }

  function closeAccountModal() {
    const m = $('#accountModal');
    if (!m) return;
    m.classList.add('hidden');
    document.body.classList.remove('modalOpen');
  }

// ------------------ APP SETTINGS MODAL ------------------

  function openAppSettingsModal() {
    const m = $('#appSettingsModal');
    if (!m) return;

    // hydrate fields
    $('#settingsName').value = state.profile.name || '';
    $('#settingsWeeklyGoal').value = String(Number(state.profile.weeklyGoalHours || 0));
        $('#settingsTheme').value = String(state.profile.theme || 'midnight');

    // background video visibility
    const vis = clamp(Number(state.audio.videoBgOpacity ?? 0.22) * 100, 0, 100);
    const visEl = $('#settingsVideoVis');
    const visVal = $('#settingsVideoVisVal');
    if (visEl) visEl.value = String(Math.round(vis));
    if (visVal) visVal.textContent = `${Math.round(vis)}%`;

    // background image
    const bgSel = $('#settingsBgChoice');
    const bgRow = $('#settingsBgUploadRow');
    if (bgSel) {
      bgSel.value = String(state.profile.backgroundChoice || 'black');
      const showUpload = (bgSel.value === 'custom');
      if (bgRow) bgRow.classList.toggle('hidden', !showUpload);
    }

    // stopwatch cap
    const capOnEl = $('#settingsSwCapOn');
    const capHrsEl = $('#settingsSwCapHours');
    if (capOnEl) capOnEl.checked = (state.profile.stopwatchCapOn !== false);
    if (capHrsEl) capHrsEl.value = String(clamp(Number(state.profile.stopwatchCapHours ?? 6), 1, 24));

    // manual add label select
    hydrateLabelSelect('#manualLabel', true);

    m.classList.remove('hidden');
    setTimeout(() => $('#settingsName')?.focus?.(), 0);
  }

  function closeAppSettingsModal() {
    const m = $('#appSettingsModal');
    if (!m) return;
    m.classList.add('hidden');
  }

  function saveAppSettings() {
    state.profile.name = String($('#settingsName')?.value || 'Student').trim().slice(0, 28) || 'Student';
    state.profile.weeklyGoalHours = clamp(Number($('#settingsWeeklyGoal')?.value || 0), 0, 168);
    state.profile.theme = String($('#settingsTheme')?.value || 'midnight');
    applyTheme(state.profile.theme);

    // background image
    state.profile.backgroundChoice = String($('#settingsBgChoice')?.value || state.profile.backgroundChoice || 'black');

    // background video visibility (0..100)
    const visPct = clamp(Number($('#settingsVideoVis')?.value || (Number(state.audio.videoBgOpacity ?? 0.22) * 100)), 0, 100) / 100;
    state.audio.videoBgOpacity = clamp01(visPct);
    // Dark overlay is inversely related so the video can be seen more clearly.
    state.audio.videoOverlayOpacity = clamp01(0.55 * (1 - visPct));
    // Brightness scales up to 1.0 at 100% visibility (so the video can be fully clear).
    state.audio.videoBgBrightness = clamp(Number(0.75 + 0.25 * visPct), 0.5, 1.0);

    // stopwatch session cap
    state.profile.stopwatchCapOn = !!($('#settingsSwCapOn')?.checked);
    state.profile.stopwatchCapHours = clamp(Number($('#settingsSwCapHours')?.value || 6), 1, 24);

    applyVideoBackground();
    applyBackgroundImage();
    saveState();
    renderAll();
    toast('Settings saved', 'Updated locally on this device.');
  }

  function manualAddSession() {
    const h = clamp(Number($('#manualHours')?.value || 0), 0, 23);
    const m = clamp(Number($('#manualMinutes')?.value || 0), 0, 59);
    const durSec = Math.round((h * 3600) + (m * 60));

    // label id -> name
    const labelId = String($('#manualLabel')?.value || '');
    let labelName = '';
    if (labelId) {
      const l = getLabelById(labelId);
      labelName = l?.name || '';
    }

    const ok = saveSession({
      durationSec: durSec,
      method: 'manual',
      rewardMode: state.ui.worldView || 'island',
      label: labelName,
      endedAt: now(),
    });

    if (ok) {
      // reset quick inputs
      $('#manualHours').value = '0';
      $('#manualMinutes').value = '0';
      $('#manualLabel').value = '';
    }
  }

function openLabelModal() {
  const m = $('#labelModal');
  if (!m) return;
  m.classList.remove('hidden');
  $('#labelNameInput').value = '';
  $('#labelColorInput').value = '#a855f7';
  setTimeout(() => $('#labelNameInput')?.focus?.(), 0);
}

function closeLabelModal() {
  const m = $('#labelModal');
  if (!m) return;
  m.classList.add('hidden');
}

function openTasksModal() {
  const m = $('#tasksModal');
  if (!m) return;
  m.classList.remove('hidden');
  renderTasks();
  const input = $('#taskInput');
  if (input) {
    input.value = '';
    input.focus();
  }
}

function closeTasksModal() {
  const m = $('#tasksModal');
  if (!m) return;
  m.classList.add('hidden');
}

function renderTasks() {
  const host = $('#tasksList');
  if (!host) return;

  if (!Array.isArray(state.tasks) || state.tasks.length === 0) {
    host.innerHTML = '<p class="muted small">No tasks yet. Add one above.</p>';
    return;
  }

  host.innerHTML = state.tasks
    .slice()
    .sort((a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0))
    .map(t => {
      const done = !!t.done;
      const l = t.labelId ? getLabelById(t.labelId) : null;
      const pill = l ? `<span class="labelPill" style="--pill:${l.color}">${escapeHtml(l.name)}</span>` : '';
      const desc = t.desc ? `<div class="taskDesc">${escapeHtml(t.desc)}</div>` : '';
      return `
        <div class="taskItem" data-task-id="${escapeAttr(t.id)}">
          <div class="taskLeft">
            <input class="taskCheck" type="checkbox" ${done ? 'checked' : ''} data-task-toggle />
            <div class="taskStack">
              <div class="taskLine">
                <div class="taskText ${done ? 'taskText--done' : ''}">${escapeHtml(t.text || '')}</div>
                ${pill}
              </div>
              ${desc}
            </div>
          </div>
          <div class="taskBtns">
            <button class="iconBtn" data-task-del title="Delete task" aria-label="Delete task">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 7H19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M10 11V17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M14 11V17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M9 7L10 5H14L15 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M7 7L8 20H16L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

function addTask(text, desc = '', labelId = '') {
  const clean = String(text || '').trim().slice(0, 80);
  if (!clean) return;
  state.tasks.unshift({
    id: uid(),
    text: clean,
    desc: String(desc || '').trim().slice(0, 220),
    labelId: String(labelId || ''),
    done: false,
    createdTs: Date.now(),
  });
  saveState();
  renderTasks();
}

function toggleTaskDone(id, done) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !!done;
  saveState();
  renderTasks();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState();
  renderTasks();
}

function clearDoneTasks() {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter(t => !t.done);
  if (state.tasks.length !== before) saveState();
  renderTasks();
}

function clearAllTasks() {
  if (!state.tasks.length) return;
  state.tasks = [];
  saveState();
  renderTasks();
}

function hydrateLabelSelect(selectCss, includeNoLabel = false) {
  const sel = $(selectCss);
  if (!sel) return;
  sel.innerHTML = '';

  // Support older/newer state shapes:
  // - state.labels = { items: [...] }
  // - state.labels = [...]
  const labels = Array.isArray(state.labels)
    ? state.labels
    : (state.labels && Array.isArray(state.labels.items) ? state.labels.items : []);

  if (includeNoLabel) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No label';
    sel.appendChild(opt);
  }

  for (const l of labels) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    sel.appendChild(opt);
  }
}



/* ------------------ Sounds + Music ------------------ */

const AMBIENT_KEYS = ['fire', 'wind', 'sea', 'nature'];

function getAmbientAudioEl(key) {
  return $(`#aud_${key}`);
}

function anyAmbientOn() {
  return AMBIENT_KEYS.some(k => !!(state.audio?.ambient?.[k]?.on));
}

function applyAudioState() {
  if (!state.audio) return;

  const master = clamp01(Number(state.audio.master ?? 0.6));

  for (const k of AMBIENT_KEYS) {
    const cfg = state.audio.ambient[k];
    const el = getAmbientAudioEl(k);
    if (!el) continue;

    const vol = clamp01(Number(cfg.vol ?? 0.35));
    el.volume = clamp01(master * vol);

    if (cfg.on) {
      // play() requires user gesture; errors are safely ignored.
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      el.pause();
    }
  }

  // Dock indicator
  const icon = $('#openSoundBtn');
  if (icon) icon.classList.toggle('dockIcon--active', anyAmbientOn());
}

function syncSoundModalUI() {
  if (!state.audio) return;

  const master = $('#snd_master');
  if (master) master.value = String(clamp01(state.audio.master ?? 0.6));

  for (const k of AMBIENT_KEYS) {
    const onEl = $(`#snd_${k}_on`);
    const volEl = $(`#snd_${k}_vol`);
    if (onEl) onEl.checked = !!state.audio.ambient[k].on;
    if (volEl) volEl.value = String(clamp01(state.audio.ambient[k].vol ?? 0.35));
  }
}

function openSoundModal() {
  const m = $('#soundModal');
  if (!m) return;
  m.classList.remove('hidden');
  syncSoundModalUI();
}

function closeSoundModal() {
  const m = $('#soundModal');
  if (!m) return;
  m.classList.add('hidden');
}

function youtubeIdFromInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  // If user pasted just the ID.
  if (/^[a-zA-Z0-9_-]{6,}$/.test(raw)) return raw;

  try {
    const u = new URL(raw);

    // watch?v=
    const v = u.searchParams.get('v');
    if (v) return v;

    // youtu.be/<id>
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace('/', '').trim();
      if (id) return id;
    }

    // /embed/<id>
    const em = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/i);
    if (em) return em[1];
  } catch (e) {
    // ignore
  }

  // Fallback regex
  const m1 = raw.match(/\/embed\/([a-zA-Z0-9_-]{6,})/i);
  const m2 = raw.match(/[?&]v=([a-zA-Z0-9_-]{6,})/i);
  const m3 = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/i);
  return (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]) || '';
}

function lofiEmbedUrlFromId(id, autoplay = 0) {
  const safe = String(id || '').trim() || 'CFGLoQIhmow';
  const ap = autoplay ? 1 : 0;
  // Show the video UI in the modal (helps avoid a "black rectangle" when paused)
  // and include origin for better YouTube embed compatibility.
  const origin = encodeURIComponent(location.origin);
  return `https://www.youtube.com/embed/${safe}?autoplay=${ap}&controls=1&rel=0&modestbranding=1&enablejsapi=1&playsinline=1&origin=${origin}`;
}

// Muted preview used inside the Music modal so we don't create double-audio
// (the actual audio comes from the hidden YouTube IFrame API player).
function lofiPreviewUrlFromId(id, autoplay = 0) {
  const safe = String(id || '').trim() || 'CFGLoQIhmow';
  const ap = autoplay ? 1 : 0;
  const origin = encodeURIComponent(location.origin);
  return `https://www.youtube.com/embed/${safe}?autoplay=${ap}&mute=1&controls=1&rel=0&modestbranding=1&enablejsapi=1&playsinline=1&origin=${origin}`;
}

function lofiBgUrlFromId(id, mute = 0) {
  const safe = String(id || '').trim() || 'CFGLoQIhmow';
  // Loop requires playlist=<id>
  const origin = encodeURIComponent(location.origin);
  const m = mute ? 1 : 0;
  return `https://www.youtube.com/embed/${safe}?autoplay=1&mute=${m}&controls=0&rel=0&loop=1&playlist=${safe}&modestbranding=1&playsinline=1&enablejsapi=1&origin=${origin}`;
}

function toYouTubeEmbedUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return lofiEmbedUrlFromId(state.audio.lofiVideoId || 'CFGLoQIhmow', 0);

  const id = youtubeIdFromInput(raw);
  if (!id) return lofiEmbedUrlFromId(state.audio.lofiVideoId || 'CFGLoQIhmow', 0);
  return lofiEmbedUrlFromId(id, 0);
}

function applyVideoBackground() {
  const wrap = $('#videoBg');
  const frame = $('#videoBgFrame');
  if (!wrap || !frame) return;

  const vid = String(state.audio.lofiVideoId || 'CFGLoQIhmow').trim() || 'CFGLoQIhmow';
  const opacity = clamp01(Number(state.audio.videoBgOpacity ?? 0.22));
  document.documentElement.style.setProperty('--video-bg-opacity', String(opacity));
  const overlay = clamp01(Number(state.audio.videoOverlayOpacity ?? (0.55)));
  document.documentElement.style.setProperty('--video-overlay-opacity', String(overlay));
  const bright = clamp(Number(state.audio.videoBgBrightness ?? (0.75)), 0.5, 1.0);
  document.documentElement.style.setProperty('--video-bg-brightness', String(bright));


  // Only show video background while the user is actively playing a LoFi track AND the toggle is on.
  if (state.audio.videoBgOn && state.audio.isPlaying) {
    wrap.classList.remove('hidden');

    // Muted background (audio comes from the modal/player).
    const targetSrc = lofiBgUrlFromId(vid, 1);
    if (frame.src !== targetSrc) frame.src = targetSrc;
  } else {
    wrap.classList.add('hidden');
    frame.src = '';
  }


// ---- Small helpers for controlling the embedded YouTube iframe (lofiFrame) ----
// Uses postMessage commands (requires enablejsapi=1 on the embed URL).
function ytIframeCmd(func, args = []) {
  const frame = $('#lofiFrame');
  if (!frame || !frame.contentWindow) return;
  frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

let ytLastKnownTime = 0;
let ytTimeReqId = 0;

function ytRequestCurrentTime() {
  const frame = $('#lofiFrame');
  if (!frame || !frame.contentWindow) return Promise.resolve(ytLastKnownTime);

  const reqId = ++ytTimeReqId;

  return new Promise((resolve) => {
    let done = false;

    const onMsg = (e) => {
      try {
        const data = (typeof e.data === 'string') ? JSON.parse(e.data) : e.data;
        if (!data || data.event !== 'infoDelivery' || !data.info) return;
        if (typeof data.info.currentTime !== 'number') return;

        ytLastKnownTime = data.info.currentTime;
        if (!done) {
          done = true;
          window.removeEventListener('message', onMsg);
          resolve(ytLastKnownTime);
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener('message', onMsg);

    // Ask for the current time.
    ytIframeCmd('getCurrentTime');

    // Safety timeout (avoid dangling listeners)
    setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      resolve(ytLastKnownTime);
    }, 650);
  });
}

async function ytSeekRelative(deltaSec) {
  const t = await ytRequestCurrentTime();
  const next = Math.max(0, Number(t || 0) + Number(deltaSec || 0));
  ytIframeCmd('seekTo', [next, true]);
}

function ytSetVolume(vol) {
  const v = clamp(Number(vol || 0), 0, 100);
  state.audio.ytVolume = v;
  saveState();
  ytIframeCmd('unMute');
  ytIframeCmd('setVolume', [v]);
}

}


// ---- Simple YouTube-backed music controller (works without the full IFrame API) ----
(function initYtAudioController(){
  // NOTE: This is a pragmatic controller for file:// usage.
  // Play/Pause works by reloading the embed with autoplay on/off.
  const PLAYING_CLASS = 'isPlaying';
  let playing = false;

  const playlist = [
    // User-requested LoFi Girl videos
    'CFGLoQIhmow',
    '4xDzrJKXOOY',
    'CBSlu_VMS9U',
    'cyzx45mupcQ',
    'Z_8f5IWuTFg',
    'A8yjETPcZeA',
    'UJs6__K7gSY',
    '8b3fqIBrNW0',
  ];

  function normalizeId(input){
    const s = String(input||'').trim();
    if(!s) return 'CFGLoQIhmow';
    // accept full URL or id
    const m = s.match(/[?&]v=([^&]+)/);
    if(m) return m[1];
    const em = s.match(/embed\/([^?]+)/);
    if(em) return em[1];
    return s;
  }

  function getFrame(){ return document.getElementById('lofiFrame'); }

  function setPlayingUi(){
    const wrap = document.getElementById('musicTopControls');
    if(wrap) wrap.classList.toggle(PLAYING_CLASS, playing);
    const btn = document.getElementById('musicPlay');
    if(btn) btn.textContent = playing ? '⏸' : '▶';
  }

  function loadById(id, autoplay){
    const vid = normalizeId(id);
    state.audio.lofiVideoId = vid;
    // Sync play state so video-background + UI can rely on state (not just local var)
    state.audio.isPlaying = !!autoplay;
    saveState();

    // Update local playing flag first so applyVideoBackground can make the correct decision.
    playing = !!autoplay;

    const frame = getFrame();
    if(frame){
      // Always load a visible embed in the modal (controls enabled in URL builder),
      // even if we don't autoplay.
      frame.src = lofiEmbedUrlFromId(vid, playing ? 1 : 0);
    }

    // If video background is enabled, refresh it too (only shows when playing).
    applyVideoBackground();
    setPlayingUi();
  }

  function currentIndex(){
    const vid = normalizeId(state.audio.lofiVideoId);
    const idx = playlist.indexOf(vid);
    return idx >= 0 ? idx : 0;
  }

  window.ytAudio = {
    playlist,
    loadTrackById: (id, autoplay=1) => loadById(id, autoplay),
    loadByIndex: (i, autoplay=1) => loadById(playlist[(i+playlist.length)%playlist.length], autoplay),
    nextTrack: () => window.ytAudio.loadByIndex(currentIndex()+1, 1),
    prevTrack: () => window.ytAudio.loadByIndex(currentIndex()-1, 1),
    togglePlay: () => {
      // If not loaded yet, load + play
      if(!state.audio.lofiVideoId) return loadById('CFGLoQIhmow', 1);
      if(playing){
        loadById(state.audio.lofiVideoId, 0);
      }else{
        loadById(state.audio.lofiVideoId, 1);
      }
    },
    isPlaying: () => playing,
  };

  // Ensure preset dropdown stays in sync if present
  document.addEventListener('change', (e) => {
    const sel = e.target && e.target.id === 'lofiPresetSelect' ? e.target : null;
    if(!sel) return;
    const val = sel.value;
    if(val === 'custom') return;
    loadById(val, 1);
  });

  // Delegate: music buttons in timer/clock/pomodoro/stopwatch
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('#openMusicBtn, #openLofiBtn');
    if(t){ e.preventDefault(); openMusicModal(); }
  });

  // Initialize play button UI
  setPlayingUi();
})();


function openMusicModal() {
  const m = $('#musicModal');
  if (!m) return;
  m.classList.remove('hidden');

  const vid = String(state.audio.lofiVideoId || 'CFGLoQIhmow').trim() || 'CFGLoQIhmow';

  const preset = $('#lofiPresetSelect');
  if (preset) {
    const has = Array.from(preset.options).some(o => o.value === vid);
    preset.value = has ? vid : 'custom';
  }

  const input = $('#lofiUrlInput');
  if (input) input.value = `https://www.youtube.com/watch?v=${vid}`;

  const bgToggle = $('#lofiBgToggle');
  if (bgToggle) bgToggle.checked = !!state.audio.videoBgOn;

  // Top-bar volume slider
  const vol = $('#musicVol');
  if (vol) vol.value = String(clamp(Number(state.audio.ytVolume ?? 60), 0, 100));
  // Apply volume to the embed (best-effort)
  ytIframeCmd('setVolume', [clamp(Number(state.audio.ytVolume ?? 60), 0, 100)]);

  // Show the video in the modal, but keep it MUTED to avoid double audio.
  // If music is already playing, keep the preview playing too.
  const frame = $('#lofiFrame');
  if (frame) {
    const target = lofiPreviewUrlFromId(vid, state.audio.isPlaying ? 1 : 0);
    if (frame.src !== target) frame.src = target;
  }

  // Do not apply video background on open/startup.
  // Background should only become the LoFi video when the user explicitly loads a track
  // and has the "use video as background" toggle enabled.
}

function closeMusicModal() {
  const m = $('#musicModal');
  if (!m) return;
  m.classList.add('hidden');
}


  function saveSettingsFromModal() {
  // Guarded reads: settings modal isn't mounted on every route in some builds.
  const nameInput = $('#nameInput');
  const bgToggle = $('#bgToggle');
  const themeSel = $('#themeSelect');
  const musicSel = $('#musicSelect');

  if (nameInput) state.settings.displayName = nameInput.value || 'Student';
  if (bgToggle) state.settings.useVideoBg = !!bgToggle.checked;
  if (themeSel) state.settings.theme = themeSel.value || state.settings.theme || 'default';
  if (musicSel) state.settings.musicPreset = musicSel.value || state.settings.musicPreset;

  saveState();
  applyTheme();
  applyVideoBackground();
}


  // ------------------ TIMER ------------------

  let activeTimerTab = 'timer';

  // Stopwatch
  let swRunning = false;
  let swStartTs = 0;
  let swElapsedSec = 0;
  let swTick = null;
  let swLastChimedHour = 0;

  function swRender() {
    const cur = swRunning ? (swElapsedSec + (now() - swStartTs) / 1000) : swElapsedSec;

    // Optional session cap – prevents accidental runaway timers
    const capOn = (state.profile.stopwatchCapOn !== false);
    const capSec = clamp(Number(state.profile.stopwatchCapHours ?? 6), 1, 24) * 3600;
    const capBlock = $('#swCapBlock');
    if (capBlock) capBlock.classList.toggle('hidden', !capOn);

    if (capOn && swRunning && cur >= capSec) {
      swElapsedSec = capSec;
      swPause();
      toast('Stopwatch paused', `You reached the ${clamp(Number(state.profile.stopwatchCapHours ?? 6), 1, 24)} hour session cap.`);
      return;
    }

    // Hourly chime (every full hour while running)
    if (swRunning) {
      const hNow = Math.floor(cur / 3600);
      if (hNow >= 1 && hNow > swLastChimedHour) {
        swLastChimedHour = hNow;
        playNotifyTone('hour');
      }
    }

    const swDisp = $('#swDisplay');
    if (!swDisp) return; // view not mounted
    swDisp.textContent = formatHMS(cur);

    // Start/Pause button swap
    const sbtn = $('#swStart');
    const pbtn = $('#swPause');
    if (sbtn && pbtn) {
      sbtn.classList.toggle('hidden', swRunning);
      pbtn.classList.toggle('hidden', !swRunning);
      sbtn.disabled = swRunning;
      pbtn.disabled = !swRunning;
    }

    // Enable save after 1 minute
    const endBtn = $('#swEnd');
    if (endBtn) endBtn.disabled = cur < 60;

    // Progress bars (cap + weekly goal)
    const capOn2 = (state.profile.stopwatchCapOn !== false);
    const capSec2 = clamp(Number(state.profile.stopwatchCapHours ?? 6), 1, 24) * 3600;
    const capPct = capOn2 ? clamp((cur / capSec2) * 100, 0, 100) : 0;
    const capFill = $('#swCapFill');
    const capMeta = $('#swCapMeta');
    if (capFill) capFill.style.width = `${capPct}%`;
    if (capMeta) capMeta.textContent = `${Math.floor(capPct)}%`;

    const goalH = Number(state.profile.weeklyGoalHours || 0);
    const goalSec = goalH * 3600;
    const weekSavedSec = getTotals(state.sessions, 'week').totalSec;
    const weekNowSec = weekSavedSec + cur;
    const weekPct = goalSec > 0 ? clamp((weekNowSec / goalSec) * 100, 0, 100) : 0;

    const weekFill = $('#swWeekFill');
    const weekMeta = $('#swWeekMeta');
    if (weekFill) weekFill.style.width = `${weekPct}%`;
    if (weekMeta) weekMeta.textContent = goalSec > 0 ? `${Math.floor(weekPct)}%` : '—';
    refreshRunningTitle();
}

function swStart() {
    if (swRunning) return;
    swRunning = true;
    swStartTs = now();
    sessEnsureCtx();
    sessSyncAmbient();

    if (!swTick) {
      swTick = setInterval(swRender, 200);
    }
    swRender();
  }

  function swPause() {
    if (!swRunning) return;
    swElapsedSec += (now() - swStartTs) / 1000;
    swRunning = false;
    sessSyncAmbient();
    swRender();
  }

  function swReset() {
    swRunning = false;
    swStartTs = 0;
    swElapsedSec = 0;
    swLastChimedHour = 0;
    swRender();
    sessSyncAmbient();
  }

  function swEndAndSave() {
    if (swRunning) swPause();
    const dur = swElapsedSec;
      const reward = normalizeRewardMode(state.ui.worldView || 'island');
    const labelId = $('#swLabel').value || '';
    const label = labelId ? labelNameFromId(labelId) : '';

    const saved = saveSession({
      durationSec: dur,
      method: 'stopwatch',
      rewardMode: reward,
      label,
    });

    if (saved) {
      $('#swLabel').value = '';
      swReset();
    }
  }

  // Pomodoro
  const toInt = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : fallback;
  };

  const normalizePomSettings = (input = {}) => {
    const focusMin = clamp(toInt(input.focusMin, 25), 1, 180);
    const breakMin = clamp(toInt(input.breakMin, 5), 1, 60);
    const longBreakMin = clamp(toInt(input.longBreakMin, 15), 1, 120);
    const longEvery = clamp(toInt(input.longEvery, 4), 2, 12);
    return { focusMin, breakMin, longBreakMin, longEvery };
  };

  let pomSettings = normalizePomSettings(state.pomodoro);

  let pom = {
    phase: 'focus',
    session: 1,
    running: false,
    remainingSec: pomSettings.focusMin * 60,
    focusElapsedThisRun: 0,
    interval: null,
    focusStartedAt: 0,
  };

  function pomSetPhase(phase) {
    pom.phase = phase;
    $('#pomPhaseChip').textContent = phase === 'focus' ? 'Focus' : 'Break';
    $('#pomPhaseChip').className = 'chip';
    if (phase === 'break') {
      // tint
      $('#pomPhaseChip').style.borderColor = rgbaFromRGB(getThemeAccentRGB(),0.25);
      $('#pomPhaseChip').style.background = rgbaFromRGB(getThemeAccentRGB(),0.08);
    } else {
      $('#pomPhaseChip').style.borderColor = '';
      $('#pomPhaseChip').style.background = '';
    }
  }

  function pomRender() {
    if (pom.phase === 'focus') {
      $('#pomDisplay').textContent = formatMMSS(pom.remainingSec);
    } else {
      $('#pomDisplay').textContent = formatMMSS(pom.remainingSec);
    }

    $('#pomSessionCount').textContent = String(pom.session);

    // Save button
    const focusDur = pomSettings.focusMin * 60;
    const elapsed = (pom.phase === 'focus') ? (focusDur - pom.remainingSec) : 0;
    $('#pomSave').disabled = !(pom.phase === 'focus' && elapsed >= 60);
    refreshRunningTitle();
}

  function pomStart() {
    if (pom.running) return;
    pom.running = true;
    sessEnsureCtx();
    sessSyncAmbient();
    $('#pomStart').textContent = 'Pause';

    pom.interval = setInterval(() => {
      pom.remainingSec -= 1;
      if (pom.remainingSec <= 0) {
        pom.remainingSec = 0;
        pomRender();
        pomCompletePhase();
      } else {
        pomRender();
      }
    }, 1000);

    pomRender();
  }

  function pomPause() {
    if (!pom.running) return;
    pom.running = false;
    sessSyncAmbient();
    $('#pomStart').textContent = 'Start';
    if (pom.interval) clearInterval(pom.interval);
    pom.interval = null;
    pomRender();
  }

  function pomToggleStart() {
    if (pom.running) pomPause();
    else pomStart();
  }

  function pomReset() {
    pomPause();
    pomSetPhase('focus');
    pom.remainingSec = pomSettings.focusMin * 60;
    pom.session = 1;
    pomRender();
  }


  function openPomSettingsModal() {
    pomSettings = normalizePomSettings(state.pomodoro);

    const focusEl = $('#pomFocusInput');
    const shortEl = $('#pomShortInput');
    const longEl = $('#pomLongInput');
    const everyEl = $('#pomEveryInput');

    if (focusEl) focusEl.value = String(pomSettings.focusMin);
    if (shortEl) shortEl.value = String(pomSettings.breakMin);
    if (longEl) longEl.value = String(pomSettings.longBreakMin);
    if (everyEl) everyEl.value = String(pomSettings.longEvery);

    $('#pomSettingsModal')?.classList.remove('hidden');
  }

  function closePomSettingsModal() {
    $('#pomSettingsModal')?.classList.add('hidden');
  }

  function savePomSettingsModal() {
    const next = normalizePomSettings({
      focusMin: $('#pomFocusInput')?.value,
      breakMin: $('#pomShortInput')?.value,
      longBreakMin: $('#pomLongInput')?.value,
      longEvery: $('#pomEveryInput')?.value,
    });

    state.pomodoro = next;
    pomSettings = next;
    saveState();

    // Apply immediately (prevents "saving" mid-session settings changes)
    pomReset();
    closePomSettingsModal();
    toast('Pomodoro settings saved.');
  }


  function pomSkip() {
    // move to next phase without saving
    if (pom.phase === 'focus') {
      pomPause();
      pomSetPhase('break');
      pom.remainingSec = pomSettings.breakMin * 60;
    } else {
      pomPause();
      pomSetPhase('focus');
      pom.remainingSec = pomSettings.focusMin * 60;
      pom.session += 1;
    }
    pomRender();
  }

  function pomCompletePhase() {
    // called when timer hits 0
    playNotifyTone('pom');
    const focusDur = pomSettings.focusMin * 60;

    if (pom.phase === 'focus') {
      // auto-save a full focus session
      const reward = normalizeRewardMode(state.ui.worldView || 'island');
      const labelId = $('#pomLabel').value || '';
    const label = labelId ? labelNameFromId(labelId) : '';
      saveSession({ durationSec: focusDur, method: 'pomodoro', rewardMode: reward, label });

      // switch to break
      pomSetPhase('break');
      const isLong = (pom.session % pomSettings.longEvery === 0);
      pom.remainingSec = (isLong ? pomSettings.longBreakMin : pomSettings.breakMin) * 60;

      // keep running
      pomRender();
      return;
    }

    // phase break -> move to next focus
    pomSetPhase('focus');
    pom.session += 1;
    pom.remainingSec = pomSettings.focusMin * 60;
    pomRender();
  }

  function pomSaveFocusElapsed() {
    if (pom.phase !== 'focus') return;
    const focusDur = pomSettings.focusMin * 60;
    const elapsed = focusDur - pom.remainingSec;
    if (elapsed < 60) return;

    const reward = normalizeRewardMode(state.ui.worldView || 'island');
    const label = $('#pomLabel').value;

    const saved = saveSession({ durationSec: elapsed, method: 'pomodoro', rewardMode: reward, label });
    if (saved) {
      pomPause();
      pomSetPhase('focus');
      pom.remainingSec = pomSettings.focusMin * 60;
      pomRender();
      $('#pomLabel').value = '';
    }
  }

  // Countdown timer
  let cd = {
    running: false,
    totalSec: 25 * 60,
    remainingSec: 25 * 60,
    interval: null,
  };

  function cdReadInputsToTotal() {
    const h = clamp(Number($('#cdHours').value || 0), 0, 23);
    const m = clamp(Number($('#cdMinutes').value || 0), 0, 59);
    const s = clamp(Number($('#cdSeconds').value || 0), 0, 59);
    return h * 3600 + m * 60 + s;
  }

  function cdSetInputsFromTotal(totalSec) {
    totalSec = Math.max(0, Math.round(totalSec));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    $('#cdHours').value = String(h);
    $('#cdMinutes').value = String(m);
    $('#cdSeconds').value = String(s);
  }

  function cdRender() {
  const elapsed = Math.max(0, cd.totalSec - cd.remainingSec);
  const hasStarted = cd.totalSec > 0 && elapsed > 0;
  const finished = cd.totalSec > 0 && cd.remainingSec === 0;

  // Update time
  const display = $('#cdDisplay');
  if (display) display.textContent = formatHMS(cd.remainingSec);

  // Toggle panels (set vs running UI)
  const setPanel = $('#cdSetPanel');
  const runPanel = $('#cdRunPanel');
  const startRow = $('#cdStartRow');
  const runActions = $('#cdRunActions');
  const saveRow = $('#cdSaveRow');

  const inSetMode = !hasStarted && !cd.running;
  if (setPanel) setPanel.classList.toggle('hidden', !inSetMode);
  if (runPanel) runPanel.classList.toggle('hidden', inSetMode);
  if (startRow) startRow.classList.toggle('hidden', !inSetMode);
  if (runActions) runActions.classList.toggle('hidden', inSetMode);

  // Status
  const statusEl = $('#cdStatus');
  if (statusEl) {
    if (finished) statusEl.textContent = 'FINISHED';
    else if (cd.running) statusEl.textContent = 'IN PROGRESS';
    else if (hasStarted) statusEl.textContent = 'PAUSED';
    else statusEl.textContent = 'READY';
  }

  // Buttons
  const startBtn = $('#cdStart');
  const pauseBtn = $('#cdPause');
  const saveBtn = $('#cdSave');

  // Start button uses inputs directly (cd.totalSec can be 0 until start)
  if (startBtn) startBtn.disabled = cd.running || cdReadInputsToTotal() <= 0;

  if (pauseBtn) {
    pauseBtn.textContent = cd.running ? '⏸ Pause' : '▶ Resume';
    pauseBtn.disabled = !hasStarted || finished;
  }

  if (saveBtn) saveBtn.disabled = elapsed < 60;
  if (saveRow) saveRow.classList.toggle('hidden', cd.running || elapsed < 60);
  refreshRunningTitle();
}

function cdStart() {
  if (cd.running) return;

  // Start uses the inputs unless a countdown is already mid-way.
  if (cd.totalSec <= 0 || cd.remainingSec <= 0 || cd.remainingSec === cd.totalSec) {
    const total = cdReadInputsToTotal();
    if (total <= 0) {
      toast('Set a duration', 'Timer needs at least 1 second.');
      return;
    }
    cd.totalSec = total;
    cd.remainingSec = total;
  }

  if (cd.remainingSec <= 0) {
    toast('Set a duration', 'Timer needs at least 1 second.');
    return;
  }

  cd.running = true;
  sessEnsureCtx();
  sessSyncAmbient();

  if (cd.interval) clearInterval(cd.interval);
  cd.interval = setInterval(() => {
    cd.remainingSec -= 1;

    if (cd.remainingSec <= 0) {
      cd.remainingSec = 0;
      cd.running = false;
    sessSyncAmbient();
      if (cd.interval) clearInterval(cd.interval);
      cd.interval = null;
      cdRender();
      playNotifyTone('timer');
      toast('Timer finished', 'Nice work! Click “End & Save” to log the time.');
    } else {
      cdRender();
    }
  }, 1000);

  cdRender();
}

// Toggle Pause / Resume
function cdPause() {
  // Pause
  if (cd.running) {
    cd.running = false;
    if (cd.interval) clearInterval(cd.interval);
    cd.interval = null;
    cdRender();
    sessSyncAmbient();
    return;
  }

  // Resume
  const elapsed = Math.max(0, cd.totalSec - cd.remainingSec);
  if (elapsed <= 0 || cd.remainingSec <= 0 || cd.totalSec <= 0) return;

  cd.running = true;
  sessEnsureCtx();
  sessSyncAmbient();
  if (cd.interval) clearInterval(cd.interval);
  cd.interval = setInterval(() => {
    cd.remainingSec -= 1;

    if (cd.remainingSec <= 0) {
      cd.remainingSec = 0;
      cd.running = false;
      if (cd.interval) clearInterval(cd.interval);
      cd.interval = null;
      cdRender();
      playNotifyTone('timer');
      toast('Timer finished', 'Nice work! Click “End & Save” to log the time.');
    } else {
      cdRender();
    }
  }, 1000);

  cdRender();
}

  function cdReset() {
    if (cd.interval) clearInterval(cd.interval);
    cd.interval = null;
    cd.running = false;
    cd.totalSec = cdReadInputsToTotal();
    cd.remainingSec = cd.totalSec;
    $('#cdStart').disabled = false;
    $('#cdPause').disabled = true;
    cdRender();
    sessSyncAmbient();
  }

  function cdSaveAndReset() {
    if (cd.running) cdPause();

    const elapsed = Math.max(0, cd.totalSec - cd.remainingSec);
    const reward = normalizeRewardMode(($('#cdReward')?.value) || state.ui.worldView || 'island');
    const labelId = $('#cdLabel').value || '';
    const label = labelId ? labelNameFromId(labelId) : '';

    const saved = saveSession({ durationSec: elapsed, method: 'timer', rewardMode: reward, label });
    if (saved) {
      $('#cdLabel').value = '';
    }

    // reset
    cd.totalSec = cdReadInputsToTotal();
    cd.remainingSec = cd.totalSec;
    $('#cdSave').disabled = true;
    cdRender();
  }

  function syncRewardSelectorsFromWorldView() {
    const mode = normalizeRewardMode(state.ui.worldView || 'island');
    // Mode only affects what you *view* (progress is always synced).
    const sw = $('#swReward');
    const pom = $('#pomReward');
    const cd = $('#cdReward');

    // Only set a safe initial value; don't fight the user's active selection.
    if (sw && (!sw.value || !['island','garden'].includes(sw.value))) sw.value = mode;
    if (pom && (!pom.value || !['island','garden'].includes(pom.value))) pom.value = mode;
    if (cd && (!cd.value || !['island','garden'].includes(cd.value))) cd.value = mode;
  }

  function setTimerTab(tab) {
    activeTimerTab = tab;

    // buttons
    $$('[data-timer-tab]').forEach(btn => {
      const isActive = btn.dataset.timerTab === tab;
      btn.classList.toggle('segmented__btn--active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // views
    $$('[data-timer-view]').forEach(v => {
      v.classList.toggle('hidden', v.dataset.timerView !== tab);
    });

    // on switching to clock, update quote
    if (tab === 'clock') {
      const q = CLOCK_QUOTES[Math.floor(Math.random() * CLOCK_QUOTES.length)];
      $('#clockQuote').textContent = q.quote;
      // author line is the next sibling muted small line
      const authorP = $('#clockQuote').nextElementSibling;
      if (authorP) authorP.textContent = `— ${q.author}`;
    }
  }

  // ------------------ NAV CLOCK ------------------

  function renderNavClock() {
    const d = new Date();
    const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    $('#navClock').textContent = t;

    // clock page
    if ($('#clockTime')) {
      const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      $('#clockTime').textContent = time;

      const ampm = d.toLocaleTimeString(undefined, { hour: '2-digit' }).includes('AM') ? 'AM' :
                   d.toLocaleTimeString(undefined, { hour: '2-digit' }).includes('PM') ? 'PM' : '';
      // Some locales don't show AM/PM; we derive from hour
      const hr = d.getHours();
      const ampm2 = hr >= 12 ? 'PM' : 'AM';
      $('#clockAmPm').textContent = ampm || ampm2;

      $('#clockDate').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }
  }

function updateTimerHeaderClock() {
  // Keep title/nav clock in sync with any running timer.
  try { refreshRunningTitle(); } catch (e) {}
  try { renderNavClock(); } catch (e) {}
}


  // ------------------ EXPORT/IMPORT ------------------

  function exportState() {
    const filename = `bloomora_backup_${new Date().toISOString().slice(0,10)}.json`;
    downloadText(filename, JSON.stringify(state, null, 2));
    toast('Exported', 'Backup JSON downloaded.');
  }

  function importStateFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = safeParseJson(reader.result);
      if (!parsed.ok) {
        toast('Import failed', 'That file was not valid JSON.');
        return;
      }

      const incoming = parsed.value;
      // Basic validation
      if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.sessions)) {
        toast('Import failed', 'File structure did not look like a Bloomora backup.');
        return;
      }

      // Merge with defaults to avoid missing keys
      const d = defaultState();
      

      // Backward-compat: older backups may store Island/Garden progress as flat keys
      const legacyIslandXpSec =
        (incoming.island && (incoming.island.xpSec ?? incoming.island.xp_sec)) ??
        incoming.island_xp_sec ??
        incoming.profile?.island_xp_sec ??
        incoming.profile?.islandXpSec;

      const legacyGardenGrowthSec =
        (incoming.garden && (incoming.garden.growthSec ?? incoming.garden.growth_sec)) ??
        incoming.garden_growth_sec ??
        incoming.profile?.garden_growth_sec ??
        incoming.profile?.gardenGrowthSec;

      const legacyGardenTreeType =
        (incoming.garden && (incoming.garden.treeType ?? incoming.garden.tree_type)) ??
        incoming.garden_tree_type ??
        incoming.profile?.garden_tree_type;

      const legacyGardenHarvested =
        (incoming.garden && (incoming.garden.harvestedOnThisTree ?? incoming.garden.harvested_on_tree)) ??
        incoming.garden_harvested_on_tree ??
        incoming.profile?.garden_harvested_on_tree;

state = {
        ...d,
        ...incoming,
        profile: { ...d.profile, ...(incoming.profile || {}) },
        island: { ...d.island, ...(incoming.island || {}), ...(legacyIslandXpSec!=null ? { xpSec: Number(legacyIslandXpSec) } : {}) },
        garden: { ...d.garden, ...(incoming.garden || {}), ...(legacyGardenGrowthSec!=null ? { growthSec: Number(legacyGardenGrowthSec) } : {}), ...(legacyGardenTreeType ? { treeType: String(legacyGardenTreeType) } : {}), ...(legacyGardenHarvested!=null ? { harvestedOnThisTree: Number(legacyGardenHarvested) } : {}) },
        fruitCollection: { ...d.fruitCollection, ...(incoming.fruitCollection || {}), ...((incoming.fruit_collection && typeof incoming.fruit_collection==='object') ? incoming.fruit_collection : {}) },
        sessions: incoming.sessions,
      };

      saveState();
      renderAll();
      toast('Imported', 'Backup restored successfully.');
      if (sbSignedIn()) { sb.forcePushOnce = true; sbSaveMeta(); queueSyncSoon(50); }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    storage.removeItem(STORAGE_KEY);
    state = defaultState();
    saveState();

    // reset timers
    swReset();
    pomReset();
    cdReset();

    renderAll();
    toast('Reset complete', 'All local data cleared.');
  }

  // ------------------ RENDER ALL ------------------

  function renderAll() {
    pomSettings = normalizePomSettings(state.pomodoro);
    renderDashboard();
    renderIsland();
    renderGarden();
    renderLabels();
    renderStats();
    renderRoute();
  }

  // ------------------ EVENTS ------------------

  function bindEvents() {
    window.addEventListener('hashchange', renderRoute);



    // hero go buttons
    $$('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => setRoute(btn.dataset.go));
    });

    // year select
    on('#yearSelect', 'change', renderDashboardActivity);

    // month view toggle
    $$('[data-month-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        dashboardChartView = btn.dataset.monthView;
        renderDashboardActivity();
      });
    });

    on('#jumpToToday', 'click', () => {
      const yearSel = $('#yearSelect');
      if (yearSel) yearSel.value = String(new Date().getFullYear());
      renderDashboardActivity();
      toast('Jumped', 'Showing this year.');
    });

    // Settings modal
    on('#openSettings', 'click', openSettings);
    // Session ambient sounds modal
    on('#openSessionSound', 'click', () => { sessEnsureCtx(); sessOpenModal(); });
    on('#openAppSettings', 'click', openAppSettingsModal);
    on('#saveAppSettings', 'click', saveAppSettings);

on('#resetStatsBtn', 'click', () => {
  const ok = confirm('Reset all study stats? This will delete your session history and reset Island/Garden progress.');
  if (ok) resetStats();
});

// Delete individual sessions from the Dashboard "Recent sessions" list
on('#recentSessions', 'click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('.sessionDeleteBtn') : null;
  if (!btn) return;
  const id = btn.getAttribute('data-session-id') || '';
  const ok = confirm('Delete this study session? This will also reduce your progress.');
  if (ok) deleteSessionById(id);
});


    on('#settingsVideoVis', 'input', (e) => { const v = e.target.value; const out = $('#settingsVideoVisVal'); if (out) out.textContent = `${v}%`; });

    // Background image settings
    on('#settingsBgChoice', 'change', (e) => {
      const v = String(e.target.value || 'black');
      const row = $('#settingsBgUploadRow');
      if (row) row.classList.toggle('hidden', v !== 'custom');
    });
    on('#settingsBgUpload', 'change', async (e) => {
      try {
        const file = e.target.files && e.target.files[0];
if (!file) return;
// Keep uploads reasonably small so local storage doesn't break persistence.
const maxBytes = 900 * 1024; // ~0.9MB
if (file.size && file.size > maxBytes) {
  toast('Image too large', 'Please use an image under ~1MB (or resize it).');
  e.target.value = '';
  return;
}

        if (!String(file.type || '').startsWith('image/')) {
          toast('Unsupported file', 'Please choose an image file.');
          return;
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('read failed'));
          r.readAsDataURL(file);
        });
        state.profile.backgroundChoice = 'custom';
        // Store large image data separately to avoid breaking main state persistence.
        storage.setItem(CUSTOM_BG_KEY, dataUrl);
        applyBackgroundImage();
        saveState();
        toast('Background updated', 'Saved locally on this device.');
      } catch {
        toast('Couldn\'t load image', 'Try a different file.');
      }
    });
    // Label modal (create/close)
    on('#closeLabel', 'click', closeLabelModal);
    on('#cancelLabel', 'click', closeLabelModal);
    on('#createLabel', 'click', () => {
      const name = String($('#labelNameInput')?.value || '');
      const color = String($('#labelColorInput')?.value || '#a855f7');
      const ok = createLabel({ name, color });
      if (ok) closeLabelModal();
    });

    on('#manualAddBtn', 'click', manualAddSession);
    on('#saveSettings', 'click', saveSettingsFromModal);
    // Top-bar music controls
    on('#musicPrev', 'click', () => window.ytAudio?.prevTrack());
    on('#musicNext', 'click', () => window.ytAudio?.nextTrack());

    // Music modal footer close (explicit handler; some browsers swallow the delegated handler in rare cases)
    on('#musicModalFooterClose', 'click', closeMusicModal);


    // Close modals (generic)
    $$('[data-close-modal]').forEach(el => {
      el.addEventListener('click', () => {
        const t = el.dataset.closeModal;
        if (t === 'settings') closeSettings();
        if (t === 'appSettings') closeAppSettingsModal();
        if (t === 'account') closeAccountModal();
        if (t === 'label') closeLabelModal();
        if (t === 'tasks') closeTasksModal();
        if (t === 'sound') closeSoundModal();
        if (t === 'music') closeMusicModal();
        if (t === 'pom') closePomSettingsModal();
      });
    });

    // Back-compat: some markup uses data-close="<key>".
    $$('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-close');
        if (key === 'music') closeMusicModal();
        if (key === 'settings') closeSettings();
        if (key === 'tasks') closeTasksModal();
        if (key === 'sound') closeSoundModal();
        if (key === 'sessionSoundModal') sessCloseModal();
        if (key === 'label') closeLabelModal();
        if (key === 'appSettings') closeAppSettingsModal();
        if (key === 'pom') closePomSettingsModal();
      });
    })
    // Session ambient controls
    $$('input[name="sessAmbType"]').forEach(r => {
      r.addEventListener('change', () => {
        if (!state.profile.sessionAmbient) state.profile.sessionAmbient = { type: 'off', volume: 0.4 };
        state.profile.sessionAmbient.type = r.value;
        saveState();
        sessEnsureCtx();
        sessSyncAmbient();
      });
    });
    const ambVol = $('#sessAmbVol');
    if (ambVol) {
      ambVol.addEventListener('input', () => {
        if (!state.profile.sessionAmbient) state.profile.sessionAmbient = { type: 'off', volume: 0.4 };
        state.profile.sessionAmbient.volume = clamp01(Number(ambVol.value));
        saveState();
        sessEnsureCtx();
        sessSyncAmbient();
      });
    }

;

    // ESC closes modals
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#labelModal') && !$('#labelModal').classList.contains('hidden')) closeLabelModal();
      if ($('#appSettingsModal') && !$('#appSettingsModal').classList.contains('hidden')) closeAppSettingsModal();
      if ($('#settingsModal') && !$('#settingsModal').classList.contains('hidden')) closeSettings();
      if ($('#tasksModal') && !$('#tasksModal').classList.contains('hidden')) closeTasksModal();
      if ($('#soundModal') && !$('#soundModal').classList.contains('hidden')) closeSoundModal();
      if ($('#musicModal') && !$('#musicModal').classList.contains('hidden')) closeMusicModal();
      if ($('#pomSettingsModal') && !$('#pomSettingsModal').classList.contains('hidden')) closePomSettingsModal();
    });

    // Settings export/import/reset
    on('#settingsExport', 'click', exportState);
    on('#settingsImportFile', 'change', (e) => importStateFromFile(e.target.files?.[0]));
    on('#settingsReset', 'click', resetAll);

    // Dashboard export/import
    on('#exportJsonBtn', 'click', exportState);
    on('#importJsonBtn', 'click', () => $('#importFileHidden')?.click());
    on('#importFileHidden', 'change', (e) => importStateFromFile(e.target.files?.[0]));

    // Timer segmented
    $$('[data-timer-tab]').forEach(btn => {
      btn.addEventListener('click', () => setTimerTab(btn.dataset.timerTab));
    });

    // Remember which world view the user prefers to *see* (progress is always synced)
    const rememberWorldView = (val) => {
      const m = normalizeRewardMode(val);
      if (state.ui.worldView !== m) {
        state.ui.worldView = m;
        saveState();
      }
    };
    on('#cdReward', 'change', (e) => rememberWorldView(e.target.value));

    // Stopwatch events
    on('#swStart', 'click', swStart);
    on('#swPause', 'click', swPause);
    on('#swReset', 'click', swReset);
    on('#swEnd', 'click', swEndAndSave);

    // Pomodoro
    on('#pomStart', 'click', pomToggleStart);
    on('#pomReset', 'click', pomReset);
    on('#pomSkip', 'click', pomSkip);
    on('#pomSave', 'click', pomSaveFocusElapsed);

    on('#pomSettings', 'click', () => openPomSettingsModal());

    on('#pomSaveSettingsBtn', 'click', () => savePomSettingsModal());

    // Countdown
    ['cdHours','cdMinutes','cdSeconds'].forEach(id => {
      on('#' + id, 'change', () => {
        if (!cd.running) {
          cd.totalSec = cdReadInputsToTotal();
          cd.remainingSec = cd.totalSec;
          cdRender();
        }
      });
    });

    on('#cdStart', 'click', () => {
      cd.totalSec = cdReadInputsToTotal();
      if (cd.remainingSec !== cd.totalSec && !cd.running) {
        cd.remainingSec = cd.totalSec;
      }
      cdStart();
    });

    on('#cdPause', 'click', cdPause);
    on('#cdReset', 'click', cdReset);
    on('#cdSave', 'click', cdSaveAndReset);

    // Garden
    on('#treeTypeSelect', 'change', (e) => restartTree(e.target.value));
    on('#restartTree', 'click', () => restartTree($('#treeTypeSelect')?.value));
    on('#harvestBtn', 'click', harvestFruits);

    // Stats range
    $$('[data-stats-range]').forEach(btn => {
      btn.addEventListener('click', () => {
        statsRange = btn.dataset.statsRange;
        renderStats();
      });
    });

    // stats days
    $$('[data-days]').forEach(btn => {
      btn.addEventListener('click', () => {
        statsDays = Number(btn.dataset.days);
        renderStatsActivityChart();
      });
    });

    // -------- Labels --------
    on('#openLabelModal', 'click', openLabelModal);
    on('#openLabelModal2', 'click', openLabelModal);

    on('#labelsViewGrid', 'click', () => {
      state.labels.view = 'grid';
      saveState();
      renderLabels();
    });
    on('#labelsViewList', 'click', () => {
      state.labels.view = 'list';
      saveState();
      renderLabels();
    });
    on('#labelsSortName', 'click', () => {
      state.labels.sort = 'name';
      saveState();
      renderLabels();
    });
    on('#labelsSortDate', 'click', () => {
      state.labels.sort = 'date';
      saveState();
      renderLabels();
    });

    const labelsGrid = $('#labelsGrid');
    if (labelsGrid) {
      labelsGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-label-action]');
        if (!btn) return;
        const action = btn.dataset.labelAction;
        const id = btn.dataset.labelId;
        if (!id) return;

        if (action === 'fav') toggleLabelFavorite(id);
        if (action === 'del') {
          const name = getLabelById(id)?.name || 'this label';
          if (confirm(`Delete ${name}?`)) deleteLabel(id);
        }
      });
    }

// Timer dock (Tasks / Sounds / Music)
on('#openTasksBtn', 'click', openTasksModal);
on('#openSoundBtn', 'click', openSoundModal);
on('#openMusicBtn', 'click', openMusicModal);
on('#openLofiBtn', 'click', openMusicModal);
on('#studyRoomBtn', 'click', () => {
  setRoute(state.ui.worldView === 'garden' ? 'garden' : 'island');
});

// Fullscreen button (top bar)
on('#toggleFullscreen', 'click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (_) {
    // ignore
  }
});

// Tasks drawer
on('#openTasksBtn', 'click', () => {
  openTasksModal();
  // hydrate label dropdown each open
  hydrateLabelSelect('#taskLabel', true);
});

on('#closeTasks', 'click', closeTasksModal);
on('#tasksModal', 'click', (e) => {
  if (e.target && e.target.id === 'tasksModal') closeTasksModal();
});

on('#addTaskToggle', 'click', () => {
  const el = $('#taskComposer');
  if (!el) return;
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) setTimeout(() => $('#taskInput')?.focus(), 0);
});

on('#addTaskBtn', 'click', () => {
  const title = ($('#taskInput')?.value || '').trim();
  const desc = ($('#taskDesc')?.value || '').trim();
  const labelId = $('#taskLabel')?.value || '';
  addTask(title, desc, labelId);
  if ($('#taskInput')) $('#taskInput').value = '';
  if ($('#taskDesc')) $('#taskDesc').value = '';
});

on('#taskInput', 'keydown', (e) => {
  if (e.key !== 'Enter') return;
  const input = e.target;
  const desc = ($('#taskDesc')?.value || '').trim();
  const labelId = $('#taskLabel')?.value || '';
  addTask(input.value, desc, labelId);
  input.value = '';
});

on('#tasksList', 'change', (e) => {
  const t = e.target;
  if (!t || !t.matches('[data-task-toggle]')) return;
  const item = t.closest('[data-task-id]');
  if (!item) return;
  toggleTaskDone(item.getAttribute('data-task-id'), t.checked);
});

on('#tasksList', 'click', (e) => {
  const del = e.target.closest('[data-task-del]');
  if (!del) return;
  const item = del.closest('[data-task-id]');
  if (!item) return;
  deleteTask(item.getAttribute('data-task-id'));
});

on('#clearDoneTasks', 'click', clearDoneTasks);
on('#clearAllTasks', 'click', clearAllTasks);

// Sound modal controls
on('#snd_master', 'input', (e) => {
  state.audio.master = clamp01(Number(e.target.value));
  saveState();
  applyAudioState();
});

for (const k of AMBIENT_KEYS) {
  on(`#snd_${k}_on`, 'change', (e) => {
    state.audio.ambient[k].on = !!e.target.checked;
    saveState();
    applyAudioState();
  });

  on(`#snd_${k}_vol`, 'input', (e) => {
    state.audio.ambient[k].vol = clamp01(Number(e.target.value));
    saveState();
    applyAudioState();
  });
}

on('#snd_stop_all', 'click', () => {
  for (const k of AMBIENT_KEYS) state.audio.ambient[k].on = false;
  saveState();
  syncSoundModalUI();
  applyAudioState();
});


// Music modal
on('#lofiPresetSelect', 'change', (e) => {
  const val = String(e.target.value || '').trim();
  if (!val) return;

  if (val === 'custom') {
    const input = $('#lofiUrlInput');
    if (input) input.focus();
    return;
  }

  state.audio.lofiVideoId = val;
  state.audio.lofiEmbedUrl = lofiEmbedUrlFromId(val, 0);
  saveState();

  const input = $('#lofiUrlInput');
  if (input) input.value = `https://www.youtube.com/watch?v=${val}`;

  const frame = $('#lofiFrame');
  if (frame) frame.src = state.audio.lofiEmbedUrl;

  applyVideoBackground();
  toast('Loaded', 'LoFi track selected.');
});

on('#loadLofiBtn', 'click', () => {
  const preset = $('#lofiPresetSelect');
  const presetVal = preset ? String(preset.value || '').trim() : '';

  let vid = '';
  if (presetVal && presetVal !== 'custom') {
    vid = presetVal;
  } else {
    const input = $('#lofiUrlInput');
    vid = youtubeIdFromInput(input ? input.value : '');
  }

  if (!vid) {
    toast('Could not load', 'Paste a YouTube URL (or pick one from the dropdown).');
    return;
  }

  state.audio.lofiVideoId = vid;
  state.audio.lofiEmbedUrl = lofiEmbedUrlFromId(vid, 0);
  saveState();

  // Sync dropdown
  if (preset) {
    const has = Array.from(preset.options).some(o => o.value === vid);
    preset.value = has ? vid : 'custom';
  }

  const input = $('#lofiUrlInput');
  if (input) input.value = `https://www.youtube.com/watch?v=${vid}`;

  const frame = $('#lofiFrame');
  if (frame) frame.src = state.audio.lofiEmbedUrl;

  applyVideoBackground();
  toast('Loaded', 'LoFi stream updated.');
});

on('#lofiBgToggle', 'change', (e) => {
  state.audio.videoBgOn = !!e.target.checked;
  saveState();
  applyVideoBackground();
});
  }


  
// ------------------ BACKGROUND IMAGE ------------------
function applyBackgroundImage() {
  const el = document.getElementById('imageBg');
  if (!el) return;

  const choice = String(state?.profile?.backgroundChoice || 'black');
  let url = '';

  if (choice === 'black') {
    url = '';
  } else if (choice === 'custom') {
    const dataUrl = storage.getItem(CUSTOM_BG_KEY);
    if (dataUrl) url = dataUrl;
  } else {
    // Built-in assets live in assets/images as SVGs
    url = `assets/images/bg_${choice}.svg`;
  }

  if (url) {
    el.style.setProperty('--bg-image', `url("${url}")`);
  } else {
    el.style.setProperty('--bg-image', 'none');
  }
}

// ------------------ INIT ------------------

  function init() {
    bindEvents();
    ambientDockInit();

    // UI helpers
    setupColorGrids();
    hydrateLabelSelect('#habitLabelSelect', true);
    hydrateLabelSelect('#taskLabel', true);

    // theme
    applyTheme(state.profile.theme);
    initAmbientPanel();

    // background image
    applyBackgroundImage();

    // keep reward selectors aligned with last used world view
    syncRewardSelectorsFromWorldView();

    // initial
    setTimerTab('timer');
    swReset();
    pomReset();
    sessSyncAmbient();

    // Countdown default
    cd.totalSec = cdReadInputsToTotal();
    cd.remainingSec = cd.totalSec;
    cdRender();

    // clock
    renderNavClock();
    setInterval(renderNavClock, 1000);

    // initial render
    renderAll();
    // Supabase auth/sync init
    sbInit();

    // Auth / Sync UI handlers
    on('#openAccount', 'click', openAccountModal);
    on('#openAccountFromSettings', 'click', openAccountModal);

    // Account modal buttons
    on('#accountSignInBtn', 'click', async () => {
      const email = String(document.getElementById('accountEmail')?.value || '').trim();
      const pass = String(document.getElementById('accountPassword')?.value || '');
      if (!sb.ready) return toast('Sync unavailable', 'Supabase is not ready.');
      if (!email || !pass) return toast('Missing info', 'Enter email and password.');
      await authSignIn(email, pass);
    });

    on('#accountSignUpBtn', 'click', async () => {
      const email = String(document.getElementById('accountEmail')?.value || '').trim();
      const pass = String(document.getElementById('accountPassword')?.value || '');
      if (!sb.ready) return toast('Sync unavailable', 'Supabase is not ready.');
      if (!email || !pass) return toast('Missing info', 'Enter email and password.');
      if (pass.length < 6) return toast('Password too short', 'Use 6+ characters.');
      await authSignUp(email, pass);
    });

    on('#accountSignOutBtn', 'click', authSignOut);
    on('#authSignOutBtn', 'click', authSignOut);

    on('#accountSyncNowBtn', 'click', () => {
      if (!sbSignedIn()) return toast('Not signed in', 'Sign in to sync.');
      queueSyncSoon(50);
    });
    on('#syncNowBtn', 'click', () => {
      if (!sbSignedIn()) return toast('Not signed in', 'Sign in to sync.');
      queueSyncSoon(50);
    });
    on('#syncNowBtn2', 'click', () => {
      if (!sbSignedIn()) return toast('Not signed in', 'Sign in to sync.');
      queueSyncSoon(50);
    });

if (storageBlocked) {
      toast('Storage blocked', 'Your browser blocked local saving for file:// pages. Run Bloomora from a local web server (http://localhost) to persist your data.');
    }

    applyVideoBackground();
  }

  function setupColorGrids() {
    const colors = [
      '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308',
      '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#a855f7', '#f43f5e',
    ];

    const makeGrid = (gridId, inputId) => {
      const grid = $(gridId);
      const input = $(inputId);
      if (!grid || !input) return;
      grid.innerHTML = '';
      colors.forEach(c => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'colorSwatch';
        b.style.background = c;
        b.setAttribute('aria-label', `Choose ${c}`);
        b.addEventListener('click', () => {
          input.value = c;
          [...grid.querySelectorAll('.colorSwatch')].forEach(x => x.classList.remove('colorSwatch--active'));
          b.classList.add('colorSwatch--active');
        });
        grid.appendChild(b);
      });
      // mark current
      const current = input.value || colors[0];
      const btns = [...grid.querySelectorAll('.colorSwatch')];
      const hit = btns.find(b => b.style.background.replace(/\s/g,'') === current);
      (hit || btns[0])?.classList.add('colorSwatch--active');
    };

    makeGrid('#habitColorGrid', '#habitColorInput');
    makeGrid('#labelColorGrid', '#labelColorInput');
  }

  // expose minimal globals for external modules
  window.__bloomora = { state, persist, openSettings, qs: $ };

  // Boot the app. If something goes wrong, surface the error instead of a blank screen.
  try {
    init();
  } catch (e) {
    console.error('Bloomora boot error:', e);
    // Ensure at least the dashboard is visible as a fallback
    try {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const dash = document.getElementById('page-dashboard');
      if (dash) dash.classList.add('active');
    } catch {}

    const host = document.getElementById('app') || document.body;
    const box = document.createElement('div');
    box.style.cssText = 'max-width:900px;margin:24px auto;padding:16px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:#0b0b0b;color:#fff;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;';
    box.innerHTML = `
      <h2 style="margin:0 0 8px;font-size:18px">Something went wrong while loading Bloomora</h2>
      <div style="opacity:.8;font-size:13px;line-height:1.4">Open DevTools → Console for details. Error:</div>
      <pre style="white-space:pre-wrap;margin:10px 0 0;padding:10px;border-radius:10px;background:#000;border:1px solid rgba(255,255,255,.10);font-size:12px;line-height:1.35;">${(e && (e.stack || e.message)) ? String(e.stack || e.message) : String(e)}</pre>
    `;
    host.prepend(box);
  }
})();

// YouTube audio controller (for top-bar play/pause/skip)
  const LOFI_TRACKS = [
    { title: "LoFi Girl — 1", id: "CFGLoQIhmow" },
    { title: "LoFi Girl — 2", id: "4xDzrJKXOOY" },
    { title: "LoFi Girl — 3", id: "CBSlu_VMS9U" },
    { title: "LoFi Girl — 4", id: "cyzx45mupcQ" },
    { title: "LoFi Girl — 5", id: "Z_8f5IWuTFg" },
    { title: "LoFi Girl — 6", id: "A8yjETPcZeA" },
    { title: "LoFi Girl — 7", id: "UJs6__K7gSY" },
    { title: "LoFi Girl — 8", id: "8b3fqIBrNW0" },
  ];

  let ytPlayer = null;
  let ytReady = false;

  function getTrackIndexById(id){
    const i = LOFI_TRACKS.findIndex(t=>t.id===id);
    return i>=0?i:0;
  }
  function setNowPlayingUI(){
    const now = window.__bloomora.qs('#musicNow');
    if (now) {
      const idx = getTrackIndexById(window.__bloomora.state.audio.lofiVideoId);
      now.textContent = LOFI_TRACKS[idx]?.title || "LoFi";
    }
    const playBtn = window.__bloomora.qs('#musicPlay');
    if (playBtn) playBtn.textContent = window.__bloomora.state.audio.isPlaying ? "⏸" : "▶";
  }

  // Called by the YouTube iframe API (see index.html)
  window.onYouTubeIframeAPIReady = function(){
    const host = document.getElementById('ytAudioHost');
    if (!host) return;
    try{
      ytPlayer = new YT.Player('ytAudioHost', {
        height: '0',
        width: '0',
        videoId: window.__bloomora.state.audio.lofiVideoId || LOFI_TRACKS[0].id,
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: (location.origin && location.origin.startsWith("http")) ? location.origin : undefined
        },
        events: {
          onReady: () => { ytReady = true; setNowPlayingUI(); },
          onStateChange: (e) => {
            // 1 playing, 2 paused, 0 ended
            if (e.data === 1) window.__bloomora.state.audio.isPlaying = true;
            if (e.data === 2 || e.data === 0) window.__bloomora.state.audio.isPlaying = false;
            if (e.data === 0) nextTrack();
            try{ window.__bloomora.applyVideoBackground(); }catch(_e){}
            window.__bloomora.persist();
            setNowPlayingUI();
          }
        }
      });
    }catch(err){
      console.warn('YouTube API init failed', err);
    }
  };

  function loadTrackById(id, autoplay=true){
    window.__bloomora.state.audio.lofiVideoId = id;
    window.__bloomora.state.audio.lofiEmbedUrl = toEmbedFromId(id, autoplay);
    window.__bloomora.state.audio.isPlaying = !!autoplay;
    window.__bloomora.persist();
    setNowPlayingUI();

    // Update the visible iframe preview (in Settings modal) if present
    const frame = window.__bloomora.qs('#lofiFrame');
    if (frame) frame.src = window.__bloomora.state.audio.lofiEmbedUrl;

    try{ window.__bloomora.applyVideoBackground(); }catch(_e){}

    // Update the audio player
    if (ytReady && ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      if (autoplay) ytPlayer.loadVideoById(id);
      else ytPlayer.cueVideoById(id);
    }
  }

  function nextTrack(){
    const idx = getTrackIndexById(window.__bloomora.state.audio.lofiVideoId);
    const next = LOFI_TRACKS[(idx+1)%LOFI_TRACKS.length].id;
    loadTrackById(next, true);
  }
  function prevTrack(){
    const idx = getTrackIndexById(window.__bloomora.state.audio.lofiVideoId);
    const prev = LOFI_TRACKS[(idx-1+LOFI_TRACKS.length)%LOFI_TRACKS.length].id;
    loadTrackById(prev, true);
  }
  function togglePlay(){
    if (!ytReady || !ytPlayer) {
      // Fallback: open settings modal so user can press play inside the embed.
      window.__bloomora.openSettings();
      return;
    }
    const st = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1;
    if (st === 1) ytPlayer.pauseVideo();
    else ytPlayer.playVideo();
  }

  window.ytAudio_api = { loadTrackById, nextTrack, prevTrack, togglePlay, setNowPlayingUI, LOFI_TRACKS };
