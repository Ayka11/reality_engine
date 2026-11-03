import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('src/creator/PackageSerializer.ts', root), 'utf8');
const stubModule = `const archives = new Map();
let nextArchiveId = 0;
class JSZip {
  constructor(files = new Map()) { this.files = new Map(files); }
  file(path, value) {
    if (arguments.length > 1) { this.files.set(path, value); return this; }
    if (!this.files.has(path)) return null;
    const content = this.files.get(path);
    return { async: async type => {
      if (type === 'string') return typeof content === 'string' ? content : new TextDecoder().decode(content);
      if (type === 'uint8array') return content instanceof Uint8Array ? new Uint8Array(content) : new Uint8Array(content);
      return content;
    }};
  }
  async generateAsync() {
    const id = ++nextArchiveId;
    archives.set(id, new Map(this.files));
    return { __realityArchiveId: id };
  }
  static async loadAsync(archive) {
    const files = archives.get(archive?.__realityArchiveId);
    if (!files) throw new Error('unknown in-memory ZIP archive');
    return new JSZip(files);
  }
}
export default JSZip;
export function deflate(value) { return value; }
export function inflate(value) { return value; }
`;
const stubUrl = `data:text/javascript;base64,${Buffer.from(stubModule).toString('base64')}`;
const transformed = ts.transpileModule(source
  .replace("import JSZip from 'jszip';", `import JSZip from '${stubUrl}';`)
  .replace("import { deflate, inflate } from 'pako';", `import { deflate, inflate } from '${stubUrl}';`), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`;
const { serializePackageJson, parsePackageJson, PackageSerializer } = await import(moduleUrl);

const snapshot = {
  entities: [{
    id: 7,
    cells: [1, 2, 3],
    centroid: [1, 2, 3],
    genome: { metabolismRate: 0.5 },
    memoryBuffer: new Float32Array([0.125, 0.25, 0.5, 1, 2, 4, 8, 16]),
    colorRgb: [0.1, 0.2, 0.3],
  }],
  rngState: 123456,
};
const fullRuntimeState = {
  entityLayer: {
    entities: [{
      id: 1, cells: [2], centroid: [0, 0, 0],
      genome: { metabolismRate: 0.5, reproThreshold: 100, signalStrength: 0.2, bioAffinity: 0.3, mutationRate: 0.02, memoryDecay: 0.1 },
      age: 3, energy: 4, stage: 'mature', memoryBuffer: new Float32Array([0.1, 0.2]),
      memPtr: 1, symbol: '@', colorRgb: [0.1, 0.2, 0.3], children: 0, reproCounter: 0,
    }],
    bioThreshold: 0.2, mutationStrength: 0.1, nextId: 2, extinctCount: 0, rngState: 123,
  },
  agents: { agents: [], nextAgentId: 1, rngState: 124 },
  civilizations: { civs: [], nextId: 0, tickCount: 0, historyLog: [], rngState: 125 },
  laws: { laws: [], lawOverrides: [['law-a', 'on']], manualOn: [1], manualOff: [], graphProcessIds: null, rngState: 126 },
  chemistry: { pendingDensityTransfers: [[3, 0.25]] },
  worldEvents: { history: [], nextAuto: 0, rngState: 127 },
  causal: { events: [], nextId: 1, lastEventByCell: [[3, 1]] },
  previousEnergy: new Float32Array([0.25, 0.5]),
  climate: { windX: new Float32Array([1]), windY: new Float32Array([2]), pressure: new Float32Array([3]), globalTemp: 4, tickCount: 5 },
  multiScale: {
    macroEnergy: new Float32Array([1]), macroEntropy: new Float32Array([2]),
    macroBio: new Float32Array([3]), macroTemp: new Float32Array([4]),
    count: new Float32Array([5]), tickCount: 6,
  },
  language: {
    vocabulary: [['water', { id: 1, meaning: { type: 'resource', value: 'water' }, firstSeen: 7 }]],
    signalLog: [], lexiconAge: [['water', 2]], nextWordId: 2, communicationEvents: 1, tickCount: 7,
  },
  economy: { markets: [], gdp: [[1, 12.5]], globalGDP: 12.5, gini: 0.25, tickCount: 8 },
  metaLawEvolution: { lastCycle: 9, lastAction: 'stable', cycleCount: 1, topLaw: 'law-a' },
  cosmologicalSim: {
    tick: 10, galaxies: [], cells: [['0,0,0', [0, 1, 2, 3, 4, 5]]],
    dirtyKeys: ['0,0,0'], rngState: 128,
  },
  director: { history: [{ role: 'user', content: 'build a world' }], worldLog: [] },
};
const decodedRuntimeState = parsePackageJson(serializePackageJson(fullRuntimeState));
assert.deepEqual(decodedRuntimeState, fullRuntimeState,
  'all supported runtime domains, pair-array maps and nested Float32Array buffers must roundtrip through package JSON');
assert.ok(decodedRuntimeState.entityLayer.entities[0].memoryBuffer instanceof Float32Array);
assert.ok(decodedRuntimeState.previousEnergy instanceof Float32Array);
assert.ok(decodedRuntimeState.climate.windY instanceof Float32Array);
assert.ok(decodedRuntimeState.multiScale.macroTemp instanceof Float32Array);

const worldEditorFixture = {
  version: 1,
  generator: { seed: 'world-seed-a', seaLevel: 16, maxElevation: 52 },
  surfaceProvider: {
    version: 1, kind: 'world-generator-surface', seed: 'world-seed-a',
    seaLevel: 16, maxElevation: 52,
  },
  objects: [{
    id: 'tree:1:0:2', kind: 'tree', x: 1, y: 0, z: 2,
    rotationY: 0.5, scale: 1.25, seed: 17, properties: { species: 'oak', planted: true },
  }],
  terrainDeformations: { version: 1, seed: 'world-seed-a', deltas: [['0,0', 1.5]] },
  authoritativeField: {
    schemaVersion: 'world-field-state-v2',
    providerId: 'authoritative-world-field',
    providerVersion: 'world-field-mutation-v1',
    version: 3, nextId: 1, mutations: [], globalOverlays: [],
  },
};

const packageSerializer = new PackageSerializer();
const packageFixture = {
  manifest: {
    version: '1.0', name: 'Archive roundtrip', author: 'test',
    created: '2026-11-03T00:00:00.000Z', description: 'test', tags: [], compatibility: 'v5+',
  },
  graph: { nodes: [], edges: [], metadata: { name: 'test', version: '1.0', author: 'test', timestamp: 0 } },
  voxelState: new Uint8Array([7, 8, 9, 10]).buffer,
  chunks: {
    chunkSize: 32,
    activeCount: 1,
    serialized: [{
      key: '0,0,0', cx: 0, cy: 0, cz: 0, active: true,
      buffer: new Uint8Array([1, 2, 3, 4]).buffer,
    }],
  },
  entities: [],
  runtimeEntityLayer: undefined,
  laws: [],
  lawEngineState: undefined,
  runtimeState: fullRuntimeState,
  worldEditor: worldEditorFixture,
  processes: [],
  metadata: {
    gridSize: { x: 1, y: 1, z: 1 }, totalEnergy: 0, entropy: 0,
    complexityScore: 0, dominantLaws: [], simulationTicks: 11,
  },
};
const packedPackage = await packageSerializer.pack(packageFixture);
const unpackedPackage = await packageSerializer.unpack(packedPackage);
assert.deepEqual(unpackedPackage.runtimeState, fullRuntimeState,
  'full runtime snapshots must survive the actual ZIP pack/unpack path');
assert.deepEqual(unpackedPackage.worldEditor, worldEditorFixture,
  'infinite-world editor state must survive the actual ZIP pack/unpack path');
assert.deepEqual(Array.from(new Uint8Array(unpackedPackage.chunks.serialized[0].buffer)), [1, 2, 3, 4],
  'sparse chunk binary payloads must survive the actual ZIP pack/unpack path');
assert.deepEqual(Array.from(new Uint8Array(unpackedPackage.voxelState)), [7, 8, 9, 10],
  'dense voxel payloads must remain intact alongside sparse chunks');

const legacyPackage = await packageSerializer.unpack(await packageSerializer.pack({
  ...packageFixture,
  runtimeState: undefined,
  worldEditor: undefined,
  chunks: undefined,
}));
assert.equal(legacyPackage.runtimeState, undefined,
  'legacy archives without runtime-state.json must remain readable');
assert.equal(legacyPackage.worldEditor, undefined,
  'legacy archives without world-editor.json must remain readable');
assert.equal(legacyPackage.chunks, undefined,
  'legacy archives without sparse chunk manifests must remain readable');


const decoded = parsePackageJson(serializePackageJson(snapshot));
assert.ok(decoded.entities[0].memoryBuffer instanceof Float32Array,
  'runtime entity memory buffers must survive JSON package serialization as Float32Array values');
assert.deepEqual(decoded.entities[0].memoryBuffer, snapshot.entities[0].memoryBuffer);
assert.deepEqual(decoded.entities[0].cells, snapshot.entities[0].cells);
assert.equal(decoded.rngState, snapshot.rngState);

assert.throws(
  () => parsePackageJson(JSON.stringify({
    memoryBuffer: { __realityTypedArray: 'Float32Array', values: [1, 'bad', 3] },
  })),
  /invalid Float32Array payload/,
  'malformed typed-array envelopes must be rejected during package decoding',
);

const editorSource = await readFile(new URL('src/ui/LawProcessEditor.tsx', root), 'utf8');
const mainSource = await readFile(new URL('src/main.ts', root), 'utf8');
const worldSaveSource = await readFile(new URL('src/world/save/WorldSaveSystem.ts', root), 'utf8');
const realityPackageSource = await readFile(new URL('src/creator/RealityPackage.ts', root), 'utf8');
const packageSerializerSource = await readFile(new URL('src/creator/PackageSerializer.ts', root), 'utf8');
const worldEditorSnapshotSource = await readFile(new URL('src/infinity/WorldEditorSnapshot.ts', root), 'utf8');
const worldRendererSource = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8');
const worldSurfaceProviderSource = await readFile(new URL('src/infinity/WorldSurfaceProvider.ts', root), 'utf8');
assert.match(editorSource, /const candidate = this\.preflightPackage\(pkg\);\s+const sim = this\.options\.simulation!;/,
  'package preflight must complete before opening the live mutation transaction');
assert.match(editorSource, /dimensions\.x !== sim\.grid\.W[\s\S]*dimensions\.y !== sim\.grid\.H[\s\S]*dimensions\.z !== sim\.grid\.D/,
  'package dimensions must match all active grid axes');
assert.match(editorSource, /sim\.mutateAuthoritativeState\(\(\) => \{/,
  'field, entity and law import must use the engine-owned atomic mutation boundary');
assert.match(editorSource, /sim\.entityLayer\.restore\(candidate\.entityLayer, sim\.grid\.size\)/,
  'new packages must restore complete authoritative entity state');
assert.match(editorSource, /fieldOwner !== entity\.id[\s\S]*ownerByCell\.get\(cellIndex\) !== fieldOwner/,
  'voxel ENTITY_ID ownership must agree with the restored spatial entity model');
assert.match(editorSource, /this\.options\.lawEngine\.restore\(candidate\.lawEngine\)/,
  'law import must restore manual overrides and graph bindings, not replace only law definitions');
assert.match(editorSource, /sim\.grid\.buffer\[offset\] = 0/,
  'legacy packages without spatial entity snapshots must clear orphan entity IDs');
assert.match(editorSource, /this\.graph\.load\(graphBefore\)/,
  'editor graph state must be rolled back if the engine transaction fails');
assert.doesNotMatch(editorSource, /private applyVoxelState\(/,
  'the old non-transactional voxel-only import path must not remain');

assert.ok(editorSource.includes("runAtStepBoundary: <T>(operation: () => T) => Promise<T>;"),
  'Creator Studio package capture must expose the engine step-boundary contract');
assert.ok(editorSource.includes("await simulation.runAtStepBoundary(() => this.buildPackage())"),
  'Creator Studio export must capture state at a coherent simulation boundary');
assert.ok(mainSource.includes("exportWorldPackage: name => saveSystem.exportRealityPackage(name)"),
  'the primary Creator Studio export button must delegate to WorldSaveSystem full-world capture');
assert.ok(editorSource.includes("importWorldPackage?: (file: File) => Promise<void>;"),
  'Creator Studio must expose the complete World Save import contract');
assert.ok(editorSource.includes("await this.options.importWorldPackage(file)"),
  'Creator Studio file picker must prefer the complete World Save restore path');
assert.ok(mainSource.includes("importWorldPackage: file => saveSystem.importRealityPackage(file)"),
  'the primary Creator Studio import button must restore all runtime domains through WorldSaveSystem');
assert.ok(editorSource.includes("await this.options.exportWorldPackage(packageName)"),
  'Creator Studio must use the complete application export callback when available');
assert.ok(editorSource.includes("await simulation.runAtStepBoundary(() => this.buildPackage())"),
  'standalone Creator Studio usage must retain a coherent step-boundary fallback');
assert.ok(editorSource.includes("simulationTicks: sim.tick"),
  'new Creator Studio packages must preserve their simulation clock');
assert.ok(editorSource.includes("pkg.metadata.simulationTicks !== undefined") &&
  editorSource.includes("Number.isSafeInteger(pkg.metadata.simulationTicks)"),
  'provided package simulation ticks must be validated before import');
assert.ok(realityPackageSource.includes("simulationTicks?: number"),
  'package metadata must retain a backward-compatible optional simulation clock');
assert.ok(realityPackageSource.includes("worldEditor?: WorldEditorSnapshot"),
  'RealityPackage must expose the separate InfiniteWorldRenderer snapshot');
assert.ok(worldEditorSnapshotSource.includes("export interface WorldEditorSnapshot") &&
  worldEditorSnapshotSource.includes("authoritativeField: ReturnType<MutableWorldFieldProvider['serialize']>"),
  'the portable world-editor contract must cover terrain, objects, surface and authoritative field state');
assert.ok(packageSerializerSource.includes("zip.file('world-editor.json', serializePackageJson(pkg.worldEditor))"),
  'the ZIP serializer must write the portable world-editor snapshot');
assert.ok(packageSerializerSource.includes("const worldEditorFile = zip.file('world-editor.json')"),
  'the ZIP importer must read world-editor state as an optional legacy-compatible file');
assert.ok(packageSerializerSource.includes("worldEditor,"),
  'the ZIP importer must return the decoded world-editor snapshot');
assert.ok(worldSaveSource.includes("worldEditor: this.context.getWorldEditorSnapshot?.()"),
  'World Save capture must include the Infinite World editor state');
assert.ok(worldSaveSource.includes("worldEditor: snapshot.worldEditor") &&
  worldSaveSource.includes("worldEditor: pkg.worldEditor"),
  'World Save export and import must map the world-editor snapshot in both directions');
assert.ok(worldSaveSource.includes("this.context.restoreWorldEditorSnapshot?.(snapshot.worldEditor)"),
  'world-editor restore must join the same full-world mutation transaction');
assert.ok(worldSaveSource.includes("rollback(\"Infinite world editor\""),
  'late world restore failures must roll back the separate Infinite World editor');
assert.ok(worldSaveSource.includes("this.context.persistWorldEditorSnapshot?.()"),
  'the imported editor state must persist only after the world transaction commits');
assert.ok(mainSource.includes("capturePortableWorldSnapshot") &&
  mainSource.includes("restorePortableWorldSnapshot") &&
  mainSource.includes("persistPortableWorldSnapshot"),
  'application World Save integration must connect InfiniteWorldRenderer snapshot, restore and persistence');
assert.ok(worldRendererSource.includes("capturePortableWorldSnapshot(): WorldEditorSnapshot") &&
  worldRendererSource.includes("restorePortableWorldSnapshot(snapshot?: WorldEditorSnapshot)") &&
  worldRendererSource.includes("persistPortableWorldSnapshot(): void"),
  'InfiniteWorldRenderer must expose portable capture, detached restore and post-commit persistence');
assert.ok(worldSurfaceProviderSource.includes("kind: 'world-generator-surface'") &&
  worldSurfaceProviderSource.includes("new WorldGenerator(value.seed, value.seaLevel, value.maxElevation)"),
  'generator-backed world surfaces must retain deterministic seed and generator parameters');
assert.ok(realityPackageSource.includes("runtimeState?: RealityPackageRuntimeState"),
  'the package contract must expose the complete typed runtime snapshot');
assert.ok(realityPackageSource.includes("export interface RealityPackageChunks"),
  'the package contract must describe sparse chunk payloads');
assert.ok(packageSerializerSource.includes("zip.file('chunks/manifest.json'"),
  'sparse chunk metadata must be written to an archive manifest');
assert.ok(packageSerializerSource.includes("zip.file(`chunks/${index}.bin`, new Uint8Array(chunk.buffer))"),
  'sparse chunk buffers must be written as binary archive entries');
assert.ok(packageSerializerSource.includes("const chunksManifestFile = zip.file('chunks/manifest.json')"),
  'sparse chunk manifests must be optional during legacy archive import');
assert.ok(worldSaveSource.includes("chunks: snapshot.chunks") && worldSaveSource.includes("chunks: pkg.chunks"),
  'World Save export and import must preserve sparse chunk state');
assert.ok(editorSource.includes("serialized: sim.grid.serializeChunks(false)"),
  'Creator Studio export must include non-empty sparse chunks');
assert.ok(editorSource.includes("sim.grid.loadChunks(candidate.chunks?.serialized ?? [])"),
  'Creator Studio import must replace the sparse chunk domain transactionally');
assert.ok(editorSource.includes("chunk.buffer.byteLength !== expectedChunkBytes") &&
  editorSource.includes("new Float32Array(chunk.buffer).every(Number.isFinite)"),
  'Creator Studio must validate sparse chunk buffer size and finite fields before publication');
assert.ok(packageSerializerSource.includes("zip.file('runtime-state.json', serializePackageJson(pkg.runtimeState))"),
  'the ZIP serializer must write a dedicated portable runtime-state file');
assert.ok(packageSerializerSource.includes("const runtimeStateFile = zip.file('runtime-state.json')"),
  'the ZIP importer must read runtime state as an optional legacy-compatible file');
assert.ok(packageSerializerSource.includes("runtimeState,"),
  'the ZIP importer must return the decoded runtime snapshot');
assert.ok(worldSaveSource.includes("runtimeState: snapshot.runtimeState"),
  'World Save export must carry all captured runtime domains into the package');
assert.ok(worldSaveSource.includes("...pkg.runtimeState") &&
  worldSaveSource.includes("entityLayer: pkg.runtimeState.entityLayer ?? pkg.runtimeEntityLayer") &&
  worldSaveSource.includes("laws: pkg.runtimeState.laws ?? pkg.lawEngineState"),
  'World Save import must restore the complete runtime snapshot with legacy entity/law fallbacks');
assert.ok(worldSaveSource.includes("runtimeEntityLayer: snapshot.runtimeState?.entityLayer"),
  'World Save export must carry the complete spatial entity snapshot into .reality');
assert.ok(worldSaveSource.includes("lawEngineState: snapshot.runtimeState?.laws"),
  'World Save export must carry law overrides and RNG state into .reality');
assert.ok(worldSaveSource.includes("simulationTicks: snapshot.metadata.simulationTicks"),
  'World Save export must preserve the captured simulation clock');
assert.ok(worldSaveSource.includes("entityLayer: pkg.runtimeEntityLayer") &&
  worldSaveSource.includes("laws: pkg.lawEngineState"),
  '.reality import through World Save must restore both complete entity and law runtime snapshots');
assert.ok(worldSaveSource.includes("simulationTicks: pkg.metadata.simulationTicks ?? this.context.getTick?.() ?? 0"),
  'World Save import must restore package simulation ticks, retaining a legacy fallback');

console.log('Reality package codec, atomic import and World Save bridge regression: PASS');
