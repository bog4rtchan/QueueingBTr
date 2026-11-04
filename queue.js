// Pure queue logic: A = ATAP issuance, C = CL issuance.
const QUEUES = ['A', 'C'];
const TYPES = ['add', 'next', 'recall', 'reset', 'skip', 'insert', 'missing'];
const COUNTERS = [1, 2, 3];
// Announcement voices = folders in public/audio. Shared, because the TV plays the sound.
const VOICES = ['Valkyrie', 'Halliday'];

// line = waiting numbers in calling order; skipped = taken out of the line, can be brought back.
// counter = which counter (1–3) the number on screen was called to; 0 = none yet.
// missing = stubs lost from the ticket set: never issued or called, and kept across Start over.
const fresh = () => ({ issued: 0, serving: 0, counter: 0, calls: 0, line: [], skipped: [], missing: [] });
const initial = () => ({ A: fresh(), C: fresh(), voice: VOICES[0] });

// State saved before the line was stored only had counters: rebuild the line from them once.
function normalize(q = {}) {
  const issued = q.issued ?? 0, serving = q.serving ?? 0, skipped = [...(q.skipped ?? [])];
  let line = q.line;
  if (!line) {
    line = [];
    for (let n = serving + 1; n <= issued; n++) if (!skipped.includes(n)) line.push(n);
  }
  return { issued, serving, counter: q.counter ?? 0, calls: q.calls ?? 0, line: [...line], skipped, missing: [...(q.missing ?? [])] };
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

// Returns a new state, or throws on invalid input.
function apply(state, { queue, type, number, counter, voice } = {}) {
  if (type === 'voice') {
    if (!VOICES.includes(voice)) throw new Error('bad voice');
    return { ...state, voice };
  }
  if (!QUEUES.includes(queue)) throw new Error('bad queue');
  if (!TYPES.includes(type)) throw new Error('bad type');
  const q = normalize(state[queue]);
  if (type === 'add') {
    do q.issued++; while (q.missing.includes(q.issued)); // jump over missing stubs
    q.line.push(q.issued);
  }
  if (type === 'next') {
    // Staff must pick the counter the client goes to; it's shown on the TV and announced.
    if (!COUNTERS.includes(counter)) throw new Error('bad counter');
    if (!q.line.length) return state; // nobody waiting
    q.counter = counter;
    q.serving = q.line.shift();
    q.skipped = q.skipped.filter((s) => s > q.serving); // skipped numbers behind us no longer matter
    q.calls++;
  }
  if (type === 'recall' && q.serving > 0) q.calls++; // display flashes and announces on calls change
  if (type === 'reset') Object.assign(q, fresh(), { missing: q.missing }); // the stub list outlives the day
  if (type === 'skip') {
    // Toggles: skipping a skipped number brings it back, so a mis-click can be undone.
    checkNumber(number);
    if (q.line.includes(number)) {
      q.line = q.line.filter((x) => x !== number);
      q.skipped = [...q.skipped, number].sort((a, b) => a - b);
    } else if (q.skipped.includes(number)) {
      q.skipped = q.skipped.filter((x) => x !== number);
      placeInLine(q, number);
    } else throw new Error('bad number');
  }
  if (type === 'insert') {
    // A specific number put back into the line, e.g. a client whose stub went missing.
    checkNumber(number);
    if (q.line.includes(number)) throw new Error('already in line');
    if (number === q.serving) throw new Error('now serving');
    if (q.missing.includes(number)) throw new Error('missing stub');
    q.skipped = q.skipped.filter((x) => x !== number);
    placeInLine(q, number);
    if (number > q.issued) q.issued = number; // Issue continues after it, so no duplicate tickets
  }
  if (type === 'missing') {
    // Toggle. Unmarking doesn't put it in line: Issue jumped over it, so nobody holds that stub.
    checkNumber(number);
    if (q.missing.includes(number)) q.missing = q.missing.filter((x) => x !== number);
    else {
      q.missing = [...q.missing, number].sort((a, b) => a - b);
      q.line = q.line.filter((x) => x !== number);
      q.skipped = q.skipped.filter((x) => x !== number);
    }
  }
  return { ...state, [queue]: q };
}

// What pages receive: stored state plus `waiting` (the line), the name pages already use.
const view = (state) => ({
  ...Object.fromEntries(QUEUES.map((k) => {
    const q = normalize(state[k]);
    return [k, { ...q, waiting: q.line }];
  })),
  voice: VOICES.includes(state.voice) ? state.voice : VOICES[0], // older saved state has no voice
});

module.exports = { apply, initial, view };
