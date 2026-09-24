import { InfinityScaleV2 } from "../InfinityScaleV2";
import {
  InfinityScalePredictiveAdaptivePipeline,
  type InfinityScalePredictiveAdaptivePipelineInput,
  type InfinityScalePredictiveAdaptivePipelineResult,
} from "./InfinityScalePredictiveAdaptivePipeline";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";
import type { InfinityScaleGPUExecutionBudget } from "./InfinityScaleGPUExecutionPlanAdapter";

export interface InfinityScaleAdaptiveRuntimeStep {
  stateRevision: number;
  topologyRevision: number;
  mutations: InfinityScaleAdaptiveMutation[];
  gpuBudget: InfinityScaleGPUExecutionBudget;
  conservationValid: boolean;
  gpuComplete: boolean;
}

export interface InfinityScaleAdaptiveRuntimeResult
  extends InfinityScalePredictiveAdaptivePipelineResult {
  committed: boolean;
  stateRevision: number;
  topologyRevision: number;
  lodByRegion: Record<string, number>;
}

export class InfinityScaleAdaptiveRuntime {
  private readonly pipeline = new InfinityScalePredictiveAdaptivePipeline();
  private stateRevision = 0;
  private topologyRevision = 0;
  private lodByRegion = new Map<string, number>();

  constructor(private readonly scale: InfinityScaleV2) {}

  getStateRevision(): number {
    return this.stateRevision;
  }

  getTopologyRevision(): number {
    return this.topologyRevision;
  }

  getLOD(regionId: string): number | undefined {
    return this.lodByRegion.get(regionId);
  }

  step(step: InfinityScaleAdaptiveRuntimeStep): InfinityScaleAdaptiveRuntimeResult {
    if (step.stateRevision !== this.stateRevision) {
      throw new Error("Adaptive runtime state revision is stale");
    }
    if (step.topologyRevision !== this.topologyRevision) {
      throw new Error("Adaptive runtime topology revision is stale");
    }

    const input: InfinityScalePredictiveAdaptivePipelineInput = {
      stateRevision: this.stateRevision,
      topologyRevision: this.topologyRevision,
      expectedStateRevision: this.stateRevision,
      expectedTopologyRevision: this.topologyRevision,
      mutations: step.mutations,
      gpuBudget: step.gpuBudget,
      conservationValid: step.conservationValid,
      gpuComplete: step.gpuComplete,
    };

    const pipeline = this.pipeline.run(input);
    let committed = false;

    if (pipeline.commitReady) {
      for (const mutation of step.mutations) {
        if (mutation.fromLOD === mutation.toLOD) continue;
        const current = this.lodByRegion.get(mutation.regionId);
        if (current !== undefined && current !== mutation.fromLOD) {
          throw new Error(`LOD state conflict for region: ${mutation.regionId}`);
        }
      }

      for (const mutation of step.mutations) {
        if (mutation.fromLOD === mutation.toLOD) continue;
        this.lodByRegion.set(mutation.regionId, mutation.toLOD);
      }

      this.stateRevision++;
      if (step.mutations.some(mutation => mutation.fromLOD !== mutation.toLOD)) {
        this.topologyRevision++;
      }
      committed = true;
    }

    return {
      ...pipeline,
      committed,
      stateRevision: this.stateRevision,
      topologyRevision: this.topologyRevision,
      lodByRegion: Object.fromEntries([...this.lodByRegion.entries()].sort()),
    };
  }

  bindToObserver(cell: { x: number; y: number; z: number }): void {
    this.scale.setObserver(cell);
  }
}
