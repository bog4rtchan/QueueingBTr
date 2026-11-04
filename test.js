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
assert.deepStrictEqual(s.A, { issued: 0, serving: 0, calls: 0, skipped: [] });
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

console.log('all queue tests passed');
