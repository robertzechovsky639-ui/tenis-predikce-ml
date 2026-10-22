const assert = require('assert');
require('../web/live.js'); const T = globalThis.TenisLive;
// stejní hráči, jiný zápis
assert.ok(T.samePlayer('Wolf J.J.', 'Jeffrey John Wolf'));
assert.ok(T.samePlayer('Wolf J. J.', 'Jeffrey John Wolf'));
assert.ok(T.samePair('Wolf J.J.', 'Jong S.', 'Jeffrey John Wolf', 'Sander Jong'));
assert.ok(T.samePlayer('Tsonga J.-W.', 'Jo-Wilfried Tsonga'));
assert.ok(T.samePlayer('Wolf J.', 'Jeffrey Wolf'));
// různí hráči se nesmí slít
assert.ok(!T.samePlayer('Wolf J.J.', 'Jeffrey Wolf'));        // dvě iniciály vs jedno jméno
assert.ok(!T.samePlayer('Wolf J.J.', 'James Peter Wolf'));
assert.ok(!T.samePlayer('Wolf J.J.', 'Jeffrey John Wolff'));
assert.ok(!T.samePlayer('Wolf J.P.', 'Jeffrey John Wolf'));
assert.ok(!T.samePair('Wolf J.J.', 'Jong S.', 'Jeffrey John Wolf', 'Tim Jong'));
// zápas s jiným začátkem o >12 h zůstává jiný (#13)
assert.ok(T.tsFar(1000, 1000 + 13 * 3600)); assert.ok(!T.tsFar(1000, 1000 + 3600));
console.log('test_dedupe_names OK');
