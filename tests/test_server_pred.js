'use strict';
// Podávající se bere jen z hlášení zdroje. Živá predikce se musí pohnout, když se podávající přepne,
// a bez podávajícího je průměr obou stran.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const context = {
  console, Date, Math, JSON, String, Number, Object, Array, Map, Set, RegExp, Error, Promise,
  parseInt, isNaN, decodeURIComponent, encodeURIComponent, URL, URLSearchParams,
  setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
  location: { hostname: 'example.com', search: '', href: 'http://example.com/' },
  localStorage: {}, document: { hidden: true, querySelectorAll: () => [] },
  navigator: {}, performance: { now: () => Date.now() }, fetch: async () => { throw new Error('offline'); }
};
context.matchMedia = () => ({ matches: false });
context.globalThis = context;
vm.createContext(context);
const code = fs.readFileSync(path.join(root, 'web/live.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'web/static.js'), 'utf8')
  + '\nglobalThis.__t = { liveCalc, sofaServer };';
vm.runInContext(code, context, { filename: 'static.js' });
const { liveCalc, sofaServer } = context.__t;

// Lichý počet gemů ani tie-break nesmí firstToServe otočit. Chybějící hlášení není odhad.
const odd = [[6, 3], [2, 2]];
assert.strictEqual(sofaServer({ firstToServe: 2 }, true), 2);
assert.strictEqual(sofaServer({ firstToServe: 1 }, false), 2);
assert.strictEqual(sofaServer({ firstToServe: 2, sets: odd }, true), 2);
assert.strictEqual(sofaServer({ firstToServe: 1 }, true), 1);
assert.strictEqual(sofaServer({}, true), null);
assert.strictEqual(sofaServer({ firstToServe: 0 }, true), null);

function match(server) {
  return {
    id: 'srv', status: 'live', pred: 0.55, g: 'M', best_of: 3, server,
    sets: [[5, 4]], pts: [0, 0], players: [{ name: 'A' }, { name: 'B' }], odds: null
  };
}
const serving = match(1); liveCalc(serving);
const returning = match(2); liveCalc(returning);
const unknown = match(null); liveCalc(unknown);
assert.ok(serving.live.match > returning.live.match, 'podání hráče A musí zvednout jeho šanci na výhru');
assert.ok(serving.live.game > 0.5 && returning.live.game < 0.5);
assert.strictEqual(unknown.live.game, null);
assert.ok(Math.abs(unknown.live.match - (serving.live.match + returning.live.match) / 2) < 1e-9);

const live = match(1); liveCalc(live);
const before = live.live.match;
live.server = 2; liveCalc(live);
assert.ok(live.live.match < before, 'přepnutí podávajícího musí snížit predikci hráče A');
assert.ok(Math.abs(live.live.match - returning.live.match) < 1e-12);

// Tiebreak: podávající aktuálního bodu. Z 0:0 po vyhraném bodu podává soupeř a predikce na to navazuje.
function tbMatch(server, sets, pts, bestOf) {
  return {
    id: 'tb', status: 'live', pred: 0.55, g: 'M', best_of: bestOf || 3, server,
    sets, pts, players: [{ name: 'A' }, { name: 'B' }], odds: null
  };
}
const tb0 = tbMatch(1, [[6, 6]], [0, 0]); liveCalc(tb0);
const tbWin = tbMatch(2, [[6, 6]], [1, 0]); liveCalc(tbWin);
const tbLose = tbMatch(2, [[6, 6]], [0, 1]); liveCalc(tbLose);
const pa = tb0.live.serve_a;
assert.ok(Math.abs(tb0.live.set - (pa * tbWin.live.set + (1 - pa) * tbLose.live.set)) < 1e-9);
const stuckTb = tbMatch(1, [[6, 6]], [1, 0]); liveCalc(stuckTb);
assert.ok(stuckTb.live.set !== tbWin.live.set, 'přepnutí podání v tiebreaku musí změnit šanci setu');
assert.strictEqual(stuckTb.live.game, null);

// Supertiebreak rozhodujícího setu na 10: 8:6 ještě běží, 10:8 už ne. Samostatný tiebreak taky.
const superMid = tbMatch(1, [[6, 4], [4, 6], [6, 6]], [8, 6]); liveCalc(superMid);
assert.ok(superMid.live.set > 0 && superMid.live.set < 1, '8:6 v supertiebreaku není konec');
const superOver = tbMatch(1, [[6, 4], [4, 6], [6, 6]], [10, 8]); liveCalc(superOver);
assert.strictEqual(superOver.live.set, 1);
const regOver = tbMatch(1, [[6, 6]], [7, 4]); liveCalc(regOver);
assert.strictEqual(regOver.live.set, 1);
const matchTbA = tbMatch(1, [[6, 4], [4, 6]], [5, 4]); matchTbA.match_tb = true; liveCalc(matchTbA);
const matchTbB = tbMatch(2, [[6, 4], [4, 6]], [5, 4]); matchTbB.match_tb = true; liveCalc(matchTbB);
assert.ok(matchTbA.live.set > 0 && matchTbA.live.set < 1);
assert.ok(matchTbA.live.set !== matchTbB.live.set);
assert.ok(Math.abs(matchTbA.live.match - matchTbA.live.set) < 1e-12);

// Po tiebreaku podává příjemce prvního bodu a živá predikce se podle toho posune.
const TL = context.TenisLive;
const after = {
  id: 'next', status: 'live', pred: 0.55, g: 'M', best_of: 3, server: null, srvTrust: 0,
  sets: [[6, 6]], pts: [0, 0], players: [{ name: 'A' }, { name: 'B' }], _accAt: 1
};
assert.strictEqual(TL.applyLive(after, { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 2 }, () => true), true);
assert.strictEqual(TL.applyLive(after, { status: 'live', sets: [[7, 6]], pts: [0, 0], server: null, srvTrust: 0, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 3 }, () => true), true);
assert.strictEqual(after.server, 2);
liveCalc(after);
const serveNext = tbMatch(1, [[7, 6]], [0, 0]); liveCalc(serveNext);
// Na 0:0 dalšího setu je šance zápasu pro oba podávající stejná; šance gemu se otočí podle toho, kdo podává.
assert.ok(after.live.game < 0.5 && serveNext.live.game > 0.5);
assert.ok(after.live.game < serveNext.live.game, 'příjemce prvního bodu tiebreaku podává další set');

// 6:7 v tiebreaku a pak 0:0 je třetí set. Stejné číslo, ať je 0:0 v poli setů, nebo jen jako gemy.
function board(sets) {
  const sp = TL.liveSplit(sets, 'live');
  return { n: sp.n, sa: sp.done.filter(s => s[0] > s[1]).length, sb: sp.done.filter(s => s[1] > s[0]).length, cur: sp.cur.join(':') };
}
const fw = tbMatch(1, [[6, 3], [6, 7]], [0, 0]); liveCalc(fw);
const fw3 = tbMatch(1, [[6, 3], [6, 7], [0, 0]], [0, 0]); liveCalc(fw3);
assert.deepStrictEqual(board([[6, 3], [6, 7]]), { n: 3, sa: 1, sb: 1, cur: '0:0' });
assert.deepStrictEqual(board([[6, 3], [6, 7], [0, 0]]), board([[6, 3], [6, 7]]));
assert.ok(fw.live.set > 0.05 && fw.live.set < 0.95, 'třetí set 0:0 není rozhodnutý');
assert.ok(Math.abs(fw.live.set - fw3.live.set) < 1e-12 && Math.abs(fw.live.match - fw3.live.match) < 1e-12);
const seven = tbMatch(1, [[7, 6]], [0, 0]); liveCalc(seven);
assert.strictEqual(TL.liveSplit([[7, 6]], 'live').n, 2);
assert.ok(seven.live.set > 0.05 && seven.live.set < 0.95, '7:6 je dohraný set, predikce patří dalšímu');

// Konec tiebreaku, bod i gem musí živou predikci přepočítat. Samotné 0:0 po 6:7 je stejné číslo jako sbalený set.
const duringTb = tbMatch(1, [[6, 3], [6, 6]], [2, 4]);
liveCalc(duringTb);
assert.strictEqual(duringTb.live.game, null);
const tbMatchP = duringTb.live.match, tbSetP = duringTb.live.set;
const step = tbMatch(1, [[6, 3], [6, 6]], [2, 4]);
step._accAt = 1; step._lk = 'stale';
assert.strictEqual(TL.applyLive(step, { status: 'live', sets: [[6, 3], [6, 6]], pts: [5, 7], pts_raw: [5, 7], server: 1, srvTrust: 1, src_pts: '365scores' }, { src: 's365', t0: 5 }, () => true), true);
assert.strictEqual(step._lk, '');
assert.strictEqual(JSON.stringify(step.sets), JSON.stringify([[6, 3], [6, 7]]));
assert.strictEqual(JSON.stringify(step.pts), JSON.stringify([0, 0]));
liveCalc(step);
assert.ok(step.live.game != null, 'po konci tiebreaku se šance gemu znovu počítá');
assert.ok(step.live.match > 0.05 && step.live.match < 0.95, '1:1 po 6:7 zápas ještě běží');
assert.ok(Math.abs(step.live.match - tbMatchP) > 1e-6, 'konec tiebreaku musí změnit predikci zápasu');
assert.ok(Math.abs(step.live.set - tbSetP) > 1e-6, 'konec tiebreaku musí změnit predikci setu');
assert.strictEqual(TL.liveSplit(step.sets, 'live').n, 3);
const game0 = step.live.game, match0 = step.live.match;
assert.strictEqual(TL.applyLive(step, { status: 'live', sets: step.sets.map(s => s.slice()), pts: [1, 0], pts_raw: [15, 0], server: 1, srvTrust: 1, src_pts: '365scores' }, { src: 's365', t0: 6 }, () => true), true);
liveCalc(step);
assert.ok(Math.abs(step.live.game - game0) > 1e-6, 'bod v gemu musí změnit šanci gemu');
assert.ok(Math.abs(step.live.match - match0) > 1e-6, 'bod v gemu musí změnit predikci zápasu');
const matchPoint = step.live.match;
assert.strictEqual(TL.applyLive(step, { status: 'live', sets: [[6, 3], [6, 7], [0, 1]], pts: [0, 0], pts_raw: [0, 0], server: 2, srvTrust: 2, src_pts: '365scores' }, { src: 's365', t0: 7 }, () => true), true);
liveCalc(step);
assert.strictEqual(TL.liveSplit(step.sets, 'live').cur.join(':'), '0:1');
assert.ok(Math.abs(step.live.match - matchPoint) > 1e-6, 'gem 0:1 musí změnit predikci zápasu');
assert.ok(step.live.game != null && Math.abs(step.live.game - game0) > 1e-6);

// Sloučená karta Cali: body a podávající zůstávají a další bod přepočítá Markov.
const cali = {
  id: 'fs-cali', status: 'live', pred: 0.15, g: 'M', best_of: 3, server: 2, srvTrust: 1,
  sets: [[2, 6], [4, 5]], pts: [2, 3], pts_raw: [30, 40], src_pts: 'Sofascore', _accAt: 1, _lk: 'old',
  players: [{ name: 'Ficovich J. P.' }, { name: 'Meligeni Alves F.' }], odds: null
};
liveCalc(cali);
assert.ok(cali.live.note.indexOf('nejsou k dispozici') < 0, 'když je podávající, detail nesmí hlásit chybějící body');
assert.ok(cali.live.game != null);
const caliBefore = cali.live.match;
assert.strictEqual(TL.applyLive(cali, { status: 'live', sets: [[2, 6], [5, 5]], src_pts: 'Flashscore' }, { src: 'fs', t0: 20 }, () => true), false);
assert.strictEqual(JSON.stringify(cali.pts_raw), JSON.stringify([30, 40]));
assert.strictEqual(cali.server, 2);
assert.strictEqual(TL.applyLive(cali, { status: 'live', sets: [[2, 6], [4, 5]], pts: [2, 4], pts_raw: [30, 'A'], server: 2, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 21 }, () => true), true);
liveCalc(cali);
assert.ok(Math.abs(cali.live.match - caliBefore) > 1e-6, 'další bod na sloučené kartě musí přepočítat predikci');
assert.ok(cali.live.game != null);
