'use strict';
// Tipy v průběhu zápasu z Markovova modelu (bod na podání pa/pb): kdo vezme set teď a další set, tiebreak, počet gemů.
// Čistá funkce bez DOM – stejný kód běží na GitHub Pages i se serverem a v Node testech.
const InTips = (() => {
  function game(p, a = 0, b = 0) { const memo = {}; const g = (x, y) => { const k = x * 50 + y; if (k in memo) return memo[k]; let r;
    if (x >= 4 && x - y >= 2) r = 1; else if (y >= 4 && y - x >= 2) r = 0; else if (x >= 3 && y >= 3 && x === y) r = p * p / (p * p + (1 - p) * (1 - p));
    else r = p * g(x + 1, y) + (1 - p) * g(x, y + 1); return memo[k] = r }; return g(a, b) }
  function tiebreak(pa, pb, a, b, aFirst, target) { const memo = {}; const t = (x, y) => { const k = x * 100 + y; if (k in memo) return memo[k]; let r;
    if (x >= target && x - y >= 2) r = 1; else if (y >= target && y - x >= 2) r = 0;
    else if (x >= target - 1 && y >= target - 1 && x === y) { const w = pa * (1 - pb), l = (1 - pa) * pb; r = w + l > 0 ? w / (w + l) : .5 }
    else { let as = Math.floor((x + y + 1) / 2) % 2 === 0; if (!aFirst) as = !as; const q = as ? pa : 1 - pb; r = q * t(x + 1, y) + (1 - q) * t(x, y + 1) }
    return memo[k] = r }; return t(a, b) }
  const aServedFirst = (aNow, pts) => (Math.floor(((pts[0] | 0) + (pts[1] | 0) + 1) / 2) % 2 === 0) ? aNow : !aNow;
  // Rozdělení výsledků jednoho setu: [{a:1/0, games, tb, nextA, p}] (tiebreak = 1 gem, 7:6 = 13 gemů)
  function setDist(pa, pb, ga, gb, aSrv, pts, tbTo) {
    const ha = game(pa), hb = game(pb), out = new Map();
    const add = (a, games, tb, nextA, p) => { if (p <= 0) return; const k = a + '|' + games + '|' + (tb ? 1 : 0) + '|' + (nextA ? 1 : 0); out.set(k, (out.get(k) || 0) + p) };
    let frontier = new Map();  // key x|y|as -> p
    const push = (m, x, y, as, p) => { if (p <= 0) return; const k = x + '|' + y + '|' + (as ? 1 : 0); m.set(k, (m.get(k) || 0) + p) };
    const settle = (x, y, as, p) => {  // vrací true, když je set u konce
      if ((x >= 6 && x - y >= 2) || x === 7) { add(1, x + y, x === 7 && y === 6, as, p); return true }
      if ((y >= 6 && y - x >= 2) || y === 7) { add(0, x + y, y === 7 && x === 6, as, p); return true }
      if (x === 6 && y === 6) { const w = tiebreak(pa, pb, 0, 0, as, tbTo); add(1, 13, true, !as, p * w); add(0, 13, true, !as, p * (1 - w)); return true }
      return false };
    if (ga === 6 && gb === 6) { const f = aServedFirst(aSrv, pts), w = tiebreak(pa, pb, pts[0] | 0, pts[1] | 0, f, tbTo); add(1, 13, true, !f, w); add(0, 13, true, !f, 1 - w); return [...unpack(out)] }
    if ((pts[0] | 0) || (pts[1] | 0)) { const q = aSrv ? game(pa, pts[0], pts[1]) : 1 - game(pb, pts[1], pts[0]);
      for (const [x, y, p] of [[ga + 1, gb, q], [ga, gb + 1, 1 - q]]) if (!settle(x, y, !aSrv, p)) push(frontier, x, y, !aSrv, p) }
    else if (!settle(ga, gb, aSrv, 1)) push(frontier, ga, gb, aSrv, 1);
    while (frontier.size) { const nx = new Map();
      for (const [k, p] of frontier) { const [x, y, s] = k.split('|').map(Number), as = s === 1, q = as ? ha : 1 - hb;
        for (const [x2, y2, pp] of [[x + 1, y, q], [x, y + 1, 1 - q]]) if (!settle(x2, y2, !as, p * pp)) push(nx, x2, y2, !as, p * pp) }
      frontier = nx }
    return [...unpack(out)] }
  function* unpack(m) { for (const [k, p] of m) { const [a, g, tb, n] = k.split('|').map(Number); yield { a, games: g, tb: tb === 1, nextA: n === 1, p } } }
  // linie kolem očekávané hodnoty (x,5), nižší než už odehrané gemy nemají smysl
  const around = (e, played, step) => { const L = Math.floor(e) + .5; return [-2, -1, 0, 1, 2].map(i => L + i * step).filter(l => l > played) };
  const useful = (ls) => { const k = ls.filter((x, i) => x.over > .01 && x.over < .99 && !(i && Math.abs(ls[i - 1].over - x.over) < 1e-9)); return (k.length ? k : ls.slice(0, 1)).slice(0, 3) };
  // s = {pa, pb, done:[[a,b]..], cur:[ga,gb], pts:[a,b], server:1|2|null, bo, tbTo, matchTb}
  function compute(s) {
    const bo = s.bo || 3, need = Math.floor(bo / 2) + 1, pts = s.pts || [0, 0], done = s.done || [], cur = s.cur || [0, 0];
    const sa0 = done.filter(x => x[0] > x[1]).length, sb0 = done.length - sa0, g0 = done.reduce((t, x) => t + x[0] + x[1], 0);
    const srvs = s.server ? [s.server === 1] : [true, false], w = 1 / srvs.length;
    const curTarget = s.tbTo || (done.length >= bo - 1 ? 10 : 7);
    const R = { cur: { a: 0, tb: 0, games: new Map() }, next: { played: 0, a: 0, tb: 0 }, total: new Map(), decider: 0, match: 0 };
    for (const srv of srvs) {
      let first;
      if (s.matchTb) { const f = aServedFirst(srv, pts), p = tiebreak(s.pa, s.pb, pts[0] | 0, pts[1] | 0, f, curTarget); first = [{ a: 1, games: 1, tb: true, nextA: !f, p }, { a: 0, games: 1, tb: true, nextA: !f, p: 1 - p }] }
      else first = setDist(s.pa, s.pb, cur[0], cur[1], srv, pts, curTarget);
      for (const o of first) { R.cur.a += w * o.a * o.p; R.cur.tb += w * (o.tb ? o.p : 0); const k = o.games; R.cur.games.set(k, (R.cur.games.get(k) || 0) + w * o.p) }
      // zbytek zápasu: stav (sety A, sety B, gemy, A podává) -> p
      let st = new Map(); const put = (m, a, b, g, n, p) => { const k = a + '|' + b + '|' + g + '|' + (n ? 1 : 0); m.set(k, (m.get(k) || 0) + p) };
      for (const o of first) put(st, sa0 + o.a, sb0 + 1 - o.a, g0 + o.games, o.nextA, w * o.p);
      let idx = 0;
      while (st.size) { const nx = new Map(); idx++;
        for (const [k, p] of st) { const [a, b, g, n] = k.split('|').map(Number);
          if (a >= need || b >= need) { R.total.set(g, (R.total.get(g) || 0) + p); if (a >= need) R.match += p; continue }
          if (a + b === bo - 1) R.decider += p;
          const target = a + b >= bo - 1 ? 10 : 7;
          for (const o of setDist(s.pa, s.pb, 0, 0, n === 1, [0, 0], target)) {
            if (idx === 1) { R.next.played += p * o.p; R.next.a += p * o.p * o.a; if (o.tb) R.next.tb += p * o.p }
            put(nx, a + o.a, b + 1 - o.a, g + o.games, o.nextA, p * o.p) } }
        st = nx } }
    // rozhodující set už běží?
    if (sa0 + sb0 === bo - 1) R.decider = 1;
    const over = (m, line) => { let t = 0; for (const [g, p] of m) if (g > line) t += p; return t };
    const exp = m => { let t = 0; for (const [g, p] of m) t += g * p; return t };
    const out = { cur: { a: R.cur.a, tb: R.cur.tb, lines: useful(around(exp(R.cur.games), cur[0] + cur[1], 1).map(l => ({ line: l, over: over(R.cur.games, l) }))), exp: exp(R.cur.games) },
      next: R.next.played > 1e-9 ? { played: R.next.played, a: R.next.a / R.next.played, tb: R.next.tb / R.next.played } : null,
      match: { a: R.match, decider: R.decider, exp: exp(R.total), lines: useful(around(exp(R.total), g0 + cur[0] + cur[1], 2).map(l => ({ line: l, over: over(R.total, l) }))) } };
    if (s.matchTb) out.cur.lines = [];
    return out }
  return { compute, setDist, game, tiebreak };
})();
if (typeof module !== 'undefined') module.exports = InTips;
