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

  function normSets(sets) {
    const o = [];
    for (const s of sets || []) {
      const a = s[0] | 0, b = s[1] | 0;
      if (a < 0 || b < 0) continue;
      o.push([a, b]);
    }
    while (o.length && o[o.length - 1][0] === 0 && o[o.length - 1][1] === 0) o.pop();
    return o;
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
      const x = A[i] || [0, 0], y = B[i] || [0, 0];
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
  function applyLive(m, upd, token, fresh) {
    // Starší odpověď stejného polleru smí skóre jen posunout dopředu. Stejný nebo starší stav
    // (včetně podávajícího z méně spolehlivého zdroje) se zahodí, aby seznam nekmital.
    const stale = !!(fresh && token && !fresh(token));
    if (m.status === 'finished' && upd.status !== 'finished') return false;
    if (m.status === 'live' && upd.status === 'upcoming') return false;
    if (upd.status === 'finished' && m.status !== 'finished') {
      const setRel = cmpScore(m.sets, null, upd.sets, null);
      if (setRel < 0 || (stale && setRel <= 0)) return false;
      if (setRel > 0) m.sets = cleanSets(upd.sets);
      m.status = 'finished';
      if (upd.winner) m.winner = upd.winner;
      m.pts = null; m.pts_raw = null; m.server = null; m.srvTrust = 0;
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
        m.pts = null; m.pts_raw = null; m.server = null; m.srvTrust = 0; changed = true;
      }
      if (upd.status !== 'finished' && takeServer(m, upd)) changed = true;
      if (changed) m._accAt = now;
      return changed;
    }
    if (setsChanged) {
      m.sets = cleanSets(upd.sets);
      m.pts = upd.pts ? upd.pts.slice() : null;
      m.pts_raw = upd.pts ? (upd.pts_raw || null) : null;
      // Nový gem: starý podávající už neplatí. Bez nového hlášení raději žádný než odhad.
      if (upd.server === 1 || upd.server === 2) {
        m.server = upd.server; m.srvTrust = upd.srvTrust || 0; m.srv_src = upd.srv_src || null;
      } else { m.server = null; m.srvTrust = 0; m.srv_src = null; }
    } else {
      if (upd.pts) { m.pts = upd.pts.slice(); if (upd.pts_raw) m.pts_raw = upd.pts_raw; }
      takeServer(m, upd);
    }
    if (upd.status) m.status = upd.status;
    if (upd.winner) m.winner = upd.winner;
    if (upd.src_pts) m.src_pts = upd.src_pts;
    m.t_pts = now; m._accAt = now;
    if (m.status === 'live') m.day = 0;
    return true;
  }

  root.TenisLive = {
    toks, isPlaceholder, relaxKeys, buildIndex, matchPlayer, eloFromRank, tourElo, fallbackPred,
    normSets, pointRank, cmpScore, isDeuceReset, reportedServer, applyLive, MIN_HISTORY, RANK_ELO, TOUR_PRIOR
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
