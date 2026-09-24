import type { InfinityScalePredictiveAdaptivePipelineResult } from "./InfinityScalePredictiveAdaptivePipeline";
import { InfinityScaleAdaptiveTelemetryRecorder, type InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";

export interface InfinityScaleAdaptiveFeedbackSample {
  epoch: number;
  error: number;
  stateRevision: number;
  topologyRevision: number;
  pipeline: InfinityScalePredictiveAdaptivePipelineResult;
  committed?: boolean;
  lodByRegion?: Record<string, number>;
}

export interface InfinityScaleAdaptiveFeedbackSummary {
  epochs: number;
  meanError: number;
  lastError: number;
  errorTrend: number;
  executableRate: number;
  commitReadyRate: number;
  committedRate: number;
  gpuCompletionRate: number;
  deferredRate: number;
  telemetryHash: string;
}

export interface InfinityScaleAdaptivePostCommitObservation {
  epoch: number;
  committed: boolean;
  stateRevision: number;
  topologyRevision: number;
  lodByRegion: Record<string, number>;
  errorBefore: number;
  errorAfter: number;
  errorDelta: number;
  topologyChanged: boolean;
  observationHash: string;
}

export class InfinityScaleAdaptiveFeedbackLoop {
  private readonly telemetry = new InfinityScaleAdaptiveTelemetryRecorder();
  private readonly errors: Array<{ epoch: number; error: number }> = [];
  private readonly postCommit: InfinityScaleAdaptivePostCommitObservation[] = [];

  observe(sample: InfinityScaleAdaptiveFeedbackSample): InfinityScaleAdaptiveFeedbackSummary {
    if (!Number.isFinite(sample.error) || sample.error < 0) throw new Error("Adaptive feedback error must be finite and non-negative");
    this.errors.push({ epoch: sample.epoch, error: sample.error });
    this.errors.sort((a, b) => a.epoch - b.epoch);

    const p = sample.pipeline;
    const record: InfinityScaleAdaptiveTelemetryRecord = {
      epoch: sample.epoch,
      stateRevision: sample.stateRevision,
      topologyRevision: sample.topologyRevision,
      mutationCount: p.mutationCount,
      transferCount: p.transferCount,
      deferredNodeCount: p.deferredNodeIds.length,
      conservationValid: p.transaction.reasons.every(r => !r.includes("conservation")),
      gpuComplete: p.gpuCompletion ? p.gpuCompletion.allRequiredCompleted : false,
      executable: p.executable,
      commitReady: p.commitReady,
      transferPlanHash: p.transferPlanHash,
      graphHash: p.graphHash,
      gpuPlanHash: p.gpuPlanHash,
      pipelineHash: p.pipelineHash,
    };
    this.telemetry.record(record);
    return this.summary();
  }

  observePostCommit(observation: InfinityScaleAdaptivePostCommitObservation): void {
    if (!Number.isInteger(observation.epoch) || observation.epoch < 0) throw new Error("Post-commit epoch must be a non-negative integer");
    if (!Number.isFinite(observation.errorBefore) || !Number.isFinite(observation.errorAfter)) throw new Error("Post-commit errors must be finite");
    if (observation.lodByRegion && Object.keys(observation.lodByRegion).some(key => !Number.isInteger(observation.lodByRegion[key]) || observation.lodByRegion[key] < 0)) {
      throw new Error("Post-commit LOD state must contain non-negative integer levels");
    }
    this.postCommit.push({ ...observation, lodByRegion: { ...observation.lodByRegion } });
    this.postCommit.sort((a, b) => a.epoch - b.epoch);
  }

  getPostCommitObservations(): InfinityScaleAdaptivePostCommitObservation[] {
    return this.postCommit.map(observation => ({ ...observation, lodByRegion: { ...observation.lodByRegion } }));
  }

  getTelemetry(): InfinityScaleAdaptiveTelemetryRecorder { return this.telemetry; }

  getErrorHistory(): Array<{ epoch: number; error: number }> {
    return this.errors.map(sample => ({ ...sample }));
  }

  summary(): InfinityScaleAdaptiveFeedbackSummary {
    const records = this.telemetry.list();
    const meanError = this.errors.length === 0 ? 0 : this.errors.reduce((sum, item) => sum + item.error, 0) / this.errors.length;
    const first = this.errors[0]?.error ?? 0;
    const last = this.errors[this.errors.length - 1]?.error ?? 0;
    const firstEpoch = this.errors[0]?.epoch ?? 0;
    const lastEpoch = this.errors[this.errors.length - 1]?.epoch ?? firstEpoch;
    const errorTrend = lastEpoch === firstEpoch ? 0 : (last - first) / (lastEpoch - firstEpoch);
    return {
      epochs: records.length,
      meanError,
      lastError: last,
      errorTrend,
      executableRate: rate(records, r => r.executable),
      commitReadyRate: rate(records, r => r.commitReady),
      committedRate: this.postCommit.length === 0 ? 0 : this.postCommit.filter(r => r.committed).length / this.postCommit.length,
      gpuCompletionRate: rate(records, r => r.gpuComplete),
      deferredRate: rate(records, r => r.deferredNodeCount > 0),
      telemetryHash: this.telemetry.summarize().telemetryHash,
    };
  }
}

function rate<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.length === 0 ? 0 : items.filter(predicate).length / items.length;
}
