// Pure queue logic: A = ATAP issuance, C = CL issuance.
const QUEUES = ['A', 'C'];
const TYPES = ['add', 'next', 'recall', 'reset', 'skip', 'insert', 'missing', 'back'];
const COUNTERS = [1, 2, 3];
// Announcement voices = folders in public/audio. Shared, because the TV plays the sound.
const VOICES = ['Valkyrie', 'Halliday'];
// shortcut: capped log, export/rotate per day if a longer record is needed.
const HISTORY_MAX = 2000;
// Physical stubs per queue. Internal numbers keep counting up (31, 32…) so every ticket of the day is unique;
// pages show and announce the stub (31 → A1, round 2). shortcut: one count for both queues, make per-queue if the sets differ.
const STUBS = 30;
const stub = (n) => ((n - 1) % STUBS) + 1;
const round = (n) => Math.ceil(n / STUBS);

// line = waiting numbers in calling order; skipped = taken out of the line, can be brought back.
// counter = which counter (1–3) the number on screen was called to; 0 = none yet.
// missing = stub numbers (1–STUBS) lost from the set: never issued in any round, kept across Start over.
// previous = earlier calls since Start over ({number, counter}), newest last, for "Back to the previous number".
const fresh = () => ({ issued: 0, serving: 0, counter: 0, calls: 0, line: [], skipped: [], missing: [], previous: [] });
const PREVIOUS_MAX = 50;
const initial = () => ({ A: fresh(), C: fresh(), voice: VOICES[0] });

// State saved before the line was stored only had counters: rebuild the line from them once.
function normalize(q = {}) {
  const issued = q.issued ?? 0, serving = q.serving ?? 0, skipped = [...(q.skipped ?? [])];
  let line = q.line;
  if (!line) {
    line = [];
    for (let n = serving + 1; n <= issued; n++) if (!skipped.includes(n)) line.push(n);
  }
  return { issued, serving, counter: q.counter ?? 0, calls: q.calls ?? 0, line: [...line], skipped, missing: [...(q.missing ?? [])], previous: [...(q.previous ?? [])] };
}

// Passed numbers (below serving) go first, behind passed numbers re-added earlier;
// others slot into number order among the rest of the line.
function placeInLine(q, n) {
  const i = n < q.serving
    ? q.line.findIndex((x) => x > q.serving)
    : q.line.findIndex((x) => x > q.serving && x > n);
  if (i === -1) q.line.push(n);
  else q.line.splice(i, 0, n);
}

const checkNumber = (number) => {
  if (!Number.isInteger(number) || number < 1) throw new Error('bad number');
};

