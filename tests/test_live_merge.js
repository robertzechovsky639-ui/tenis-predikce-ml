'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const context = { globalThis: {}, console, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'web/live.js'), 'utf8'), context);
const TL = context.TenisLive;

function liveP(m) {
  const base = m.pred;
  if (!m.server) return base;
  return m.server === 1 ? Math.min(0.99, base + 0.08) : Math.max(0.01, base - 0.08);
}
function snap(list) { return list.map(m => [m.server || 0, m.pts && m.pts.join(':'), JSON.stringify(m.sets), Math.round(liveP(m) * 100)]).join(';'); }

// Starý klient: Sofascore live poll (firstToServe, každé 1,5 s, celý seznam najednou)
// a point-by-point (každých 0,6 s) se navzájem přepisují. Podávající se liší asi v polovině gemů.
function oldWrite(m, server, pts) {
  m.server = server; m.srv_src = 'overwrite'; if (pts) m.pts = pts.slice(); return true;
}

const N = 12, CYCLES = 20;
function freshList() {
  return Array.from({ length: N }, (_, i) => ({
    id: 'm' + i, status: 'live', pred: 0.5 + (i % 5) * 0.02, sets: [[6, 4], [2, 1]], pts: [1, 1],
    server: null, srvTrust: 0, src_pts: null, _accAt: 0, players: [{ name: 'A' }, { name: 'B' }]
  }));
}
const sofaSrv = i => (i % 2) + 1;
const pbpSrv = i => 3 - sofaSrv(i);

const oldList = freshList();
const oldSnaps = [];
for (let c = 0; c < CYCLES; c++) {
  oldList.forEach((m, i) => oldWrite(m, sofaSrv(i), [1, 1]));
  oldSnaps.push(snap(oldList));
  oldList.forEach((m, i) => oldWrite(m, pbpSrv(i), [1, 1]));
  oldSnaps.push(snap(oldList));
}
const oldUnique = new Set(oldSnaps);
assert.ok(oldUnique.size >= 2, 'reprodukce: staré přepisování musí kmitat');
assert.notStrictEqual(oldSnaps[0], oldSnaps[1]);

const neu = freshList();
let t = Date.now();
const sources = { sofascore: { cur: null, gen: 0 }, pbp: { cur: null, gen: 0 }, s365: { cur: null, gen: 0 } };
function token(src) {
  t = Math.max(Date.now(), t + 5);
  const tok = { src, t0: t, gen: ++sources[src].gen };
  sources[src].cur = tok;
  return tok;
}
function fresh(tok) { return !tok || sources[tok.src].cur === tok; }
const neuSnaps = [];
for (let c = 0; c < CYCLES; c++) {
  const sofaTok = token('sofascore');
  neu.forEach((m, i) => TL.applyLive(m, { status: 'live', sets: [[6, 4], [2, 1]], pts: [1, 1], server: sofaSrv(i), srvTrust: 1, srv_src: 'firstToServe', src_pts: 'Sofascore' }, sofaTok, fresh));
  neuSnaps.push(snap(neu));
  neu.forEach((m, i) => TL.applyLive(m, { status: 'live', sets: [[6, 4], [2, 1]], pts: [1, 1], server: pbpSrv(i), srvTrust: 3, srv_src: 'pbp', src_pts: 'Sofascore' }, token('pbp'), () => true));
  neuSnaps.push(snap(neu));
}
const after = neuSnaps.slice(2);
assert.ok(after.every(s => s === after[0]), 'po první opravě z bod po bodu se predikce ani podávající nesmí vracet');
assert.ok(neu.every((m, i) => m.server === pbpSrv(i) && m.srvTrust === 3));

// starší odpověď stejného polleru nesmí vrátit skóre; novější skóre ano, i když mezitím začal další dotaz
{
  const m = { status: 'live', sets: [[6, 4], [3, 2]], pts: [2, 1], server: 1, srvTrust: 2, src_pts: '365scores', _accAt: Date.now() };
  const oldTok = { src: 's365', t0: m._accAt - 5000, gen: 1 };
  sources.s365.cur = { src: 's365', t0: Date.now(), gen: 2 };
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 4], [3, 1]], pts: [0, 0], server: 2, srvTrust: 2, src_pts: '365scores' }, oldTok, fresh), false);
  assert.strictEqual(JSON.stringify(m.sets), JSON.stringify([[6, 4], [3, 2]]));
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 4], [4, 2]], pts: [0, 0], server: 2, srvTrust: 2, src_pts: '365scores' }, oldTok, fresh), true);
  assert.strictEqual(JSON.stringify(m.sets), JSON.stringify([[6, 4], [4, 2]]));
}

