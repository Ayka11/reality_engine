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
  sourceCells: Float32Array[];
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
      sourceCells: sourceCells.map(source => new Float32Array(source)),
    });
  }

  validate(): InfinityScaleLODSynchronizationResult {
    this.state.assertRevision(this.revision);
    let invalidUpdateCount = 0;
    let topologyValid = true;
    const seenTargets = new Set<string>();
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

    const conservationErrorFields = new Set<number>();
    for (const update of this.staged.values()) {
      for (let field = 0; field < CELL_FIELDS; field++) {
        const semantics = getInfinityScaleFieldSemantics(field);
        if (semantics.policy === "unsupported" || semantics.conservation === "none" || semantics.conservation === "majority") {
          continue;
        }

        const sources = update.sourceCells;
        if (sources.length === 0) {
          conservationErrorFields.add(field);
          continue;
        }

        let expected = 0;
        if (semantics.conservation === "sum") {
          for (const source of sources) expected += source[field] ?? 0;
          if (update.relation === "coarse-to-fine") {
            expected /= update.sourceCells.length === 1 ? 1 : update.sourceCells.length;
          }
          if (update.relation === "coarse-to-fine" && sources.length === 1) {
            expected /= Math.max(1, refinementRatio(update));
          }
        } else if (semantics.conservation === "average") {
          for (const source of sources) expected += source[field] ?? 0;
          expected /= sources.length;
        } else {
          let sumSin = 0;
          let sumCos = 0;
          for (const source of sources) {
            const phase = source[field] ?? 0;
            sumSin += Math.sin(phase);
            sumCos += Math.cos(phase);
          }
          expected = Math.atan2(sumSin, sumCos);
        }

        const actual = update.value[field] ?? 0;
        const error = semantics.conservation === "circular"
          ? Math.abs(Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)))
          : Math.abs(actual - expected);
        const tolerance = 1e-4 * Math.max(1, Math.abs(expected), Math.abs(actual));
        if (error > tolerance) conservationErrorFields.add(field);
      }
    }

    const conservationErrorFieldList = [...conservationErrorFields];
    const conservationValid = invalidUpdateCount === 0 && conservationErrorFieldList.length === 0;
    return {
      revision: this.revision,
      updates: this.getStagedUpdates(),
      conservationValid,
      topologyValid,
      readyToCommit: conservationValid && topologyValid,
      invalidUpdateCount,
      conservationErrorFields: conservationErrorFieldList,
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
      sourceCells: update.sourceCells.map(source => new Float32Array(source)),
    }));
  }

  private updateKey(targetChunk: string, cell: [number, number, number]): string {
    return `${targetChunk}|${cell[0]},${cell[1]},${cell[2]}`;
  }
}

function refinementRatio(update: InfinityScaleLODBoundaryUpdate): number {
  const sourceLevel = chunkLevel(update.sourceChunk);
  const targetLevel = chunkLevel(update.targetChunk);
  return 2 ** Math.abs(sourceLevel - targetLevel);
}

function chunkLevel(key: string): number {
  const match = /^(\d+):/.exec(key);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
  return Number(match[1]);
}
