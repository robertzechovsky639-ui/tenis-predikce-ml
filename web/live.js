/* Čistá logika bez DOM: monotónní živé skóre, párování jmen a záložní predikce.
   Stejná pravidla skóre jsou v backend/scoremerge.py. */
(function (root) {
  'use strict';
  const RANK_ELO = { M: [3050.7, -198.2], W: [2883.6, -140.7] };
  const TOUR_PRIOR = { ATP: 1560, WTA: 1560, Challenger: 1500, 'WTA 125': 1500, 'ITF muži': 1440, 'ITF ženy': 1440 };
  const QUAL_DROP = 25, MIN_HISTORY = 5;

  function toks(s) {
    return (String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]+/g) || []).filter(t => t !== 'jr' && t !== 'sr');
  }
  function isPlaceholder(name) {
    const t = toks(name);
    if (!t.length) return true;
    const raw = t.join('');
    return ['tbd', 'tba', 'bye', 'qualifier', 'qualifying', 'unknown', 'player'].includes(raw) || (t.length === 1 && ['tbd', 'tba', 'bye'].includes(t[0]));
  }
  function relaxKeys(name) {
    const s = String(name || '').trim();
    const m = s.match(/^(.*?)\s+((?:[A-Za-z][\w\-]*\.\s*)+)$/);
    if (m) {
      const sur = toks(m[1]).join('');
      const parts = m[2].split(/\s+/).map(toks).filter(x => x.length);
      if (sur.length >= 4 && parts.length) return [[sur, parts[0][0][0]]];
      return [];
    }
    const t = toks(s);
    if (t.length < 2) return [];
    const keys = [];
    const sur = t.slice(1).join('');
    if (sur.length >= 4) keys.push([sur, t[0][0]]);
    if (t.length === 2 && t[0].length >= 4) { const rev = [t[0], t[t.length - 1][0]]; if (rev[0] !== keys[0]?.[0] || rev[1] !== keys[0]?.[1]) keys.push(rev); }
    return keys;
  }
  function buildIndex(players) {
    const full = new Map(), rx = new Map(), byId = new Map();
    for (const p of players || []) {
      byId.set(p[0], p);
      const g = p[0][0], t = toks(p[1]);
      if (t.length) {
        const k = g + '|' + t.slice().sort().join(' ');
        const prev = full.get(k);
        if (!prev || p[6] > prev[6]) full.set(k, p);
      }
      for (const key of relaxKeys(p[1])) {
        const k = g + '|' + key[0] + '|' + key[1];
        const cur = rx.get(k);
        if (cur === undefined) rx.set(k, p);
        else if (cur && cur[0] !== p[0]) rx.set(k, null);
      }
    }
    return { full, rx, byId };
  }
  function matchPlayer(index, g, name) {
    if (!index || !name || isPlaceholder(name)) return null;
    const t = toks(name);
    if (t.length) {
      const hit = index.full.get(g + '|' + t.slice().sort().join(' '));
      if (hit) return hit;
    }
    for (const key of relaxKeys(name)) {
      const hit = index.rx.get(g + '|' + key[0] + '|' + key[1]);
      if (hit) return hit;
    }
    return null;
  }
  function eloFromRank(g, rank) {
    const c = RANK_ELO[g] || RANK_ELO.M;
    return c[0] + c[1] * Math.log(Math.max(1, +rank));
  }
  function tourElo(m) {
    const base = TOUR_PRIOR[m.circuit] ?? 1500;
    return m.qual ? base - QUAL_DROP : base;
  }
  function noteOf(kinds) {
    if (kinds.some(k => k === 'tbd')) return 'Soupeř není určen – nízká spolehlivost.';
    if (kinds.some(k => k === 'rank') && kinds.every(k => k === 'hist' || k === 'rank')) return 'Odhad ze žebříčku – nízká spolehlivost.';
    if (kinds.some(k => k === 'rank')) return 'Odhad ze žebříčku a úrovně turnaje – nízká spolehlivost.';
    return 'Odhad podle úrovně turnaje – hráč bez historie, nízká spolehlivost.';
  }
  function fallbackPred(m, eloOf) {
    const el = [], kinds = [];
    for (let i = 0; i < 2; i++) {
      const p = m.players[i] || {};
      const id = m.pids && m.pids[i];
      const known = id && eloOf ? eloOf(id) : null;
      if (known != null && !isPlaceholder(p.name)) { el.push(+known); kinds.push('hist'); continue; }
      if (isPlaceholder(p.name)) { el.push(tourElo(m)); kinds.push('tbd'); continue; }
      const rk = p.ranking;
      if (rk) { el.push(eloFromRank(m.g || 'M', rk)); kinds.push('rank'); continue; }
      el.push(tourElo(m)); kinds.push('tour');
    }
    const pe = 1 / (1 + 10 ** ((el[1] - el[0]) / 400));
    const unknown = kinds.filter(k => k !== 'hist').length;
    let shrink = unknown >= 2 ? 0.6 : unknown === 1 ? 0.75 : 1;
    if (kinds.some(k => k === 'tbd')) shrink = Math.min(shrink, 0.35);
    const p = Math.min(0.98, Math.max(0.02, 0.5 + (pe - 0.5) * shrink));
    return { p: Math.round(p * 10000) / 10000, note: noteOf(kinds), kinds };
  }

  function finishedSet(s) {
    if (!s) return false;
    const a = s[0] | 0, b = s[1] | 0, hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi >= 6 && hi - lo >= 2) || (hi === 7 && lo === 6);
  }
  function normSets(sets) {
    const o = [];
    for (const s of sets || []) {
      const a = s[0] | 0, b = s[1] | 0;
      if (a < 0 || b < 0) continue;
      o.push([a, b]);
    }
    // 0:0 po dohraném setu je nový set (i po 7:6). 0:0 po nedohraném setu je jen výplň.
    while (o.length >= 2 && o[o.length - 1][0] === 0 && o[o.length - 1][1] === 0 && !finishedSet(o[o.length - 2])) o.pop();
    while (o.length === 1 && o[0][0] === 0 && o[0][1] === 0) o.pop();
    while (o.length >= 2 && o[o.length - 1][0] === 0 && o[o.length - 1][1] === 0 && o[o.length - 2][0] === 0 && o[o.length - 2][1] === 0) o.pop();
    return o;
  }
  function dropOpen(sets) {
    const s = normSets(sets).map(x => [x[0], x[1]]);
    if (s.length && s[s.length - 1][0] === 0 && s[s.length - 1][1] === 0) s.pop();
    return s;
  }
  function liveSplit(sets, status) {
    // Dohaný set (i 7:6 / 6:7) nepatří do aktuálního. Když je poslední dohraný a zápas žije, hraje se další od 0:0.
    const s = normSets(sets).map(x => [x[0], x[1]]);
    if (status === 'live') {
      if (!s.length) return { done: [], cur: [0, 0], n: 1 };
      if (finishedSet(s[s.length - 1])) return { done: s, cur: [0, 0], n: s.length + 1 };
      return { done: s.slice(0, -1), cur: s[s.length - 1], n: s.length };
    }
    return { done: s.filter(finishedSet), cur: null, n: s.length };
  }
  function pointRank(pts) {
    if (!pts) return -1;
    const a = +pts[0] || 0, b = +pts[1] || 0;
    return (a + b) * 100 + Math.max(a, b);
  }
  function cmpScore(aSets, aPts, bSets, bPts) {
    const A = normSets(aSets), B = normSets(bSets);
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const x = A[i], y = B[i];
      if (!x || !y) {
        const longer = y || x, prev = (y ? B : A)[i - 1];
        const open = longer && longer[0] === 0 && longer[1] === 0 && prev && finishedSet(prev);
        if (open) {
          // Nový set 0:0 je dopředu hned, i když body v gemu ještě nestouply. Kratší seznam je pozadu.
          // Nižší body ten set nezablokují — applyLive si je v tom jediném případě nechá.
          if (!x && y) return 1;
          return -1;
        }
        const xx = x || [0, 0], yy = y || [0, 0];
        if (xx[0] === yy[0] && xx[1] === yy[1]) continue;
        if (yy[0] >= xx[0] && yy[1] >= xx[1]) return 1;
        if (xx[0] >= yy[0] && xx[1] >= yy[1]) return -1;
        return -1;
      }
      if (x[0] === y[0] && x[1] === y[1]) continue;
      if (y[0] >= x[0] && y[1] >= x[1]) return 1;
      if (x[0] >= y[0] && x[1] >= y[1]) return -1;
      return -1;
    }
    const ap = pointRank(aPts), bp = pointRank(bPts);
    if (bp > ap) return 1;
    if (bp < ap) return -1;
    return 0;
  }
  function isDeuceReset(oldPts, newPts) {
    if (!oldPts || !newPts) return false;
    const a = +oldPts[0] || 0, b = +oldPts[1] || 0, c = +newPts[0] || 0, d = +newPts[1] || 0;
    return Math.min(a, b) >= 3 && Math.max(a, b) >= 4 && Math.abs(a - b) === 1 && c === 3 && d === 3;
  }
  function cleanSets(sets) { return normSets(sets).map(s => [s[0], s[1]]); }
  function isAdvAfterDeuce(oldPts, newPts) {
    if (!oldPts || !newPts) return false;
    const a = +oldPts[0] || 0, b = +oldPts[1] || 0, c = +newPts[0] || 0, d = +newPts[1] || 0;
    return a === 3 && b === 3 && Math.min(c, d) >= 3 && Math.max(c, d) >= 4 && Math.abs(c - d) === 1;
  }
  function reportedServer(raw, same) {
    // 1 = domácí daného zdroje, 2 = host. Bez hlášeného podávajícího null — žádný odhad z parity gemů.
    const sv = +raw;
    if (sv !== 1 && sv !== 2) return null;
    return same ? sv : 3 - sv;
  }
  function tbOnFirst(pts) {
    const n = ((pts && pts[0]) | 0) + ((pts && pts[1]) | 0);
    return Math.floor((n + 1) / 2) % 2 === 0;
  }
  function tbBlock(pts) {
    const n = ((pts && pts[0]) | 0) + ((pts && pts[1]) | 0);
    return n === 0 ? 0 : Math.floor((n + 1) / 2);
  }
  function tbNow(first, pts) {
    if (first !== 1 && first !== 2) return null;
    return tbOnFirst(pts) ? first : 3 - first;
  }
  function tbFirstOf(current, pts) {
    if (current !== 1 && current !== 2) return null;
    return tbOnFirst(pts) ? current : 3 - current;
  }
  function tbView(sets, pts, bestOf, matchTb) {
    // Běžný tiebreak je 6:6. Supertiebreak na 10 je rozhodující set, nebo celý rozhodující set hraný jen jako tiebreak.
    const s = normSets(sets);
    const p = [(pts && pts[0]) | 0, (pts && pts[1]) | 0];
    const bo = bestOf || 3;
    const cur = s.length ? s[s.length - 1] : null;
    if (cur && cur[0] === 6 && cur[1] === 6) {
      return { target: s.length >= bo ? 10 : 7, pts: p, kind: 'set' };
    }
    const played = cur && cur[0] === 0 && cur[1] === 0 ? s.slice(0, -1) : s;
    if (!played.length || !played.every(finishedSet)) return null;
    let a = 0, b = 0;
    for (const g of played) { if ((g[0] | 0) > (g[1] | 0)) a++; else if ((g[1] | 0) > (g[0] | 0)) b++; }
    if (a === b && a > 0 && a * 2 + 1 === bo && (matchTb || p[0] > 4 || p[1] > 4)) return { target: 10, pts: p, kind: 'match' };
    return null;
  }
  function inferTbFirst(prevSets, sets, prevServer) {
    // Do tiebreaku se vstupuje o jeden gem. Podává ten, kdo přijímal poslední gem.
    if (prevServer !== 1 && prevServer !== 2) return null;
    const A = normSets(prevSets), B = normSets(sets);
    if (!B.length || A.length !== B.length) return null;
    const p = A[A.length - 1], c = B[B.length - 1];
    if (c[0] !== 6 || c[1] !== 6) return null;
    if ((c[0] + c[1]) - ((p[0] | 0) + (p[1] | 0)) !== 1) return null;
    for (let i = 0; i < A.length - 1; i++) if (A[i][0] !== B[i][0] || A[i][1] !== B[i][1]) return null;
    return 3 - prevServer;
  }
  function settleTb(m, upd, prevSets, prevPts, prevServer) {
    if (m.status === 'finished') { m.tbFirst = null; m.tbReported = null; m.tbBlock = null; return; }
    const view = tbView(m.sets, m.pts, m.best_of, m.match_tb);
    const was = tbView(prevSets, prevPts, m.best_of, m.match_tb);
    if (view && view.kind === 'match') m.match_tb = true;
    const reported = upd.server === 1 || upd.server === 2 ? upd.server : null;
    const trust = upd.srvTrust || 0;
    const eligible = reported != null && trust >= (m.srvTrust || 0);
    if (view) {
      const pts = view.pts;
      const carried = !was && eligible && reported === prevServer && !!inferTbFirst(prevSets, m.sets, prevServer);
      const fresh = eligible && !carried && (m.tbReported == null || reported !== m.tbReported || (m.tbBlock != null && tbBlock(pts) === m.tbBlock));
      if (fresh) {
        m.tbFirst = tbFirstOf(reported, pts);
        m.tbReported = reported;
        m.tbBlock = tbBlock(pts);
        m.server = reported;
        return;
      }
      if (carried || (m.tbFirst == null && !eligible)) {
        const inferred = inferTbFirst(prevSets, m.sets, prevServer);
        if (inferred) {
          m.tbFirst = inferred;
          m.tbReported = reported;
          m.tbBlock = null;
          m.server = tbNow(inferred, pts);
          m.srv_src = 'tb';
          return;
        }
      }
      if (m.tbFirst) {
        const now = tbNow(m.tbFirst, pts);
        if (now) { m.server = now; if (!fresh) m.srv_src = 'tb'; }
      }
      return;
    }
    if (was && m.tbFirst) {
      const next = 3 - m.tbFirst;
      const sticky = eligible && m.tbReported != null && reported === m.tbReported && reported !== next;
      if (eligible && !sticky) m.server = reported;
      else { m.server = next; m.srvTrust = 0; m.srv_src = 'tb-next'; }
      m.tbFirst = null; m.tbReported = null; m.tbBlock = null;
      return;
    }
    m.tbFirst = null; m.tbReported = null; m.tbBlock = null;
  }
  function takeServer(m, upd) {
    const sv = upd.server;
    if (sv !== 1 && sv !== 2) return false;
    const trust = upd.srvTrust || 0;
    if (trust < (m.srvTrust || 0)) return false;
    if (m.server === sv && (m.srvTrust || 0) >= trust) return false;
    m.server = sv;
    m.srvTrust = trust;
    if (upd.srv_src) m.srv_src = upd.srv_src;
    return true;
  }
  function tbTarget(setIndex, bestOf) { return setIndex >= (bestOf || 3) - 1 ? 10 : 7; }
  function tbWinner(pts, target) {
    const x = (pts && pts[0]) | 0, y = (pts && pts[1]) | 0, hi = Math.max(x, y), lo = Math.min(x, y);
    if (hi >= (target || 7) && hi - lo >= 2) return x > y ? 1 : 2;
    return 0;
  }
  function closeFinishedTb(sets, pts, bestOf) {
    // Tiebreak dohraný v bodech (7:5, 10:8, …) je hotový set 7:6, i když zdroj ještě nechává gemy 6:6.
    const s = (sets || []).map(x => [x[0] | 0, x[1] | 0]);
    const p = pts ? [(pts[0] | 0), (pts[1] | 0)] : null;
    if (!s.length || !p || s[s.length - 1][0] !== 6 || s[s.length - 1][1] !== 6) return { sets: s, pts: p, closed: false };
    const w = tbWinner(p, tbTarget(s.length - 1, bestOf));
    if (!w) return { sets: s, pts: p, closed: false };
    s[s.length - 1] = w === 1 ? [7, 6] : [6, 7];
    return { sets: s, pts: [0, 0], closed: true };
  }
  function onlyOpenedSet(prev, next) {
    const A = normSets(prev), B = normSets(next);
    if (!A.length || B.length !== A.length + 1) return false;
    const last = B[B.length - 1];
    if (last[0] !== 0 || last[1] !== 0 || !finishedSet(B[B.length - 2])) return false;
    for (let i = 0; i < A.length; i++) if (A[i][0] !== B[i][0] || A[i][1] !== B[i][1]) return false;
    return true;
  }
  function gamePointToken(v) {
    return v == null || v === '' || v === 0 || v === '0' || v === 15 || v === '15' || v === 30 || v === '30' || v === 40 || v === '40' || v === 'A';
  }
  function parseSofaScore(homeScore, awayScore, bestOf) {
    // periodN je počet gemů. Dohraný tiebreak často zůstane 6:6 a výsledek je v periodNTieBreak.
    const hs = homeScore || {}, as = awayScore || {};
    const sets = [];
    let closed = false;
    for (let i = 1; i <= 5; i++) {
      if (hs['period' + i] === undefined && as['period' + i] === undefined) continue;
      let a = hs['period' + i] | 0, b = as['period' + i] | 0;
      const ta = hs['period' + i + 'TieBreak'], tbk = as['period' + i + 'TieBreak'];
      closed = false;
      if (a === 6 && b === 6 && (ta !== undefined || tbk !== undefined)) {
        const w = tbWinner([ta | 0, tbk | 0], tbTarget(i - 1, bestOf));
        if (w === 1) { a = 7; closed = true; }
        else if (w === 2) { b = 7; closed = true; }
      }
      sets.push([a, b]);
    }
    const SPT = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4 };
    const last = sets.length ? sets[sets.length - 1] : null;
    const tb = last && last[0] === 6 && last[1] === 6;
    let pts, ptsRaw;
    if (tb) {
      pts = [+hs.point || 0, +as.point || 0];
      ptsRaw = [hs.point ?? 0, as.point ?? 0];
    } else if (closed && !(gamePointToken(hs.point) && gamePointToken(as.point))) {
      // Tiebreak se právě zavřel a point je ještě 7:5, ne body nového gemu.
      pts = [0, 0];
      ptsRaw = [0, 0];
    } else {
      pts = [SPT[hs.point] ?? (+hs.point || 0), SPT[as.point] ?? (+as.point || 0)];
      ptsRaw = [hs.point ?? 0, as.point ?? 0];
    }
    return { sets, pts, pts_raw: ptsRaw };
  }
  function map365Points(rawHome, rawAway) {
    // 0/15/30/40/50 jsou body gemu. 1, 2, 7, … jsou body tiebreaku a nesmí spadnout na nulu ani na výhodu.
    const PT = { 0: 0, 15: 1, 30: 2, 40: 3, 50: 4 };
    const mapPt = n => (n in PT ? PT[n] : (n | 0));
    const raw = [rawHome ?? 0, rawAway ?? 0];
    let p = raw.map(x => mapPt(+x || 0));
    if ((+raw[0] === 50 || +raw[1] === 50) && !((p[0] === 4 && p[1] === 3) || (p[0] === 3 && p[1] === 4))) p = +raw[0] === 50 ? [4, 3] : [3, 4];
    return p;
  }
  function applyLive(m, upd, token, fresh) {
    // Starší odpověď stejného polleru smí skóre jen posunout dopředu. Stejný nebo starší stav
    // (včetně podávajícího z méně spolehlivého zdroje) se zahodí, aby seznam nekmital.
    const closed = closeFinishedTb(upd.sets, upd.pts, m.best_of);
    if (closed.closed) upd = Object.assign({}, upd, { sets: closed.sets, pts: closed.pts, pts_raw: [0, 0] });
    const prevSets = m.sets, prevPts = m.pts, prevServer = m.server;
    const stale = !!(fresh && token && !fresh(token));
    if (m.status === 'finished' && upd.status !== 'finished') return false;
    if (m.status === 'live' && upd.status === 'upcoming') return false;
    if (upd.status === 'finished' && m.status !== 'finished') {
      const setRel = cmpScore(dropOpen(m.sets), null, dropOpen(upd.sets), null);
      if (setRel < 0 || (stale && setRel <= 0)) return false;
      m.sets = dropOpen(setRel > 0 ? upd.sets : m.sets);
      m.status = 'finished';
      if (upd.winner) m.winner = upd.winner;
      m.pts = null; m.pts_raw = null; m.server = null; m.srvTrust = 0;
      m.tbFirst = null; m.tbReported = null; m.tbBlock = null;
      m._accAt = Date.now();
      return true;
    }
    const rel = cmpScore(m.sets, m.pts, upd.sets, upd.pts);
    const sameSrc = !m.src_pts || !upd.src_pts || upd.src_pts === m.src_pts;
    const deuce = rel < 0 && !stale && isDeuceReset(m.pts, upd.pts) && sameSrc && token && token.t0 > (m._accAt || 0);
    if (rel < 0 && !deuce) return false;
    if (stale && rel <= 0) return false;
    const setsChanged = JSON.stringify(normSets(m.sets)) !== JSON.stringify(normSets(upd.sets));
    if (!setsChanged && isAdvAfterDeuce(m.pts, upd.pts)) {
      const other = m.src_pts && upd.src_pts && m.src_pts !== upd.src_pts;
      const oldReq = stale || !token || token.t0 < (m._accAt || 0);
      if (other || oldReq) return false;
    }
    const now = Date.now();
    if (rel === 0 && !deuce) {
      if (token && m._accAt && token.t0 < m._accAt) return false;
      let changed = false;
      if (upd.status === 'finished' && m.status !== 'finished') {
        m.status = 'finished'; if (upd.winner) m.winner = upd.winner;
        m.pts = null; m.pts_raw = null; m.server = null; m.srvTrust = 0;
        m.tbFirst = null; m.tbReported = null; m.tbBlock = null; changed = true;
      }
      if (upd.status !== 'finished') {
        if (takeServer(m, upd)) changed = true;
        settleTb(m, upd, prevSets, prevPts, prevServer);
        if (m.server !== prevServer) changed = true;
      }
      if (changed) { m._accAt = now; m._lk = ''; }
      return changed;
    }
    if (setsChanged) {
      const keepPts = onlyOpenedSet(m.sets, upd.sets) && pointRank(upd.pts) < pointRank(m.pts);
      m.sets = cleanSets(upd.sets);
      if (!keepPts) {
        m.pts = upd.pts ? upd.pts.slice() : null;
        m.pts_raw = upd.pts ? (upd.pts_raw || null) : null;
        // Nový gem: starý podávající už neplatí. Bez nového hlášení raději žádný než odhad.
        if (upd.server === 1 || upd.server === 2) {
          m.server = upd.server; m.srvTrust = upd.srvTrust || 0; m.srv_src = upd.srv_src || null;
        } else { m.server = null; m.srvTrust = 0; m.srv_src = null; }
      }
    } else {
      if (upd.pts) { m.pts = upd.pts.slice(); if (upd.pts_raw) m.pts_raw = upd.pts_raw; }
      takeServer(m, upd);
    }
    if (upd.status) m.status = upd.status;
    if (upd.winner) m.winner = upd.winner;
    if (upd.src_pts) m.src_pts = upd.src_pts;
    if (m.status !== 'finished') settleTb(m, upd, prevSets, prevPts, prevServer);
    m.t_pts = now; m._accAt = now;
    if (m.status === 'live') m.day = 0;
    m._lk = '';
    return true;
  }

  root.TenisLive = {
    toks, isPlaceholder, relaxKeys, buildIndex, matchPlayer, eloFromRank, tourElo, fallbackPred,
    normSets, pointRank, cmpScore, isDeuceReset, finishedSet, liveSplit, closeFinishedTb, tbWinner, tbTarget, parseSofaScore, map365Points, reportedServer, tbNow, tbView, applyLive, MIN_HISTORY, RANK_ELO, TOUR_PRIOR
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
