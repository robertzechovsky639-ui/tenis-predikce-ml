'use strict';
// Statický režim (GitHub Pages): předzápasová data z data/*.json (GitHub Actions), živé skóre přímo z prohlížeče.
const STATIC = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('static');
const SK = {};
// ---------- Markovův model (port backend/markov.py) ----------
const MK = (() => {
  function game(p, a = 0, b = 0) { const memo = {}; const g = (x, y) => { const k = x * 50 + y; if (k in memo) return memo[k];
      let r; if (x >= 4 && x - y >= 2) r = 1; else if (y >= 4 && y - x >= 2) r = 0; else if (x >= 3 && y >= 3 && x === y) r = p * p / (p * p + (1 - p) * (1 - p));
      else r = p * g(x + 1, y) + (1 - p) * g(x, y + 1); return memo[k] = r }; return g(a, b) }
  function onFirst(pts) { const n = (pts[0] | 0) + (pts[1] | 0); return Math.floor((n + 1) / 2) % 2 === 0 }
  function aServedFirst(aNow, pts) { return onFirst(pts) ? aNow : !aNow }
  function tiebreak(pa, pb, a = 0, b = 0, aFirst = true, target = 7) { const memo = {}; const t = (x, y) => { const k = x * 100 + y; if (k in memo) return memo[k]; let r;
      if (x >= target && x - y >= 2) r = 1; else if (y >= target && y - x >= 2) r = 0;
      else if (x >= target - 1 && y >= target - 1 && x === y) { const w = pa * (1 - pb), l = (1 - pa) * pb; r = w + l > 0 ? w / (w + l) : .5 }
      else { const n = x + y; let as = Math.floor((n + 1) / 2) % 2 === 0; if (!aFirst) as = !as; const q = as ? pa : 1 - pb; r = q * t(x + 1, y) + (1 - q) * t(x, y + 1) }
      return memo[k] = r }; return t(a, b) }
  function setP(pa, pb, ga = 0, gb = 0, aSrv = true, pts = [0, 0], tbTo = 7) { const ha = game(pa), hb = game(pb), memo = {};
    const s = (x, y, as) => { const k = x * 100 + y * 2 + (as ? 1 : 0); if (k in memo) return memo[k]; let r;
      if ((x >= 6 && x - y >= 2) || x === 7) r = 1; else if ((y >= 6 && y - x >= 2) || y === 7) r = 0; else if (x === 6 && y === 6) r = tiebreak(pa, pb, 0, 0, as, tbTo);
      else { const q = as ? ha : 1 - hb; r = q * s(x + 1, y, !as) + (1 - q) * s(x, y + 1, !as) } return memo[k] = r };
    if (ga === 6 && gb === 6) return tiebreak(pa, pb, pts[0], pts[1], aServedFirst(aSrv, pts), tbTo);
    if (pts[0] || pts[1]) { const q = aSrv ? game(pa, pts[0], pts[1]) : 1 - game(pb, pts[1], pts[0]); return q * s(ga + 1, gb, !aSrv) + (1 - q) * s(ga, gb + 1, !aSrv) }
    return s(ga, gb, aSrv) }
  function matchP(pa, pb, sa, sb, ga, gb, aSrv, pts, bo, tbTo = 7, matchTb = false) { const need = Math.floor(bo / 2) + 1; if (sa >= need) return 1; if (sb >= need) return 0;
    const ps = (setP(pa, pb, 0, 0, true) + setP(pa, pb, 0, 0, false)) / 2; const memo = {};
    const m = (x, y) => { if (x >= need) return 1; if (y >= need) return 0; const k = x * 10 + y; if (k in memo) return memo[k]; return memo[k] = ps * m(x + 1, y) + (1 - ps) * m(x, y + 1) };
    const inTb = matchTb || (ga === 6 && gb === 6);
    const curOf = s => matchTb ? tiebreak(pa, pb, pts[0], pts[1], aServedFirst(s, pts), tbTo) : setP(pa, pb, ga, gb, s, pts, tbTo);
    if (!inTb) { const c = curOf(aSrv); return c * m(sa + 1, sb) + (1 - c) * m(sa, sb + 1) }
    const aFirst = aServedFirst(aSrv, pts), nextDecider = sa + sb + 1 >= bo - 1;
    const psNext = setP(pa, pb, 0, 0, !aFirst, [0, 0], nextDecider ? 10 : 7); const memo2 = {};
    const m2 = (x, y, useNext) => { if (x >= need) return 1; if (y >= need) return 0; const k = (x * 10 + y) * 2 + (useNext ? 1 : 0); if (k in memo2) return memo2[k];
      const pset = useNext ? psNext : ps; return memo2[k] = pset * m2(x + 1, y, false) + (1 - pset) * m2(x, y + 1, false) };
    const c = curOf(aSrv); return c * m2(sa + 1, sb, true) + (1 - c) * m2(sa, sb + 1, true) }
  const spCache = new Map();
  function serveProbs(p, female, bo) {
    const key = p + '|' + (female ? 1 : 0) + '|' + bo;
    const hit = spCache.get(key); if (hit) return hit;
    const base = female ? .56 : .64; let lo = -.25, hi = .25;
    for (let i = 0; i < 30; i++) { const d = (lo + hi) / 2; if (matchP(base + d, base - d, 0, 0, 0, 0, true, [0, 0], bo) < p) lo = d; else hi = d }
    const d = (lo + hi) / 2; const out = [base + d, base - d]; spCache.set(key, out); return out;
  }
  function live(p, done, cur, pts, server, female, bo, tbTo, matchTb) { const [pa, pb] = serveProbs(p, female, bo); const sa = done.filter(s => s[0] > s[1]).length, sb = done.length - sa;
    const srv = server ? [server === 1] : [true, false]; const avg = f => srv.reduce((t, s) => t + f(s), 0) / srv.length;
    const tb = !!(matchTb || (cur[0] === 6 && cur[1] === 6));
    let target = tbTo;
    if (target == null) target = done.length >= (bo || 3) - 1 ? 10 : 7;
    const setOf = s => matchTb ? tiebreak(pa, pb, pts[0], pts[1], aServedFirst(s, pts), target) : setP(pa, pb, cur[0], cur[1], s, pts, target);
    return { match: avg(s => matchP(pa, pb, sa, sb, cur[0], cur[1], s, pts, bo || 3, target, !!matchTb)), set: avg(setOf),
      game: server && !tb ? (server === 1 ? game(pa, pts[0], pts[1]) : 1 - game(pb, pts[1], pts[0])) : null, serve_a: pa, serve_b: pb, hold_a: game(pa), hold_b: game(pb) } }
  return { game, setP, matchP, serveProbs, live };
})();
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const surKey = n => { n = String(n || '').trim(); const m = n.match(/^(.*?)\s+[A-Z][\w\-]*\.$/); if (m) return norm(m[1]); const t = n.split(/\s+/); return norm(t[t.length - 1]) };
const pairKey = (a, b) => [surKey(a), surKey(b)].sort().join('|');
const lastTok = n => { n = String(n || '').trim(); const m = n.match(/^(.*?)\s+[A-Z][\w\-]*\.$/); const t = (m ? m[1] : n).split(/[\s\-]+/); return norm(t[t.length - 1]) };
const pairKey2 = (a, b) => '~' + [lastTok(a), lastTok(b)].sort().join('|');
function findPair(g, a, b) { return ST.byPair[g + pairKey(a, b)] || ST.byPair[g + pairKey2(a, b)] }
function indexM(m) { ST.byPair[m.g + pairKey(m.players[0].name, m.players[1].name)] = m; const k2 = m.g + pairKey2(m.players[0].name, m.players[1].name); if (!ST.byPair[k2] || ST.byPair[k2].status === 'finished') ST.byPair[k2] = m }

