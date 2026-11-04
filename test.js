const assert = require('node:assert');
const { apply, initial, view, rollover, stub, round, STUBS } = require('./queue');

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
assert.deepStrictEqual(s.A, { issued: 0, serving: 0, counter: 0, calls: 0, line: [], skipped: [], missing: [], previous: [] });
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
assert.deepStrictEqual(s.C.skipped, [2], 'passed skipped numbers stay, so they can be brought back');
s = apply(s, { queue: 'C', type: 'skip', number: 4 });
s = apply(s, { queue: 'C', type: 'skip', number: 5 });
const before = s;
assert.strictEqual(apply(s, { queue: 'C', type: 'next', counter: 1 }), before, 'all remaining skipped = nobody waiting');
for (const number of [6, 0, '4', undefined]) {
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

// Back to the previous number: undoes a call, the number on screen goes first in line.
s = initial();
for (let i = 0; i < 4; i++) s = apply(s, { queue: 'A', type: 'add' });
assert.strictEqual(apply(s, { queue: 'A', type: 'back' }), s, 'nothing called yet: back is a no-op');
s = apply(s, { queue: 'A', type: 'next', counter: 1 });
s = apply(s, { queue: 'A', type: 'next', counter: 2 });
s = apply(s, { queue: 'A', type: 'next', counter: 3 });
const callsBefore = s.A.calls;
s = apply(s, { queue: 'A', type: 'back' }, 50);
assert.deepStrictEqual([s.A.serving, s.A.counter, s.A.line, s.A.calls], [2, 2, [3, 4], callsBefore + 1], 'back shows A2 at counter 2, A3 first in line');
assert.deepStrictEqual(s.history.at(-1), { at: 50, queue: 'A', type: 'back', number: 2, counter: 2, returned: 3 });
s = apply(s, { queue: 'A', type: 'back' });
assert.deepStrictEqual([s.A.serving, s.A.counter, s.A.line], [1, 1, [2, 3, 4]]);
const atStart = s;
assert.strictEqual(apply(s, { queue: 'A', type: 'back' }), atStart, 'no earlier call: no-op');
s = apply(s, { queue: 'A', type: 'next', counter: 1 });
assert.deepStrictEqual([s.A.serving, s.A.line], [2, [3, 4]], 'Call after back brings the returned number up');
s = apply(s, { queue: 'A', type: 'reset' });
assert.deepStrictEqual(s.A.previous, [], 'Start over clears the back stack');
assert.deepStrictEqual(view({ A: { issued: 1, serving: 1, calls: 1 }, C: {} }).A.previous, [], 'old state has no previous list');

// Daily restart: queues and history start over on a new day, lost stubs and voice stay.
s = initial();
s = rollover(s, '2026-11-04');
assert.strictEqual(s.day, '2026-11-04', 'state without a day adopts today without wiping');
s = apply(s, { queue: 'A', type: 'missing', number: 2 });
s = apply(s, { queue: 'A', type: 'add' });
s = apply(s, { queue: 'A', type: 'next', counter: 1 });
s = apply(s, { type: 'voice', voice: 'Halliday' });
assert.strictEqual(rollover(s, '2026-11-04'), s, 'same day: unchanged');
const kept = rollover({ A: { issued: 3, serving: 1, calls: 1 }, C: {} }, '2026-11-04');
assert.deepStrictEqual([kept.A.issued, kept.A.serving], [3, 1], 'old saved queue survives the upgrade');
s = rollover(s, '2026-11-05');
assert.deepStrictEqual([s.day, s.A.issued, s.A.serving, s.A.missing, s.history, s.voice], ['2026-11-05', 0, 0, [2], [], 'Halliday']);
assert.deepStrictEqual(s.C, { issued: 0, serving: 0, counter: 0, calls: 0, line: [], skipped: [], missing: [], previous: [] });

// Skipping the number on screen (no-show): screen blanks, number kept as a bring-back.
s = initial();
for (let i = 0; i < 4; i++) s = apply(s, { queue: 'A', type: 'add' });
s = apply(s, { queue: 'A', type: 'next', counter: 1 });
s = apply(s, { queue: 'A', type: 'next', counter: 2 }); // A2 on screen, A1 in previous
s = apply(s, { queue: 'A', type: 'skip', number: 2 }, 9);
assert.deepStrictEqual([s.A.serving, s.A.skipped, s.A.line], [2, [2], [3, 4]], 'serving A2 marked skipped');
assert.deepStrictEqual(s.history.at(-1), { at: 9, queue: 'A', type: 'skip', number: 2 });
assert.strictEqual(apply(s, { queue: 'A', type: 'recall' }), s, 'no repeat call for a skipped number');
const unskipped = apply(s, { queue: 'A', type: 'skip', number: 2 });
assert.deepStrictEqual([unskipped.A.skipped, unskipped.A.line], [[], [3, 4]], 'skip again puts it back on screen');
const backed = apply(s, { queue: 'A', type: 'back' });
assert.deepStrictEqual([backed.A.serving, backed.A.line, backed.A.skipped], [1, [3, 4], [2]], 'back leaves a skipped no-show out of the line');
s = apply(s, { queue: 'A', type: 'next', counter: 1 });
assert.deepStrictEqual([s.A.serving, s.A.previous.map((p) => p.number)], [3, [1]], 'skipped no-show is not a Back target');
s = apply(s, { queue: 'A', type: 'skip', number: 2 });
assert.deepStrictEqual([s.A.line, s.A.skipped], [[2, 4], []], 'a returning no-show goes first in line');

// 30 stubs reused: internal numbers keep counting, stub label wraps, rounds tell them apart.
assert.deepStrictEqual([STUBS, stub(1), stub(30), stub(31), round(30), round(31), stub(62), round(62)], [30, 1, 30, 1, 1, 2, 2, 3]);
s = initial();
s = apply(s, { queue: 'A', type: 'missing', number: 3 });
for (let i = 0; i < 3; i++) s = apply(s, { queue: 'A', type: 'add' });
assert.deepStrictEqual(s.A.line, [1, 2, 4], 'missing stub 3 jumped');
for (let i = 0; i < 26; i++) s = apply(s, { queue: 'A', type: 'add' });
assert.strictEqual(s.A.issued, 30);
assert.throws(() => apply(s, { queue: 'A', type: 'add' }), /no free stub/, 'all 29 usable stubs are still waiting');
for (let i = 0; i < 3; i++) s = apply(s, { queue: 'A', type: 'next', counter: 1 }); // A1, A2, A4 called; A4 on screen
s = apply(s, { queue: 'A', type: 'add' });
assert.strictEqual(s.A.line.at(-1), 31, 'stub 1 again (number 31) once A1 has been served');
s = apply(s, { queue: 'A', type: 'add' });
assert.strictEqual(s.A.line.at(-1), 32, 'stub 2 again');
assert.throws(() => apply(s, { queue: 'A', type: 'add' }), /no free stub/, 'stub 3 missing, 4 on screen, 5–30 waiting');
s = apply(s, { queue: 'A', type: 'next', counter: 1 }); // A5 on screen: stub 4 handed back
s = apply(s, { queue: 'A', type: 'add' });
assert.strictEqual(s.A.line.at(-1), 34, 'jumps missing stub 3 to the freed stub 4');
assert.throws(() => apply(s, { queue: 'A', type: 'insert', number: 8 }), /already in line/, 'stub 8 from round 1 is still waiting');
assert.throws(() => apply(s, { queue: 'A', type: 'insert', number: 5 }), /now serving/);
let r2 = initial();
for (let i = 0; i < 30; i++) r2 = apply(r2, { queue: 'C', type: 'add' });
for (let i = 0; i < 30; i++) r2 = apply(r2, { queue: 'C', type: 'next', counter: 1 }); // C30 on screen
r2 = apply(r2, { queue: 'C', type: 'add' }); // stub 1 again = 31
r2 = apply(r2, { queue: 'C', type: 'insert', number: 5 });
assert.deepStrictEqual([r2.C.issued, r2.C.line], [35, [31, 35]], 'insert stub 5 in round 2 = number 35');
r2 = apply(r2, { queue: 'C', type: 'skip', number: 31 });
r2 = apply(r2, { queue: 'C', type: 'insert', number: 1 });
assert.deepStrictEqual([r2.C.line, r2.C.skipped, r2.C.issued], [[31, 35], [], 35], 'insert of a skipped stub brings that ticket back');
assert.throws(() => apply(s, { queue: 'A', type: 'insert', number: 31 }), /bad number/);
assert.throws(() => apply(s, { queue: 'A', type: 'missing', number: 31 }), /bad number/);
s = apply(s, { queue: 'A', type: 'missing', number: 6 });
assert.ok(!s.A.line.includes(6) && s.A.line.includes(7), 'marking stub 6 missing removes it from the line');
assert.strictEqual(view(s).stubs, 30);

console.log('all queue tests passed');
