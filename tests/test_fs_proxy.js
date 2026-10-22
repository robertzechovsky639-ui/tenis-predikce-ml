const assert = require('assert');
require('../web/live.js'); const T = globalThis.TenisLive;
assert.strictEqual(T.fsFeedUrl(''), null); assert.strictEqual(T.fsFeedUrl('  '), null); assert.strictEqual(T.fsFeedUrl(undefined), null);
assert.strictEqual(T.fsFeedUrl('https://x.workers.dev/'), 'https://x.workers.dev/feed/f_2_0_2_en_1');
let w = T.FS_MIN_WAIT; const seq = []; for (let i = 0; i < 10; i++) { w = T.fsBackoff(w, false); seq.push(w) }
assert.deepStrictEqual(seq.slice(0, 5), [16000, 32000, 64000, 128000, 256000]); assert.strictEqual(seq[9], 300000);
assert.strictEqual(T.fsBackoff(300000, true), 8000); assert.strictEqual(T.fsBackoff(0, false), 8000);
const src = require('fs').readFileSync(__dirname + '/../web/static.js', 'utf8');
assert.ok(/const FS_PROXY = 'https:\/\/tenis-fs-proxy\.robertzechovsky639\.workers\.dev';/.test(src)); assert.ok(/function fsLoop\(onChange\) \{ if \(!TenisLive\.fsFeedUrl\(FS_PROXY\)\) return;/.test(src));
assert.ok(!src.includes('global.flashscore.ninja/2/x/feed'));
console.log('test_fs_proxy OK');