// ---------- data ----------
const ST = { all: [], byId: {}, byPair: {}, players: null, lr: null, status: {}, lastLive: null, liveMs: null, srcOk: {} };
function dayOf(ts) { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(ts * 1000); b.setHours(0, 0, 0, 0); return Math.round((b - a) / 864e5) }
function cacheLoad() { try { const d = JSON.parse(localStorage.tenisCache || 'null'); if (d && Date.now() / 1000 - d.generated < 86400) { applyData(d); ST.fromCache = true; ST.cacheHit = true; return true } } catch (e) { } return false }
let _cT = 0; function cacheSave() { const now = Date.now(); if (now - _cT < 20000) return; _cT = now; const run = () => { try { localStorage.tenisCache = JSON.stringify({ generated: ST.generated, status: ST.status, matches: ST.all }) } catch (e) { } }; if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2500 }); else setTimeout(run, 40); }
function keepLive(m, o) {
  const oldModel = o.pred != null && !o.pred_low, newModel = m.pred != null && !m.pred_low;
  if (oldModel && !newModel) { m.pred = o.pred; m.pred_lr = o.pred_lr; m.pids = o.pids; m.pred_low = false; m.pred_note = null; }
  else if (m.pred == null && o.pred != null) { m.pred = o.pred; m.pred_low = !!o.pred_low; m.pred_note = o.pred_note; if (o.pids) m.pids = o.pids; }
  TenisLive.applyLive(m, { status: o.status, sets: o.sets, pts: o.pts, pts_raw: o.pts_raw, server: o.server, srvTrust: o.srvTrust, srv_src: o.srv_src, winner: o.winner, src_pts: o.src_pts },
    { src: 'memory', t0: o._accAt || Date.now() }, () => true);
  if (m.status === 'live') liveCalc(m);
}
async function loadStatic() { const r = await fetch('data/matches.json', { cache: 'no-cache' }); const d = await r.json(); const old = ST.byId; applyData(d);
  for (const m of ST.all) { const o = old[m.id]; if (o) keepLive(m, o); if (m.pred == null) ensurePred(m) }
  for (const id in old) if ((id.startsWith('ss-') || id.startsWith('s365-')) && !findPair(old[id].g, old[id].players[0].name, old[id].players[1].name)) { ST.all.push(old[id]); ST.byId[id] = old[id]; indexM(old[id]) }
  ST.fromCache = false; cacheSave(); _cT = 0 }
function applyData(d) {
  ST.status = d.status; ST.generated = d.generated; ST.all = d.matches; ST.byId = {}; ST.byPair = {};
  for (const m of ST.all) { m.day = m.status === 'live' ? 0 : dayOf(m.ts); ST.byId[m.id] = m; indexM(m) } }
