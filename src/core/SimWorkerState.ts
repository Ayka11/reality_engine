export interface XorShift32Result {
  state: number;
  value: number;
}

/** Advance a non-zero uint32 xorshift state exactly once. */
export function nextXorShift32(state: number): XorShift32Result {
  if (!Number.isSafeInteger(state) || state <= 0 || state > 0xffffffff) {
    throw new Error("Invalid xorshift32 state");
  }
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const nextState = x >>> 0;
  if (nextState === 0) throw new Error("xorshift32 reached the forbidden zero state");
  return { state: nextState, value: nextState / 0x100000000 };
}