// otočená orientace a záporné sety z 365 se neberou jako novější stav
{
  const m = { status: 'live', sets: [[6, 4], [2, 1]], pts: [1, 0], server: 1, srvTrust: 3, _accAt: 10 };
  assert.strictEqual(TL.cmpScore([[6, 4]], null, [[6, 4], [-1, -1]], null), 0);
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[4, 6], [1, 2]], pts: [0, 1], server: 2, srvTrust: 1, src_pts: 'ESPN' }, { src: 'espn', t0: 50 }, () => true), false);
  assert.strictEqual(m.server, 1);
  assert.strictEqual(JSON.stringify(TL.normSets([[6, 4], [0, 0], [-1, -1]])), JSON.stringify([[6, 4]]));
}

// shoda → výhoda jen ze stejného zdroje a z dotazu, který začal až po shodě; jinak by se body vracely
{
  const m = { status: 'live', sets: [[1, 1]], pts: [4, 3], server: 1, srvTrust: 2, src_pts: 'Sofascore', _accAt: Date.now() - 50 };
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[1, 1]], pts: [3, 3], src_pts: '365scores' }, { src: 's365', t0: Date.now() }, () => true), false);
  assert.strictEqual(JSON.stringify(m.pts), JSON.stringify([4, 3]));
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[1, 1]], pts: [3, 3], src_pts: 'Sofascore' }, { src: 'sofascore', t0: Date.now() }, () => true), true);
  assert.strictEqual(JSON.stringify(m.pts), JSON.stringify([3, 3]));
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[1, 1]], pts: [4, 3], src_pts: '365scores' }, { src: 's365', t0: Date.now() + 1000 }, () => true), false);
  assert.strictEqual(JSON.stringify(m.pts), JSON.stringify([3, 3]));
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[1, 1]], pts: [3, 4], src_pts: 'Sofascore' }, { src: 'sofascore', t0: Date.now() + 1000 }, () => true), true);
  assert.strictEqual(JSON.stringify(m.pts), JSON.stringify([3, 4]));
}

// firstToServe je aktuální podávající. Lichý počet gemů ho nesmí otočit zpátky na prvního podávajícího.
{
  assert.strictEqual(TL.reportedServer(2, true), 2);
  assert.strictEqual(TL.reportedServer(1, false), 2);
  assert.strictEqual(TL.reportedServer(null, true), null);
  assert.strictEqual(TL.reportedServer(0, true), null);
  const m = { status: 'live', sets: [[6, 4], [2, 2]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore', _accAt: 1 };
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 4], [2, 2]], pts: [1, 0], server: 2, srvTrust: 1, srv_src: 'firstToServe', src_pts: 'Sofascore' }, { src: 'sofascore', t0: 5 }, () => true), true);
  assert.strictEqual(m.server, 2);
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 4], [2, 2]], pts: [1, 1], server: 1, srvTrust: 1, srv_src: 'firstToServe', src_pts: 'Sofascore' }, { src: 'sofascore', t0: 9 }, () => true), true);
  assert.strictEqual(m.server, 1);
}

// tie-break: stejný zdroj smí podávajícího změnit, slabší zdroj ne
{
  const m = { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 1, srvTrust: 2, src_pts: '365scores', _accAt: 1 };
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 6]], pts: [2, 1], server: 2, srvTrust: 2, srv_src: '365', src_pts: '365scores' }, { src: 's365', t0: 5 }, () => true), true);
  assert.strictEqual(m.server, 2);
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 6]], pts: [2, 2], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 6 }, () => true), true);
  assert.strictEqual(m.server, 2);
  assert.strictEqual(m.pts.join(':'), '2:2');
}

// Tiebreak: zdroj drží podávajícího prvního bodu. Tečka se otáčí po 1, pak po 2 bodech.
{
  const m = { status: 'live', sets: [[6, 6]], pts: [0, 0], server: null, srvTrust: 0, best_of: 3, _accAt: 1 };
  const pts = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]];
  const want = [1, 2, 2, 1, 1, 2];
  pts.forEach((p, i) => {
    assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 6]], pts: p, server: 1, srvTrust: 1, srv_src: 'firstToServe', src_pts: 'Sofascore' }, { src: 'sofascore', t0: 10 + i }, () => true), true);
    assert.strictEqual(m.server, want[i], 'bod ' + p.join(':'));
  });
  // Opakované stejné hlášení v novém bloku je staré: [3,3] podává hráč 2.
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 6]], pts: [3, 3], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 20 }, () => true), true);
  assert.strictEqual(m.server, 2);
  // Nové hlášení (jiný hráč) má přednost a přepíše, kdo podával první bod.
  const fresh = { status: 'live', sets: [[6, 6]], pts: [2, 1], server: 1, srvTrust: 1, tbFirst: 1, tbReported: 1, tbBlock: 0, best_of: 3, _accAt: 1 };
  assert.strictEqual(TL.applyLive(fresh, { status: 'live', sets: [[6, 6]], pts: [2, 2], server: 2, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 21 }, () => true), true);
  assert.strictEqual(fresh.server, 2);
  assert.strictEqual(fresh.tbFirst, 2);
}

