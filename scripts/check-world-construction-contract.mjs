import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs/promises';

const contract = await fs.readFile('src/infinity/WorldConstructionContract.ts', 'utf8');
const renderer = await fs.readFile('src/render/InfiniteWorldRenderer.ts', 'utf8');

const out = ts.transpileModule(contract, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
assert.equal(out.diagnostics?.length ?? 0, 0);

for (const kind of ['building', 'road', 'bridge', 'water']) {
  assert.ok(contract.includes("'"+kind+"'"), 'missing structural kind '+kind);
}
assert.ok(contract.includes('buildability.score >= 0.2'));
assert.ok(contract.includes('laws.penalty < 0.25'));
assert.ok(renderer.includes('this.constructionContract.materialize(\'water\''));
assert.ok(renderer.includes('return this.constructionContract.authorize(kind, x, z)'));
console.log('World Construction Contract regression: PASS');

const decisionSource = await fs.readFile('src/infinity/WorldDecisionLayer.ts', 'utf8');
const decisionJs = ts.transpileModule(decisionSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const decisionRecordStub = 'data:text/javascript,export const createDecisionRecord=(...args)=>args';
const decisionModuleJs = decisionJs.replace(
  "from './DecisionRecord'",
  `from '${decisionRecordStub}'`,
);
const decisionModuleUrl = `data:text/javascript;base64,${Buffer.from(decisionModuleJs).toString('base64')}`;
const { WorldDecisionLayer } = await import(decisionModuleUrl);

const scientificSample = {
  energy: 1, density: 0.1, information: 5, entropy: 0.01,
  temperature: 0.5, biology: 0.3, material: 0.7,
};
const sampledCoordinates = [];
const climateOverrides = [];
let baselineSampleCalls = 0;
const decisionSurface = {
  seed: 'decision-terrain-regression',
  referenceBuildElevation: 20,
  waterLevel: 10,
  sampleSurface(x, z, heightOverride) {
    climateOverrides.push({ x, z, heightOverride });
    return {
      height: 0, temperature: 0.5, moisture: 0.6,
      biome: 'plains', biomeId: 0, waterDepth: 10,
    };
  },
};
const decisionSampler = {
  surfaceProvider: decisionSurface,
  sampleWorld() {
    baselineSampleCalls++;
    return {
      x: 0, y: 0, z: 0, ...scientificSample,
      height: 0, moisture: 0.6, biome: 'plains', waterDepth: 10,
    };
  },
  sample(x, y, z) {
    sampledCoordinates.push({ x, y, z });
    return scientificSample;
  },
};
const deformedHeight = (x, z) => x === 100 ? 8 : 12 + x * 0.5 + z * 0.25;
const decisionLayer = new WorldDecisionLayer(
  decisionSampler,
  undefined,
  undefined,
  deformedHeight,
);

const raisedDecision = decisionLayer.analyzeBuildability(2, 0);
assert.equal(raisedDecision.elevation, 13,
  'buildability must use the deformed terrain height rather than the generator baseline');
assert.equal(raisedDecision.waterDepth, 0,
  'terrain raised above the sea plane must not be evaluated as flooded');
assert.ok(Math.abs(raisedDecision.slope - Math.sqrt(5) / 4) < 1e-9,
  'buildability slope must be calculated from the deformed heightfield');
assert.ok(sampledCoordinates.some(point => point.x === 2 && point.y === 13 && point.z === 0),
  'scientific field sampling must use the current terrain elevation');
assert.ok(climateOverrides.some(point => point.x === 2 && point.z === 0 && point.heightOverride === 13),
  'surface climate sampling must receive the deformed elevation');
assert.equal(baselineSampleCalls, 0,
  'renderer decisions with a terrain sampler must not fall back to stale FieldSampler.sampleWorld()');

const floodedDecision = decisionLayer.analyzeBuildability(100, 0);
assert.equal(floodedDecision.elevation, 8);
assert.equal(floodedDecision.waterDepth, 2,
  'terrain lowered below the global water plane must be evaluated as flooded');
assert.equal(floodedDecision.score, 0,
  'flooded terrain must fail the existing buildability gate');

const routeDecision = decisionLayer.routeCost(4, 0, 2, 0, 'safe');
assert.ok(Math.abs(routeDecision.slope - 0.5) < 1e-9,
  'route cost must compare deformed elevations at both route endpoints');

const decisionLayerConstructors = renderer.split('new WorldDecisionLayer(').slice(1);
assert.equal(decisionLayerConstructors.length, 2,
  'renderer must own exactly one initial and one rebuildable WorldDecisionLayer instance');
for (const constructorSource of decisionLayerConstructors) {
  assert.match(constructorSource.slice(0, 500), /\(x, z\) => this\.sampleTerrainHeight\(x, z\)/,
    'both initial and rebuilt WorldDecisionLayer instances must receive the renderer terrain sampler');
}

console.log('World decision terrain-overlay regression: PASS');

