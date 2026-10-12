import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/scientific/SolverClient.ts', 'utf8');
assert.match(source, /import\.meta\.env\.VITE_SOLVER_URL/);
assert.match(source, /import\.meta\.env\.DEV\s*\?\s*'http:\/\/localhost:8765'\s*:\s*''/);
assert.match(source, /if \(!SOLVER_URL\)\s*\{/);
assert.match(source, /No solver endpoint configured/);
assert.doesNotMatch(source, /export const SOLVER_URL\s*=\s*'http:\/\/localhost:8765'/);
console.log('Solver deployment endpoint contract: PASS');
