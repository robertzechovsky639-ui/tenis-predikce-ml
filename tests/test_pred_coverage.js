'use strict';
// Offline kontrola: zápasy, které dřív neměly predikci, ji teď mají. Modelové číslo se nepřepisuje.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const fix = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/unpredicted.json'), 'utf8'));
const context = {
  console, Date, Math, JSON, String, Number, Object, Array, Map, Set, RegExp, Error, Promise,
  parseInt, parseFloat, isNaN, decodeURIComponent, encodeURIComponent, URL, URLSearchParams,
  setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
  location: { hostname: 'example.com', search: '', href: 'http://example.com/index.html' },
  localStorage: {},
  document: { hidden: true },
  performance: { now: () => 1 },
  fetch: async () => { throw new Error('offline'); },
  navigator: {}
};
context.globalThis = context;
vm.createContext(context);
const live = fs.readFileSync(path.join(root, 'web/live.js'), 'utf8');
const stat = fs.readFileSync(path.join(root, 'web/static.js'), 'utf8');
vm.runInContext(live + '\n' + stat + '\nglobalThis.__t = { ensurePred, ST, TenisLive, keepLive };', context, { filename: 'static.js' });
const { ensurePred, ST, TenisLive: TL, keepLive } = context.__t;

ST.players = fix.players;
ST.pIndex = TL.buildIndex(fix.players);

let filled = 0, both = 0, one = 0, prior = 0;
for (const src of fix.matches) {
  assert.strictEqual(src.pred, null, src.id);
  const m = JSON.parse(JSON.stringify(src));
  m.sets = []; m.best_of = 3;
  const changed = ensurePred(m);
  assert.strictEqual(changed, true, m.id);
  assert.strictEqual(typeof m.pred, 'number', m.id);
  assert.ok(m.pred >= 0.02 && m.pred <= 0.98, m.id + ' ' + m.pred);
  assert.ok(m.pred_low || (m.pids && m.pids[0] && m.pids[1]), m.id);
  assert.strictEqual(ensurePred(m), false, 'druhé volání nesmí predikci přepsat: ' + m.id);
  filled++;
  const ids = [0, 1].map(i => {
    if (src.pids && src.pids[i] && ST.pIndex.byId.get(src.pids[i])) return src.pids[i];
    const hit = TL.matchPlayer(ST.pIndex, src.g, src.players[i].name);
    return hit ? hit[0] : null;
  });
  const n = ids.filter(Boolean).length;
  if (n === 2) both++; else if (n === 1) one++; else prior++;
}
assert.strictEqual(filled, fix.before_missing);
assert.strictEqual(filled, fix.matches.length);

// zápas, který už model spočítal, si číslo nechá
const kept = { pred: 0.71, pred_lr: 0.7, pred_low: false, pids: ['M1', 'M2'], g: 'M', circuit: 'ATP', qual: 0, status: 'upcoming', sets: [], best_of: 3, players: [{ name: 'Jannik Sinner' }, { name: 'Carlos Alcaraz' }] };
assert.strictEqual(ensurePred(kept), false);
assert.strictEqual(kept.pred, 0.71);
assert.strictEqual(kept.pred_low, false);

// pětiminutové obnovení nesmí vrátit starší skóre ani přepsat model odhadem
const older = { pred: 0.4, pred_low: true, pred_note: 'odhad', status: 'live', sets: [[6, 4], [1, 1]], pts: [1, 0], server: 1, srvTrust: 1, pids: [null, null], players: kept.players, g: 'M', best_of: 3 };
const newer = { pred: 0.71, pred_low: false, pred_lr: 0.7, pids: ['M1', 'M2'], status: 'live', sets: [[6, 4], [3, 2]], pts: [2, 1], server: 2, srvTrust: 3, _accAt: Date.now(), players: kept.players, g: 'M', best_of: 3 };
keepLive(older, newer);
assert.strictEqual(older.pred, 0.71);
assert.strictEqual(older.pred_low, false);
assert.strictEqual(JSON.stringify(older.sets), JSON.stringify([[6, 4], [3, 2]]));
const back = { pred: 0.2, pred_low: true, status: 'live', sets: [[6, 4], [1, 0]], pts: [0, 0], server: 1, srvTrust: 1, _accAt: Date.now() - 1000, players: kept.players };
keepLive(older, back);
assert.strictEqual(JSON.stringify(older.sets), JSON.stringify([[6, 4], [3, 2]]));
assert.strictEqual(older.server, 2);

console.log(`predikce doplněna u ${filled} zápasů (export ${fix.export_missing}, sofascore ${fix.sofa_missing}); oba hráči v datech ${both}, jeden ${one}, bez historie ${prior}`);
