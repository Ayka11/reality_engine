import { CELL_FIELDS, F } from "../core/CellState";
import type {
  InfinityScaleBoundaryTransferSpec,
} from "./InfinityScaleChunkExecutionContext";

/**
 * Field policy used by the LOD transfer operator.
 *
 * Continuous physical fields use volume-weighted averaging for restriction
 * and piecewise-constant prolongation. Identity/discrete fields are never
 * interpolated because doing so would manufacture invalid entity/material IDs.
 */
export type InfinityScaleLODFieldPolicy =
  | "intensive"
  | "discrete"
  | "unsupported";

export interface InfinityScaleLODTransferResult {
  operation: "copy" | "prolongation" | "restriction";
  sourceLevel: number;
  targetLevel: number;
  refinementRatio: number;
  transferredFields: number[];
  skippedFields: number[];
}

/**
 * Pure field-transfer kernel for the Infinity Scale AMR boundary contract.
 *
 * This module deliberately operates on caller-supplied cell vectors rather
 * than SparseVoxelGrid ownership. The current dense grid has no separate
 * coarse-level storage, so enabling this kernel does NOT by itself make
 * mixed-LOD execution safe. SimulationEngine keeps lodBoundaryTransferReady
 * disabled until hierarchical storage and boundary commit integration exist.
 */
export class InfinityScaleLODTransfer {
  static readonly continuousFields: number[] = [
    F.ENERGY,
    F.DENSITY,
    F.INFORMATION,
    F.ENTROPY,
    F.TEMPERATURE,
    F.PRESSURE,
    F.FIELD_X,
    F.FIELD_Y,
    F.FIELD_Z,
    F.LOCAL_TIME,
    F.BIO_POTENTIAL,
    F.WAVE_PHASE,
    F.WAVE_AMP,
    F.GRAVITY_POT,
    F.SIGNAL,
    F.MEM_FIELD,
  ];

  static readonly discreteFields: number[] = [
    F.MATERIAL_ID,
    F.CHEM_STATE,
    F.CAUSALITY_ID,
    F.AGENT_MARK,
    F.ENTITY_ID,
  ];

  static policy(field: number): InfinityScaleLODFieldPolicy {
    if (this.continuousFields.includes(field)) return "intensive";
    if (this.discreteFields.includes(field)) return "discrete";
    return "unsupported";
  }

  /**
   * Same-level transfer. No interpolation is performed.
   */
  static copy(
    source: ReadonlyArray<number>,
    target: number[],
  ): InfinityScaleLODTransferResult {
    if (source.length !== CELL_FIELDS || target.length !== CELL_FIELDS) {
      throw new Error(
        `Infinity Scale cell transfer requires exactly ${CELL_FIELDS} fields`,
      );
    }

    const transferredFields: number[] = [];
    const skippedFields: number[] = [];

    for (let field = 0; field < CELL_FIELDS; field++) {
      const policy = this.policy(field);
      if (policy === "intensive" || policy === "discrete") {
        target[field] = source[field];
        transferredFields.push(field);
      } else {
        skippedFields.push(field);
      }
    }

    return {
      operation: "copy",
      sourceLevel: 0,
      targetLevel: 0,
      refinementRatio: 1,
      transferredFields,
      skippedFields,
    };
  }

  /**
   * Coarse-to-fine baseline prolongation.
   *
   * A coarse cell is represented as a piecewise-constant value over each of
   * its refinementRatio^3 child cells. This is deterministic for the current
   * field-transfer policy; conservation is not assumed for every field.
   */
  static prolongate(
    source: ReadonlyArray<number>,
    targets: Array<number[]>,
    sourceLevel: number,
    targetLevel: number,
  ): InfinityScaleLODTransferResult {
    const refinementRatio = this.validateLevels(sourceLevel, targetLevel, "prolongation");
    const expected = refinementRatio ** 3;

    if (targets.length !== expected) {
      throw new Error(
        `Infinity Scale prolongation requires ${expected} target cells; received ${targets.length}`,
      );
    }

    if (source.length !== CELL_FIELDS) {
      throw new Error(
        `Infinity Scale prolongation source requires exactly ${CELL_FIELDS} fields`,
      );
    }

    for (const target of targets) {
      if (target.length !== CELL_FIELDS) {
        throw new Error(
          `Infinity Scale prolongation target requires exactly ${CELL_FIELDS} fields`,
        );
      }
    }

    const transferredFields: number[] = [];
    const skippedFields: number[] = [];

    for (let field = 0; field < CELL_FIELDS; field++) {
      const policy = this.policy(field);
      if (policy !== "intensive" && policy !== "discrete") {
        skippedFields.push(field);
        continue;
      }

      for (const target of targets) target[field] = source[field];
      transferredFields.push(field);
    }

    return {
      operation: "prolongation",
      sourceLevel,
      targetLevel,
      refinementRatio,
      transferredFields,
      skippedFields,
    };
  }

