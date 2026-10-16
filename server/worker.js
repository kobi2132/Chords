// אקורדי – שרת סטטיסטיקה ומשובים (Cloudflare Worker + D1)
// חיבורים נדרשים בהגדרות ה-Worker:
//   DB          – חיבור (Binding) למסד D1 בשם akordi
//   OWNER_EMAIL – סוד (Secret): המייל של בעל האפליקציה. רק מי שמחובר לגוגל עם המייל הזה מקבל את הנתונים.
//   TG_TOKEN    – סוד (Secret, לא חובה): מפתח של בוט טלגרם, להתראה על פנייה חדשה. ההתראה כוללת רק את סוג הפנייה.
// לא נשמרים: מייל (חוץ ממשוב שהמשתמש בחר לצרף אליו מייל), שם, כתובת IP או תוכן שירים.

const ORIGINS = ['https://kobi2132.github.io', 'https://akordi-dev.pages.dev', 'http://localhost:8765', 'http://localhost:8766'];
const DAY_MS = 864e5;
let BETA_SRV = false; // נקבע לפי כתובת השרת – אותו קוד משמש את השרת האמיתי ואת שרת הבדיקות
// כל התאריכים לפי שעון ישראל
const IL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const ilDay = ms => IL.format(new Date(ms));
const today = () => ilDay(Date.now());
const dayAgo = n => ilDay(Date.now() - n * DAY_MS);
const KINDS = { idea: 'רעיון לשיפור', bug: 'משהו לא עובד', fb: 'מחשבות ופידבק', other: 'אחר' };
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : null);
const int = x => (Number.isFinite(+x) ? Math.max(0, Math.min(1e6, Math.round(+x))) : null);
const flag = x => (x ? 1 : 0);
// אובייקט קטן של מונים {שם: מספר}
function counters(o, maxKeys) {
  const r = {};
  if (o && typeof o === 'object') for (const k of Object.keys(o).slice(0, maxKeys || 40)) { const v = int(o[k]); if (v) r[k.slice(0, 24)] = v; }
  return r;
}

function cors(req) {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) || /^https:\/\/([a-z0-9-]+\.)?akordi[a-z0-9-]*\.pages\.dev$/.test(o || '') ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (req, data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) } });

// בדיקה מול גוגל שהבקשה באה מבעל האפליקציה
async function isOwner(req, env) {
  const a = req.headers.get('Authorization') || '';
  if (!a.startsWith('Bearer ') || !env.OWNER_EMAIL) return false;
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: a } });
    if (!r.ok) return false;
    const u = await r.json();
    return !!u.email && u.email_verified !== false && u.email.toLowerCase() === env.OWNER_EMAIL.trim().toLowerCase();
  } catch (e) { return false; }
}

async function ping(req, env, b) {
  const id = str(b.id, 40);
  if (!id || !/^[a-z0-9-]{8,40}$/i.test(id)) return json(req, { ok: false }, 400);
  const d = today(), cc = str((req.cf && req.cf.country) || '', 2);
  const uk = typeof b.u === 'string' && /^[a-f0-9]{32}$/.test(b.u) ? b.u : null, me = flag(b.me);
  const ev = counters(b.ev, 40), bn = {};
  // באנרים: כל שם קצר באותיות לטיניות (inst, login, help, upd…) – כך באנר חדש לא דורש עדכון שרת
  if (b.bn && typeof b.bn === 'object') for (const k of Object.keys(b.bn).slice(0, 8)) if (/^[a-z]{2,10}$/.test(k) && b.bn[k]) bn[k] = counters(b.bn[k], 5);
  const st = [
    // u: קוד מוצפן חד-כיווני של משתמש מחובר (אותו קוד בכל המכשירים שלו). מכשיר שהתחבר פעם נשאר משויך למשתמש
    // dev: מכשיר של בעל האפליקציה (לא נספר בסטטיסטיקה, אלא אם בוחרים "כולל אותי")
    env.DB.prepare('INSERT INTO devices (id, first, last, u, dev) VALUES (?1, ?2, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET last = ?2, u = COALESCE(?3, u), dev = MAX(dev, ?4)').bind(id, d, uk, me),
    env.DB.prepare(`INSERT INTO daily (day,id,v,dv,os,br,cc,st,li,dk,ins,ns,nf,he,en,ev,bn) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
      ON CONFLICT(day,id) DO UPDATE SET v=?3,dv=?4,os=?5,br=?6,cc=?7,st=?8,li=?9,dk=?10,ins=?11,ns=?12,nf=?13,he=?14,en=?15,ev=?16,bn=?17`)
      .bind(d, id, str(b.v, 16), str(b.dv, 12), str(b.os, 12), str(b.br, 20), cc, flag(b.st), flag(b.li), flag(b.dk), str(b.ins, 1),
        int(b.ns), int(b.nf), int(b.he), int(b.en), JSON.stringify(ev), JSON.stringify(bn)),
  ];
  if (Array.isArray(b.er)) for (const m of b.er.slice(0, 10)) {
    const msg = str(m, 200); if (!msg) continue;
    st.push(env.DB.prepare('INSERT INTO errs (day,msg,v,me,n) VALUES (?1,?2,?3,?4,1) ON CONFLICT(day,msg,v,me) DO UPDATE SET n=n+1').bind(d, msg, str(b.v, 16) || '', me));
  }
  await env.DB.batch(st);
  // ניקוי: מכשירים שלא נראו שנה, ונתונים יומיים ושגיאות בני יותר מ-400 יום (פעם ביום בערך)
  if (Math.random() < 0.02) await env.DB.batch([
    env.DB.prepare('DELETE FROM devices WHERE last < ?1').bind(dayAgo(365)),
    env.DB.prepare('DELETE FROM daily WHERE day < ?1').bind(dayAgo(400)),
    env.DB.prepare('DELETE FROM errs WHERE day < ?1').bind(dayAgo(400)),
  ]);
  return json(req, { ok: true, msg: await activeMsg(env) });
}

