// swingCheck z web/app.js: upozornění na velký zvrat živé pravděpodobnosti
const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../web/app.js', 'utf8');
const code = src.match(/const SWING=[^\n]+\n/)[0] + src.match(/function swingCheck[^]*?\}\}\n/)[0];
const sur = p => p.name; const f = new Function('sur', code + 'return {swingCheck,livePr};')(sur);
const m = p => ({ status: 'live', live: { match: p }, players: [{ name: 'Sinner' }, { name: 'Alcaraz' }] });
const assert = require('assert');
assert.strictEqual(f.swingCheck(0.6, m(0.7)), null);
const s = f.swingCheck(0.6, m(0.4)); assert(s && /Alcaraz vede/.test(s.text) && s.p === 0.4, JSON.stringify(s));
assert.strictEqual(f.swingCheck(null, m(0.1)), null);
assert.strictEqual(f.swingCheck(0.6, Object.assign(m(0.1), { status: 'finished' })), null);
console.log('swing ok');