  /**
   * Fine-to-coarse baseline restriction.
   *
   * Continuous fields are volume-averaged. Discrete fields use deterministic
   * majority selection rather than arithmetic interpolation.
   */
  static restrict(
    sources: ReadonlyArray<ReadonlyArray<number>>,
    target: number[],
    sourceLevel: number,
    targetLevel: number,
  ): InfinityScaleLODTransferResult {
    const refinementRatio = this.validateLevels(sourceLevel, targetLevel, "restriction");
    const expected = refinementRatio ** 3;

    if (sources.length !== expected) {
      throw new Error(
        `Infinity Scale restriction requires ${expected} source cells; received ${sources.length}`,
      );
    }

    for (const source of sources) {
      if (source.length !== CELL_FIELDS) {
        throw new Error(
          `Infinity Scale restriction source requires exactly ${CELL_FIELDS} fields`,
        );
      }
    }

    if (target.length !== CELL_FIELDS) {
      throw new Error(
        `Infinity Scale restriction target requires exactly ${CELL_FIELDS} fields`,
      );
    }

    const transferredFields: number[] = [];
    const skippedFields: number[] = [];

    for (let field = 0; field < CELL_FIELDS; field++) {
      const policy = this.policy(field);

      if (policy === "intensive") {
        let sum = 0;
        for (const source of sources) sum += source[field] ?? 0;
        target[field] = sum / sources.length;
        transferredFields.push(field);
        continue;
      }

      if (policy === "discrete") {
        const counts = new Map<number, number>();
        for (const source of sources) {
          const value = source[field] ?? 0;
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }

        let selected = 0;
        let selectedCount = -1;
        for (const [value, count] of counts) {
          if (count > selectedCount || (count === selectedCount && value < selected)) {
            selected = value;
            selectedCount = count;
          }
        }

        target[field] = selected;
        transferredFields.push(field);
        continue;
      }

      skippedFields.push(field);
    }

    return {
      operation: "restriction",
      sourceLevel,
      targetLevel,
      refinementRatio,
      transferredFields,
      skippedFields,
    };
  }

  static validateSpec(spec: InfinityScaleBoundaryTransferSpec): void {
    const expectedOperation =
      spec.relation === "same-level"
        ? "copy"
        : spec.relation === "coarse-to-fine"
          ? "prolongation"
          : "restriction";

    if (spec.operation !== expectedOperation) {
      throw new Error(
        `Infinity Scale transfer operation mismatch: ${spec.operation} !== ${expectedOperation}`,
      );
    }

    const expectedRatio = 2 ** Math.abs(spec.sourceLevel - spec.targetLevel);
    if (spec.refinementRatio !== expectedRatio) {
      throw new Error(
        `Infinity Scale transfer ratio mismatch: ${spec.refinementRatio} !== ${expectedRatio}`,
      );
    }
  }

  private static validateLevels(
    sourceLevel: number,
    targetLevel: number,
    operation: "prolongation" | "restriction",
  ): number {
    if (!Number.isInteger(sourceLevel) || !Number.isInteger(targetLevel)) {
      throw new Error("Infinity Scale LOD levels must be integers");
    }

    if (operation === "prolongation" && sourceLevel <= targetLevel) {
      throw new Error("Infinity Scale prolongation requires coarse source -> finer target");
    }

    if (operation === "restriction" && sourceLevel >= targetLevel) {
      throw new Error("Infinity Scale restriction requires fine source -> coarser target");
    }

    return 2 ** Math.abs(sourceLevel - targetLevel);
  }
}