// הודעה לכל המשתמשים: מוצגת רק בין זמן ההתחלה (since) לזמן הסיום (until)
async function activeMsg(env) {
  const m = await env.DB.prepare('SELECT mid, text, since, until FROM msg WHERE k=1').first();
  const t = Date.now();
  return m && (!m.since || m.since <= t) && (!m.until || m.until > t) ? { mid: m.mid, text: m.text, until: m.until } : null;
}
async function kvGet(env, k) { const r = await env.DB.prepare('SELECT v FROM kv WHERE k=?1').bind(k).first(); return r ? r.v : null; }
async function tgSend(env, chat, text) {
  if (BETA_SRV) text = '🧪 [בדיקה] ' + text;
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
  return r.ok;
}
// התראה בטלגרם על פנייה חדשה – רק הסוג, בלי התוכן
async function notify(env, kind) {
  try { if (!env.TG_TOKEN) return; const chat = await kvGet(env, 'tg_chat'); if (chat) await tgSend(env, chat, '📩 פנייה חדשה באקורדי: ' + (KINDS[kind] || 'אחר')); } catch (e) {}
}
async function feedback(req, env, b, ctx) {
  const text = str(b.text, 2000), id = str(b.id, 40);
  if (!text || !text.trim()) return json(req, { ok: false }, 400);
  if (id) { // עד 5 משובים ביום ממכשיר אחד
    const c = await env.DB.prepare('SELECT COUNT(*) n FROM feedback WHERE id=?1 AND ts>?2').bind(id, Date.now() - DAY_MS).first();
    if (c && c.n >= 5) return json(req, { ok: false, err: 'limit' }, 429);
  }
  const email = str(b.email, 120);
  const kind = KINDS[b.kind] ? b.kind : 'other';
  await env.DB.prepare('INSERT INTO feedback (ts,id,v,text,email,kind) VALUES (?1,?2,?3,?4,?5,?6)')
    .bind(Date.now(), id, str(b.v, 16), text.trim(), email && /\S+@\S+\.\S+/.test(email) ? email.trim() : null, kind).run();
  if (ctx && ctx.waitUntil) ctx.waitUntil(notify(env, kind)); else await notify(env, kind);
  return json(req, { ok: true });
}

