import { InfinityScaleV2 } from "../InfinityScaleV2";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { InfinityScaleAdaptiveLODTransactionBridge, type InfinityScaleAdaptiveTransferExecution } from "./InfinityScaleAdaptiveLODTransactionBridge";
import { InfinityScalePredictiveAdaptivePipeline, type InfinityScalePredictiveAdaptivePipelineResult } from "./InfinityScalePredictiveAdaptivePipeline";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";
import type { InfinityScaleGPUExecutionBudget } from "./InfinityScaleGPUExecutionPlanAdapter";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";

export interface InfinityScaleAdaptiveRuntimeStep {
  stateRevision: number;
  topologyRevision: number;
  mutations: InfinityScaleAdaptiveMutation[];
  gpuBudget: InfinityScaleGPUExecutionBudget;
  conservationValid: boolean;
  gpuComplete: boolean;
  transferExecutions?: InfinityScaleAdaptiveTransferExecution[];
}

export interface InfinityScaleAdaptiveRuntimeResult extends InfinityScalePredictiveAdaptivePipelineResult {
  committed: boolean;
  stateRevision: number;
  topologyRevision: number;
  lodByRegion: Record<string, number>;
}

export class InfinityScaleAdaptiveRuntime {
  private readonly pipeline = new InfinityScalePredictiveAdaptivePipeline();
  private readonly lodState: InfinityScaleLODState;
  private stateRevision = 0;
  private topologyRevision = 0;

  constructor(private readonly scale: InfinityScaleV2, lodState = new InfinityScaleLODState()) { this.lodState = lodState; }
  getStateRevision(): number { return this.stateRevision; }
  getTopologyRevision(): number { return this.topologyRevision; }
  getLOD(regionId: string): number | undefined { return this.lodState.getChunk(regionId)?.level; }
  getLODState(): InfinityScaleLODState { return this.lodState; }

  step(step: InfinityScaleAdaptiveRuntimeStep, frame?: InfinityScaleGlobalExecutionFrame, plan?: InfinityScaleExecutionPlan): InfinityScaleAdaptiveRuntimeResult {
    if (step.stateRevision !== this.stateRevision) throw new Error("Adaptive runtime state revision is stale");
    if (step.topologyRevision !== this.topologyRevision) throw new Error("Adaptive runtime topology revision is stale");
    const pipeline = this.pipeline.run({
      stateRevision: this.stateRevision, topologyRevision: this.topologyRevision,
      expectedStateRevision: this.stateRevision, expectedTopologyRevision: this.topologyRevision,
      mutations: step.mutations, gpuBudget: step.gpuBudget,
      conservationValid: step.conservationValid, gpuComplete: step.gpuComplete,
    });

    let committed = false;
    if (pipeline.commitReady) {
      if (!frame || !plan) throw new Error("Adaptive runtime commit requires a global execution frame and execution plan");
      const bridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, this.lodState);
      bridge.begin(frame);
      const result = bridge.commit(frame, step.mutations, step.transferExecutions ?? []);
      committed = result.committed;
      if (committed) { this.stateRevision++; if (result.topologyChanged) this.topologyRevision++; }
    }

    const lodByRegion: Record<string, number> = {};
    for (const key of this.lodState.keys().sort()) {
      const chunk = this.lodState.getChunk(key);
      if (chunk) lodByRegion[key] = chunk.level;
    }
    return { ...pipeline, committed, stateRevision: this.stateRevision, topologyRevision: this.topologyRevision, lodByRegion };
  }

  bindToObserver(cell: { x: number; y: number; z: number }): void { this.scale.setObserver(cell); }
}
