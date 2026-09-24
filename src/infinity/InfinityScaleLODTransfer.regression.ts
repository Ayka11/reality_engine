import { CELL_FIELDS, F } from "../core/CellState";
import { InfinityScaleLODTransfer } from "./InfinityScaleLODTransfer";

function cell(): number[] {
  return new Array<number>(CELL_FIELDS).fill(0);
}

export function runInfinityScaleLODTransferInvariantRegression(): void {
  const source = cell();
  source[F.ENERGY] = 64; source[F.DENSITY] = 8; source[F.INFORMATION] = 32;
  source[F.TEMPERATURE] = 300; source[F.WAVE_PHASE] = Math.PI - 0.1;
  source[F.MATERIAL_ID] = 7; source[F.AGENT_MARK] = 11;

  const targets = Array.from({ length: 8 }, () => cell());
  InfinityScaleLODTransfer.prolongate(source, targets, 1, 0);
  const prolongation = InfinityScaleLODTransfer.validateProlongationInvariant(source, targets, 1, 0);
  if (!prolongation.valid) throw new Error("Prolongation invariant failed: " + prolongation.violations.join(","));
  const energySum = targets.reduce((sum, target) => sum + target[F.ENERGY], 0);
  if (Math.abs(energySum - source[F.ENERGY]) > 1e-6) throw new Error("Extensive ENERGY prolongation is not conservative");

  const sources = Array.from({ length: 8 }, (_, index) => {
    const value = cell();
    value[F.ENERGY] = index + 1; value[F.DENSITY] = 10 + index; value[F.TEMPERATURE] = 280 + index;
    value[F.MATERIAL_ID] = index < 4 ? 3 : 5; value[F.AGENT_MARK] = index < 4 ? 9 : 12;
    return value;
  });
  const target = cell();
  InfinityScaleLODTransfer.restrict(sources, target, 0, 1);
  const restriction = InfinityScaleLODTransfer.validateRestrictionInvariant(sources, target, 0, 1);
  if (!restriction.valid) throw new Error("Restriction invariant failed: " + restriction.violations.join(","));
  if (target[F.ENERGY] !== 36) throw new Error("Extensive ENERGY restriction expected 36");
  if (target[F.DENSITY] !== 13.5 || target[F.TEMPERATURE] !== 283.5) throw new Error("Intensive restriction mean mismatch");
  if (target[F.MATERIAL_ID] !== 3 || target[F.AGENT_MARK] !== 9) throw new Error("Discrete restriction majority mismatch");

  const circularSources = [cell(), cell(), cell(), cell()];
  circularSources[0][F.WAVE_PHASE] = Math.PI - 0.05; circularSources[1][F.WAVE_PHASE] = -Math.PI + 0.05;
  circularSources[2][F.WAVE_PHASE] = Math.PI - 0.05; circularSources[3][F.WAVE_PHASE] = -Math.PI + 0.05;
  const circularTarget = cell();
  InfinityScaleLODTransfer.restrict(circularSources, circularTarget, 0, 1);
  if (Math.abs(Math.abs(circularTarget[F.WAVE_PHASE]) - Math.PI) > 0.06) throw new Error("Circular phase wrap invariant failed");

  const faceSources = Array.from({ length: 4 }, (_, index) => {
    const value = cell(); value[F.ENERGY] = index + 1; value[F.DENSITY] = 20 + index; return value;
  });
  const faceTarget = cell();
  InfinityScaleLODTransfer.restrictFace(faceSources, faceTarget, 0, 1);
  if (faceTarget[F.ENERGY] !== 2.5 || faceTarget[F.DENSITY] !== 21.5) throw new Error("Face restriction average semantics failed");
}