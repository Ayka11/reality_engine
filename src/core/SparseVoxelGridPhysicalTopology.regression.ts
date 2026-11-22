import {
  compileSparseVoxelGridPhysicalTopology,
  resolveSparseVoxelGridPhysicalChunk,
} from "./SparseVoxelGridPhysicalTopology";

function expectRejected(label: string, operation: () => unknown): void {
  let rejected = false;
  try { operation(); } catch { rejected = true; }
  if (!rejected) throw new Error("Sparse physical topology accepted " + label);
}

export function runSparseVoxelGridPhysicalTopologyRegression(): void {
  const topology = compileSparseVoxelGridPhysicalTopology([
    "2:0,0,0",
    "4,0,0",
    "1:-1,0,0",
    "-3,0,0",
  ]);

  if (topology.chunks.length !== 4 || !Object.isFrozen(topology) ||
      !Object.isFrozen(topology.chunks) ||
      topology.chunks.some(chunk => !Object.isFrozen(chunk))) {
    throw new Error("Sparse physical topology did not publish a detached immutable descriptor set");
  }

  const expected = [
    { point: [127, 127, 127], key: "2:0,0,0", level: 2 },
    { point: [128, 1, 1], key: "4,0,0", level: 0 },
    { point: [-1, 63, 63], key: "1:-1,0,0", level: 1 },
    { point: [-65, 1, 1], key: "-3,0,0", level: 0 },
  ] as const;
  for (const candidate of expected) {
    const resolved = resolveSparseVoxelGridPhysicalChunk(
      topology,
      candidate.point[0],
      candidate.point[1],
      candidate.point[2],
    );
    if (!resolved || resolved.key !== candidate.key || resolved.level !== candidate.level) {
      throw new Error(
        "Sparse physical topology resolved " + candidate.point.join(",") +
        " to " + String(resolved?.key) + " instead of " + candidate.key,
      );
    }
  }

  if (resolveSparseVoxelGridPhysicalChunk(topology, 160, 0, 0) !== null) {
    throw new Error("Sparse physical topology resolved a base cell outside all registered chunks");
  }

  expectRejected("duplicate level-zero keys", () =>
    compileSparseVoxelGridPhysicalTopology(["-1,0,0", "-1,0,0"]));
  expectRejected("a fine chunk inside a coarse ancestor", () =>
    compileSparseVoxelGridPhysicalTopology(["1:0,0,0", "0:0,0,0"]));
  expectRejected("a negative-coordinate child inside its coarse ancestor", () =>
    compileSparseVoxelGridPhysicalTopology(["1:-1,0,0", "0:-1,0,0"]));
  expectRejected("a non-canonical legacy key", () =>
    compileSparseVoxelGridPhysicalTopology(["00,0,0"]));
  expectRejected("a level-zero prefixed key that would collide with legacy form", () =>
    compileSparseVoxelGridPhysicalTopology(["0:0,0,0"]));
  expectRejected("unsafe physical bounds", () =>
    compileSparseVoxelGridPhysicalTopology(["30:9007199254740991,0,0"]));
  expectRejected("a chunk count above the configured cap", () =>
    compileSparseVoxelGridPhysicalTopology(["0,0,0", "1,0,0"], 1));
  expectRejected("a caller-created topology object", () =>
    resolveSparseVoxelGridPhysicalChunk({ chunks: [] }, 0, 0, 0));

  console.log("SparseVoxelGrid mixed-LOD physical topology preflight and coordinate lookup: PASS");
}
