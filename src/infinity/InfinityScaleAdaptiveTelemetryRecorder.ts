export interface InfinityScaleAdaptiveTelemetryRecord {
  epoch: number;
  stateRevision: number;
  topologyRevision: number;
  mutationCount: number;
  transferCount: number;
  deferredNodeCount: number;
  conservationValid: boolean;
  gpuComplete: boolean;
  executable: boolean;
  commitReady: boolean;
  transferPlanHash: string;
  graphHash: string;
  gpuPlanHash: string;
  pipelineHash: string;
}

export interface InfinityScaleAdaptiveTelemetrySummary {
  epochs: number;
  executableEpochs: number;
  commitReadyEpochs: number;
  conservationFailures: number;
  gpuIncompleteEpochs: number;
  deferredEpochs: number;
  deterministic: boolean;
  records: InfinityScaleAdaptiveTelemetryRecord[];
  telemetryHash: string;
}

export class InfinityScaleAdaptiveTelemetryRecorder {
  private readonly records: InfinityScaleAdaptiveTelemetryRecord[] = [];

  record(input: InfinityScaleAdaptiveTelemetryRecord): void {
    if (this.records.some(record => record.epoch === input.epoch)) {
      throw new Error(`Adaptive telemetry epoch already recorded: ${input.epoch}`);
    }
    this.records.push({ ...input });
    this.records.sort((a, b) => a.epoch - b.epoch);
  }

  list(): InfinityScaleAdaptiveTelemetryRecord[] {
    return this.records.map(record => ({ ...record }));
  }

  summarize(): InfinityScaleAdaptiveTelemetrySummary {
    const records = this.list();
    return {
      epochs: records.length,
      executableEpochs: records.filter(record => record.executable).length,
      commitReadyEpochs: records.filter(record => record.commitReady).length,
      conservationFailures: records.filter(record => !record.conservationValid).length,
      gpuIncompleteEpochs: records.filter(record => !record.gpuComplete).length,
      deferredEpochs: records.filter(record => record.deferredNodeCount > 0).length,
      deterministic: this.isDeterministic(),
      records,
      telemetryHash: stableHash(JSON.stringify(records)),
    };
  }

  isDeterministic(): boolean {
    return this.records.every(record =>
      record.transferPlanHash.length > 0 &&
      record.graphHash.length > 0 &&
      record.gpuPlanHash.length > 0 &&
      record.pipelineHash.length > 0,
    );
  }

  clear(): void {
    this.records.length = 0;
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
