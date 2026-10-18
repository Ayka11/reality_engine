import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const stateSource = await readFile(new URL("src/core/SimWorkerState.ts", root), "utf8");
const workerSource = await readFile(new URL("src/core/SimWorker.ts", root), "utf8");

assert.match(workerSource, /cmd === 'snapshot'/, "SimWorker must expose snapshot command");
assert.match(workerSource, /cmd === 'restore'/, "SimWorker must expose restore command");
assert.match(workerSource, /rngState/, "SimWorker snapshots must retain RNG state");
assert.doesNotMatch(workerSource, /Math\.random\(\)/, "SimWorker must not use ambient Math.random");

const stateJs = ts.transpileModule(stateSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const stateUrl = `data:text/javascript;base64,${Buffer.from(stateJs).toString("base64")}`;
const stateModule = await import(stateUrl);
const { nextXorShift32, isValidSimWorkerCausalHistory } = stateModule;

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

// Exercise the real worker message handler in an isolated worker-like VM.
const workerJs = ts.transpileModule(workerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function makeWorker() {
  const posted = [];
  const self = { onmessage: null, postMessage: (message) => posted.push(message) };
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === "./SimWorkerState") return stateModule;
      throw new Error(`Unexpected worker dependency: ${specifier}`);
    },
    self,
    Float32Array,
    Math,
    Number,
    Array,
    Set,
    Object,
    Error,
  };
  vm.runInNewContext(workerJs, sandbox, { filename: "SimWorker.test.cjs" });
  assert.equal(typeof self.onmessage, "function", "worker message handler must initialize");
  return {
    send(cmd, data = {}) {
      posted.length = 0;
      self.onmessage({ data: { cmd, data } });
      return posted[0];
    },
  };
}

const sourceWorker = makeWorker();
sourceWorker.send("setSeed", { seed: 123456789 });
sourceWorker.send("preset", { name: "life" });
sourceWorker.send("tick", { speed: 3 });
const checkpointResponse = sourceWorker.send("snapshot");
assert.equal(checkpointResponse?.cmd, "snapshot", "snapshot command must return a snapshot");
const saved = checkpointResponse.data;
assert.equal(saved.version, 1);
assert.equal(saved.tick, 3);
assert.equal(saved.rngState > 0, true);
assert.equal(saved.buffer.length, 32 * 24 * 10 * 14);
assert.equal(saved.backBuffer.length, saved.buffer.length);

sourceWorker.send("preset", { name: "proto" });
sourceWorker.send("tick", { speed: 2 });
const expectedReplay = sourceWorker.send("snapshot").data;

const restoredWorker = makeWorker();
const restoredResponse = restoredWorker.send("restore", saved);
assert.equal(restoredResponse?.cmd, "restored", "restore command must acknowledge success");
restoredWorker.send("preset", { name: "proto" });
restoredWorker.send("tick", { speed: 2 });
const actualReplay = restoredWorker.send("snapshot").data;
assert.equal(JSON.stringify(actualReplay), JSON.stringify(expectedReplay),
  "worker snapshot/restore must reproduce the same state after further randomized operations");

// A rejected restore must not partially mutate the worker's live state.
const beforeInvalidRestore = restoredWorker.send("snapshot").data;
assert.throws(() => restoredWorker.send("restore", { ...saved, buffer: [1, 2, 3] }),
  /Invalid SimWorker snapshot/);
const afterInvalidRestore = restoredWorker.send("snapshot").data;
assert.equal(JSON.stringify(afterInvalidRestore), JSON.stringify(beforeInvalidRestore),
  "invalid restore must leave all live state unchanged");

console.log("SimWorker RNG recovery and worker snapshot round-trip: PASS");
