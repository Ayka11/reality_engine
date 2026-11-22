import { CELL_FIELDS, F } from "../core/CellState";
import { InfinityScaleLODTransfer } from "./InfinityScaleLODTransfer";

function cell(): number[] {
  return new Array<number>(CELL_FIELDS).fill(0);
}

export function runInfinityScaleLODTransferInvariantRegression(): void {
  const source = cell();
  source[F.ENERGY] = 64; source[F.DENSITY] = 8; source[F.INFORMATION] = 32;
  source[F.TEMPERATURE] = 300; source[F.WAVE_PHASE] = Math.PI - 0.1;
  source[F.MATERIAL_ID] = 7; // Entity occupancy is intentionally absent from this prolongation fixture.

  const targets = Array.from({ length: 8 }, () => cell());
  InfinityScaleLODTransfer.prolongate(source, targets, 1, 0);
  const prolongation = InfinityScaleLODTransfer.validateProlongationInvariant(source, targets, 1, 0);
  if (!prolongation.valid) throw new Error("Prolongation invariant failed: " + prolongation.violations.join(","));
  const energySum = targets.reduce((sum, target) => sum + target[F.ENERGY], 0);
  if (Math.abs(energySum - source[F.ENERGY]) > 1e-6) throw new Error("Extensive ENERGY prolongation is not conservative");

  const sources = Array.from({ length: 8 }, (_, index) => {
    const value = cell();
    value[F.ENERGY] = index + 1; value[F.DENSITY] = 10 + index; value[F.TEMPERATURE] = 280 + index;
    value[F.MATERIAL_ID] = index < 4 ? 3 : 5; value[F.AGENT_MARK] = 9;
    return value;
  });
  const target = cell();
  if (sources.length !== 8) throw new Error(`Volume restriction fixture expected 8 cells, got ${sources.length}`);
  try {
    InfinityScaleLODTransfer.restrict(sources, target, 0, 1);
  } catch (error) {
    throw new Error(`Volume restriction stage: ${error instanceof Error ? error.message : String(error)}`);
  }
  const restriction = InfinityScaleLODTransfer.validateRestrictionInvariant(sources, target, 0, 1);
  if (!restriction.valid) throw new Error("Restriction invariant failed: " + restriction.violations.join(","));
  if (target[F.ENERGY] !== 36) throw new Error("Extensive ENERGY restriction expected 36");
  if (target[F.DENSITY] !== 13.5 || target[F.TEMPERATURE] !== 283.5) throw new Error("Intensive restriction mean mismatch");
  if (target[F.MATERIAL_ID] !== 3 || target[F.AGENT_MARK] !== 9) throw new Error("Discrete restriction majority mismatch");

  const circularSources = [cell(), cell(), cell(), cell()];
  circularSources[0][F.WAVE_PHASE] = Math.PI - 0.05; circularSources[1][F.WAVE_PHASE] = -Math.PI + 0.05;
  circularSources[2][F.WAVE_PHASE] = Math.PI - 0.05; circularSources[3][F.WAVE_PHASE] = -Math.PI + 0.05;
  const circularTarget = cell();
  InfinityScaleLODTransfer.restrictFace(circularSources, circularTarget, 0, 1);
  if (Math.abs(Math.abs(circularTarget[F.WAVE_PHASE]) - Math.PI) > 0.06) throw new Error("Circular phase wrap invariant failed");

  const faceSources = Array.from({ length: 4 }, (_, index) => {
    const value = cell(); value[F.ENERGY] = index + 1; value[F.DENSITY] = 20 + index; return value;
  });
  const faceTarget = cell();
  try {
    InfinityScaleLODTransfer.restrictFace(faceSources, faceTarget, 0, 1);
  } catch (error) {
    throw new Error(`Face restriction stage: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (faceTarget[F.ENERGY] !== 10 || faceTarget[F.DENSITY] !== 21.5) throw new Error("Face restriction extensive-sum/intensive-average semantics failed");

  const validSpec = {
    sourceChunk: "1:0,0,0",
    targetChunk: "0:2,0,0",
    sourceLevel: 1,
    targetLevel: 0,
    refinementRatio: 2,
    relation: "coarse-to-fine" as const,
    operation: "prolongation" as const,
    readOperation: "restriction" as const,
  };
  InfinityScaleLODTransfer.validateSpec(validSpec);
  const invalidSpecs = [
    { ...validSpec, sourceChunk: "01:0,0,0" },
    { ...validSpec, sourceChunk: "0:0,0,0" },
    { ...validSpec, targetChunk: "1:2,0,0" },
    { ...validSpec, relation: "fine-to-coarse" as const },
    { ...validSpec, sourceChunk: "1:9007199254740992,0,0" },
  ];
  for (const [index, invalidSpec] of invalidSpecs.entries()) {
    let rejected = false;
    try {
      InfinityScaleLODTransfer.validateSpec(invalidSpec);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`LOD transfer accepted inconsistent/non-canonical spec ${index}`);
  }

  // Transfer preflight must reject unsafe data before mutating any target.
  const unchanged = (actual: number[], expected: number[], label: string): void => {
    if (actual.some((value, index) => !Object.is(value, expected[index]))) {
      throw new Error(label + " partially modified its target before rejecting");
    }
  };
  const rejectedWithoutMutation = (
    label: string,
    target: number[],
    operation: () => unknown,
    expectedMessage: string,
  ): void => {
    const before = [...target];
    let failure: unknown;
    try { operation(); } catch (error) { failure = error; }
    if (!(failure instanceof Error) || !failure.message.includes(expectedMessage)) {
      throw new Error(label + " was not rejected at the intended preflight boundary: " + String(failure));
    }
    unchanged(target, before, label);
  };

  const spareSource = cell();
  spareSource[F.SPARE_1] = 1;
  const copyTarget = new Array<number>(CELL_FIELDS).fill(17);
  rejectedWithoutMutation("copy with a non-zero unsupported field", copyTarget,
    () => InfinityScaleLODTransfer.copy(spareSource, copyTarget), "unsupported field");

  const prolongTargets = Array.from({ length: 8 }, () => new Array<number>(CELL_FIELDS).fill(19));
  const prolongBefore = prolongTargets.map(value => [...value]);
  let unsupportedProlongationRejected = false;
  try { InfinityScaleLODTransfer.prolongate(spareSource, prolongTargets, 1, 0); }
  catch (error) {
    unsupportedProlongationRejected = error instanceof Error && error.message.includes("unsupported field");
  }
  if (!unsupportedProlongationRejected ||
      prolongTargets.some((value, index) => value.some((field, offset) => !Object.is(field, prolongBefore[index][offset])))) {
    throw new Error("Prolongation did not reject unsupported payloads atomically");
  }

  const invalidNumeric = cell();
  invalidNumeric[F.ENERGY] = Number.NaN;
  const invalidNumericTarget = new Array<number>(CELL_FIELDS).fill(23);
  rejectedWithoutMutation("copy with NaN", invalidNumericTarget,
    () => InfinityScaleLODTransfer.copy(invalidNumeric, invalidNumericTarget), "finite and Float32-representable");

  const overflowNumeric = cell();
  overflowNumeric[F.ENERGY] = 3.5e38;
  const overflowTargets = Array.from({ length: 8 }, () => new Array<number>(CELL_FIELDS).fill(29));
  const overflowBefore = overflowTargets.map(value => [...value]);
  let overflowRejected = false;
  try { InfinityScaleLODTransfer.prolongate(overflowNumeric, overflowTargets, 1, 0); }
  catch (error) {
    overflowRejected = error instanceof Error && error.message.includes("Float32-representable");
  }
  if (!overflowRejected ||
      overflowTargets.some((value, index) => value.some((field, offset) => !Object.is(field, overflowBefore[index][offset])))) {
    throw new Error("Prolongation accepted Float32 overflow or partially modified targets");
  }

  const identitySources = Array.from({ length: 8 }, (_, index) => {
    const value = cell();
    value[F.ENERGY] = index + 1;
    value[F.ENTITY_ID] = index < 7 ? 41 : 99;
    return value;
  });
  const identityTarget = new Array<number>(CELL_FIELDS).fill(31);
  rejectedWithoutMutation("restriction with mixed entity IDs", identityTarget,
    () => InfinityScaleLODTransfer.restrict(identitySources, identityTarget, 0, 1),
    "mixed identity/occupancy");

  const mixedAgentSources = Array.from({ length: 8 }, (_, index) => {
    const value = cell();
    value[F.AGENT_MARK] = index < 7 ? 5 : 6;
    return value;
  });
  const mixedAgentTarget = new Array<number>(CELL_FIELDS).fill(33);
  rejectedWithoutMutation("restriction with mixed agent occupancy", mixedAgentTarget,
    () => InfinityScaleLODTransfer.restrict(mixedAgentSources, mixedAgentTarget, 0, 1),
    "mixed identity/occupancy");

  const occupiedCoarse = cell();
  occupiedCoarse[F.ENTITY_ID] = 41;
  const occupiedTargets = Array.from({ length: 8 }, () => new Array<number>(CELL_FIELDS).fill(37));
  const occupiedBefore = occupiedTargets.map(value => [...value]);
  let identityProlongationRejected = false;
  try { InfinityScaleLODTransfer.prolongate(occupiedCoarse, occupiedTargets, 1, 0); }
  catch (error) {
    identityProlongationRejected = error instanceof Error && error.message.includes("explicit identity remap");
  }
  if (!identityProlongationRejected ||
      occupiedTargets.some((value, index) => value.some((field, offset) => !Object.is(field, occupiedBefore[index][offset])))) {
    throw new Error("Prolongation duplicated an entity identity or partially changed target cells");
  }

  // Unsupported fields are explicitly cleared only when their source payload
  // is already zero; stale target contents must never survive as apparent data.
  const zeroUnsupportedTarget = new Array<number>(CELL_FIELDS).fill(55);
  InfinityScaleLODTransfer.copy(cell(), zeroUnsupportedTarget);
  for (const field of [F.SPARE_1, F.SPARE_2, F.SPARE_3]) {
    if (zeroUnsupportedTarget[field] !== 0) {
      throw new Error("Successful transfer retained stale unsupported target field " + field);
    }
  }


  // Individually valid Float32 inputs can still overflow during an extensive
  // reduction. Results are staged separately, so the target remains untouched.
  const largeSources = Array.from({ length: 8 }, () => {
    const value = cell();
    value[F.ENERGY] = 3e38;
    return value;
  });
  const largeTarget = new Array<number>(CELL_FIELDS).fill(43);
  rejectedWithoutMutation("restriction whose extensive sum overflows Float32", largeTarget,
    () => InfinityScaleLODTransfer.restrict(largeSources, largeTarget, 0, 1),
    "result for field");

  const largeFaceSources = Array.from({ length: 4 }, () => {
    const value = cell();
    value[F.ENERGY] = 3e38;
    return value;
  });
  const largeFaceTarget = new Array<number>(CELL_FIELDS).fill(47);
  rejectedWithoutMutation("face restriction whose extensive sum overflows Float32", largeFaceTarget,
    () => InfinityScaleLODTransfer.restrictFace(largeFaceSources, largeFaceTarget, 0, 1),
    "result for field");


  const boundarySource = cell();
  boundarySource[F.ENERGY] = 64;
  boundarySource[F.DENSITY] = 8;
  const boundaryTarget = new Array<number>(CELL_FIELDS).fill(61);
  const boundaryResult = InfinityScaleLODTransfer.prolongateBoundaryCell(boundarySource, boundaryTarget, 1, 0);
  if (boundaryResult.operation !== "prolongation" ||
      boundaryTarget[F.ENERGY] !== 8 ||
      boundaryTarget[F.DENSITY] !== 8 ||
      boundaryTarget[F.SPARE_1] !== 0 ||
      boundaryTarget[F.SPARE_2] !== 0 ||
      boundaryTarget[F.SPARE_3] !== 0) {
    throw new Error("Boundary prolongation did not publish the complete staged cell result");
  }

  const occupiedBoundarySource = cell();
  occupiedBoundarySource[F.ENTITY_ID] = 72;
  const occupiedBoundaryTarget = new Array<number>(CELL_FIELDS).fill(67);
  rejectedWithoutMutation("boundary prolongation with an unmapped entity identity", occupiedBoundaryTarget,
    () => InfinityScaleLODTransfer.prolongateBoundaryCell(occupiedBoundarySource, occupiedBoundaryTarget, 1, 0),
    "explicit identity remap");


  const oversizedTargetCell = new Array<number>(CELL_FIELDS).fill(0);
  let oversizedProlongationRejected = false;
  try {
    InfinityScaleLODTransfer.prolongate(
      cell(),
      new Array<number[]>(32768).fill(oversizedTargetCell),
      5,
      0,
    );
  } catch (error) {
    oversizedProlongationRejected = error instanceof RangeError &&
      error.message.includes("cell transfer limit");
  }
  if (!oversizedProlongationRejected ||
      oversizedTargetCell.some(value => value !== 0)) {
    throw new Error("Prolongation did not reject an oversized transfer before target publication");
  }

  let oversizedRestrictionRejected = false;
  try {
    InfinityScaleLODTransfer.restrict(
      new Array<ArrayLike<number>>(32768).fill(cell()),
      new Array<number>(CELL_FIELDS).fill(53),
      0,
      5,
    );
  } catch (error) {
    oversizedRestrictionRejected = error instanceof RangeError &&
      error.message.includes("cell transfer limit");
  }
  if (!oversizedRestrictionRejected) {
    throw new Error("Restriction did not enforce its cell-count allocation limit");
  }

}