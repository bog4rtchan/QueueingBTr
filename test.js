const assert = require('node:assert');
const { apply, initial, view } = require('./queue');

let s = initial();
assert.strictEqual(apply(s, { queue: 'A', type: 'next', counter: 1 }), s, 'next with nobody waiting is a no-op');
s = apply(s, { queue: 'A', type: 'add' });
s = apply(s, { queue: 'A', type: 'add' });
s = apply(s, { queue: 'C', type: 'add' });
assert.deepStrictEqual([s.A.issued, s.C.issued], [2, 1], 'queues are independent');
s = apply(s, { queue: 'A', type: 'next', counter: 1 });
assert.strictEqual(s.A.serving, 1);
s = apply(s, { queue: 'A', type: 'recall' });
assert.deepStrictEqual([s.A.serving, s.A.calls], [1, 2], 'recall keeps number, bumps calls');
s = apply(s, { queue: 'A', type: 'reset' });
assert.deepStrictEqual(s.A, { issued: 0, serving: 0, counter: 0, calls: 0, line: [], skipped: [], missing: [] });
assert.strictEqual(s.C.issued, 1, 'reset A leaves C alone');
assert.throws(() => apply(s, { queue: 'X', type: 'add' }));
assert.throws(() => apply(s, { queue: 'A', type: 'delete' }));

// Skipping: issue C2..C5 (C1 already issued above), serve C1, then skip C2 (the next) and C4 (further back).
s = initial();
for (let i = 0; i < 5; i++) s = apply(s, { queue: 'C', type: 'add' });
s = apply(s, { queue: 'C', type: 'next', counter: 1 });
s = apply(s, { queue: 'C', type: 'skip', number: 2 });
s = apply(s, { queue: 'C', type: 'skip', number: 4 });
assert.deepStrictEqual(view(s).C.waiting, [3, 5], 'skipped numbers leave the waiting list');
s = apply(s, { queue: 'C', type: 'skip', number: 4 });
assert.deepStrictEqual(view(s).C.waiting, [3, 4, 5], 'skipping again brings the number back');
s = apply(s, { queue: 'C', type: 'next', counter: 1 });
assert.strictEqual(s.C.serving, 3, 'next jumps over skipped C2');
assert.deepStrictEqual(s.C.skipped, [], 'skipped numbers behind the served one are dropped');
s = apply(s, { queue: 'C', type: 'skip', number: 4 });
s = apply(s, { queue: 'C', type: 'skip', number: 5 });
const before = s;
assert.strictEqual(apply(s, { queue: 'C', type: 'next', counter: 1 }), before, 'all remaining skipped = nobody waiting');
for (const number of [3, 6, 0, '4', undefined]) {
  assert.throws(() => apply(s, { queue: 'C', type: 'skip', number }), /bad number/, `skip ${number} rejected`);
}
// state.json saved before skipping existed has no skipped list
assert.deepStrictEqual(view({ A: { issued: 2, serving: 0, calls: 0 }, C: { issued: 0, serving: 0, calls: 0 } }).A.waiting, [1, 2]);
assert.strictEqual(apply({ A: { issued: 2, serving: 0, calls: 0 }, C: {} }, { queue: 'A', type: 'next', counter: 1 }).A.serving, 1);

// Inserting a specific number (missing stub). Issue A1–A8, call up to A6.
s = initial();
for (let i = 0; i < 8; i++) s = apply(s, { queue: 'A', type: 'add' });
for (let i = 0; i < 6; i++) s = apply(s, { queue: 'A', type: 'next', counter: 1 });
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
s = apply(s, { queue: 'A', type: 'next', counter: 1 });
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
const migrated = apply(old, { queue: 'A', type: 'next', counter: 1 });
assert.deepStrictEqual([migrated.A.serving, migrated.A.line], [2, [4, 5]], 'old state: Call skips the skipped A3');

// Counter: required on Call, stored with the number, kept by Repeat call.
s = initial();
s = apply(s, { queue: 'C', type: 'add' });
s = apply(s, { queue: 'C', type: 'add' });
for (const counter of [undefined, 0, 4, '2']) {
  assert.throws(() => apply(s, { queue: 'C', type: 'next', counter }), /bad counter/, `counter ${counter} rejected`);
}
s = apply(s, { queue: 'C', type: 'next', counter: 2 });
assert.deepStrictEqual([s.C.serving, s.C.counter], [1, 2], 'called to counter 2');
s = apply(s, { queue: 'C', type: 'recall' });
assert.strictEqual(s.C.counter, 2, 'repeat call keeps the counter');
s = apply(s, { queue: 'C', type: 'next', counter: 3 });
assert.deepStrictEqual([s.C.serving, s.C.counter, s.A.counter], [2, 3, 0], 'next call can go to another counter; A untouched');
assert.strictEqual(view({ A: { issued: 1, serving: 1, calls: 1 }, C: {} }).A.counter, 0, 'old state has no counter yet');

