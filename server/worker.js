// אקורדי – שרת סטטיסטיקה ומשובים (Cloudflare Worker + D1)
// חיבורים נדרשים בהגדרות ה-Worker:
//   DB          – חיבור (Binding) למסד D1 בשם akordi
//   OWNER_EMAIL – סוד (Secret): המייל של בעל האפליקציה. רק מי שמחובר לגוגל עם המייל הזה מקבל את הנתונים.
// לא נשמרים: מייל (חוץ ממשוב שהמשתמש בחר לצרף אליו מייל), שם, כתובת IP או תוכן שירים.

const ORIGINS = ['https://kobi2132.github.io', 'http://localhost:8765'];
const DAY_MS = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const dayAgo = n => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
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
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
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
  const uk = typeof b.u === 'string' && /^[a-f0-9]{32}$/.test(b.u) ? b.u : null;
  const ev = counters(b.ev, 40), bn = {};
  if (b.bn && typeof b.bn === 'object') for (const k of ['inst', 'login', 'upd']) if (b.bn[k]) bn[k] = counters(b.bn[k], 5);
  const st = [
    // u: קוד מוצפן חד-כיווני של משתמש מחובר (אותו קוד בכל המכשירים שלו). מכשיר שהתחבר פעם נשאר משויך למשתמש
    env.DB.prepare('INSERT INTO devices (id, first, last, u) VALUES (?1, ?2, ?2, ?3) ON CONFLICT(id) DO UPDATE SET last = ?2, u = COALESCE(?3, u)').bind(id, d, uk),
    env.DB.prepare(`INSERT INTO daily (day,id,v,dv,os,br,cc,st,li,dk,ins,ns,nf,he,en,ev,bn) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
      ON CONFLICT(day,id) DO UPDATE SET v=?3,dv=?4,os=?5,br=?6,cc=?7,st=?8,li=?9,dk=?10,ins=?11,ns=?12,nf=?13,he=?14,en=?15,ev=?16,bn=?17`)
      .bind(d, id, str(b.v, 16), str(b.dv, 12), str(b.os, 12), str(b.br, 20), cc, flag(b.st), flag(b.li), flag(b.dk), str(b.ins, 1),
        int(b.ns), int(b.nf), int(b.he), int(b.en), JSON.stringify(ev), JSON.stringify(bn)),
  ];
  if (Array.isArray(b.er)) for (const m of b.er.slice(0, 10)) {
    const msg = str(m, 200); if (!msg) continue;
    st.push(env.DB.prepare('INSERT INTO errors (day,msg,v,n) VALUES (?1,?2,?3,1) ON CONFLICT(day,msg,v) DO UPDATE SET n=n+1').bind(d, msg, str(b.v, 16) || ''));
  }
  await env.DB.batch(st);
  // ניקוי: מכשירים שלא נראו שנה, ונתונים יומיים ושגיאות בני יותר מ-400 יום (פעם ביום בערך)
  if (Math.random() < 0.02) await env.DB.batch([
    env.DB.prepare('DELETE FROM devices WHERE last < ?1').bind(dayAgo(365)),
    env.DB.prepare('DELETE FROM daily WHERE day < ?1').bind(dayAgo(400)),
    env.DB.prepare('DELETE FROM errors WHERE day < ?1').bind(dayAgo(400)),
  ]);
  const m = await env.DB.prepare('SELECT mid, text, until FROM msg WHERE k=1').first();
  return json(req, { ok: true, msg: m && (!m.until || m.until > Date.now()) ? m : null });
}

async function feedback(req, env, b) {
  const text = str(b.text, 2000), id = str(b.id, 40);
  if (!text || !text.trim()) return json(req, { ok: false }, 400);
  if (id) { // עד 5 משובים ביום ממכשיר אחד
    const c = await env.DB.prepare('SELECT COUNT(*) n FROM feedback WHERE id=?1 AND ts>?2').bind(id, Date.now() - DAY_MS).first();
    if (c && c.n >= 5) return json(req, { ok: false, err: 'limit' }, 429);
  }
  const email = str(b.email, 120);
  await env.DB.prepare('INSERT INTO feedback (ts,id,v,text,email) VALUES (?1,?2,?3,?4,?5)')
    .bind(Date.now(), id, str(b.v, 16), text.trim(), email && /\S+@\S+\.\S+/.test(email) ? email.trim() : null).run();
  return json(req, { ok: true });
}

