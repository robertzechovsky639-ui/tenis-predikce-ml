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
