// Server clock. Everything that stores or compares a timestamp (sends, due dates, follow up
// actions, the fixture mailbox) reads time from one Clock so tests and browser QA can move time
// forward deterministically instead of waiting days. Production uses the real time (offset 0); the
// offset can only change through the test controls, which exist only in full fixture mode.
export interface Clock {
  now(): Date;
  offsetMs(): number;
  setOffsetMs(ms: number): void;
}

export function createClock(initialOffsetMs = 0, base: () => number = Date.now): Clock {
  let offset = initialOffsetMs;
  return {
    now: () => new Date(base() + offset),
    offsetMs: () => offset,
    setOffsetMs: (ms) => {
      offset = ms;
    },
  };
}
