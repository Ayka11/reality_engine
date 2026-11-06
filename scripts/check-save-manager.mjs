import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/world/save/SaveManager.ts", root), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = "data:text/javascript;base64," + Buffer.from(js).toString("base64");
const { SaveManager } = await import(moduleUrl);

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const intervals = new Map();
const cleared = [];
let nextTimerId = 1;
globalThis.setInterval = (callback, delay) => {
  const id = nextTimerId++;
  intervals.set(id, { callback, delay });
  return id;
};
globalThis.clearInterval = id => {
  cleared.push(id);
  intervals.delete(id);
};

const pending = [];
const savedNames = [];
const reportedErrors = [];
const saveSystem = {
  quickSave(name) {
    savedNames.push(name);
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  },
};
const manager = new SaveManager(saveSystem, error => reportedErrors.push(error));
const flush = () => new Promise(resolve => setImmediate(resolve));

try {
  manager.startAutoSave(25);
  assert.equal(manager.enabled, true);
  assert.equal(intervals.size, 1);
  const firstTimerId = [...intervals.keys()][0];
  const tick = intervals.get(firstTimerId).callback;

  tick();
  tick();
  await flush();
  assert.equal(savedNames.length, 1,
    "a second timer tick must not start another save while the first is pending");

  pending[0].resolve("Autosave_1");
  await flush();
  tick();
  await flush();
  assert.equal(savedNames.length, 2,
    "autosave must resume after the prior save settles");

  const injectedError = new Error("injected autosave quota failure");
  pending[1].reject(injectedError);
  await flush();
  assert.deepEqual(reportedErrors, [injectedError],
    "autosave failures must be forwarded to the UI error reporter");

  tick();
  await flush();
  assert.equal(savedNames.length, 3,
    "a failed autosave must release the single-flight guard for the next interval");
  pending[2].resolve("Autosave_3");
  await flush();

  manager.startAutoSave(50);
  assert.equal(cleared.includes(firstTimerId), true,
    "restarting autosave must clear the previous timer");
  assert.equal(intervals.size, 1);
  manager.stopAutoSave();
  assert.equal(manager.enabled, false);
  assert.equal(intervals.size, 0);
  assert.equal(cleared.length, 2);
} finally {
  manager.stopAutoSave();
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}

console.log("SaveManager single-flight autosave, retry, error reporting and timer lifecycle: PASS");