function liveKey(m) { let s = ''; const sets = m.sets || []; for (let i = 0; i < sets.length; i++) s += sets[i][0] + '-' + sets[i][1] + ','; const pts = m.pts; return m.pred + '|' + (m.best_of || 3) + '|' + m.g + '|' + (m.server || 0) + '|' + s + '|' + (pts ? pts[0] + ':' + pts[1] : '') + '|' + (m.odds ? m.odds.best_a + ':' + m.odds.best_b : ''); }
function liveCalc(m) { if (m.status !== 'live' || m.pred == null) { m.live = null; m._lk = ''; return }
  const lk = liveKey(m); if (m.live && m._lk === lk) return; m._lk = lk;
  const pts = m.pts || [0, 0]; const bo = m.best_of || 3;
  const view = TenisLive.tbView(m.sets, pts, bo, m.match_tb);
  let done, cur, matchTb = false, tbTo = 7;
  if (view && view.kind === 'match') { done = TenisLive.liveSplit(m.sets, 'finished').done; cur = [0, 0]; matchTb = true; tbTo = view.target; }
  else {
    const sp = TenisLive.liveSplit(m.sets, 'live');
    done = sp.done; cur = sp.cur;
    if (view) tbTo = view.target;
    if (done.length >= bo - 1) tbTo = 10;
  }
  const l = MK.live(m.pred, done, cur, pts, m.server, m.g === 'W', m.best_of, tbTo, matchTb);
  l.note = m.server ? 'stav bod po bodu (365scores, v prohlížeči): sety, gemy, body a podávající' : 'body/podání nejsou k dispozici – stav = sety a gemy, podávající neznámý (průměr)';
  m.live = l; m.value = null; if (m.odds && m.odds_t > Date.now() - 90000) { const p = l.match; m.value = p * m.odds.best_a - 1 > .05 ? 'A' : (1 - p) * m.odds.best_b - 1 > .05 ? 'B' : null } }
