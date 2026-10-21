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
  assert.strictEqual(JSON.stringify(TL.normSets([[6, 4], [0, 0], [-1, -1]])), JSON.stringify([[6, 4], [0, 0]]));
  assert.strictEqual(JSON.stringify(TL.normSets([[6, 5], [0, 0]])), JSON.stringify([[6, 5]]));
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

// Set vyhraný 6:7 v tiebreaku je dohraný. 0:0 potom je další set, ne pokračování druhého.
{
  assert.strictEqual(JSON.stringify(TL.normSets([[6, 3], [6, 7], [0, 0]])), JSON.stringify([[6, 3], [6, 7], [0, 0]]));
  const bare = TL.liveSplit([[6, 3], [6, 7]], 'live');
  const opened = TL.liveSplit([[6, 3], [6, 7], [0, 0]], 'live');
  assert.strictEqual(bare.n, 3);
  assert.strictEqual(opened.n, 3);
  assert.strictEqual(JSON.stringify(bare.cur), JSON.stringify([0, 0]));
  assert.strictEqual(JSON.stringify(opened.cur), JSON.stringify([0, 0]));
  assert.strictEqual(bare.done.filter(s => s[0] > s[1]).length, 1);
  assert.strictEqual(bare.done.filter(s => s[1] > s[0]).length, 1);
  const won = TL.liveSplit([[6, 3], [7, 6]], 'live');
  assert.strictEqual(won.n, 3);
  assert.strictEqual(won.done.filter(s => s[0] > s[1]).length, 2);
  assert.strictEqual(TL.cmpScore([[6, 3], [6, 7]], [0, 0], [[6, 3], [6, 7], [0, 0]], [0, 0]), 1);
  assert.strictEqual(TL.cmpScore([[6, 3], [6, 7], [0, 0]], [0, 0], [[6, 3], [6, 7]], [0, 0]), -1);
  assert.strictEqual(TL.cmpScore([[6, 3], [6, 6]], [3, 3], [[6, 3], [6, 7], [0, 0]], [0, 0]), 1);
  assert.strictEqual(TL.cmpScore([[6, 3], [7, 6]], [0, 0], [[6, 3], [6, 6]], [6, 5]), -1);
  assert.strictEqual(TL.cmpScore([[6, 3], [6, 7]], [1, 0], [[6, 3], [6, 7], [0, 0]], [0, 0]), 1);
  const m = { status: 'live', sets: [[6, 3], [6, 6]], pts: [6, 5], server: 1, srvTrust: 1, best_of: 3, _accAt: 1 };
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 3], [6, 7], [0, 0]], pts: [0, 0], server: 2, srvTrust: 1, src_pts: '365scores' }, { src: 's365', t0: 80 }, () => true), true);
  assert.strictEqual(JSON.stringify(m.sets), JSON.stringify([[6, 3], [6, 7], [0, 0]]));
  assert.strictEqual(TL.liveSplit(m.sets, m.status).n, 3);
  assert.strictEqual(TL.applyLive(m, { status: 'live', sets: [[6, 3], [6, 6]], pts: [6, 6], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 81 }, () => true), false);
  assert.strictEqual(JSON.stringify(m.sets), JSON.stringify([[6, 3], [6, 7], [0, 0]]));
  const held = { status: 'live', sets: [[6, 3], [6, 7]], pts: [1, 0], pts_raw: [15, 0], server: 1, srvTrust: 1, best_of: 3, _accAt: 1, _lk: 'stale' };
  assert.strictEqual(TL.applyLive(held, { status: 'live', sets: [[6, 3], [6, 7], [0, 0]], pts: [0, 0], server: 2, srvTrust: 1, src_pts: '365scores' }, { src: 's365', t0: 82 }, () => true), true);
  assert.strictEqual(JSON.stringify(held.sets), JSON.stringify([[6, 3], [6, 7], [0, 0]]));
  assert.strictEqual(JSON.stringify(held.pts), JSON.stringify([1, 0]));
  assert.strictEqual(JSON.stringify(held.pts_raw), JSON.stringify([15, 0]));
  assert.strictEqual(held.server, 1);
  assert.strictEqual(held._lk, '');
  const nxt = { status: 'live', sets: [[6, 6]], pts: [0, 0], server: null, srvTrust: 0, best_of: 3, _accAt: 1 };
  TL.applyLive(nxt, { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 90 }, () => true);
  TL.applyLive(nxt, { status: 'live', sets: [[7, 6], [0, 0]], pts: [0, 0], server: null, srvTrust: 0, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 91 }, () => true);
  assert.strictEqual(nxt.server, 2);
  assert.strictEqual(JSON.stringify(nxt.sets), JSON.stringify([[7, 6], [0, 0]]));
  assert.strictEqual(TL.liveSplit(nxt.sets, 'live').n, 2);
  const fin = { status: 'live', sets: [[6, 3], [6, 4], [0, 0]], pts: [0, 0], server: 1, srvTrust: 1, _accAt: 1 };
  assert.strictEqual(TL.applyLive(fin, { status: 'finished', sets: [[6, 3], [6, 4]], winner: 1 }, { src: 'sofascore', t0: 92 }, () => true), true);
  assert.strictEqual(fin.status, 'finished');
  assert.strictEqual(JSON.stringify(fin.sets), JSON.stringify([[6, 3], [6, 4]]));
  const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
  const stat = fs.readFileSync(path.join(root, 'web/static.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'web/sw.js'), 'utf8');
  assert.ok(app.includes('TenisLive.liveSplit(d.sets,d.status)'));
  assert.ok(app.includes('sp.done[k-1]'));
  assert.ok(stat.includes('TenisLive.liveSplit'));
  assert.ok(sw.includes('tenis-v11'));
  assert.ok(app.includes('predikce aktualizovány před'));
}

// Živý zdroj zavře tiebreak hned z bodů a z periodNTieBreak. Nový set 0:0 nesmí čekat na snímek.
{
  const mid = TL.closeFinishedTb([[6, 3], [6, 6]], [5, 3], 3);
  assert.strictEqual(mid.closed, false);
  const won = TL.closeFinishedTb([[6, 3], [6, 6]], [7, 5], 3);
  assert.strictEqual(won.closed, true);
  assert.strictEqual(JSON.stringify(won.sets), JSON.stringify([[6, 3], [7, 6]]));
  assert.strictEqual(JSON.stringify(won.pts), JSON.stringify([0, 0]));
  const lost = TL.closeFinishedTb([[6, 3], [6, 6]], [5, 7], 3);
  assert.strictEqual(lost.closed, true);
  assert.strictEqual(JSON.stringify(lost.sets[1]), JSON.stringify([6, 7]));
  const early = TL.closeFinishedTb([[6, 4], [4, 6], [6, 6]], [8, 6], 3);
  assert.strictEqual(early.closed, false);
  const sup = TL.closeFinishedTb([[6, 4], [4, 6], [6, 6]], [10, 8], 3);
  assert.strictEqual(sup.closed, true);
  assert.strictEqual(JSON.stringify(sup.sets[2]), JSON.stringify([7, 6]));
  assert.strictEqual(TL.tbWinner([7, 5], 7), 1);
  assert.strictEqual(TL.tbWinner([5, 7], 7), 2);
  assert.strictEqual(TL.tbWinner([8, 6], 10), 0);
  assert.strictEqual(TL.tbWinner([10, 8], 10), 1);
  const live = { status: 'live', sets: [[6, 3], [6, 6]], pts: [5, 4], server: 1, srvTrust: 1, best_of: 3, _accAt: 1, _lk: 'stale' };
  assert.strictEqual(TL.applyLive(live, { status: 'live', sets: [[6, 3], [6, 6]], pts: [7, 5], pts_raw: [7, 5], server: 1, srvTrust: 2, src_pts: '365scores' }, { src: 's365', t0: 10 }, () => true), true);
  assert.strictEqual(JSON.stringify(live.sets), JSON.stringify([[6, 3], [7, 6]]));
  assert.strictEqual(live.status, 'finished');
  assert.strictEqual(live.winner, 1);
  assert.strictEqual(live.pts, null);
  assert.strictEqual(TL.liveSplit(live.sets, 'live').n, 3);
  assert.strictEqual(live._lk, '');
  assert.strictEqual(TL.applyLive(live, { status: 'live', sets: [[6, 3], [6, 6]], pts: [6, 6], server: 2, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 11 }, () => true), false);
  assert.strictEqual(JSON.stringify(live.sets), JSON.stringify([[6, 3], [7, 6]]));
  const nxt = { status: 'live', sets: [[6, 6]], pts: [0, 0], server: null, srvTrust: 0, best_of: 3, _accAt: 1 };
  TL.applyLive(nxt, { status: 'live', sets: [[6, 6]], pts: [0, 0], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 20 }, () => true);
  TL.applyLive(nxt, { status: 'live', sets: [[6, 6]], pts: [7, 5], server: 1, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 21 }, () => true);
  assert.strictEqual(JSON.stringify(nxt.sets), JSON.stringify([[7, 6]]));
  assert.strictEqual(JSON.stringify(nxt.pts), JSON.stringify([0, 0]));
  assert.strictEqual(nxt.server, 2);
  assert.strictEqual(nxt.srv_src, 'tb-next');
  const dec = { status: 'live', sets: [[6, 4], [4, 6], [6, 6]], pts: [8, 6], server: 1, srvTrust: 1, best_of: 3, _accAt: 1 };
  assert.strictEqual(TL.applyLive(dec, { status: 'live', sets: [[6, 4], [4, 6], [6, 6]], pts: [8, 6], server: 1, srvTrust: 1, src_pts: '365scores' }, { src: 's365', t0: 30 }, () => true), false);
  assert.strictEqual(JSON.stringify(dec.sets[2]), JSON.stringify([6, 6]));
  assert.strictEqual(TL.applyLive(dec, { status: 'live', sets: [[6, 4], [4, 6], [6, 6]], pts: [10, 8], server: 1, srvTrust: 1, src_pts: '365scores' }, { src: 's365', t0: 31 }, () => true), true);
  assert.strictEqual(JSON.stringify(dec.sets[2]), JSON.stringify([7, 6]));
  assert.strictEqual(dec.status, 'finished');
  assert.strictEqual(dec.winner, 1);
  assert.strictEqual(dec.pts, null);
  const sofa = TL.parseSofaScore(
    { period1: 6, period2: 6, period2TieBreak: 5, point: '7' },
    { period1: 3, period2: 6, period2TieBreak: 7, point: '5' },
    3);
  assert.strictEqual(JSON.stringify(sofa.sets), JSON.stringify([[6, 3], [6, 7]]));
  assert.strictEqual(JSON.stringify(sofa.pts), JSON.stringify([0, 0]));
  const sofaGame = TL.parseSofaScore(
    { period1: 6, period2: 6, period2TieBreak: 5, point: '15' },
    { period1: 3, period2: 6, period2TieBreak: 7, point: '0' },
    3);
  assert.strictEqual(JSON.stringify(sofaGame.sets), JSON.stringify([[6, 3], [6, 7]]));
  assert.strictEqual(JSON.stringify(sofaGame.pts), JSON.stringify([1, 0]));
  const sofaOpen = TL.parseSofaScore(
    { period1: 6, period2: 6, period3: 0, point: '40' },
    { period1: 3, period2: 7, period3: 0, point: 'A' },
    3);
  assert.strictEqual(JSON.stringify(sofaOpen.sets), JSON.stringify([[6, 3], [6, 7], [0, 0]]));
  assert.strictEqual(JSON.stringify(sofaOpen.pts), JSON.stringify([3, 4]));
  const during = TL.parseSofaScore({ period1: 6, period2: 6, point: '4' }, { period1: 3, period2: 6, point: '2' }, 3);
  assert.strictEqual(JSON.stringify(during.sets), JSON.stringify([[6, 3], [6, 6]]));
  assert.strictEqual(JSON.stringify(during.pts), JSON.stringify([4, 2]));
  assert.strictEqual(JSON.stringify(TL.map365Points(7, 5)), JSON.stringify([7, 5]));
  assert.strictEqual(JSON.stringify(TL.map365Points(15, 0)), JSON.stringify([1, 0]));
  assert.strictEqual(JSON.stringify(TL.map365Points(50, 40)), JSON.stringify([4, 3]));
  assert.strictEqual(JSON.stringify(TL.map365Points(50, 30)), JSON.stringify([4, 3]));
  assert.strictEqual(JSON.stringify(TL.map365Points(4, 2)), JSON.stringify([4, 2]));
  assert.strictEqual(JSON.stringify(TL.map365Points(5, 4)), JSON.stringify([5, 4]));
}

assert.strictEqual(JSON.stringify(TL.displaySets([[6, 3], [6, 7]], 'live')), JSON.stringify([[6, 3], [6, 7], [0, 0]]));
assert.strictEqual(JSON.stringify(TL.displaySets([[6, 3], [6, 7], [0, 0]], 'live')), JSON.stringify([[6, 3], [6, 7], [0, 0]]));
assert.strictEqual(JSON.stringify(TL.displaySets([[6, 3], [5, 4]], 'live')), JSON.stringify([[6, 3], [5, 4]]));
assert.strictEqual(JSON.stringify(TL.displaySets([[6, 4], [6, 3]], 'live', 3)), JSON.stringify([[6, 4], [6, 3]]));
assert.strictEqual(JSON.stringify(TL.displaySets([[6, 4], [6, 3]], 'live', 5)), JSON.stringify([[6, 4], [6, 3], [0, 0]]));
{
  const over = { status: 'live', sets: [[4, 6]], pts: [0, 0], server: 1, srvTrust: 1, best_of: 3, _accAt: 1 };
  assert.strictEqual(TL.applyLive(over, { status: 'live', sets: [[4, 6], [4, 6]], pts: [0, 0], src_pts: 'Sofascore' }, { src: 'sofascore', t0: 9 }, () => true), true);
  assert.strictEqual(over.status, 'finished');
  assert.strictEqual(over.winner, 2);
  assert.strictEqual(JSON.stringify(over.sets), JSON.stringify([[4, 6], [4, 6]]));
  assert.strictEqual(over.pts, null);
  assert.strictEqual(TL.applyLive(over, { status: 'live', sets: [[4, 6], [3, 6]], src_pts: 'Sofascore' }, { src: 'sofascore', t0: 10 }, () => true), false);
  assert.strictEqual(over.status, 'finished');
  const slam = { status: 'live', sets: [[6, 4], [6, 3]], pts: [0, 0], best_of: 5, _accAt: 1 };
  assert.strictEqual(TL.applyLive(slam, { status: 'live', sets: [[6, 4], [6, 3], [0, 0]], pts: [0, 0], src_pts: 'Sofascore' }, { src: 'sofascore', t0: 11 }, () => true), true);
  assert.strictEqual(slam.status, 'live');
  assert.strictEqual(JSON.stringify(slam.sets), JSON.stringify([[6, 4], [6, 3], [0, 0]]));
}
const pragueNoon = Date.UTC(2026, 9, 20, 12, 0, 0);
assert.strictEqual(TL.dayOffset(Date.UTC(2026, 9, 20, 10, 0, 0) / 1000, pragueNoon), 0);
assert.strictEqual(TL.dayOffset(Date.UTC(2026, 9, 20, 22, 30, 0) / 1000, pragueNoon), 1);
assert.strictEqual(TL.pragueDate(1, pragueNoon).d, 21);
assert.strictEqual(TL.fsLiveStatus(2, 0), 'live');
assert.strictEqual(TL.fsLiveStatus(2, 8), 'finished');
assert.strictEqual(TL.fsLiveStatus(2, 54), 'finished');
assert.strictEqual(TL.fsLiveStatus(3, 0), 'finished');
assert.strictEqual(TL.fsLiveStatus(5, 0), 'finished');
const retired = { status: 'live', sets: [[6, 4], [3, 2]], pts: [1, 0], server: 1, srvTrust: 1, _accAt: 1 };
assert.strictEqual(TL.applyLive(retired, { status: TL.fsLiveStatus(2, 8), sets: [[6, 4], [3, 2]], winner: 2, src_pts: 'Flashscore' }, { src: 'fs', t0: 3 }, () => true), true);
assert.strictEqual(retired.status, 'finished');
assert.strictEqual(retired.winner, 2);
assert.strictEqual(TL.applyLive(retired, { status: 'live', sets: [[6, 4], [2, 2]], src_pts: 'Flashscore' }, { src: 'fs', t0: 4 }, () => true), false);
assert.strictEqual(retired.status, 'finished');
assert.strictEqual(JSON.stringify(retired.sets), JSON.stringify([[6, 4], [3, 2]]));
const adv = { status: 'live', sets: [[1, 1]], pts: [4, 3], server: 1, srvTrust: 2, src_pts: '365scores', _accAt: 1 };
assert.strictEqual(TL.applyLive(adv, { status: 'live', sets: [[1, 1]], pts: [3, 4], server: 2, srvTrust: 1, src_pts: 'Sofascore' }, { src: 'sofascore', t0: 5 }, () => true), false);
assert.strictEqual(JSON.stringify(adv.pts), JSON.stringify([4, 3]));
assert.strictEqual(adv.server, 1);
{
  const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
  const stat = fs.readFileSync(path.join(root, 'web/static.js'), 'utf8');
  assert.ok(app.includes('TenisLive.displaySets'));
  assert.ok(app.includes('TenisLive.pragueDate'));
  assert.ok(app.includes('setInterval(upd,60000)'));
  assert.ok(app.includes("timeZone:'Europe/Prague'"));
  assert.ok(stat.includes('TenisLive.fsLiveStatus'));
  assert.ok(stat.includes("src_pts: 'Flashscore'"));
  const tick = stat.slice(stat.indexOf('async function fsTick'));
  assert.ok(tick.length > 40);
  assert.ok(!tick.includes('m.sets = sets'));
}

// Cali: Flashscore „Ficovich J. P.“ a Sofascore „J. Pablo Ficovich“ jsou jeden zápas.
{
  assert.strictEqual(TL.samePlayer('Ficovich J. P.', 'J. Pablo Ficovich'), true);
  assert.strictEqual(TL.samePlayer('Meligeni Alves F.', 'F. Meligeni Alves'), true);
  assert.strictEqual(TL.samePlayer('Świątek I.', 'Iga Swiatek'), true);
  assert.strictEqual(TL.samePlayer('de Minaur A.', 'Alex de Minaur'), true);
  assert.strictEqual(TL.samePlayer('Carlos Alcaraz', 'Albert Alcaraz'), false);
  assert.strictEqual(TL.samePlayer('Ficovich J. P.', 'F. Meligeni Alves'), false);
  assert.strictEqual(TL.samePlayer('TBD', 'TBD'), false);
  assert.strictEqual(TL.samePlayer('Tirante T. A.', 'Thiago Agustin Tirante'), true);
  assert.strictEqual(TL.samePlayer('Ryan Ziegann S.', 'Sam Ryan Ziegann'), true);
  assert.strictEqual(TL.samePlayer('Bhamidipaty S. R.', 'Shrivalli Rashmikaa Bhamidipaty'), true);
  assert.strictEqual(TL.samePlayer('Wan I W.', 'I Wen Wan'), true);
  assert.strictEqual(TL.samePlayer('Mushika Mio', 'Mio Mushika'), true);
  assert.strictEqual(TL.samePlayer('Yuhan L.', 'Yuhan Liu'), true);
  assert.strictEqual(TL.samePlayer('Zhang S.', 'Zhang Shuai'), true);
  assert.strictEqual(TL.samePlayer('Shi H.', 'Shi Han'), true);
  assert.strictEqual(TL.samePlayer('Guo H.', 'Guo Hanyu'), true);
  assert.strictEqual(TL.samePlayer('Cerundolo J. M.', 'Juan Manuel Cerundolo'), true);
  assert.strictEqual(TL.samePlayer('Manuel J.', 'Juan Manuel Cerundolo'), false);
  assert.strictEqual(TL.samePlayer('Pierre H.', 'Pierre-Hugues Herbert'), false);
  assert.strictEqual(TL.samePlayer('Zhang S.', 'Zhang Z.'), false);
  assert.strictEqual(TL.samePlayer('Martin T.', 'Tomas Martin Etcheverry'), false);
  assert.strictEqual(TL.samePlayer('Luciano L.', 'Luciano Darderi'), false);
  assert.strictEqual(TL.samePlayer('Alex M.', 'Alex de Minaur'), false);
  assert.strictEqual(TL.samePlayer('Yang Y.', 'Yang Y. Y.'), false);
  assert.strictEqual(TL.samePair('TBD', 'TBD', 'TBD', 'TBD'), false);
  assert.strictEqual(TL.samePair('Ficovich J. P.', 'Meligeni Alves F.', 'F. Meligeni Alves', 'J. Pablo Ficovich'), true);
  assert.strictEqual(TL.canonTournament('Cali (Colombia)'), 'Cali');
  assert.strictEqual(TL.canonTournament('Cali, Colombia'), 'Cali');
  assert.strictEqual(TL.canonTournament('Roland Garros'), 'Roland Garros');
  const fsM = { id: 'fs-cali', src: 'Flashscore', g: 'M', circuit: 'Challenger', tournament: 'Cali (Colombia)', status: 'live', best_of: 3, ts: 1000, pred: 0.15, sets: [[2, 6], [1, 1]], pts: null, server: null, srvTrust: 0, _accAt: 1, players: [{ name: 'Ficovich J. P.' }, { name: 'Meligeni Alves F.' }] };
  const ssM = { id: 'ss-cali', src: 'Sofascore', g: 'M', circuit: 'Challenger', tournament: 'Cali, Colombia', status: 'live', best_of: 3, ts: 2000, pred: 0.11, ssid: 99, sets: [[2, 6], [2, 2]], pts: [2, 3], pts_raw: [30, 40], server: 2, srvTrust: 1, players: [{ name: 'J. Pablo Ficovich' }, { name: 'F. Meligeni Alves' }] };
  const swapped = { id: 'ss-swap', src: 'Sofascore', g: 'M', tournament: 'Cali, Colombia', status: 'live', best_of: 3, ts: 2000, sets: [[6, 2], [2, 2]], pts: [3, 2], pts_raw: [40, 30], server: 1, srvTrust: 1, players: [{ name: 'F. Meligeni Alves' }, { name: 'J. Pablo Ficovich' }] };
  let out = TL.dedupeMatches([fsM, ssM]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'fs-cali');
  assert.strictEqual(out[0].tournament, 'Cali');
  assert.strictEqual(JSON.stringify(out[0].sets), JSON.stringify([[2, 6], [2, 2]]));
  assert.strictEqual(JSON.stringify(out[0].pts), JSON.stringify([2, 3]));
  assert.strictEqual(JSON.stringify(out[0].pts_raw), JSON.stringify([30, 40]));
  assert.strictEqual(out[0].pred, 0.15);
  assert.strictEqual(out[0].ssid, 99);
  const fresh = { id: 'fs-cali2', src: 'Flashscore', g: 'M', tournament: 'Cali (Colombia)', status: 'live', best_of: 3, ts: 3000, pred: 0.2, sets: [[2, 6], [3, 2]], pts: [1, 0], server: 1, srvTrust: 2, _accAt: 1, players: [{ name: 'Ficovich J. P.' }, { name: 'Meligeni Alves F.' }] };
  const stale = { id: 'ss-old', src: 'Sofascore', g: 'M', tournament: 'Cali, Colombia', status: 'live', best_of: 3, ts: 1000, sets: [[2, 6], [1, 1]], pts: null, players: [{ name: 'J. Pablo Ficovich' }, { name: 'F. Meligeni Alves' }] };
  out = TL.dedupeMatches([fresh, stale]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(JSON.stringify(out[0].sets), JSON.stringify([[2, 6], [3, 2]]));
  assert.strictEqual(JSON.stringify(out[0].pts), JSON.stringify([1, 0]));
  const base = { id: 'fs-ord', src: 'Flashscore', g: 'M', tournament: 'Cali (Colombia)', status: 'live', best_of: 3, ts: 1000, sets: [[2, 6], [1, 1]], pts: null, _accAt: 1, players: [{ name: 'Ficovich J. P.' }, { name: 'Meligeni Alves F.' }] };
  out = TL.dedupeMatches([base, swapped]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(JSON.stringify(out[0].sets), JSON.stringify([[2, 6], [2, 2]]));
  assert.strictEqual(JSON.stringify(out[0].pts), JSON.stringify([2, 3]));
  const yesterday = { id: 'fs-old', src: 'Flashscore', g: 'M', status: 'finished', ts: 1000, sets: [[6, 3], [6, 4]], players: [{ name: 'Ficovich J. P.' }, { name: 'Meligeni Alves F.' }] };
  const today = { id: 'fs-new', src: 'Flashscore', g: 'M', status: 'live', ts: 1000 + 40 * 3600, sets: [[1, 0]], players: [{ name: 'J. Pablo Ficovich' }, { name: 'F. Meligeni Alves' }] };
  assert.strictEqual(TL.dedupeMatches([yesterday, today]).length, 2);
  const src = fs.readFileSync(path.join(root, 'web/static.js'), 'utf8');
  assert.ok(src.includes('TenisLive.samePair'));
  assert.ok(src.includes('TenisLive.dedupeMatches'));
  assert.ok(src.includes('TenisLive.samePlayer'));
}

console.log('test_live_merge ok; old snapshots', oldUnique.size, 'stable after fix');