// משתמש = משתמש רשום (לפי הקוד שלו, בכל המכשירים) או מכשיר של משתמש לא רשום
const K = "COALESCE(v.u, 'd:' || v.id)";
// days: טווח הזמן לגרפים ולפילוחים (1 = היום / 7 / 30 / 90, או 0 = הכל). me: לכלול את המכשירים של בעל האפליקציה
async function stats(env, days, me) {
  const D = env.DB, t = today(), d7 = dayAgo(6), d30 = dayAgo(29), from = days ? dayAgo(days - 1) : '0000-00-00';
  const one = async (sql, ...a) => (await D.prepare(sql).bind(...a).first()) || {};
  const all = async (sql, ...a) => (await D.prepare(sql).bind(...a).all()).results || [];
  const DV = me ? 'devices' : '(SELECT * FROM devices WHERE dev = 0)', EM = me ? '' : ' AND me = 0';
  const J = `FROM daily d JOIN ${DV} v ON v.id = d.id`;
  // לכל מכשיר שהיה פעיל בטווח – הסיכום האחרון שלו
  const LD = `SELECT d.* ${J} JOIN (SELECT id, MAX(day) md FROM daily WHERE day >= ?1 GROUP BY id) x ON d.id = x.id AND d.day = x.md`;
  // לכל משתמש שהיה פעיל בטווח – הסיכום האחרון שלו (מכל מכשיר)
  const LU = `SELECT * FROM (SELECT d.*, ${K} k, (v.u IS NOT NULL) reg, ROW_NUMBER() OVER (PARTITION BY ${K} ORDER BY d.day DESC) rn ${J} WHERE d.day >= ?1) WHERE rn = 1`;
  const byD = col => all(`SELECT ${col} k, COUNT(*) n FROM (${LD}) GROUP BY ${col} ORDER BY n DESC LIMIT 20`, from);
  const US = `SELECT ${K} k, MIN(v.first) f, MAX(v.u IS NOT NULL) r FROM ${DV} v GROUP BY ${K}`;
  const ret = n => one(`WITH us AS (${US})
    SELECT COUNT(*) n, SUM(EXISTS(SELECT 1 FROM daily d JOIN devices v ON v.id = d.id WHERE ${K} = us.k AND d.day >= date(us.f, '+${n} day'))) r
    FROM us WHERE f BETWEEN ?1 AND ?2`, dayAgo(n === 7 ? 60 : 120), dayAgo(n + 1));
  const [rng, act, total, new7, first, series, newS, ret7, ret30, dv, os, br, cc, v, ins, dflags, uflags, content, evRows, bnRows, errs, fbOpen] = await Promise.all([
    one(`SELECT COUNT(DISTINCT ${K}) n, COUNT(DISTINCT v.u) r ${J} WHERE d.day>=?1`, from),
    one(`SELECT COUNT(DISTINCT CASE WHEN d.day=?1 THEN ${K} END) dau, COUNT(DISTINCT CASE WHEN d.day=?1 THEN v.u END) dauR,
      COUNT(DISTINCT CASE WHEN d.day>=?2 THEN ${K} END) wau, COUNT(DISTINCT CASE WHEN d.day>=?2 THEN v.u END) wauR,
      COUNT(DISTINCT ${K}) mau, COUNT(DISTINCT v.u) mauR ${J} WHERE d.day>=?3`, t, d7, d30),
    one(`SELECT COUNT(DISTINCT ${K}) n, COUNT(DISTINCT v.u) r, COUNT(*) dev, SUM(v.u IS NOT NULL) devR FROM ${DV} v`),
    one(`SELECT COUNT(*) n FROM (${US}) WHERE f >= ?1`, d7),
    one(`SELECT MIN(d.day) day ${J}`),
    all(`SELECT d.day day, COUNT(DISTINCT ${K}) n, COUNT(DISTINCT v.u) r ${J} WHERE d.day>=?1 GROUP BY d.day ORDER BY d.day`, from),
    all(`SELECT f day, COUNT(*) n, SUM(r) r FROM (${US}) WHERE f>=?1 GROUP BY f ORDER BY f`, from),
    ret(7), ret(30),
    byD('dv'), byD('os'), byD('br'), byD('cc'), byD('v'),
    all(`SELECT ins k, COUNT(*) n FROM (${LU}) GROUP BY ins ORDER BY n DESC`, from),
    one(`SELECT COUNT(*) n, SUM(st) st, SUM(dk) dk FROM (${LD})`, from),
    one(`SELECT COUNT(*) n, SUM(reg) li FROM (${LU})`, from),
    one(`SELECT AVG(ns) ns, AVG(nf) nf, SUM(he) he, SUM(en) en, MAX(ns) mx FROM (${LU})`, from),
    all(`SELECT j.key k, SUM(j.value) n, COUNT(DISTINCT ${K}) u ${J}, json_each(d.ev) j WHERE d.day>=?1 GROUP BY j.key ORDER BY u DESC`, from),
    all(`SELECT b.key k, s.key a, SUM(s.value) n ${J}, json_each(d.bn) b, json_each(b.value) s WHERE d.day>=?1 GROUP BY b.key, s.key`, from),
    all(`SELECT msg, v, SUM(n) n, MAX(day) last FROM errs WHERE day>=?1${EM} GROUP BY msg, v ORDER BY n DESC LIMIT 30`, from),
    one('SELECT COUNT(*) n FROM feedback WHERE done=0'),
  ]);
  const bn = {};
  for (const r of bnRows) (bn[r.k] = bn[r.k] || {})[r.a] = r.n;
  return {
    at: Date.now(), today: t, days, me: !!me, first: first.day || null,
    range: rng, active: act, total, new7: new7.n || 0, series, newS,
    ret: { d7: ret7, d30: ret30 },
    by: { dv, os, br, cc, v, ins },
    flags: { n: dflags.n || 0, st: dflags.st || 0, dk: dflags.dk || 0, un: uflags.n || 0, li: uflags.li || 0 },
    content, ev: evRows, bn, errs, fbOpen: fbOpen.n || 0,
  };
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    const url = new URL(req.url), p = url.pathname.replace(/\/+$/, '') || '/';
    // שרת הבדיקות (akordi-dev) – כל התראה בטלגרם מסומנת "בדיקה"
    BETA_SRV = url.hostname.startsWith('akordi-dev');
    try {
      if (p === '/') return json(req, { ok: true, app: 'akordi' });
      // הודעה לכל המשתמשים – גם למי שכיבה את שליחת נתוני השימוש
      if (p === '/msg' && req.method === 'GET') {
        return json(req, { msg: await activeMsg(env) });
      }
      if (req.method === 'POST' && (p === '/ping' || p === '/feedback')) {
        const len = +(req.headers.get('Content-Length') || 0);
        if (len > 20000) return json(req, { ok: false }, 413);
        let b; try { b = await req.json(); } catch (e) { return json(req, { ok: false }, 400); }
        return p === '/ping' ? ping(req, env, b || {}) : feedback(req, env, b || {}, ctx);
      }
      if (p.startsWith('/admin/')) {
        if (!(await isOwner(req, env))) return json(req, { ok: false, err: 'auth' }, 403);
        if (p === '/admin/stats') {
          const dd = [1, 7, 30, 90, 0].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 30;
          return json(req, await stats(env, dd, url.searchParams.get('me') === '1'));
        }
        if (p === '/admin/tg' && req.method === 'GET') return json(req, { token: !!env.TG_TOKEN, linked: !!(await kvGet(env, 'tg_chat')) });
        if (p === '/admin/feedback' && req.method === 'GET')
          return json(req, (await env.DB.prepare('SELECT fid, ts, v, text, email, done, kind FROM feedback ORDER BY done, ts DESC LIMIT 300').all()).results);
        if (req.method === 'POST') {
          const b = await req.json().catch(() => ({}));
          if (p === '/admin/feedback/done') { await env.DB.prepare('UPDATE feedback SET done=?2 WHERE fid=?1').bind(int(b.fid), flag(b.done)).run(); return json(req, { ok: true }); }
          if (p === '/admin/feedback/del') { await env.DB.prepare('DELETE FROM feedback WHERE fid=?1').bind(int(b.fid)).run(); return json(req, { ok: true }); }
          // חיבור טלגרם: הצ'אט האחרון ששלח הודעה לבוט נשמר כיעד להתראות
          if (p === '/admin/tg-link') {
            if (!env.TG_TOKEN) return json(req, { ok: false, err: 'no_token' });
            const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/getUpdates`);
            if (!r.ok) return json(req, { ok: false, err: 'bad_token' });
            const ups = ((await r.json()).result || []).map(x => x.message || x.edited_message).filter(m => m && m.chat && m.chat.type === 'private');
            const m = ups[ups.length - 1];
            if (!m) return json(req, { ok: false, err: 'no_message' });
            await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind('tg_chat', String(m.chat.id)).run();
            await tgSend(env, m.chat.id, '✅ אקורדי מחוברת. מעכשיו תקבל כאן התראה על כל פנייה חדשה.');
            return json(req, { ok: true, name: m.chat.first_name || '' });
          }
          if (p === '/admin/tg-test') {
            const chat = await kvGet(env, 'tg_chat');
            if (!env.TG_TOKEN || !chat) return json(req, { ok: false, err: 'not_linked' });
            return json(req, { ok: await tgSend(env, chat, '🔔 בדיקה מאקורדי: ההתראות עובדות.') });
          }
          if (p === '/admin/msg') {
            if (!b.text) await env.DB.prepare('DELETE FROM msg').run();
            else {
              const ts = x => (Number.isFinite(+x) && +x > 0 ? Math.round(+x) : null);
              await env.DB.prepare('INSERT INTO msg (k,mid,text,since,until) VALUES (1,?1,?2,?3,?4) ON CONFLICT(k) DO UPDATE SET mid=?1,text=?2,since=?3,until=?4')
                .bind(Date.now(), str(b.text, 500), ts(b.since), ts(b.until)).run();
            }
            return json(req, { ok: true });
          }
        }
        if (p === '/admin/msg') return json(req, await env.DB.prepare('SELECT mid, text, since, until FROM msg WHERE k=1').first());
      }
      return json(req, { ok: false }, 404);
    } catch (e) {
      return json(req, { ok: false, err: 'server', detail: String((e && e.message) || e).slice(0, 300) }, 500);
    }
  },
};