// Supertiebreak na 10: stejné střídání i po sedmém bodu, v rozhodujícím setu i jako samostatný set.
{
  const m = { status: 'live', sets: [[6, 4], [4, 6], [6, 6]], pts: [0, 0], server: null, srvTrust: 0, best_of: 3, _accAt: 1 };
  const steps = [[[0, 0], 1], [[1, 0], 2], [[8, 8], 1], [[9, 8], 2]];
  steps.forEach(([p, want], i) => {
    TL.applyLive(m, { status: 'live', sets: m.sets, pts: p, server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 30 + i }, () => true);
    assert.strictEqual(m.server, want, 'super ' + p.join(':'));
  });
  const mtb = { status: 'live', sets: [[6, 4], [4, 6]], pts: null, server: null, srvTrust: 0, best_of: 3, match_tb: true, _accAt: 1 };
  TL.applyLive(mtb, { status: 'live', sets: [[6, 4], [4, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 40 }, () => true);
  assert.strictEqual(mtb.server, 1);
  TL.applyLive(mtb, { status: 'live', sets: [[6, 4], [4, 6]], pts: [1, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 41 }, () => true);
  assert.strictEqual(mtb.server, 2);
  TL.applyLive(mtb, { status: 'live', sets: [[6, 4], [4, 6]], pts: [5, 4], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 42 }, () => true);
  assert.strictEqual(mtb.server, TL.tbNow(1, [5, 4]));
}

// Vstup do tiebreaku a další set: příjemce prvního bodu podává. Čerstvý zdroj má přednost, staré hlášení ne.
{
  const entered = { status: 'live', sets: [[6, 5]], pts: [0, 0], server: 1, srvTrust: 1, best_of: 3, _accAt: 1 };
  assert.strictEqual(TL.applyLive(entered, { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 50 }, () => true), true);
  assert.strictEqual(entered.server, 2);
  const freshIn = { status: 'live', sets: [[6, 5]], pts: [0, 0], server: 1, srvTrust: 1, best_of: 3, _accAt: 1 };
  TL.applyLive(freshIn, { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 2, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 51 }, () => true);
  assert.strictEqual(freshIn.server, 2);
  const done = { status: 'live', sets: [[6, 6]], pts: [0, 0], server: null, srvTrust: 0, best_of: 3, _accAt: 1 };
  TL.applyLive(done, { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 52 }, () => true);
  TL.applyLive(done, { status: 'live', sets: [[7, 6]], pts: [0, 0], server: null, srvTrust: 0, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 53 }, () => true);
  assert.strictEqual(done.server, 2);
  assert.strictEqual(done.srv_src, 'tb-next');
  const sticky = { status: 'live', sets: [[6, 6]], pts: [0, 0], server: null, srvTrust: 0, best_of: 3, _accAt: 1 };
  TL.applyLive(sticky, { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 54 }, () => true);
  TL.applyLive(sticky, { status: 'live', sets: [[7, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 55 }, () => true);
  assert.strictEqual(sticky.server, 2);
  const moved = { status: 'live', sets: [[6, 6]], pts: [0, 0], server: null, srvTrust: 0, best_of: 3, _accAt: 1 };
  TL.applyLive(moved, { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 56 }, () => true);
  TL.applyLive(moved, { status: 'live', sets: [[6, 6]], pts: [1, 0], server: 2, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 57 }, () => true);
  TL.applyLive(moved, { status: 'live', sets: [[7, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 58 }, () => true);
  assert.strictEqual(moved.server, 1);
}

// nový gem bez hlášeného podávajícího smaže starého — žádný odhad
{
  const m = { status: 'live', sets: [[1, 1]], pts: [3, 0], server: 1, srvTrust: 3, src_pts: 'Sofascore', _accAt: 1 };
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[2, 1]], pts: [0, 0], server: null, srvTrust: 0, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 5 }, () => true), true);
  assert.strictEqual(m.server, null);
  assert.strictEqual(m.srvTrust, 0);
}

// dohraný zápas se znovu neotevře a živý nespadne do „nadcházející“
{
  const m = { status: 'finished', sets: [[6, 2], [6, 4]], pts: null, server: null };
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 2], [1, 0]], pts: [1, 0], server: 1, srvTrust: 1 }, { t0: 5 }, () => true), false);
  assert.strictEqual(m.status, 'finished');
  const live = { status: 'live', sets: [[1, 0]], pts: [1, 0], server: 1, srvTrust: 1, _accAt: 3 };
  assert.strictEqual(TL.applyLive(live, { status: 'upcoming', sets: [], pts: null }, { t0: 9 }, () => true), false);
  assert.strictEqual(live.status, 'live');
}

