// Pure queue logic: A = ATAP issuance, C = CL issuance.
const QUEUES = ['A', 'C'];
const TYPES = ['add', 'next', 'recall', 'reset', 'skip'];

const fresh = () => ({ issued: 0, serving: 0, calls: 0, skipped: [] });
const initial = () => ({ A: fresh(), C: fresh() });

// Numbers issued but not yet served, minus skipped ones, in calling order.
function waitingList(q) {
  const skipped = q.skipped ?? []; // state.json from before skipping existed has no list
  const list = [];
  for (let n = q.serving + 1; n <= q.issued; n++) if (!skipped.includes(n)) list.push(n);
  return list;
}

// Returns a new state, or throws on invalid input.
function apply(state, { queue, type, number } = {}) {
  if (!QUEUES.includes(queue)) throw new Error('bad queue');
  if (!TYPES.includes(type)) throw new Error('bad type');
  const q = { ...state[queue], skipped: [...(state[queue].skipped ?? [])] };
  if (type === 'add') q.issued++;
  if (type === 'next') {
    const [n] = waitingList(q);
    if (!n) return state; // nobody waiting
    q.serving = n;
    q.skipped = q.skipped.filter((s) => s > n); // skipped numbers behind us no longer matter
    q.calls++;
  }
  if (type === 'recall' && q.serving > 0) q.calls++; // display flashes on calls change
  if (type === 'reset') Object.assign(q, fresh());
  if (type === 'skip') {
    // Toggles: skipping a skipped number brings it back, so a mis-click can be undone.
    if (!Number.isInteger(number) || number <= q.serving || number > q.issued) throw new Error('bad number');
    q.skipped = q.skipped.includes(number) ? q.skipped.filter((s) => s !== number) : [...q.skipped, number].sort((a, b) => a - b);
  }
  return { ...state, [queue]: q };
}

// What pages receive: stored state plus each queue's waiting list.
const view = (state) => Object.fromEntries(QUEUES.map((k) => [k, { ...state[k], skipped: state[k].skipped ?? [], waiting: waitingList(state[k]) }]));

module.exports = { apply, initial, view };
