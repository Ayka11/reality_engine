import { isValidSimWorkerCausalHistory, nextXorShift32 } from "../core/SimWorkerState";

export function runSimWorkerRNGRecoveryRegression(): void {
  const seed = 0x51ed270b;
  let state = seed;
  const prefix: number[] = [];
  for (let i = 0; i < 17; i++) {
    const next = nextXorShift32(state);
    state = next.state;
    prefix.push(next.value);
  }
  const checkpoint = state;

  const expected: number[] = [];
  for (let i = 0; i < 32; i++) {
    const next = nextXorShift32(state);
    state = next.state;
    expected.push(next.value);
  }
  const expectedFinalState = state;

  state = checkpoint;
  const replay: number[] = [];
  for (let i = 0; i < 32; i++) {
    const next = nextXorShift32(state);
    state = next.state;
    replay.push(next.value);
  }
  if (JSON.stringify(expected) !== JSON.stringify(replay) || state !== expectedFinalState) {
    throw new Error("SimWorker PRNG did not replay from a restored RNG checkpoint");
  }

  let rejected = false;
  try { nextXorShift32(0); } catch { rejected = true; }
  if (!rejected) throw new Error("SimWorker PRNG accepted zero state");

  const validHistory = [
    { id: 2, tick: 3, x: 0, y: 1, z: 2, delta: 4 },
    { id: 5, tick: 4, x: 31, y: 23, z: 9, delta: -7 },
  ];
  if (!isValidSimWorkerCausalHistory(validHistory, 5, 4, 32, 24, 10)) {
    throw new Error("SimWorker rejected a valid causal history");
  }

  const invalidHistories: Array<{ name: string; events: unknown; evCount: number; tick: number }> = [
    { name: "zero event ID", events: [{ ...validHistory[0], id: 0 }], evCount: 5, tick: 4 },
    { name: "event ID beyond count", events: [{ ...validHistory[0], id: 6 }], evCount: 5, tick: 4 },
    { name: "non-monotonic IDs", events: [validHistory[1], validHistory[0]], evCount: 5, tick: 4 },
    { name: "future event tick", events: [{ ...validHistory[0], tick: 5 }], evCount: 5, tick: 4 },
    { name: "out-of-bounds coordinate", events: [{ ...validHistory[0], x: 32 }], evCount: 5, tick: 4 },
    { name: "non-finite delta", events: [{ ...validHistory[0], delta: Number.NaN }], evCount: 5, tick: 4 },
    { name: "too many events", events: Array.from({ length: 401 }, (_, i) => ({ ...validHistory[0], id: i + 1 })), evCount: 401, tick: 4 },
  ];
  for (const invalid of invalidHistories) {
    if (isValidSimWorkerCausalHistory(invalid.events, invalid.evCount, invalid.tick, 32, 24, 10)) {
      throw new Error(`SimWorker accepted invalid causal history: ${invalid.name}`);
    }
  }
}
