import assert from 'node:assert/strict'
import ts from 'typescript'
import fs from 'node:fs/promises'

const contract = await fs.readFile('src/infinity/LawPhysicsContract.ts', 'utf8')
const renderer = await fs.readFile('src/render/InfiniteWorldRenderer.ts', 'utf8')
const construction = await fs.readFile('src/infinity/WorldConstructionContract.ts', 'utf8')

const out = ts.transpileModule(contract, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
assert.equal(out.diagnostics?.length ?? 0, 0)

const module = { exports: {} }
new Function('exports', 'module', out.outputText)(module.exports, module)
const { LawPhysicsContract } = module.exports

const base = {
  gravity: 48,
  entropyDamping: 0.82,
  quantumLift: 35,
  forcePush: 40,
  metaLawOrbit: 22,
}

const all = new LawPhysicsContract(() => ({
  processes: ['gravity', 'entropy', 'info', 'density'],
})).apply(base)
assert.deepEqual(all, base)

const noGravity = new LawPhysicsContract(() => ({
  processes: ['entropy', 'info', 'density'],
})).apply(base)
assert.equal(noGravity.gravity, 0)
assert.equal(noGravity.entropyDamping, base.entropyDamping)
assert.equal(noGravity.quantumLift, base.quantumLift)
assert.equal(noGravity.forcePush, base.forcePush)

const noEntropy = new LawPhysicsContract(() => ({
  processes: ['gravity', 'info', 'density'],
})).apply(base)
assert.equal(noEntropy.entropyDamping, 1)

const noInfo = new LawPhysicsContract(() => ({
  processes: ['gravity', 'entropy', 'density'],
})).apply(base)
assert.equal(noInfo.quantumLift, 0)
assert.equal(noInfo.metaLawOrbit, 0)

const noDensity = new LawPhysicsContract(() => ({
  processes: ['gravity', 'entropy', 'info'],
})).apply(base)
assert.equal(noDensity.forcePush, 0)

assert.ok(renderer.includes("new LawPhysicsContract(() => (window as any).getRealityLawState?.() ?? null)"))
assert.ok(renderer.includes("this.lawPhysicsContract.apply(this.fieldPhysics.modulation(field))"))
assert.ok(construction.includes("laws.penalty < 0.25"))

console.log('Law → Physics Contract regression: PASS')
