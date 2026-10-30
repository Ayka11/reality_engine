import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'

const root = new URL('../', import.meta.url)

async function transpiledModuleUrl(path) {
  const source = await readFile(new URL(path, root), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
}

const objectModuleUrl = await transpiledModuleUrl('src/infinity/WorldObject.ts')
const seedModuleUrl = await transpiledModuleUrl('src/infinity/WorldSeed.ts')
const coordinateModuleUrl = await transpiledModuleUrl('src/infinity/WorldCoordinate.ts')
const spatialIndexSource = await readFile(new URL('src/infinity/WorldObjectSpatialIndex.ts', root), 'utf8')
let spatialIndexJs = ts.transpileModule(spatialIndexSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
spatialIndexJs = spatialIndexJs
  .replaceAll("'./WorldObject'", `'${objectModuleUrl}'`)
  .replaceAll("'./WorldCoordinate'", `'${coordinateModuleUrl}'`)
const spatialIndexModuleUrl = `data:text/javascript;base64,${Buffer.from(spatialIndexJs).toString('base64')}`
const { WorldObjectSpatialIndex } = await import(spatialIndexModuleUrl)
const managerSource = await readFile(new URL('src/infinity/ObjectManager.ts', root), 'utf8')
let managerJs = ts.transpileModule(managerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
managerJs = managerJs
  .replaceAll("'./WorldObject'", `'${objectModuleUrl}'`)
  .replaceAll("'./WorldSeed'", `'${seedModuleUrl}'`)
  .replaceAll("'./WorldObjectSpatialIndex'", `'${spatialIndexModuleUrl}'`)
const { WorldObjectManager } = await import(
  `data:text/javascript;base64,${Buffer.from(managerJs).toString('base64')}`
)

function measureBuild(placements, withSpatialIndex) {
  const manager = new WorldObjectManager(withSpatialIndex ? new WorldObjectSpatialIndex() : undefined)
  const start = performance.now()
  for (const placement of placements) manager.add(placement)
  return { manager, elapsedMs: performance.now() - start }
}

const SIZES = [10_000, 50_000, 100_000]
const WORLD_HALF_EXTENT = 8192
const VIEW_HALF_EXTENT = 96
const QUERY_CENTERS = [
  [-6144, -4096],
  [-3072, 2048],
  [0, 0],
  [3072, -2048],
  [6144, 4096],
]
const KINDS = ['tree', 'building', 'rock', 'crystal']
const SAMPLE_COUNT = 7
const WARMUP_COUNT = 2

function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function makeQuery(centerX, centerZ) {
  return {
    minX: centerX - VIEW_HALF_EXTENT,
    maxX: centerX + VIEW_HALF_EXTENT,
    minZ: centerZ - VIEW_HALF_EXTENT,
    maxZ: centerZ + VIEW_HALF_EXTENT,
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function linearQuery(objects, query) {
  return objects
    .filter(object =>
      object.x >= query.minX && object.x <= query.maxX &&
      object.z >= query.minZ && object.z <= query.maxZ)
    .map(object => ({ ...object, properties: { ...object.properties } }))
}

function sortedIds(objects) {
  return objects.map(object => object.id).sort()
}

function buildDataset(count, seed) {
  const random = createRandom(seed)
  const placements = new Array(count)
  for (let i = 0; i < count; i++) {
    placements[i] = {
      id: `benchmark-object-${i}`,
      kind: KINDS[i % KINDS.length],
      x: (random() * 2 - 1) * WORLD_HALF_EXTENT,
      y: (random() * 2 - 1) * 2048,
      z: (random() * 2 - 1) * WORLD_HALF_EXTENT,
      rotationY: random() * Math.PI * 2,
      scale: 0.5 + random() * 2,
      seed: i,
      properties: { benchmarkIndex: i },
    }
  }
  return placements
}

function measure(queryFn, queries) {
  let checksum = 0
  const start = performance.now()
  for (const query of queries) {
    const result = queryFn(query)
    checksum += result.length
  }
  return { elapsedMs: performance.now() - start, checksum }
}

const reports = []
for (const [datasetIndex, count] of SIZES.entries()) {
  const placements = buildDataset(count, 0x51a7 + datasetIndex)
  // Measure write-side cost separately, using the same placement objects and manager API.
  const indexedBuildSamples = []
  const linearBuildSamples = []
  let manager
  for (let sample = 0; sample < 3; sample++) {
    const indexedFirst = sample % 2 === 0
    const indexedBuild = measureBuild(placements, true)
    const linearBuild = measureBuild(placements, false)
    indexedBuildSamples.push(indexedBuild.elapsedMs)
    linearBuildSamples.push(linearBuild.elapsedMs)
    if (sample === 2) manager = indexedBuild.manager
    else indexedBuild.manager.clear()
    linearBuild.manager.clear()
    // Alternate the conceptual first-measured path to reduce fixed order bias.
    if (!indexedFirst) {
      indexedBuildSamples[indexedBuildSamples.length - 1] = indexedBuild.elapsedMs
      linearBuildSamples[linearBuildSamples.length - 1] = linearBuild.elapsedMs
    }
  }
  const queries = QUERY_CENTERS.map(([x, z]) => makeQuery(x, z))

  for (const query of queries) {
    const indexed = manager.query(query)
    const linear = linearQuery(placements, query)
    assert.deepEqual(sortedIds(indexed), sortedIds(linear),
      `indexed and linear query results must match for ${count} objects`)
    assert.equal(new Set(indexed.map(object => object.id)).size, indexed.length,
      'indexed query must not return duplicate object IDs')
  }

  // Warm up both code paths before collecting comparable samples.
  for (let i = 0; i < WARMUP_COUNT; i++) {
    measure(query => manager.query(query), queries)
    measure(query => linearQuery(placements, query), queries)
  }

  const indexedSamples = []
  const linearSamples = []
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    const indexedFirst = sample % 2 === 0
    const indexed = indexedFirst
      ? measure(query => manager.query(query), queries)
      : measure(query => linearQuery(placements, query), queries)
    const linear = indexedFirst
      ? measure(query => linearQuery(placements, query), queries)
      : measure(query => manager.query(query), queries)
    if (indexedFirst) {
      indexedSamples.push(indexed.elapsedMs)
      linearSamples.push(linear.elapsedMs)
      assert.equal(indexed.checksum, linear.checksum, 'timed query paths must produce equal result counts')
    } else {
      linearSamples.push(indexed.elapsedMs)
      indexedSamples.push(linear.elapsedMs)
      assert.equal(indexed.checksum, linear.checksum, 'timed query paths must produce equal result counts')
    }
  }

  const indexedMedianMs = median(indexedSamples)
  const linearMedianMs = median(linearSamples)
  const indexedBuildMedianMs = median(indexedBuildSamples)
  const linearBuildMedianMs = median(linearBuildSamples)
  const report = {
    objects: count,
    queriesPerSample: queries.length,
    returnedPerQuery: queries.map(query => manager.query(query).length),
    indexedMedianMs: Number(indexedMedianMs.toFixed(3)),
    linearMedianMs: Number(linearMedianMs.toFixed(3)),
    querySpeedup: Number((linearMedianMs / Math.max(indexedMedianMs, 0.000001)).toFixed(2)),
    indexedBuildMedianMs: Number(indexedBuildMedianMs.toFixed(3)),
    linearBuildMedianMs: Number(linearBuildMedianMs.toFixed(3)),
    writeOverheadPercent: Number(((indexedBuildMedianMs / Math.max(linearBuildMedianMs, 0.000001) - 1) * 100).toFixed(1)),
  }
  reports.push(report)
}

const largest = reports.at(-1)
assert.ok(largest.linearMedianMs > 0, 'linear baseline must produce a measurable duration')
assert.ok(largest.indexedMedianMs < largest.linearMedianMs,
  'spatially indexed queries should outperform the full linear scan on the 100k-object benchmark')

console.log('World object spatial-query benchmark: PASS')
console.table(reports)
