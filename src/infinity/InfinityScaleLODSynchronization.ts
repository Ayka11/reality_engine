import { CELL_FIELDS } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { getInfinityScaleFieldSemantics } from "./InfinityScaleFieldSemantics";
import {
  InfinityScaleLODTransfer,
} from "./InfinityScaleLODTransfer";
import type {
  InfinityScaleBoundaryTransferSpec,
} from "./InfinityScaleChunkExecutionContext";

export interface InfinityScaleLODBoundaryUpdate {
  sourceChunk: string;
  targetChunk: string;
  relation: "same-level" | "coarse-to-fine" | "fine-to-coarse";
  targetCell: [number, number, number];
  value: Float32Array;
}

export interface InfinityScaleLODSynchronizationResult {
  revision: number;
  updates: InfinityScaleLODBoundaryUpdate[];
  conservationValid: boolean;
  topologyValid: boolean;
  readyToCommit: boolean;
  invalidUpdateCount: number;
  conservationErrorFields: number[];
}

export class InfinityScaleLODSynchronization {
  private readonly staged = new Map<string, InfinityScaleLODBoundaryUpdate>();
  private revision = 0;

  constructor(private readonly state: InfinityScaleLODState) {}

  begin(revision: number): void {
    if (!Number.isInteger(revision) || revision < 0) {
      throw new Error("Infinity Scale synchronization revision must be a non-negative integer");
    }
    this.state.assertRevision(revision);
    this.staged.clear();
    this.revision = revision;
  }

  stageTransfer(
    spec: InfinityScaleBoundaryTransferSpec,
    targetCell: [number, number, number],
    sourceCells: ReadonlyArray<ReadonlyArray<number>>,
  ): void {
    InfinityScaleLODTransfer.validateSpec(spec);

    const target = new Float32Array(CELL_FIELDS);
    if (spec.operation === "copy") {
      if (sourceCells.length !== 1) {
        throw new Error("Infinity Scale copy transfer requires exactly one source cell");
      }
      InfinityScaleLODTransfer.copy(sourceCells[0], target as unknown as number[]);
    } else if (spec.operation === "prolongation") {
      const expected = spec.refinementRatio ** 3;
      if (sourceCells.length !== 1) {
        throw new Error("Infinity Scale prolongation boundary staging requires one coarse source cell");
      }
      const children = Array.from({ length: expected }, () => new Array<number>(CELL_FIELDS).fill(0));
      InfinityScaleLODTransfer.prolongate(
        sourceCells[0],
        children,
        spec.sourceLevel,
        spec.targetLevel,
      );
      target.set(children[0]);
    } else {
      InfinityScaleLODTransfer.restrict(
        sourceCells,
        target as unknown as number[],
        spec.sourceLevel,
        spec.targetLevel,
      );
    }

    const key = this.updateKey(spec.targetChunk, targetCell);
    this.staged.set(key, {
      sourceChunk: spec.sourceChunk,
      targetChunk: spec.targetChunk,
      relation: spec.relation,
      targetCell: [...targetCell],
      value: target,
    });
  }

  validate(): InfinityScaleLODSynchronizationResult {
    this.state.assertRevision(this.revision);
    let invalidUpdateCount = 0;
    let topologyValid = true;
    const seenTargets = new Set<string>();
    const conservationErrorFields: number[] = [];

    for (const update of this.staged.values()) {
      if (update.value.length !== CELL_FIELDS || !update.value.every(Number.isFinite)) {
        invalidUpdateCount++;
      }

      const targetKey = this.updateKey(update.targetChunk, update.targetCell);
      if (seenTargets.has(targetKey)) topologyValid = false;
      seenTargets.add(targetKey);

      const level = chunkLevel(update.targetChunk);
      const state = this.state.getChunk(update.targetChunk);
      if (!state || state.level !== level) topologyValid = false;
    }

    const conservationValid = invalidUpdateCount === 0;
    for (const field of Array.from({ length: CELL_FIELDS }, (_, index) => index)) {
      const semantics = getInfinityScaleFieldSemantics(field);
      if (semantics.conservation === "none" || semantics.policy === "unsupported") continue;

      let sourceTotal = 0;
      let targetTotal = 0;
      let hasComparableUpdate = false;

      for (const update of this.staged.values()) {
        if (update.relation === "fine-to-coarse" && semantics.conservation === "sum") {
          const sourceState = this.state.getChunk(update.sourceChunk);
          const targetState = this.state.getChunk(update.targetChunk);
          if (!sourceState || !targetState) continue;
          hasComparableUpdate = true;
          targetTotal += update.value[field] ?? 0;
          // Fine-to-coarse restriction output is the complete aggregate for the
          // source footprint, so the staged target is directly comparable.
          const sourceCell = sourceState.cells[0] ?? 0;
          sourceTotal += sourceCell;
        }
      }

      if (hasComparableUpdate && Math.abs(sourceTotal - targetTotal) > 1e-4 * Math.max(1, Math.abs(sourceTotal), Math.abs(targetTotal))) {
        conservationErrorFields.push(field);
      }
    }

    return {
      revision: this.revision,
      updates: this.getStagedUpdates(),
      conservationValid: conservationValid && conservationErrorFields.length === 0,
      topologyValid,
      readyToCommit: conservationValid && topologyValid && conservationErrorFields.length === 0,
      invalidUpdateCount,
      conservationErrorFields,
    };
  }

  commit(): InfinityScaleLODSynchronizationResult {
    const result = this.validate();
    this.state.assertRevision(this.revision);
    if (!result.readyToCommit) {
      throw new Error(
        `Infinity Scale LOD synchronization rejected: invalid=${result.invalidUpdateCount}, conservationErrors=${result.conservationErrorFields.length}`,
      );
    }

    for (const update of result.updates) {
      const [x, y, z] = update.targetCell;
      const targetLevel = chunkLevel(update.targetChunk);
      this.state.writeBaseCell(
        update.targetChunk,
        targetLevel,
        x,
        y,
        z,
        update.value,
      );
    }

    this.staged.clear();
    return {
      ...result,
      updates: result.updates.map(update => ({
        ...update,
        value: new Float32Array(update.value),
        targetCell: [...update.targetCell] as [number, number, number],
      })),
    };
  }

  rollback(): void {
    this.staged.clear();
  }

  getStagedUpdates(): InfinityScaleLODBoundaryUpdate[] {
    return [...this.staged.values()].map(update => ({
      ...update,
      targetCell: [...update.targetCell] as [number, number, number],
      value: new Float32Array(update.value),
    }));
  }

  private updateKey(targetChunk: string, cell: [number, number, number]): string {
    return `${targetChunk}|${cell[0]},${cell[1]},${cell[2]}`;
  }
}

function chunkLevel(key: string): number {
  const match = /^(\d+):/.exec(key);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
  return Number(match[1]);
}