// משתמש = משתמש רשום (לפי הקוד שלו, בכל המכשירים) או מכשיר של משתמש לא רשום
const K = "COALESCE(v.u, 'd:' || v.id)";
async function stats(env) {
  const D = env.DB, t = today(), d7 = dayAgo(6), d30 = dayAgo(29);
  const one = async (sql, ...a) => (await D.prepare(sql).bind(...a).first()) || {};
  const all = async (sql, ...a) => (await D.prepare(sql).bind(...a).all()).results || [];
  const J = 'FROM daily d JOIN devices v ON v.id = d.id';
  // לכל מכשיר שהיה פעיל ב-30 הימים האחרונים – הסיכום האחרון שלו
  const LD = `SELECT d.* FROM daily d JOIN (SELECT id, MAX(day) md FROM daily WHERE day >= ?1 GROUP BY id) x ON d.id=x.id AND d.day=x.md`;
  // לכל משתמש שהיה פעיל ב-30 הימים האחרונים – הסיכום האחרון שלו (מכל מכשיר)
  const LU = `SELECT * FROM (SELECT d.*, ${K} k, (v.u IS NOT NULL) reg, ROW_NUMBER() OVER (PARTITION BY ${K} ORDER BY d.day DESC) rn ${J} WHERE d.day >= ?1) WHERE rn = 1`;
  const byD = col => all(`SELECT ${col} k, COUNT(*) n FROM (${LD}) GROUP BY ${col} ORDER BY n DESC LIMIT 20`, d30);
  const ret = days => one(`WITH us AS (SELECT ${K} k, MIN(v.first) f FROM devices v GROUP BY ${K})
    SELECT COUNT(*) n, SUM(EXISTS(SELECT 1 FROM daily d JOIN devices v ON v.id = d.id WHERE ${K} = us.k AND d.day >= date(us.f, '+${days} day'))) r
    FROM us WHERE f BETWEEN ?1 AND ?2`, dayAgo(days === 7 ? 60 : 120), dayAgo(days + 1));
  const [act, total, series, newS, ret7, ret30, dv, os, br, cc, v, ins, dflags, uflags, content, evRows, bnRows, errs, fbOpen] = await Promise.all([
    one(`SELECT COUNT(DISTINCT CASE WHEN d.day=?1 THEN ${K} END) dau, COUNT(DISTINCT CASE WHEN d.day=?1 THEN v.u END) dauR,
      COUNT(DISTINCT CASE WHEN d.day>=?2 THEN ${K} END) wau, COUNT(DISTINCT CASE WHEN d.day>=?2 THEN v.u END) wauR,
      COUNT(DISTINCT ${K}) mau, COUNT(DISTINCT v.u) mauR ${J} WHERE d.day>=?3`, t, d7, d30),
    one(`SELECT COUNT(DISTINCT ${K}) n, COUNT(DISTINCT v.u) r, COUNT(*) dev, SUM(v.u IS NOT NULL) devR FROM devices v`),
    all(`SELECT d.day day, COUNT(DISTINCT ${K}) n, COUNT(DISTINCT v.u) r ${J} WHERE d.day>=?1 GROUP BY d.day ORDER BY d.day`, d30),
    all(`SELECT f day, COUNT(*) n, SUM(r) r FROM (SELECT ${K} k, MIN(v.first) f, MAX(v.u IS NOT NULL) r FROM devices v GROUP BY ${K}) WHERE f>=?1 GROUP BY f ORDER BY f`, d30),
    ret(7), ret(30),
    byD('dv'), byD('os'), byD('br'), byD('cc'), byD('v'),
    all(`SELECT ins k, COUNT(*) n FROM (${LU}) GROUP BY ins ORDER BY n DESC`, d30),
    one(`SELECT COUNT(*) n, SUM(st) st, SUM(dk) dk FROM (${LD})`, d30),
    one(`SELECT COUNT(*) n, SUM(reg) li FROM (${LU})`, d30),
    one(`SELECT AVG(ns) ns, AVG(nf) nf, SUM(he) he, SUM(en) en, MAX(ns) mx FROM (${LU})`, d30),
    all(`SELECT j.key k, SUM(j.value) n, COUNT(DISTINCT ${K}) u ${J}, json_each(d.ev) j WHERE d.day>=?1 GROUP BY j.key ORDER BY u DESC`, d30),
    all(`SELECT b.key k, s.key a, SUM(s.value) n FROM daily d, json_each(d.bn) b, json_each(b.value) s WHERE d.day>=?1 GROUP BY b.key, s.key`, d30),
    all('SELECT msg, v, SUM(n) n, MAX(day) last FROM errors WHERE day>=?1 GROUP BY msg, v ORDER BY n DESC LIMIT 30', d30),
    one('SELECT COUNT(*) n FROM feedback WHERE done=0'),
  ]);
  const bn = {};
  for (const r of bnRows) (bn[r.k] = bn[r.k] || {})[r.a] = r.n;
  return {
    at: Date.now(), active: act, total, series, newS,
    ret: { d7: ret7, d30: ret30 },
    by: { dv, os, br, cc, v, ins },
    flags: { n: dflags.n || 0, st: dflags.st || 0, dk: dflags.dk || 0, un: uflags.n || 0, li: uflags.li || 0 },
    content, ev: evRows, bn, errs, fbOpen: fbOpen.n || 0,
  };
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    const p = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
    try {
      if (p === '/') return json(req, { ok: true, app: 'akordi' });
      // הודעה לכל המשתמשים – גם למי שכיבה את שליחת נתוני השימוש
      if (p === '/msg' && req.method === 'GET') {
        const m = await env.DB.prepare('SELECT mid, text, until FROM msg WHERE k=1').first();
        return json(req, { msg: m && (!m.until || m.until > Date.now()) ? m : null });
      }
      if (req.method === 'POST' && (p === '/ping' || p === '/feedback')) {
        const len = +(req.headers.get('Content-Length') || 0);
        if (len > 20000) return json(req, { ok: false }, 413);
        let b; try { b = await req.json(); } catch (e) { return json(req, { ok: false }, 400); }
        return p === '/ping' ? ping(req, env, b || {}) : feedback(req, env, b || {});
      }
      if (p.startsWith('/admin/')) {
        if (!(await isOwner(req, env))) return json(req, { ok: false, err: 'auth' }, 403);
        if (p === '/admin/stats') return json(req, await stats(env));
        if (p === '/admin/feedback' && req.method === 'GET')
          return json(req, (await env.DB.prepare('SELECT fid, ts, v, text, email, done FROM feedback ORDER BY done, ts DESC LIMIT 300').all()).results);
        if (req.method === 'POST') {
          const b = await req.json().catch(() => ({}));
          if (p === '/admin/feedback/done') { await env.DB.prepare('UPDATE feedback SET done=?2 WHERE fid=?1').bind(int(b.fid), flag(b.done)).run(); return json(req, { ok: true }); }
          if (p === '/admin/feedback/del') { await env.DB.prepare('DELETE FROM feedback WHERE fid=?1').bind(int(b.fid)).run(); return json(req, { ok: true }); }
          if (p === '/admin/msg') {
            if (!b.text) await env.DB.prepare('DELETE FROM msg').run();
            else await env.DB.prepare('INSERT INTO msg (k,mid,text,until) VALUES (1,?1,?2,?3) ON CONFLICT(k) DO UPDATE SET mid=?1,text=?2,until=?3')
              .bind(Date.now(), str(b.text, 500), Number.isFinite(+b.until) && +b.until > Date.now() ? Math.round(+b.until) : null).run();
            return json(req, { ok: true });
          }
        }
        if (p === '/admin/msg') return json(req, await env.DB.prepare('SELECT mid, text, until FROM msg WHERE k=1').first());
      }
      return json(req, { ok: false }, 404);
    } catch (e) {
      return json(req, { ok: false, err: 'server', detail: String((e && e.message) || e).slice(0, 300) }, 500);
    }
  },
};
