'use strict';
// Živá pravděpodobnost se nesmí znovu počítat celá, když se nezměnil vstup, a podání se cachuje.
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
context.matchMedia = () => ({ matches: !!context.narrow });
context.globalThis = context;
vm.createContext(context);
const code = fs.readFileSync(path.join(root, 'web/live.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'web/static.js'), 'utf8') + '\nglobalThis.__t = { liveCalc, pollPlan };';
vm.runInContext(code, context, { filename: 'static.js' });
const { liveCalc, pollPlan } = context.__t;
const planOf = () => { const p = pollPlan(); return [p.sofa, p.s365, p.espn, p.detail]; };
assert.deepStrictEqual(planOf(), [1500, 2500, 4000, 1100]);
context.narrow = true;
assert.deepStrictEqual(planOf(), [2200, 5000, 8000, 1800]);
context.narrow = false;
context.navigator.connection = { effectiveType: '3g' };
assert.deepStrictEqual(planOf(), [2200, 5000, 8000, 1800]);
context.navigator.connection = null;

function match(i, pts) {
  return { id: 'm' + i, status: 'live', pred: 0.42 + (i % 7) * 0.03, g: i % 2 ? 'W' : 'M', best_of: 3, server: (i % 2) + 1, sets: [[6, 4], [3, 2]], pts: pts, players: [{}, {}], odds: null };
}
const ms = fn => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
const cold = Array.from({ length: 30 }, (_, i) => match(i, [1, 1]));
const coldMs = ms(() => { for (const m of cold) liveCalc(m); });
const warmMs = ms(() => { for (const m of cold) liveCalc(m); });
const moved = cold.map(m => Object.assign(m, { pts: [2, 2], _lk: '' }));
const pointMs = ms(() => { for (const m of moved) liveCalc(m); });
assert.ok(cold.every(m => m.live && m.live.match > 0 && m.live.match < 1));
assert.ok(warmMs * 5 < coldMs + 5, `stejný stav má být skoro zadarmo: cold ${coldMs} ms, warm ${warmMs} ms`);
assert.ok(pointMs * 2 < coldMs + 5, `nový bod při známém předzápasovém p má použít cache podání: cold ${coldMs} ms, point ${pointMs} ms`);
console.log(`liveCalc 30 zápasů: první ${coldMs} ms, beze změny ${warmMs} ms, nový bod ${pointMs} ms`);
