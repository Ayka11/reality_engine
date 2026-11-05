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
const assetManifestSource = await readFile(new URL('src/worldLibrary/AssetImportManifest.ts', root), 'utf8');
const assetManifestJs = ts.transpileModule(assetManifestSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const assetManifestUrl = `data:text/javascript;base64,${Buffer.from(assetManifestJs).toString('base64')}`;
const { validateAssetManifest } = await import(assetManifestUrl);

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
  assetManifest: {
    version: '1.0', generatedAt: '2026-11-03T00:00:00.000Z', project: 'test',
    entries: [{
      id: 'asset.provider-a.oak-01', providerId: 'provider-a',
      sourceUrl: 'https://assets.example.test/oak.glb', sourceAssetId: 'oak-01',
      name: 'Oak Tree', license: 'CC0', attribution: 'Example asset provider',
      semanticEntryId: 'flora.tree', tags: ['tree', 'flora'],
    }],
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

const validManifestResult = validateAssetManifest(worldEditorFixture.assetManifest);
assert.deepEqual(validManifestResult, { valid: true, errors: [] },
  'valid HTTP(S) asset provenance with known licensing must be accepted');
assert.equal(validateAssetManifest({
  ...worldEditorFixture.assetManifest,
  entries: [{ ...worldEditorFixture.assetManifest.entries[0], sourceUrl: 'javascript:alert(1)' }],
}).valid, false, 'non-HTTP(S) asset provenance URLs must be rejected');
assert.equal(validateAssetManifest({
  ...worldEditorFixture.assetManifest,
  entries: [{ ...worldEditorFixture.assetManifest.entries[0], license: 'UNLICENSED' }],
}).valid, false, 'unknown license enum values must be rejected');
assert.equal(validateAssetManifest({
  ...worldEditorFixture.assetManifest,
  entries: [{ ...worldEditorFixture.assetManifest.entries[0], license: 'UNKNOWN' }],
}).valid, false, 'explicitly unknown asset licensing must be rejected');
assert.equal(validateAssetManifest({
  ...worldEditorFixture.assetManifest,
  entries: [
    worldEditorFixture.assetManifest.entries[0],
    { ...worldEditorFixture.assetManifest.entries[0], name: 'Duplicate asset' },
  ],
}).valid, false, 'duplicate asset manifest IDs must be rejected');
assert.equal(validateAssetManifest({
  ...worldEditorFixture.assetManifest,
  generatedAt: 'not-a-date',
}).valid, false, 'invalid manifest timestamps must be rejected');
assert.equal(validateAssetManifest({
  ...worldEditorFixture.assetManifest,
  entries: [null],
}).valid, false, 'malformed manifest entries must be rejected without throwing');
assert.equal(validateAssetManifest({
  ...worldEditorFixture.assetManifest,
  entries: [{ ...worldEditorFixture.assetManifest.entries[0], tags: 'tree' }],
}).valid, false, 'malformed asset tags must be rejected');

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
assert.deepEqual(unpackedPackage.worldEditor.assetManifest, worldEditorFixture.assetManifest,
  'external asset source, licensing and semantic provenance must survive package roundtrip');
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
const activeBootstrapSource = await readFile(new URL('src/infinityBootstrap.ts', root), 'utf8');
const activePackageSource = await readFile(new URL('src/infinity/ActiveWorldPackage.ts', root), 'utf8');
const activeHtmlSource = await readFile(new URL('index.html', root), 'utf8');
const worldPersistenceSource = await readFile(new URL('src/infinity/WorldPersistence.ts', root), 'utf8');
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
assert.ok(worldEditorSnapshotSource.includes("assetManifest?: WorldAssetImportManifest"),
  'portable world-editor snapshots must retain external asset provenance');
assert.ok(worldEditorSnapshotSource.includes("provenance?: RuntimeProvenanceTrace"),
  'portable world-editor snapshots must retain the causal RuntimeProvenance trace');
assert.ok(worldRendererSource.includes("provenance: runtimeProvenance.getTrace()") &&
  worldRendererSource.includes("nextProvenance.restore(snapshot.provenance)") &&
  worldRendererSource.includes("validatePortableWorldSnapshot(snapshot?: WorldEditorSnapshot)"),
  'InfiniteWorldRenderer must capture, preflight and restore provenance without mutating live state during validation');
assert.ok(mainSource.includes("validateAssetManifest(manifest)") &&
  mainSource.includes("assetManifest: structuredClone(manifest)"),
  'application capture and restore must validate and preserve asset provenance metadata');
assert.ok(assetManifestSource.includes("const ASSET_LICENSES = new Set<AssetLicense>") &&
  assetManifestSource.includes("new URL(value)") &&
  assetManifestSource.includes("new Set<string>()"),
  'asset provenance validation must constrain license values, URLs and duplicate IDs');
assert.ok(mainSource.includes("fetches URLs or executes a GLTF loader"),
  'manifest restore must remain metadata-only and avoid automatic network fetches');
assert.ok(activeBootstrapSource.includes("encodeActiveWorldPackage(grid") &&
  activeBootstrapSource.includes("decodeActiveWorldPackage(decodedJson, expected)"),
  'the actual boot entrypoint must expose the unified active finite-grid + Infinite World package codec');
assert.ok(activeBootstrapSource.includes("capturePortableWorldEditorSnapshot") &&
  activeBootstrapSource.includes("restorePortableWorldEditorSnapshot") &&
  activeBootstrapSource.includes("persistPortableWorldEditorSnapshot"),
  'the active application bootstrap must connect portable Infinite World capture, restore and persistence');
assert.ok(activeBootstrapSource.includes("bridge.restore(previousGrid)") &&
  activeBootstrapSource.includes("bridge.afterCommit?.(previousGrid)") &&
  activeBootstrapSource.indexOf("persistPortableWorldEditorSnapshot()") <
    activeBootstrapSource.indexOf("bridge.afterCommit?.(previousGrid)"),
  'the active package importer must roll back failed imports and record finite undo history only after world persistence commits');
assert.ok(activeHtmlSource.includes("window.encodeActiveRealityPackage") &&
  activeHtmlSource.includes("window.importActiveRealityPackage") &&
  activeHtmlSource.includes("window.saveWorld=async function()") &&
  activeHtmlSource.includes("window.loadWorld=async function(input)"),
  'the user-visible Save/Load controls must use the unified active package API instead of the legacy finite-only serializer');
assert.doesNotMatch(activeHtmlSource, /format:'re_v5'/,
  'the active Save button must no longer emit finite-only re_v5 packages');
assert.ok(activePackageSource.includes("format: 're_v6'") &&
  activePackageSource.includes("format === 're_v5'") &&
  activePackageSource.includes("worldEditor") &&
  activePackageSource.includes("causal: structuredClone(causal)"),
  'the active package codec must emit v6 snapshots and retain legacy v5 import compatibility');
assert.ok(worldPersistenceSource.includes("saveAssetManifestState") &&
  worldPersistenceSource.includes("loadAssetManifestState") &&
  worldPersistenceSource.includes("saveProvenanceState") &&
  worldPersistenceSource.includes("loadProvenanceState"),
  'asset provenance and RuntimeProvenance must persist with the Infinite World sidecar');
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
const worldEditorPreflightIndex = worldSaveSource.indexOf(
  "this.context.restoreWorldEditorSnapshot(snapshot.worldEditor, true)",
);
const mutationBoundaryIndex = worldSaveSource.indexOf(
  "const mutate = this.context.mutateAuthoritativeState",
);
const rollbackCaptureIndex = worldSaveSource.indexOf("const graphBefore = this.context.graphProvider?.()");
assert.ok(worldEditorPreflightIndex >= 0 &&
  mutationBoundaryIndex > worldEditorPreflightIndex &&
  rollbackCaptureIndex > worldEditorPreflightIndex,
  'portable Infinite World payloads must be preflighted before rollback capture and the authoritative mutation transaction');
assert.ok(worldSaveSource.includes("cannot preflight the imported Infinite World snapshot"),
  'imports with a world-editor payload must fail closed when no preflight callback is available');
assert.ok(mainSource.includes("restoreWorldEditorSnapshot: (snapshot, validateOnly = false) =>") &&
  mainSource.includes("world?.validatePortableWorldSnapshot(snapshot)") &&
  mainSource.includes("if (validateOnly) return;"),
  'the application must validate the detached world-editor candidate without publishing it during preflight');
assert.ok(worldSaveSource.includes("rollback(\"Infinite world editor\""),
  'late world restore failures must roll back the separate Infinite World editor');
assert.ok(worldSaveSource.includes("this.context.persistWorldEditorSnapshot?.()"),
  'the imported editor state must persist only after the world transaction commits');
assert.match(worldSaveSource, /try \{\s*this\.context\.persistWorldEditorSnapshot\?\.\(\);?\s*\} catch \(error\) \{[\s\S]*?reportWorldEditorPersistenceFailure/,
  'post-commit editor sidecar failures must be reported without rejecting an already committed world restore');
assert.ok(mainSource.includes('reportWorldEditorPersistenceFailure: (snapshotName, error) =>') &&
  mainSource.includes('_exportStatus(message, false)'),
  'the application must surface a failed editor sidecar commit without claiming that the world import rolled back');
assert.match(mainSource, /function reportWorldSaveFailure\(operation: string, error: unknown\): void[\s\S]*?_exportStatus\([^\n]*false\)/,
  'user-triggered world save/load failures must be visible in the export status panel');
assert.match(mainSource, /function importRealityPackageWithFeedback\(file: File\): Promise<void>[\s\S]*?saveSystem\.importRealityPackage\(file\)\.catch/,
  'file-based package imports must report malformed packages and restore failures');
assert.equal(mainSource.includes('void saveSystem.importRealityPackage(file)'), false,
  'file picker and drag/drop imports must not leave package import rejections unhandled');
assert.equal(mainSource.split('void importRealityPackageWithFeedback(file)').length - 1, 2,
  'both the file picker and drag/drop import surfaces must use the feedback wrapper');
assert.match(mainSource, /document\.getElementById\('loadBtn'\)[\s\S]*?catch \(error\) \{\s*reportWorldSaveFailure\('World load', error\)/,
  'quick-load lookup/restore failures must be surfaced instead of becoming unhandled rejections');
assert.match(mainSource, /document\.getElementById\('saveBtn'\)[\s\S]*?catch \(error\) \{\s*reportWorldSaveFailure\('Quick save', error\)/,
  'the quick-save button must surface IndexedDB quota and persistence failures');
assert.match(mainSource, /saveSystem\.quickSave\([\s\S]*?\.catch\(error => \{\s*reportWorldSaveFailure\('Quick save', error\)/,
  'Ctrl+S must not leave quick-save rejections unhandled');
assert.ok(mainSource.includes("capturePortableWorldSnapshot") &&
  mainSource.includes("restorePortableWorldSnapshot") &&
  mainSource.includes("persistPortableWorldSnapshot"),
  'application World Save integration must connect InfiniteWorldRenderer snapshot, restore and persistence');
assert.ok(worldRendererSource.includes("capturePortableWorldSnapshot(): WorldEditorSnapshot") &&
  worldRendererSource.includes("restorePortableWorldSnapshot(snapshot?: WorldEditorSnapshot)") &&
  worldRendererSource.includes("persistPortableWorldSnapshot(assetManifest?: WorldAssetImportManifest): void"),
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