async function jDirect(u, h, signal) { const r = await fetch(u, { headers: h || {}, cache: 'no-store', signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }
const _jobs = new Map(); let _wj = null, _jid = 0;
function pollWorker() { if (_wj) return _wj; try { _wj = new Worker('poll-worker.js'); } catch (e) { return null; }
  _wj.onmessage = e => { const job = _jobs.get(e.data.id); if (!job) return; _jobs.delete(e.data.id); if (e.data.error) { const err = new Error(e.data.error); if (e.data.error === 'AbortError') err.name = 'AbortError'; job.rej(err); } else job.res(e.data.data); };
  return _wj; }
function j(u, h, signal) { const w = !h && typeof Worker !== 'undefined' && pollWorker(); if (!w) return jDirect(u, h, signal);
  return new Promise((res, rej) => { const id = ++_jid; _jobs.set(id, { res, rej });
    const abort = () => { if (!_jobs.has(id)) return; _jobs.delete(id); try { w.postMessage({ abort: true, id }); } catch (e) { } const err = new Error('aborted'); err.name = 'AbortError'; rej(err); };
    if (signal) { if (signal.aborted) return abort(); signal.addEventListener('abort', abort, { once: true }); }
    w.postMessage({ id, url: new URL(u, location.href).href }); }); }
function consider(m, upd, token, changed) {
  if (!m || !TenisLive.applyLive(m, upd, token, t => !t || !SOURCES[t.src] || SOURCES[t.src].cur === t)) return false;
  liveCalc(m); if (changed) changed.add(m.id); return true;
}
// ---------- živé zdroje: každý má vlastní interval + backoff při 429/chybě ----------
function mkUpd(changed) { return (m, f) => { const before = JSON.stringify([m.status, m.sets, m.pts, m.server, m.winner]); f(m);
  if (JSON.stringify([m.status, m.sets, m.pts, m.server, m.winner]) !== before) { liveCalc(m); changed.add(m.id) } } }
const totG = x => x.reduce((a, s) => a + s[0] + s[1], 0);
async function srcESPN(changed, token, signal) {
  await Promise.all(['atp', 'wta'].map(t => j(`https://site.api.espn.com/apis/site/v2/sports/tennis/${t}/scoreboard`, null, signal).then(d => {
    for (const ev of d.events || []) for (const gr of ev.groupings || []) { if (!/singles/.test(gr.grouping?.slug || '')) continue;
      for (const c of gr.competitions || []) { const cs = [...c.competitors].sort((a, b) => (a.order || 0) - (b.order || 0)); if (cs.length !== 2 || !cs[0].athlete || !cs[1].athlete) continue;
        const g = t === 'atp' ? 'M' : 'W'; const m = findPair(g, cs[0].athlete.displayName, cs[1].athlete.displayName); if (!m) continue;
        const same = lastTok(cs[0].athlete.displayName) === lastTok(m.players[0].name); const st = c.status.type.state;
        const sets = (cs[0].linescores || []).map((s, i) => [s.value | 0, (cs[1].linescores || [])[i]?.value | 0]);
        const ss = same ? sets : sets.map(s => [s[1], s[0]]);
        if (st === 'in') consider(m, { status: 'live', sets: ss }, token, changed);
        else if (st === 'post') consider(m, { status: 'finished', sets: ss, winner: cs[0].winner ? (same ? 1 : 2) : cs[1].winner ? (same ? 2 : 1) : 0 }, token, changed); } } }))) }
async function src365(changed, token, signal) { const d = await j('https://webws.365scores.com/web/games/current/?appTypeId=5&langId=1&timezoneName=Europe%2FPrague&userCountryId=1&sports=3', null, signal);
  const PT = { 0: 0, 15: 1, 30: 2, 40: 3, 50: 4 };
  for (const g of d.games || []) { const h = g.homeCompetitor || {}, a = g.awayCompetitor || {}; const m = findPair('M', h.name, a.name) || findPair('W', h.name, a.name); if (!m) continue;
    const same = lastTok(h.name) === lastTok(m.players[0].name); const stg = {}; for (const s of g.stages || []) stg[s.name] = s;
    const sets = Object.keys(stg).filter(k => /^Set \d/.test(k)).map(k => [stg[k].homeCompetitorScore | 0, stg[k].awayCompetitorScore | 0]).filter(s => s[0] >= 0 && s[1] >= 0);
    const ss = same ? sets : sets.map(s => [s[1], s[0]]);
    if (g.statusGroup === 3) { const gm = stg.Game || {}; let raw = [gm.homeCompetitorScore ?? 0, gm.awayCompetitorScore ?? 0]; let p = raw.map(x => PT[x | 0] ?? 0);
      if (p.includes(4)) p = p[0] === 4 ? [4, 3] : [3, 4]; const sv = TenisLive.reportedServer(h.inPossession ? 1 : a.inPossession ? 2 : null, same);
      consider(m, { status: 'live', sets: ss, pts: same ? p : [p[1], p[0]], pts_raw: same ? raw : [raw[1], raw[0]], server: sv, srvTrust: sv ? 2 : 0, srv_src: sv ? '365' : null, src_pts: '365scores' }, token, changed); }
    else if (g.statusGroup === 4) consider(m, { status: 'finished', sets: ss, winner: h.isWinner ? (same ? 1 : 2) : a.isWinner ? (same ? 2 : 1) : 0 }, token, changed); } }
const SS_CIRC = { ATP: 'ATP', WTA: 'WTA', Challenger: 'Challenger', 'WTA 125': 'WTA 125', 'ITF Men': 'ITF muži', 'ITF Women': 'ITF ženy' };
const SS_SURF = s => /clay/i.test(s || '') ? 'Clay' : /grass/i.test(s || '') ? 'Grass' : 'Hard';
function sofaServer(e, same) {
  // firstToServe je aktuální podávající, ne ten z prvního gemu. Parita gemů ho vracela pořád na stejnou stranu.
  return TenisLive.reportedServer(e && e.firstToServe, same);
}
async function srcSofa(changed, token, signal) { const d = await j('https://api.sofascore1.com/api/v1/sport/tennis/events/live', null, signal);
  const SPT = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4 };
  for (const e of d.events || []) { const H = e.homeTeam || {}, A = e.awayTeam || {}; if (H.type !== 1 || A.type !== 1) continue;
    const circ = SS_CIRC[e.tournament?.category?.name]; if (!circ) continue; const g = H.gender === 'F' ? 'W' : 'M';
    let m = findPair(g, H.name, A.name);
    if (!m) {
      m = { id: 'ss-' + e.id, src: 'Sofascore', circuit: circ, g, tournament: e.tournament?.name || '', surface: SS_SURF(e.groundType), round: e.roundInfo?.name || '',
        qual: /qualif/i.test(e.tournament?.name + ' ' + (e.roundInfo?.name || '')) ? 1 : 0, ts: e.startTimestamp, status: 'live', sets: [], winner: 0, best_of: 3, fs: null,
        players: [{ name: H.name, country: H.country?.alpha3 || '', ranking: H.ranking }, { name: A.name, country: A.country?.alpha3 || '', ranking: A.ranking }], pids: [null, null], pred: null, odds: null, day: 0 };
      ensurePred(m); ST.all.push(m); ST.byId[m.id] = m; indexM(m); changed.add(m.id); ST.added = true; }
    const same = lastTok(H.name) === lastTok(m.players[0].name); m.ssid = e.id; m.ss_same = same;
    if (H.ranking) m.players[same ? 0 : 1].ranking ??= H.ranking;
    if (A.ranking) m.players[same ? 1 : 0].ranking ??= A.ranking;
    if (m.pred == null || m.pred_low) { if (ensurePred(m)) changed.add(m.id); }
    const hs = e.homeScore || {}, as = e.awayScore || {};
    const sets = []; for (let i = 1; i <= 5; i++) if (hs['period' + i] !== undefined) sets.push([hs['period' + i] | 0, as['period' + i] | 0]);
    const ss = same ? sets : sets.map(s => [s[1], s[0]]); const st = e.status?.type;
    if (st === 'inprogress') { let p = [SPT[hs.point] ?? (+hs.point || 0), SPT[as.point] ?? (+as.point || 0)];
      const tb = sets.length && sets[sets.length - 1][0] === 6 && sets[sets.length - 1][1] === 6; if (tb) p = [+hs.point || 0, +as.point || 0];
      const raw = [hs.point ?? 0, as.point ?? 0]; const pts = same ? p : [p[1], p[0]];
      const sv = sofaServer(e, same);
      consider(m, { status: 'live', sets: ss, pts, pts_raw: same ? raw : [raw[1], raw[0]], server: sv, srvTrust: sv ? 1 : 0, srv_src: sv ? 'firstToServe' : null, src_pts: 'Sofascore' }, token, changed); }
    else if (st === 'finished') consider(m, { status: 'finished', sets: ss, winner: e.winnerCode ? (same ? e.winnerCode : 3 - e.winnerCode) : 0 }, token, changed); } }
function indexPlayers() { if (ST.players && !ST.pIndex) ST.pIndex = TenisLive.buildIndex(ST.players); }
function ensurePred(m) {
  if (!m || (m.pred != null && !m.pred_low)) return false;
  indexPlayers();
  if (ST.pIndex && ST.lr) {
    const ids = [0, 1].map(i => {
      if (m.pids && m.pids[i] && ST.pIndex.byId.get(m.pids[i])) return m.pids[i];
      const hit = TenisLive.matchPlayer(ST.pIndex, m.g, m.players[i].name);
      return hit ? hit[0] : null;
    });
    if (ids[0] || ids[1]) m.pids = ids;
    const A = ids[0] && ST.pIndex.byId.get(ids[0]), B = ids[1] && ST.pIndex.byId.get(ids[1]);
    if (A && B) {
      const r = lrPredict(pCard(A, m.surface), pCard(B, m.surface), m.surface);
      const thin = Math.min(A[6] || 0, B[6] || 0) < TenisLive.MIN_HISTORY;
      const note = thin ? 'Málo odehraných zápasů v datech – nízká spolehlivost.' : null;
      const p = Math.round(r.p * 10000) / 10000;
      if (m.pids && m.pids[0] === A[0] && m.pids[1] === B[0] && m.pred != null && Math.round(m.pred * 10000) === Math.round(p * 10000) && !!m.pred_low === thin) return false;
      m.pids = [A[0], B[0]]; m.pred = p; m.pred_lr = p; m.pred_low = thin; m.pred_note = note;
      liveCalc(m); return true;
    }
  }
  const fb = TenisLive.fallbackPred(m, id => { const p = ST.pIndex && ST.pIndex.byId.get(id); return p ? p[2] : null; });
  if (m.pred === fb.p && m.pred_low && m.pred_note === fb.note) return false;
  m.pred = fb.p; m.pred_low = true; m.pred_note = fb.note; m.pred_lr = null; liveCalc(m); return true;
}
async function addPred(m) { try { await ensurePlayers(); ensurePred(m); } catch (e) { ensurePred(m); } }
// ---------- detail živých zápasů ze Sofascore (podávající z point-by-point, kurzy) – jen zápasy na obrazovce ----------
const frac = f => { const [a, b] = String(f).split('/').map(Number); return b ? 1 + a / b : null };
function slowNet() { const c = navigator.connection; const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches; return !!(narrow || (c && (c.saveData || c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g'))); }
function pollPlan() { return slowNet()
  ? { sofa: 2200, s365: 5000, espn: 8000, detail: 1800, lag: { sofascore: 0, s365: 700, espn: 1400 } }
  : { sofa: 1500, s365: 2500, espn: 4000, detail: 1100, lag: { sofascore: 0, s365: 400, espn: 800 } }; }
async function sofaDetail(onChange) { let i = 0;
  const step = async () => { let wait = pollPlan().detail;
    try { let L = ST.all.filter(m => m.status === 'live' && m.ssid && ((((m.srvTrust || 0) < 3) && !m.no_pbp) || (!m.odds && !(m.ss_odds_t > Date.now() - 60000))));
      const open = (typeof S !== 'undefined' && S.detail && S.detail.id) || null;
      const onScreen = new Set([...document.querySelectorAll('#view .m')].map(el => el.dataset.id));
      if (onScreen.size) L = L.filter(m => m.id === open || onScreen.has(m.id)); else L = L.slice(0, 4);
      if (L.length && !document.hidden) { const m = L[i++ % L.length]; const ch = [];
        if ((m.srvTrust || 0) < 3 && !m.no_pbp) { const d = await j(`https://api.sofascore1.com/api/v1/event/${m.ssid}/point-by-point`).catch(e => { if (/404/.test(e)) { m.no_pbp = true; return {} } throw e }); const g = d.pointByPoint?.[0]?.games?.[0];
          if (g && g.score && g.score.scoring === -1) { const cur = m.sets && m.sets.length ? m.sets[m.sets.length - 1] : null;
            const hs = g.score.homeScore | 0, as = g.score.awayScore | 0;
            const aligned = cur && hs === (m.ss_same ? cur[0] : cur[1]) && as === (m.ss_same ? cur[1] : cur[0]);
            const sv = aligned ? TenisLive.reportedServer(g.score.serving, m.ss_same) : null;
            if (sv && consider(m, { status: m.status, sets: m.sets, pts: m.pts, server: sv, srvTrust: 3, srv_src: 'pbp', src_pts: m.src_pts }, { src: 'sofaDetail', t0: Date.now() }, null)) ch.push(m.id); } }
        if (!m.odds && !(m.ss_odds_t > Date.now() - 60000)) { m.ss_odds_t = Date.now(); const d = await j(`https://api.sofascore1.com/api/v1/event/${m.ssid}/odds/1/featured`).catch(e => { if (/404/.test(e)) return {}; throw e });
          const f = d.featured?.default; if (f && f.marketId === 1 && !f.suspended) { const c = {}; for (const x of f.choices || []) c[x.name] = frac(x.fractionalValue);
            let a = c['1'], b = c['2']; if (!m.ss_same) [a, b] = [b, a]; if (a > 1 && b > 1) { m.odds = { best_a: +a.toFixed(2), best_b: +b.toFixed(2), n: 1, fair_a: (1 / a) / (1 / a + 1 / b) }; m.odds_src = 'Sofascore'; m.odds_t = Date.now(); m.odds_table = [{ bookmaker: 'Sofascore (průměr trhu)', a: +a.toFixed(2), b: +b.toFixed(2) }]; liveCalc(m); ch.push(m.id) } } }
        if (ch.length) onChange(ch) } ST.srcOk.sofaDetail = Date.now(); delete ST.srcOk.sofaDetailErr }
    catch (e) { ST.srcOk.sofaDetailErr = String(e); wait = 5000 }
    setTimeout(step, wait) }; setTimeout(step, 3000) }
// ---------- záložní rozpis z prohlížeče (365scores allscores dnes + zítra) s predikcí LR, když export z Actions zastará ----------
async function scheduleFallback(onChange) { const run = async () => { try {
    const ch = []; const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const t = new Date(), t2 = new Date(Date.now() + 864e5);
    const d = await j(`https://webws.365scores.com/web/games/allscores/?appTypeId=5&langId=1&timezoneName=Europe%2FPrague&userCountryId=1&sports=3&startDate=${fmt(t)}&endDate=${fmt(t2)}`);
    const comp = {}; for (const c of d.competitions || []) comp[c.id] = c;
    for (const g of d.games || []) { const h = g.homeCompetitor || {}, a = g.awayCompetitor || {}; if (!h.name || !a.name || /\//.test(h.name) || g.statusGroup !== 2) continue;
      const cn = (comp[g.competitionId]?.name || '') + ' ' + (g.competitionDisplayName || ''); const rk = (h.rankings || [])[0]?.name || (a.rankings || [])[0]?.name || '';
      const gender = /WTA/.test(rk) || /women|wta/i.test(cn) ? 'W' : 'M'; if (findPair(gender, h.name, a.name)) continue;
      const circ = /challenger/i.test(cn) ? 'Challenger' : /itf/i.test(cn) ? (gender === 'W' ? 'ITF ženy' : 'ITF muži') : gender === 'W' ? 'WTA' : 'ATP';
      const m = { id: 's365-' + g.id, src: '365scores', circuit: circ, g: gender, tournament: (g.competitionDisplayName || cn).replace(/ - .*$/, ''), surface: 'Hard', round: g.stageName || '',
        qual: /qualif/i.test(g.stageName || '') ? 1 : 0, ts: Date.parse(g.startTime) / 1000, status: 'upcoming', sets: [], winner: 0, best_of: 3, fs: null,
        players: [{ name: h.name, country: '' }, { name: a.name, country: '' }], pids: [null, null], pred: null, odds: null };
      m.day = dayOf(m.ts); ensurePred(m); ST.all.push(m); ST.byId[m.id] = m; indexM(m); ch.push(m.id); ST.added = true }
    ST.srcOk.schedule = Date.now(); if (ch.length) onChange(ch) } catch (e) { ST.srcOk.scheduleErr = String(e) } setTimeout(run, 300000) };
  setTimeout(run, !ST.generated || Date.now() / 1000 - ST.generated > 1800 ? 1000 : 60000) }
function health() { const now = Date.now(); return Object.keys(SOURCES).concat(['sofaDetail']).map(k => { const ok = ST.srcOk[k], err = ST.srcOk[k + 'Err'];
  return { k, state: err && !(ok > now - 10000) ? 'err' : ok > now - 15000 ? 'ok' : 'wait' } }) }
// ---------- rozpis všech úrovní (ATP, WTA, Challenger, ITF muži/ženy, kvalifikace) ze Sofascore: dnes + zítra, každých 10 min ----------
const SS_CATS = [3, 6, 72, 785, 213];
function sofaEventToMatch(e) { const H = e.homeTeam || {}, A = e.awayTeam || {}; if (H.type !== 1 || A.type !== 1) return null;
  const circ = SS_CIRC[e.tournament?.category?.name]; if (!circ) return null; const g = H.gender === 'F' ? 'W' : 'M'; const st = e.status?.type;
  return { id: 'ss-' + e.id, ssid: e.id, ss_same: true, src: 'Sofascore', circuit: circ, g, tournament: (e.tournament?.name || '').replace(/, (Qualifying|Doubles).*$/, ''), surface: SS_SURF(e.groundType),
    round: e.roundInfo?.name || '', qual: /qualif/i.test((e.tournament?.name || '') + ' ' + (e.roundInfo?.name || '')) ? 1 : 0, ts: e.startTimestamp,
    status: st === 'inprogress' ? 'live' : st === 'finished' ? 'finished' : 'upcoming', sets: [], winner: e.winnerCode || 0, best_of: 3, fs: null,
    players: [{ name: H.name, country: H.country?.alpha3 || '', ranking: H.ranking }, { name: A.name, country: A.country?.alpha3 || '', ranking: A.ranking }], pids: [null, null], pred: null, odds: null } }
async function sofaSchedule(onChange) { const run = async () => { const ch = []; let ok = 0;
    const iso = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` };
    const days = [iso(Date.now()), iso(Date.now() + 864e5)];
    await Promise.all(SS_CATS.flatMap(c => days.map(d => j(`https://api.sofascore1.com/api/v1/category/${c}/scheduled-events/${d}`).then(r => { ok++;
      for (const e of r.events || []) { if (e.status?.type !== 'notstarted') continue; const m0 = sofaEventToMatch(e); if (!m0) continue;
        const ex = findPair(m0.g, m0.players[0].name, m0.players[1].name);
        if (ex) { if (!ex.ssid) { ex.ssid = e.id; ex.ss_same = lastTok(e.homeTeam.name) === lastTok(ex.players[0].name) }
          ex.players.forEach((p, i) => { if (p.ranking == null) p.ranking = (ex.ss_same ? m0.players[i] : m0.players[1 - i]).ranking }); if ((ex.pred == null || ex.pred_low) && ensurePred(ex)) ch.push(ex.id); continue }
        m0.day = dayOf(m0.ts); if (m0.day < -2 || m0.day > 2) continue; ensurePred(m0); ST.all.push(m0); ST.byId[m0.id] = m0; indexM(m0); ch.push(m0.id); ST.added = true; ST.ssSchedAdded = (ST.ssSchedAdded || 0) + 1 } }).catch(() => { }))));
    for (const id of ch) { const m = ST.byId[id]; if (m && (m.pred == null || m.pred_low)) ensurePred(m); }
    for (const m of ST.all) if ((m.pred == null || m.pred_low) && ensurePred(m)) ch.push(m.id);
    if (ok) { ST.srcOk.schedule = Date.now(); delete ST.srcOk.scheduleErr } else ST.srcOk.scheduleErr = 'Sofascore rozpis nedostupný';
    if (ch.length) onChange(ch); setTimeout(run, 600000) }; setTimeout(run, 2500) }
function rankPred(m) { return ensurePred(m); }
async function loadRanks(onChange) {
  try {
    const [men, women] = await Promise.all([j('https://api.sofascore1.com/api/v1/rankings/type/5'), j('https://api.sofascore1.com/api/v1/rankings/type/6')]);
    const map = new Map();
    for (const row of [...(men.rankings || []), ...(women.rankings || [])]) {
      if (!row.team || !row.ranking) continue;
      const k = TenisLive.toks(row.team.name).slice().sort().join(' ');
      if (k) map.set(k, row.ranking);
    }
    ST.rankMap = map; const ch = [];
    for (const m of ST.all) {
      let up = false;
      for (const p of m.players) if (!p.ranking) { const r = map.get(TenisLive.toks(p.name).slice().sort().join(' ')); if (r) { p.ranking = r; up = true; } }
      if (up && m.pred_low && ensurePred(m)) ch.push(m.id);
    }
    if (ch.length && onChange) onChange(ch);
  } catch (e) { ST.srcOk.ranksErr = String(e); }
}
const SOURCES = { sofascore: { fn: srcSofa, base: 1500 }, s365: { fn: src365, base: 2500 }, espn: { fn: srcESPN, base: 4000 } };
function startSources(onChange) { const plan = pollPlan(); SOURCES.sofascore.base = plan.sofa; SOURCES.s365.base = plan.s365; SOURCES.espn.base = plan.espn;
  sofaDetail(onChange); scheduleFallback(onChange); ensurePlayers().then(() => { sofaSchedule(onChange); loadRanks(onChange); }); const lag = plan.lag;
  for (const [k, Src] of Object.entries(SOURCES)) { Src.iv = Src.base; Src.lat = [];
  const run = async () => { const changed = new Set(), t0 = performance.now();
    const plan = pollPlan(); Src.base = k === 'sofascore' ? plan.sofa : k === 's365' ? plan.s365 : plan.espn;
    const token = { src: k, t0: Date.now(), gen: (Src.gen = (Src.gen || 0) + 1) }; Src.cur = token;
    if (Src.abort) Src.abort.abort(); Src.abort = new AbortController(); const timer = setTimeout(() => Src.abort.abort(), 6000);
    try { await Src.fn(changed, token, Src.abort.signal); Src.iv = Src.base; ST.srcOk[k] = Date.now(); delete ST.srcOk[k + 'Err']; }
    catch (e) { if (e.name !== 'AbortError') { Src.iv = Math.min(Src.iv * 2, 30000); ST.srcOk[k + 'Err'] = String(e); } }
    finally { clearTimeout(timer); }
    Src.lat = [...Src.lat.slice(-29), performance.now() - t0]; ST.lastLive = new Date(); ST.liveMs = Math.round(performance.now() - t0);
    if (changed.size && Src.cur === token) onChange([...changed]); setTimeout(run, document.hidden ? Math.max(Src.iv, 15000) : Src.iv); };
  setTimeout(run, lag[k] || 0); } }
// Flashscore (Challenger/ITF) – každých 20 s, pokud prohlížeč povolí CORS s hlavičkou x-fsign
async function fsTick() { try { const r = await fetch('https://global.flashscore.ninja/2/x/feed/f_2_0_2_en_1', { headers: { 'x-fsign': 'SW9D1eZo' }, cache: 'no-store' }); const t = await r.text(); ST.srcOk.fs = Date.now(); const ch = [];
  for (const rec of t.split('~')) { const f = {}; for (const kv of rec.split('¬')) { const i = kv.indexOf('÷'); if (i > 0) f[kv.slice(0, i)] = kv.slice(i + 1) }
    if (!f.AA) continue; const m = ST.byId['fs-' + f.AA] || ST.all.find(x => x.fs && x.fs.id === f.AA); if (!m || m.src === 'ESPN' && m.server) continue;
    const sets = []; for (const [a, b] of [['BA', 'BB'], ['BC', 'BD'], ['BE', 'BF'], ['BG', 'BH'], ['BI', 'BJ']]) if (f[a] !== undefined && f[b] !== undefined && f[a] !== '') sets.push([+f[a], +f[b]]);
    const stt = +f.AB; const before = JSON.stringify([m.status, m.sets]);
    if (stt === 2) { m.status = 'live'; if (m.src !== 'ESPN' && sets.length) { const flip = m.fs && m.src === 'ESPN'; m.sets = sets } } else if (stt === 3 && m.status !== 'finished') { m.status = 'finished'; if (sets.length) m.sets = sets; m.winner = +f.AS || 0; m.pts = null; m.pts_raw = null }
    if (JSON.stringify([m.status, m.sets]) !== before) { liveCalc(m); ch.push(m.id) } } return ch } catch (e) { ST.srcOk.fsErr = String(e); return [] } }
async function oddsFor(m) { if (!m.fs) return null; try { const d = (await j(`https://global.ds.lsapp.eu/odds/pq_graphql?_hash=oce&eventId=${m.fs.id}&projectId=2&geoIpCode=CZ&geoIpSubdivisionCode=CZ10`)).data.findOddsByEventId || {};
  const names = {}; for (const g of d.settings?.bookmakers || []) if (g.bookmaker) names[g.bookmaker.id] = g.bookmaker.name; const res = [];
  for (const b of d.odds || []) { if (b.bettingType !== 'HOME_AWAY' || b.bettingScope !== 'FULL_TIME') continue; const o = {}; for (const x of b.odds || []) o[x.eventParticipantId] = x;
    const a = +o[m.fs.pids[0]]?.value, bb = +o[m.fs.pids[1]]?.value; if (a > 1 && bb > 1) res.push({ bookmaker: names[b.bookmakerId] || '#' + b.bookmakerId, a, b: bb }) }
  if (res.length) { m.odds_prev = Object.fromEntries((m.odds_table || []).map(x => [x.bookmaker, [x.a, x.b]])); if (!m.odds_pre && m.status !== 'live') m.odds_pre = Object.fromEntries(res.map(x => [x.bookmaker, [x.a, x.b]])); const ba = Math.max(...res.map(x => x.a)), bb = Math.max(...res.map(x => x.b)); m.odds = { best_a: ba, best_b: bb, n: res.length, fair_a: (1 / ba) / (1 / ba + 1 / bb) }; m.odds_table = res; m.odds_t = Date.now(); liveCalc(m) }
  return res } catch (e) { return null } }
// ---------- vlastní predikce (logistická regrese v prohlížeči) ----------
async function ensurePlayers() { if (!ST.players) { [ST.players, ST.lr] = await Promise.all([j('data/players.json'), j('data/lr.json')]); ST.pIndex = TenisLive.buildIndex(ST.players); } }
function pCard(p, surf) { const si = { Hard: 0, Clay: 1, Grass: 2 }[surf] ?? 0; return { id: p[0], name: p[1], elo: p[2], selo: p[3][si], rank: p[4], form: Math.round(p[5] * 10) + '/10', matches: p[6], inact: p[7], fat: p[8], exp: p[9], age: p[10], spw: p[11], rpw: p[12] } }
function lrPredict(A, B, surf) { const f = { elo_d: A.elo - B.elo, selo_d: A.selo - B.selo, elo_p: 1 / (1 + 10 ** ((B.elo - A.elo) / 400)), logrank_d: Math.log(B.rank || 2000) - Math.log(A.rank || 2000),
    form_d: (parseInt(A.form) - parseInt(B.form)) / 10, fat_d: A.fat - B.fat, inact_d: A.inact - B.inact, h2h_d: 0, exp_d: A.exp - B.exp, age_d: A.age - B.age,
    unc_d: Math.log1p(A.matches) - Math.log1p(B.matches), level: 2, best_of: 3, surf_clay: +(surf === 'Clay'), surf_grass: +(surf === 'Grass'), is_qual: 0, female: +(A.id[0] === 'W'),
    spw_d: A.spw != null && B.spw != null ? A.spw - B.spw : 0, rpw_d: A.rpw != null && B.rpw != null ? A.rpw - B.rpw : 0 };
  const L = ST.lr; let z = L.intercept; const contrib = {}; L.features.forEach((k, i) => { const c = (f[k] - L.mean[i]) / L.scale[i] * L.coef[i]; z += c; contrib[k] = c });
  return { p: 1 / (1 + Math.exp(-z)), elo_p: f.elo_p, contrib } }
const LBL = { elo_d: 'Elo celkové', selo_d: 'Elo na povrchu', elo_p: 'Elo očekávání', logrank_d: 'Žebříček', form_d: 'Forma (posl. 10 zápasů)', fat_d: 'Zápasy za 14 dní (únava)', inact_d: 'Neaktivita (dny bez zápasu)', exp_d: 'Forma vs. očekávání Elo (60 dní)', age_d: 'Věk', unc_d: 'Nejistota ratingu', spw_d: 'Body vyhrané na podání', rpw_d: 'Body vyhrané na returnu' };
async function staticApi(u) { const url = new URL(u, location.href); const q = url.searchParams; const path = url.pathname.replace(/.*\/api\//, '/api/');
  if (path === '/api/matches') { const d = +q.get('day'); return { day: d, status: ST.status, matches: ST.all.filter(m => m.day === d) } }
  if (path === '/api/status') return ST.status;
  if (path === '/api/model') return j('data/model.json');
  if (path.startsWith('/api/match/')) { const id = decodeURIComponent(path.slice(11)); const m = ST.byId[id]; let det = {};
    if (!/^(ss|s365)-/.test(id)) try { det = await j('data/m/' + encodeURIComponent(id) + '.json') } catch (e) { }
    if (m && m.status !== 'finished') await oddsFor(m);
    const o = Object.assign(det, m || {}); if (m && m.odds_table) { o.odds_table = m.odds_table; o.odds_status = 'ok' } return o }
  if (path === '/api/players') { await ensurePlayers(); const t = norm(q.get('q')); return ST.players.filter(p => norm(p[1]).includes(t)).sort((a, b) => b[6] - a[6]).slice(0, 20).map(p => ({ id: p[0], name: p[1], g: p[0][0], matches: p[6], elo: p[2], rank: p[4] })) }
  if (path === '/api/predict') { await ensurePlayers(); const s = q.get('surface') || 'Hard'; const A = pCard(ST.players.find(p => p[0] === q.get('a')), s), B = pCard(ST.players.find(p => p[0] === q.get('b')), s);
    const r = lrPredict(A, B, s); return { p: r.p, elo_p: r.elo_p, h2h: ['?', '?'], cards: [A, B], factors: Object.entries(r.contrib).filter(([k, v]) => LBL[k] && Math.abs(v) > .01).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 7).map(([k, v]) => ({ label: LBL[k], favors: v > 0 ? 'A' : 'B', value: v })), note: 'logistická regrese v prohlížeči' } }
  if (path === '/api/chat') { await ensurePlayers(); const t = q.get('q'); const surf = /antuk|clay/i.test(t) ? 'Clay' : /tráv|trav|grass/i.test(t) ? 'Grass' : 'Hard';
    const pr = t.split(/\s+(?:vs\.?|v|proti|-)\s+/i); if (pr.length === 2) { const find = s => { const x = norm(s.replace(/\b(antuka|antuce|tráva|trávě|tvrdý|hard|clay|grass)\b/gi, '')); return ST.players.filter(p => norm(p[1]).includes(x)).sort((a, b) => b[6] - a[6])[0] };
      const a = find(pr[0]), b = find(pr[1]); if (a && b) { const A = pCard(a, surf), B = pCard(b, surf), r = lrPredict(A, B, surf); return { answer: `${A.name} vs ${B.name} (${surf}): ${Math.round(r.p * 100)} % : ${Math.round(100 - r.p * 100)} % (logistická regrese v prohlížeči). Elo očekávání ${Math.round(r.elo_p * 100)} %.` } }
      return { answer: 'Hráče jsem nenašel (v datech jsou hráči aktivní od 2022).' } } return { answer: 'Napiš dvojici hráčů, např. „Sinner vs Alcaraz antuka“.' } }
  throw new Error('neznámé API ' + path) }
