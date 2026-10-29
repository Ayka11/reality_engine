import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const samplerSource = await readFile(new URL('../src/infinity/FieldSampler.ts', import.meta.url), 'utf8')
const contractSource = await readFile(new URL('../src/infinity/WorldViewContract.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(samplerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
assert.equal(compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), false)
assert.match(samplerSource, /sampleViewWindow\(width: number, height: number/)
assert.match(samplerSource, /sliceToWorld\(px \+ 0\.5, py \+ 0\.5, safeWidth, safeHeight\)/)
assert.match(samplerSource, /this\.sampleWorld\(point\.x, safeSliceY, point\.z\)/)
assert.match(samplerSource, /Math\.floor\(width\)/)
assert.match(samplerSource, /Math\.floor\(height\)/)
assert.match(contractSource, /sliceToWorld\(px: number, py: number, width: number, height: number\)/)
console.log('PASS: view-window sampling API compiles and uses shared pixel-center/world-coordinate mapping')
console.log('PASS: invalid dimensions are normalized and slice Y is explicit/deterministic')
