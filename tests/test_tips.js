// Tipy v průběhu (web/intips.js) proti Markovu z web/static.js a vysvětlení tipu (web/explain.js)
const assert = require('assert'), fs = require('fs');
const T = require('../web/intips.js'), E = require('../web/explain.js');
const src = fs.readFileSync(__dirname + '/../web/static.js', 'utf8');
const MK = new Function(src.match(/const MK = \(\(\) => \{[^]*?\n\}\)\(\);/)[0] + '\nreturn MK;')();
const close = (a, b, e = 1e-9, m = '') => assert(Math.abs(a - b) < e, `${m} ${a} vs ${b}`);
const pa = .66, pb = .61;
// 1) výhra setu / zápasu se shoduje s MK
for (const [cur, pts, srv] of [[[0, 0], [0, 0], 1], [[3, 2], [1, 2], 2], [[5, 6], [0, 0], 1], [[6, 6], [3, 4], 1], [[4, 4], [0, 0], null]]) {
  const r = T.compute({ pa, pb, done: [[6, 4]], cur, pts, server: srv, bo: 3 });
  const avg = f => srv ? f(srv === 1) : (f(true) + f(false)) / 2;
  close(r.cur.a, avg(s => MK.setP(pa, pb, cur[0], cur[1], s, pts, 7)), 1e-9, 'set ' + cur);
  // MK.matchP průměruje podávajícího dalších setů a rozhodující set bere s tiebreakem do 7; InTips sleduje střídání podání a TB do 10
  close(r.match.a, avg(s => MK.matchP(pa, pb, 1, 0, cur[0], cur[1], s, pts, 3, 7)), 5e-3, 'match ' + cur);
}
// 2) rozdělení setu sčítá do 1, tiebreak 6:6 = jistota
const d = T.setDist(pa, pb, 0, 0, true, [0, 0], 7); close(d.reduce((t, o) => t + o.p, 0), 1, 1e-9, 'sum');
assert.strictEqual(T.compute({ pa, pb, done: [], cur: [6, 6], pts: [2, 1], server: 1, bo: 3 }).cur.tb, 1);
assert(T.compute({ pa, pb, done: [], cur: [5, 1], server: 1, bo: 3 }).cur.tb < .05, 'při 5:1 je tiebreak nepravděpodobný');
// 3) over/under konzistentní a reaguje na skóre
const a = T.compute({ pa, pb, done: [], cur: [0, 0], server: 1, bo: 3 }), b = T.compute({ pa, pb, done: [[7, 6]], cur: [5, 5], server: 1, bo: 3 });
assert(b.match.exp > a.match.exp, 'po dlouhém prvním setu víc gemů');
for (const x of [...a.cur.lines, ...a.match.lines]) assert(x.over > 0 && x.over < 1);
assert(b.next && b.next.played > 0 && b.next.played < 1);
// 4) rozhodující set: další set neexistuje, decider = 1
const c = T.compute({ pa, pb, done: [[6, 4], [4, 6]], cur: [2, 2], server: 2, bo: 3 }); assert.strictEqual(c.next, null); assert.strictEqual(c.match.decider, 1); close(c.match.a, c.cur.a, 1e-9);
// 5) supertiebreak
const s = T.compute({ pa, pb, done: [[6, 4], [4, 6]], cur: [0, 0], pts: [5, 3], server: 1, bo: 3, matchTb: true, tbTo: 10 }); close(s.match.a, s.cur.a, 1e-9); assert(s.cur.a > .6);
// 6) vysvětlení
const rs = E.rows([{ key: 'selo_d', label: 'Elo na povrchu', value: .5, raw: 150 }, { key: 'h2h_d', label: 'Vzájemné zápasy (H2H)', value: -.2, raw: -3 }, { key: 'fat_d', label: 'Únava', value: .005, raw: 1 }], .7, ['Sinner', 'Alcaraz'], 'Clay');
assert.strictEqual(rs.length, 2); assert.strictEqual(rs[0].who, 'Sinner'); assert(/antuce o 150 bodů vyšší/.test(rs[0].text));
assert.strictEqual(rs[1].who, 'Alcaraz'); assert(/vede vzájemné zápasy o 3/.test(rs[1].text), rs[1].text); assert(rs[0].pp > rs[1].pp && rs[0].pp > 5 && rs[0].pp < 15);
assert(/Tip: Sinner \(70 %\)/.test(E.summary(rs, .7, ['Sinner', 'Alcaraz'])));
console.log('tips ok');