// Missing stubs: per queue, never issued or called, kept across Start over.
s = initial();
const issue = (q, times) => { for (let i = 0; i < times; i++) s = apply(s, { queue: q, type: 'add' }); };
s = apply(s, { queue: 'A', type: 'missing', number: 3 });
s = apply(s, { queue: 'A', type: 'missing', number: 5 });
issue('A', 4);
assert.deepStrictEqual(view(s).A.waiting, [1, 2, 4, 6], 'Issue jumps over missing A3 and A5');
s = apply(s, { queue: 'A', type: 'missing', number: 4 });
assert.deepStrictEqual(view(s).A.waiting, [1, 2, 6], 'marking a waiting number removes it from the line');
s = apply(s, { queue: 'A', type: 'skip', number: 6 });
s = apply(s, { queue: 'A', type: 'missing', number: 6 });
assert.deepStrictEqual([s.A.skipped, s.A.missing], [[], [3, 4, 5, 6]], 'marking a skipped number clears it from skipped');
s = apply(s, { queue: 'A', type: 'missing', number: 4 });
assert.deepStrictEqual(view(s).A.waiting, [1, 2], 'unmarking does not put it back in line');
s = apply(s, { queue: 'A', type: 'missing', number: 9 });
s = apply(s, { queue: 'A', type: 'missing', number: 9 });
issue('A', 3);
assert.deepStrictEqual(view(s).A.waiting, [1, 2, 7, 8, 9], 'an unmarked number above issued is issued normally');
assert.throws(() => apply(s, { queue: 'A', type: 'insert', number: 5 }), /missing stub/);
for (const number of [0, '3', undefined]) {
  assert.throws(() => apply(s, { queue: 'A', type: 'missing', number }), /bad number/, `missing ${number} rejected`);
}
s = apply(s, { queue: 'C', type: 'missing', number: 2 });
assert.deepStrictEqual([s.A.missing, s.C.missing], [[3, 5, 6], [2]], 'separate lists for ATAP and CL');
s = apply(s, { queue: 'A', type: 'reset' });
assert.deepStrictEqual([s.A.issued, s.A.line, s.A.missing], [0, [], [3, 5, 6]], 'Start over keeps the missing list');
issue('C', 2);
assert.deepStrictEqual(view(s).C.waiting, [1, 3]);
assert.deepStrictEqual(view({ A: { issued: 1, serving: 0, calls: 0 }, C: {} }).A.missing, [], 'old state has no missing list');

// Voice: one shared setting, not per queue.
s = initial();
assert.strictEqual(view(s).voice, 'Valkyrie');
s = apply(s, { type: 'voice', voice: 'Halliday' });
assert.deepStrictEqual([view(s).voice, s.A.issued], ['Halliday', 0]);
for (const voice of ['halliday', undefined, '../x']) {
  assert.throws(() => apply(s, { type: 'voice', voice }), /bad voice/, `voice ${voice} rejected`);
}
assert.strictEqual(view({ A: {}, C: {} }).voice, 'Valkyrie', 'old state gets the default voice');

// History: one entry per queue action, at the server's time; not part of view().
s = initial();
let t = 1000;
const act = (a) => { s = apply(s, a, t++); };
assert.strictEqual(apply(s, { queue: 'A', type: 'next', counter: 1 }, 5), s, 'no-op Call is not logged');
assert.strictEqual(apply(s, { queue: 'A', type: 'recall' }, 5), s, 'Repeat call with nothing on screen is a no-op');
act({ queue: 'A', type: 'add' });
act({ queue: 'A', type: 'add' });
act({ queue: 'A', type: 'next', counter: 2 });
act({ queue: 'A', type: 'skip', number: 2 });
act({ queue: 'A', type: 'skip', number: 2 });
act({ queue: 'A', type: 'recall' });
act({ queue: 'C', type: 'missing', number: 4 });
act({ queue: 'C', type: 'missing', number: 4 });
act({ queue: 'A', type: 'reset' });
act({ type: 'voice', voice: 'Halliday' });
assert.deepStrictEqual(s.history, [
  { at: 1000, queue: 'A', type: 'add', number: 1 },
  { at: 1001, queue: 'A', type: 'add', number: 2 },
  { at: 1002, queue: 'A', type: 'next', number: 1, counter: 2 },
  { at: 1003, queue: 'A', type: 'skip', number: 2 },
  { at: 1004, queue: 'A', type: 'unskip', number: 2 },
  { at: 1005, queue: 'A', type: 'recall', number: 1, counter: 2 },
  { at: 1006, queue: 'C', type: 'missing', number: 4 },
  { at: 1007, queue: 'C', type: 'found', number: 4 },
  { at: 1008, queue: 'A', type: 'reset' },
], 'history entries; voice change not logged; Start over keeps the log');
assert.strictEqual('history' in view(s), false, '/state does not carry the history');
s = { ...s, history: Array.from({ length: 2000 }, (_, i) => ({ at: i, queue: 'A', type: 'add', number: i + 1 })) };
act({ queue: 'C', type: 'add' });
assert.deepStrictEqual([s.history.length, s.history[0].at, s.history.at(-1).queue], [2000, 1, 'C'], 'log capped at 2000, oldest dropped');
assert.strictEqual(apply({ A: { issued: 1 }, C: {} }, { queue: 'A', type: 'add' }, 7).history.length, 1, 'old state without history');

console.log('all queue tests passed');
