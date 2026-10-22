const assert = require('assert');
require('../web/live.js'); const T = globalThis.TenisLive;
// Flashscore body + podávající
let r = T.parseFsPoints({ WA: '30', WB: '15', WC: '1' }, [[2, 1]]);
assert.deepStrictEqual(r.pts, [2, 1]); assert.strictEqual(r.server, 1);
r = T.parseFsPoints({ WA: 'A', WB: '40', WC: '2' }, [[3, 3]]); assert.deepStrictEqual(r.pts, [4, 3]); assert.strictEqual(r.server, 2);
r = T.parseFsPoints({ WA: '6', WB: '5', WC: '1' }, [[6, 3], [6, 6]]); assert.deepStrictEqual(r.pts, [6, 5]);
r = T.parseFsPoints({ WA: '15', WB: '0', WC: '1' }, [[6, 6]]); assert.deepStrictEqual(r.pts, [15, 0]);
assert.strictEqual(T.parseFsPoints({ WC: '1' }, [[1, 1]]), null);
assert.strictEqual(T.parseFsPoints({ WA: '', WB: '', WC: '' }, [[1, 1]]), null);
assert.strictEqual(T.parseFsPoints({ WA: '0', WB: '0', WC: '' }, [[0, 0]]).server, null);
// pbp: dohraný gem 3:1 podával domácí -> další podává host
const g = { score: { homeScore: 3, awayScore: 1, serving: 1, scoring: 1 } };
assert.strictEqual(T.pbpServer(g, [3, 1], true), 2);
assert.strictEqual(T.pbpServer(g, [1, 3], false), 1);
assert.strictEqual(T.pbpServer(g, [4, 1], true), null);   // gem nesedí na skóre
assert.strictEqual(T.pbpServer({ score: { homeScore: 3, awayScore: 1, serving: 1, scoring: -1 } }, [3, 1], true), 1); // rozehraný gem
// applyLive: Flashscore body se přijmou, gemy ze Sofascore bez bodů je nesmažou
const m = { status: 'live', sets: [[2, 1]], pts: [0, 0], src_pts: 'Sofascore', best_of: 3 };
assert.ok(T.applyLive(m, { status: 'live', sets: [[2, 1]], pts: [2, 1], pts_raw: [30, 15], server: 1, srvTrust: 2, srv_src: 'fs', src_pts: 'Flashscore' }, { src: 'fs', t0: Date.now() }, () => true));
assert.deepStrictEqual(m.pts, [2, 1]); assert.strictEqual(m.server, 1);
T.applyLive(m, { status: 'live', sets: [[2, 1]], pts: [0, 0], src_pts: 'Sofascore' }, { src: 'sofascore', t0: Date.now() + 1 }, () => true);
assert.deepStrictEqual(m.pts, [2, 1]);
console.log('test_itf_live OK');