// jméno a záložní predikce: každý zápas dostane číslo, známý model se neoznačí jako odhad
{
  const players = [
    ['M208342', 'Zink T.', 1700, [1700, 1500, 1500], null, 0.5, 20, 1, 1, 0, 25, null, null],
    ['M1', 'Jannik Sinner', 2200, [2200, 1500, 1500], 1, 0.8, 400, 1, 1, 0, 24, null, null],
    ['M2', 'Matsuda K.', 1550, [1550, 1500, 1500], null, 0.5, 8, 1, 1, 0, 22, null, null],
    ['M3', 'Ryuki Matsuda', 1600, [1600, 1500, 1500], null, 0.5, 10, 1, 1, 0, 23, null, null],
    ['M5', 'Amit Vales', 1500, [1500, 1500, 1500], null, 0.5, 4, 1, 1, 0, 20, null, null],
    ['M6', 'Another Vales', 1510, [1510, 1500, 1500], null, 0.5, 4, 1, 1, 0, 21, null, null]
  ];
  const index = TL.buildIndex(players);
  assert.strictEqual(TL.matchPlayer(index, 'M', 'Tyler Zink')[0], 'M208342');
  assert.strictEqual(TL.matchPlayer(index, 'M', 'Sinner J.')[0], 'M1');
  assert.strictEqual(TL.matchPlayer(index, 'M', 'Ryuki Matsuda')[0], 'M3');
  assert.strictEqual(TL.matchPlayer(index, 'M', 'Vales A.'), null);
  const known = { g: 'M', circuit: 'ATP', qual: 0, pids: ['M1', null], players: [{ name: 'Jannik Sinner' }, { name: 'TBD' }] };
  const fb = TL.fallbackPred(known, id => index.byId.get(id)[2]);
  assert.ok(fb.p > 0.5 && fb.p < 0.98);
  assert.ok(fb.note.includes('není určen'));
  const none = { g: 'M', circuit: 'ITF muži', qual: 1, pids: [null, null], players: [{ name: 'Xing Dao Chen' }, { name: 'Xirui Han' }] };
  const fb2 = TL.fallbackPred(none, () => null);
  assert.strictEqual(fb2.p, 0.5);
  assert.ok(fb2.note.includes('úrovně turnaje'));
}

// Celá obrazovka se nepřekreslí, když se přijatý stav nezmění.
// Stejné pravidlo má paintList: innerHTML seznamu se mění jen když se změní viditelné id.
{
  const list = freshList();
  let fullRenders = 0;
  const sigs = () => list.map(m => Math.round(liveP(m) * 100)).join(',');
  let shown = sigs();
  function paint(ids, accepted) {
    if (!accepted) return;
    const next = sigs();
    if (next !== shown) { fullRenders++; shown = next; }
    assert.ok(ids.length === list.length);
  }
  for (let c = 0; c < CYCLES; c++) {
    let any = false;
    const tok = token('sofascore');
    list.forEach((m, i) => { any = TL.applyLive(m, { status: 'live', sets: m.sets, pts: m.pts, server: sofaSrv(i), srvTrust: 1, srv_src: 'firstToServe', src_pts: 'Sofascore' }, tok, fresh) || any; });
    paint(list.map(m => m.id), any);
    any = false;
    list.forEach((m, i) => { any = TL.applyLive(m, { status: 'live', sets: m.sets, pts: m.pts, server: pbpSrv(i), srvTrust: 3, srv_src: 'pbp', src_pts: 'Sofascore' }, token('pbp'), () => true) || any; });
    paint(list.map(m => m.id), any);
  }
  assert.ok(fullRenders <= 2, 'seznam smí změnit predikce jen při prvním podání a jedné opravě, ne v každém cyklu: ' + fullRenders);
}

console.log('test_live_merge ok; old snapshots', oldUnique.size, 'stable after fix');