// Returns a new state, or throws on invalid input. Every queue action is logged in state.history at `now`.
function apply(state, { queue, type, number, counter, voice } = {}, now = Date.now()) {
  if (type === 'voice') {
    if (!VOICES.includes(voice)) throw new Error('bad voice');
    return { ...state, voice };
  }
  if (!QUEUES.includes(queue)) throw new Error('bad queue');
  if (!TYPES.includes(type)) throw new Error('bad type');
  const q = normalize(state[queue]);
  let logType = type, logNumber = number;
  const extra = {};
  if (type === 'add') {
    // Jump over lost stubs and stubs still in someone's hand from an earlier round (waiting, on screen, or skipped).
    const held = new Set([...q.line, ...q.skipped, q.serving].filter(Boolean).map(stub));
    let tries = 0;
    do {
      if (++tries > STUBS) throw new Error('no free stub');
      q.issued++;
    } while (q.missing.includes(stub(q.issued)) || held.has(stub(q.issued)));
    q.line.push(q.issued);
    logNumber = q.issued;
  }
  if (type === 'next') {
    // Staff must pick the counter the client goes to; it's shown on the TV and announced.
    if (!COUNTERS.includes(counter)) throw new Error('bad counter');
    if (!q.line.length) return state; // nobody waiting
    if (q.serving && !q.skipped.includes(q.serving)) q.previous = [...q.previous, { number: q.serving, counter: q.counter }].slice(-PREVIOUS_MAX);
    q.counter = counter;
    q.serving = q.line.shift();
    // Skipped numbers stay all day (as "bring back" chips): a no-show who returns goes first in line.
    q.calls++;
    logNumber = q.serving;
  }
  if (type === 'recall') {
    if (!q.serving || q.skipped.includes(q.serving)) return state; // nothing on screen to repeat
    q.calls++; // display flashes and announces on calls change
    logNumber = q.serving;
    counter = q.counter;
  }
  if (type === 'back') {
    // Undo a call: the number on screen goes back to the front of the line, the previous one is shown and announced again.
    if (!q.previous.length) return state;
    const prev = q.previous.pop();
    const returned = q.serving;
    q.line = q.line.filter((x) => x !== prev.number);
    const requeue = returned && !q.skipped.includes(returned); // a skipped no-show stays skipped
    if (requeue) q.line.unshift(returned);
    q.serving = prev.number;
    q.counter = prev.counter;
    q.calls++;
    logNumber = prev.number;
    counter = prev.counter;
    if (requeue) extra.returned = returned;
  }
  if (type === 'reset') Object.assign(q, fresh(), { missing: q.missing }); // the stub list outlives the day
  if (type === 'skip') {
    // Toggles: skipping a skipped number brings it back, so a mis-click can be undone.
    checkNumber(number);
    if (number === q.serving) {
      // The number on screen didn't come: blank the screen (pages show "–"); skipping again puts it back.
      if (q.skipped.includes(number)) {
        q.skipped = q.skipped.filter((x) => x !== number);
        logType = 'unskip';
      } else q.skipped = [...q.skipped, number].sort((a, b) => a - b);
    } else if (q.line.includes(number)) {
      q.line = q.line.filter((x) => x !== number);
      q.skipped = [...q.skipped, number].sort((a, b) => a - b);
    } else if (q.skipped.includes(number)) {
      q.skipped = q.skipped.filter((x) => x !== number);
      placeInLine(q, number);
      logType = 'unskip';
    } else throw new Error('bad number');
  }
  if (type === 'insert') {
    // A stub (1–STUBS) put into the line, e.g. a client whose stub went missing. It means that stub in the
    // current round; one not handed out yet this round bumps `issued` below.
    checkNumber(number);
    if (number > STUBS) throw new Error('bad number');
    if (q.missing.includes(number)) throw new Error('missing stub');
    const same = (x) => stub(x) === number; // checked across rounds: one physical stub, one client
    if (q.line.some(same)) throw new Error('already in line');
    if (q.serving && same(q.serving)) throw new Error('now serving');
    // A skipped holder of this stub is brought back; otherwise it's this stub in the current round.
    number = q.skipped.find(same) ?? (q.issued ? (round(q.issued) - 1) * STUBS : 0) + number;
    logNumber = number;
    q.skipped = q.skipped.filter((x) => x !== number);
    placeInLine(q, number);
    if (number > q.issued) q.issued = number; // Issue continues after it, so no duplicate tickets
  }
  if (type === 'missing') {
    // Toggle. Unmarking doesn't put it in line: Issue jumped over it, so nobody holds that stub.
    checkNumber(number);
    if (number > STUBS) throw new Error('bad number');
    if (q.missing.includes(number)) {
      q.missing = q.missing.filter((x) => x !== number);
      logType = 'found';
    } else {
      q.missing = [...q.missing, number].sort((a, b) => a - b);
      q.line = q.line.filter((x) => stub(x) !== number); // in every round
      q.skipped = q.skipped.filter((x) => stub(x) !== number);
    }
  }
  const entry = { at: now, queue, type: logType };
  if (logNumber !== undefined) entry.number = logNumber;
  if (['next', 'recall', 'back'].includes(type) && counter) entry.counter = counter;
  Object.assign(entry, extra);
  return { ...state, [queue]: q, history: [...(state.history ?? []), entry].slice(-HISTORY_MAX) };
}

// A new office day (`today` = 'YYYY-MM-DD'): both queues start over and the history is cleared.
// Lost stubs stay marked, like with Start over. State saved before this existed has no day: adopt it, don't wipe it.
function rollover(state, today) {
  if (state.day === today) return state;
  if (!state.day) return { ...state, day: today };
  const next = { ...state, day: today, history: [] };
  for (const k of QUEUES) next[k] = { ...fresh(), missing: normalize(state[k]).missing };
  return next;
}

// What pages receive: stored state plus `waiting` (the line), the name pages already use.
const view = (state) => ({
  ...Object.fromEntries(QUEUES.map((k) => {
    const q = normalize(state[k]);
    return [k, { ...q, waiting: q.line }];
  })),
  voice: VOICES.includes(state.voice) ? state.voice : VOICES[0], // older saved state has no voice
  stubs: STUBS,
}); // history is left out: /state is polled every second, the log is served by /history instead

module.exports = { apply, initial, view, rollover, stub, round, STUBS };
