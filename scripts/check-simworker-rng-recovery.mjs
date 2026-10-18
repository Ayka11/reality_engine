import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const stateSource = await readFile(new URL("src/core/SimWorkerState.ts", root), "utf8");
const workerSource = await readFile(new URL("src/core/SimWorker.ts", root), "utf8");

assert.match(workerSource, /cmd === 'snapshot'/, "SimWorker must expose snapshot command");
assert.match(workerSource, /cmd === 'restore'/, "SimWorker must expose restore command");
assert.match(workerSource, /rngState/, "SimWorker snapshots must retain RNG state");
assert.doesNotMatch(workerSource, /Math\.random\(\)/, "SimWorker must not use ambient Math.random");

const js = ts.transpileModule(stateSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const url = `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const { nextXorShift32, isValidSimWorkerCausalHistory } = await import(url);

let state = 0x51ed270b;
for (let i = 0; i < 17; i++) state = nextXorShift32(state).state;
const checkpoint = state;
const expected = [];
for (let i = 0; i < 32; i++) {
  const next = nextXorShift32(state);
  state = next.state;
  expected.push(next.value);
}
const finalState = state;
state = checkpoint;
const replay = [];
for (let i = 0; i < 32; i++) {
  const next = nextXorShift32(state);
  state = next.state;
  replay.push(next.value);
}
assert.deepEqual(replay, expected, "PRNG must replay identically from checkpoint");
assert.equal(state, finalState, "PRNG final state must match replay");
assert.throws(() => nextXorShift32(0), /Invalid xorshift32 state/);
assert.equal(isValidSimWorkerCausalHistory([
  { id: 2, tick: 3, x: 0, y: 1, z: 2, delta: 4 },
  { id: 5, tick: 4, x: 31, y: 23, z: 9, delta: -7 },
], 5, 4, 32, 24, 10), true);
assert.equal(isValidSimWorkerCausalHistory([
  { id: 5, tick: 4, x: 32, y: 1, z: 2, delta: 4 },
], 5, 4, 32, 24, 10), false);

console.log("SimWorker RNG recovery: PASS");
