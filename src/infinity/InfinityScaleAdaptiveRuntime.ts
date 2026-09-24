import { InfinityScaleV2 } from "../InfinityScaleV2";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { InfinityScaleAdaptiveLODTransactionBridge, type InfinityScaleAdaptiveTransferExecution } from "./InfinityScaleAdaptiveLODTransactionBridge";
import { InfinityScalePredictiveAdaptivePipeline, type InfinityScalePredictiveAdaptivePipelineResult } from "./InfinityScalePredictiveAdaptivePipeline";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";
import type { InfinityScaleGPUExecutionBudget } from "./InfinityScaleGPUExecutionPlanAdapter";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import { InfinityScaleClosedLoopAdaptiveController, type InfinityScaleClosedLoopAdaptiveInput, type InfinityScaleClosedLoopAdaptiveRecommendation } from "./InfinityScaleClosedLoopAdaptiveController";
import { buildInfinityScaleAdaptiveMutationPlan } from "./InfinityScaleAdaptiveMutationPlanBuilder";
import { InfinityScaleClosedLoopExecutablePlanner } from "./InfinityScaleClosedLoopExecutablePlanner";
import type { InfinityScaleSpatialConstraintNode } from "./InfinityScaleSpatialConstraintClosure";

export interface InfinityScaleAdaptiveRuntimeStep {
  stateRevision: number;
  topologyRevision: number;
  mutations: InfinityScaleAdaptiveMutation[];
  gpuBudget: InfinityScaleGPUExecutionBudget;
  conservationValid: boolean;
  gpuComplete: boolean;
  transferExecutions?: InfinityScaleAdaptiveTransferExecution[];
}

export interface InfinityScaleClosedLoopRuntimeRegion extends Omit<InfinityScaleClosedLoopAdaptiveInput, "currentLOD"> {
  currentLOD?: number;
  topology: InfinityScaleSpatialConstraintNode;
}

export interface InfinityScaleAdaptiveRuntimeResult extends InfinityScalePredictiveAdaptivePipelineResult {
  topologyChanged: boolean;
  committed: boolean;
  stateRevision: number;
  topologyRevision: number;
  lodByRegion: Record<string, number>;
}

export interface InfinityScaleClosedLoopRuntimeResult extends InfinityScaleAdaptiveRuntimeResult {
  recommendations: InfinityScaleClosedLoopAdaptiveRecommendation[];
  executablePlanHash: string;
}

export class InfinityScaleAdaptiveRuntime {
  private readonly pipeline = new InfinityScalePredictiveAdaptivePipeline();
  private readonly closedLoopController = new InfinityScaleClosedLoopAdaptiveController();
  private readonly executablePlanner = new InfinityScaleClosedLoopExecutablePlanner();
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
    let topologyChanged = false;
    if (pipeline.commitReady) {
      if (!frame || !plan) throw new Error("Adaptive runtime commit requires a global execution frame and execution plan");
      const bridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, this.lodState);
      bridge.begin(frame);
      const result = bridge.commit(frame, step.mutations, step.transferExecutions ?? []);
      committed = result.committed;
      if (committed) { topologyChanged = result.topologyChanged; this.stateRevision++; if (result.topologyChanged) this.topologyRevision++; }
    }

    return { ...pipeline, committed, topologyChanged, stateRevision: this.stateRevision, topologyRevision: this.topologyRevision, lodByRegion: this.snapshotLOD() };
  }

  stepClosedLoop(
    regions: InfinityScaleClosedLoopRuntimeRegion[],
    gpuBudget: InfinityScaleGPUExecutionBudget,
    conservationValid: boolean,
    gpuComplete: boolean,
    frame?: InfinityScaleGlobalExecutionFrame,
    plan?: InfinityScaleExecutionPlan,
    transferExecutions: InfinityScaleAdaptiveTransferExecution[] = [],
  ): InfinityScaleClosedLoopRuntimeResult {
    const recommendations = regions
      .map(region => this.closedLoopController.observeAndRecommend({
        ...region,
        currentLOD: region.currentLOD ?? this.getLOD(region.regionId) ?? region.topology.currentLOD,
        error: region.runtimeError,
      }))
      .sort((a, b) => a.regionId.localeCompare(b.regionId));

    const mutationPlan = buildInfinityScaleAdaptiveMutationPlan(recommendations);
    const executablePlan = this.executablePlanner.compile(mutationPlan, regions.map(region => ({
      ...region.topology,
      currentLOD: region.currentLOD ?? this.getLOD(region.regionId) ?? region.topology.currentLOD,
    })));

    const runtime = this.step({
      stateRevision: this.stateRevision,
      topologyRevision: this.topologyRevision,
      mutations: executablePlan.mutations,
      gpuBudget,
      conservationValid,
      gpuComplete,
      transferExecutions,
    }, frame, plan);

    return {
      ...runtime,
      recommendations,
      executablePlanHash: executablePlan.deterministicHash,
    };
  }

  private snapshotLOD(): Record<string, number> {
    const lodByRegion: Record<string, number> = {};
    for (const key of this.lodState.keys().sort()) {
      const chunk = this.lodState.getChunk(key);
      if (chunk) lodByRegion[key] = chunk.level;
    }
    return lodByRegion;
  }

  bindToObserver(cell: { x: number; y: number; z: number }): void { this.scale.setObserver(cell); }
}
