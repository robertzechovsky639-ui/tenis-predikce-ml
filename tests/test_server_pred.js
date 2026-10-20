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
