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
}
