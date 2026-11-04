const assert = require('node:assert');
const { apply, initial, view } = require('./queue');

let s = initial();
assert.strictEqual(apply(s, { queue: 'A', type: 'next' }), s, 'next with nobody waiting is a no-op');
s = apply(s, { queue: 'A', type: 'add' });
s = apply(s, { queue: 'A', type: 'add' });
s = apply(s, { queue: 'C', type: 'add' });
assert.deepStrictEqual([s.A.issued, s.C.issued], [2, 1], 'queues are independent');
s = apply(s, { queue: 'A', type: 'next' });
assert.strictEqual(s.A.serving, 1);
s = apply(s, { queue: 'A', type: 'recall' });
assert.deepStrictEqual([s.A.serving, s.A.calls], [1, 2], 'recall keeps number, bumps calls');
s = apply(s, { queue: 'A', type: 'reset' });
assert.deepStrictEqual(s.A, { issued: 0, serving: 0, calls: 0, line: [], skipped: [] });
assert.strictEqual(s.C.issued, 1, 'reset A leaves C alone');
assert.throws(() => apply(s, { queue: 'X', type: 'add' }));
assert.throws(() => apply(s, { queue: 'A', type: 'delete' }));

// Skipping: issue C2..C5 (C1 already issued above), serve C1, then skip C2 (the next) and C4 (further back).
s = initial();
for (let i = 0; i < 5; i++) s = apply(s, { queue: 'C', type: 'add' });
s = apply(s, { queue: 'C', type: 'next' });
s = apply(s, { queue: 'C', type: 'skip', number: 2 });
s = apply(s, { queue: 'C', type: 'skip', number: 4 });
assert.deepStrictEqual(view(s).C.waiting, [3, 5], 'skipped numbers leave the waiting list');
s = apply(s, { queue: 'C', type: 'skip', number: 4 });
assert.deepStrictEqual(view(s).C.waiting, [3, 4, 5], 'skipping again brings the number back');
s = apply(s, { queue: 'C', type: 'next' });
assert.strictEqual(s.C.serving, 3, 'next jumps over skipped C2');
assert.deepStrictEqual(s.C.skipped, [], 'skipped numbers behind the served one are dropped');
s = apply(s, { queue: 'C', type: 'skip', number: 4 });
s = apply(s, { queue: 'C', type: 'skip', number: 5 });
const before = s;
assert.strictEqual(apply(s, { queue: 'C', type: 'next' }), before, 'all remaining skipped = nobody waiting');
for (const number of [3, 6, 0, '4', undefined]) {
  assert.throws(() => apply(s, { queue: 'C', type: 'skip', number }), /bad number/, `skip ${number} rejected`);
}
// state.json saved before skipping existed has no skipped list
assert.deepStrictEqual(view({ A: { issued: 2, serving: 0, calls: 0 }, C: { issued: 0, serving: 0, calls: 0 } }).A.waiting, [1, 2]);
assert.strictEqual(apply({ A: { issued: 2, serving: 0, calls: 0 }, C: {} }, { queue: 'A', type: 'next' }).A.serving, 1);

// Inserting a specific number (missing stub). Issue A1–A8, call up to A6.
s = initial();
for (let i = 0; i < 8; i++) s = apply(s, { queue: 'A', type: 'add' });
for (let i = 0; i < 6; i++) s = apply(s, { queue: 'A', type: 'next' });
assert.strictEqual(s.A.serving, 6);
s = apply(s, { queue: 'A', type: 'insert', number: 3 });
assert.deepStrictEqual(view(s).A.waiting, [3, 7, 8], 'passed number goes first in line');
s = apply(s, { queue: 'A', type: 'insert', number: 5 });
assert.deepStrictEqual(view(s).A.waiting, [3, 5, 7, 8], 'second passed number queues behind the first re-added one');
s = apply(s, { queue: 'A', type: 'insert', number: 12 });
assert.deepStrictEqual(view(s).A.waiting, [3, 5, 7, 8, 12], 'number above issued goes in number order (end)');
assert.strictEqual(s.A.issued, 12, 'issued jumps so Issue never duplicates it');
s = apply(s, { queue: 'A', type: 'add' });
assert.deepStrictEqual(view(s).A.waiting.slice(-1), [13], 'next Issue is A13');
s = apply(s, { queue: 'A', type: 'insert', number: 10 });
assert.deepStrictEqual(view(s).A.waiting, [3, 5, 7, 8, 10, 12, 13], 'number between waiting ones slots into order');
s = apply(s, { queue: 'A', type: 'next' });
assert.strictEqual(s.A.serving, 3, 'Call takes the re-added number first');
for (const [number, msg] of [[5, /already in line/], [3, /now serving/], [0, /bad number/], ['5', /bad number/], [undefined, /bad number/]]) {
  assert.throws(() => apply(s, { queue: 'A', type: 'insert', number }), msg, `insert ${number} rejected`);
}
// A skipped number can be inserted: it leaves the skipped list and rejoins the line.
s = apply(s, { queue: 'A', type: 'skip', number: 8 });
assert.deepStrictEqual(s.A.skipped, [8]);
s = apply(s, { queue: 'A', type: 'insert', number: 8 });
assert.deepStrictEqual([view(s).A.waiting, s.A.skipped], [[5, 7, 8, 10, 12, 13], []], 'skipped number inserted back in order');
// Bringing back a skipped number keeps front-placed passed numbers first.
s = apply(s, { queue: 'A', type: 'skip', number: 7 });
s = apply(s, { queue: 'A', type: 'skip', number: 7 });
assert.deepStrictEqual(view(s).A.waiting, [5, 7, 8, 10, 12, 13]);
// Old saved state (counters only) gets its line rebuilt, honouring skipped numbers.
const old = { A: { issued: 5, serving: 1, calls: 1, skipped: [3] }, C: { issued: 0, serving: 0, calls: 0 } };
assert.deepStrictEqual(view(old).A.waiting, [2, 4, 5]);
const migrated = apply(old, { queue: 'A', type: 'next' });
assert.deepStrictEqual([migrated.A.serving, migrated.A.line], [2, [4, 5]], 'old state: Call skips the skipped A3');

console.log('all queue tests passed');
