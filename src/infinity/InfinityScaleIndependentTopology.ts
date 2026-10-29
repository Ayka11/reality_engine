import type { InfinityScaleFramePlan } from "./InfinityScaleFramePlan";
import type { InfinityScaleBoundaryReadRelation } from "./InfinityScaleChunkExecutionContext";

type FrameChunk = InfinityScaleFramePlan["chunks"][number];

export interface IndependentMixedLodTopologyResult {
  complete: boolean;
  expected: string[];
  observed: string[];
  missing: string[];
  unexpected: string[];
}

/**
 * Independently derives mixed-LOD face contacts from frame geometry.
 * This intentionally does not call InfinityScaleExecutionAdapter.resolveFaceNeighbors
 * or consume the context's generated transfer specs.
 */
export function validateIndependentMixedLodTopology(
  selected: FrameChunk[],
  candidates: FrameChunk[],
  observedRelations: InfinityScaleBoundaryReadRelation[],
): IndependentMixedLodTopologyResult {
  const selectedKeys = new Set(selected.map(chunk => chunk.key));
  const signature = (source: string, target: string, relation: string) =>
    `${source}|${target}|${relation}`;
  const expected = new Set<string>();

  for (const source of selected) {
    const sourceLevel = source.chunk.level;
    const sourceScale = 2 ** sourceLevel;
    const sMin = [
      source.chunk.x * sourceScale,
      source.chunk.y * sourceScale,
      source.chunk.z * sourceScale,
    ];
    const sMax = sMin.map(value => value + sourceScale - 1);

    for (const target of candidates) {
      if (target.key === source.key || selectedKeys.has(target.key)) continue;
      const targetLevel = target.chunk.level;
      if (targetLevel === sourceLevel) continue;

      const targetScale = 2 ** targetLevel;
      const tMin = [
        target.chunk.x * targetScale,
        target.chunk.y * targetScale,
        target.chunk.z * targetScale,
      ];
      const tMax = tMin.map(value => value + targetScale - 1);
      const overlap = (axis: number) =>
        sMin[axis] <= tMax[axis] && sMax[axis] >= tMin[axis];

      const faceContact =
        ((sMax[0] + 1 === tMin[0] || tMax[0] + 1 === sMin[0]) && overlap(1) && overlap(2)) ||
        ((sMax[1] + 1 === tMin[1] || tMax[1] + 1 === sMin[1]) && overlap(0) && overlap(2)) ||
        ((sMax[2] + 1 === tMin[2] || tMax[2] + 1 === sMin[2]) && overlap(0) && overlap(1));
      if (!faceContact) continue;

      // The target candidate is the read dependency (source of transferred
      // values); the selected chunk is the writable destination.
      const relation = targetLevel > sourceLevel ? "coarse-to-fine" : "fine-to-coarse";
      expected.add(signature(target.key, source.key, relation));
    }
  }

  const observed = new Set(
    observedRelations
      .filter(relation => relation.relation !== "same-level")
      .map(relation => signature(relation.sourceChunk, relation.targetChunk, relation.relation)),
  );
  const expectedList = [...expected].sort();
  const observedList = [...observed].sort();
  const missing = expectedList.filter(item => !observed.has(item));
  const unexpected = observedList.filter(item => !expected.has(item));

  return {
    complete: missing.length === 0 && unexpected.length === 0,
    expected: expectedList,
    observed: observedList,
    missing,
    unexpected,
  };
}
