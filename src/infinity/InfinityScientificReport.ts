import type { ExperimentSnapshot } from './ExperimentRunner'
import type { ReplicationStudySummary } from './ReplicationStudy'
import type { CrossDimensionGeneralizationResult, GeneralizationResult, GeneralizationDimension } from './ExperimentGeneralization'
import type { EvidenceClaimGraphSnapshot } from './EvidenceClaimGraph'
import type { ReplicationStatisticalSummary } from './ReplicationStatistics'
import type { ScientificProvenance } from './ScientificProvenance'

export type InfinityScientificReport = {
  schemaVersion: 'infinity-scientific-report-v1'
  reportId: string
  title: string
  generatedAt: string
  protocol: Record<string, unknown>
  experiment: { experimentId: string; completed: boolean; fingerprint: string; results: Record<string, unknown> }
  replication?: { repetitionsRequested: number; repetitionsCompleted: number; repetitionsFailed: number; statisticalSummary: ReplicationStatisticalSummary }
  generalization?: { dimensions: GeneralizationDimension[]; crossDimension: CrossDimensionGeneralizationResult; byDimension: GeneralizationResult[] }
  evidence?: EvidenceClaimGraphSnapshot
  conclusions: string[]
  limitations: string[]
  provenance?: ScientificProvenance
}

export type InfinityScientificReportOptions = { reportId?: string; title?: string; dimensions?: GeneralizationDimension[]; conclusions?: string[]; limitations?: string[] }

export function createInfinityScientificReport(snapshot: ExperimentSnapshot, replication?: ReplicationStudySummary, generalization?: CrossDimensionGeneralizationResult, evidence?: EvidenceClaimGraphSnapshot, options: InfinityScientificReportOptions = {}): InfinityScientificReport {
  const completed = snapshot.status === 'completed'
  const dimensions = generalization?.dimensions ?? []
  const byDimension = generalization?.analyses ?? []
  const limitations = options.limitations ?? [
    'Computational results describe the configured simulation and do not independently establish real-world causal validity.',
    'Replication and generalization conclusions are conditional on the seeds, physics, decision rules, and providers represented in the experiment set.',
    'Confidence intervals summarize observed computational variation; they do not account for model misspecification or unobserved real-world factors.',
  ]
  const conclusions = options.conclusions ?? [
    completed ? 'The configured experiment completed successfully.' : 'The configured experiment did not complete successfully.',
    ...(generalization ? ['Cross-dimension generalization was evaluated across ' + dimensions.length + ' configured dimensions.'] : []),
    ...(replication ? ['Replication completed ' + replication.repetitionsCompleted + ' of ' + replication.repetitionsRequested + ' requested runs.'] : []),
  ]
  return {
    schemaVersion: 'infinity-scientific-report-v1',
    reportId: options.reportId ?? ('infinity-report-' + snapshot.protocol.experimentId),
    title: options.title ?? ('Infinity Scale Report — ' + snapshot.protocol.experimentId),
    generatedAt: new Date().toISOString(),
    protocol: snapshot.protocol as unknown as Record<string, unknown>,
    experiment: { experimentId: snapshot.protocol.experimentId, completed, fingerprint: snapshot.fingerprint, results: { ...snapshot.results } },
    replication: replication ? { repetitionsRequested: replication.repetitionsRequested, repetitionsCompleted: replication.repetitionsCompleted, repetitionsFailed: replication.repetitionsFailed, statisticalSummary: {
      experimentIds: replication.snapshots.filter(item => item.status === 'completed').map(item => item.protocol.experimentId),
      completedExperiments: replication.repetitionsCompleted,
      metrics: Object.fromEntries(Object.entries(replication.metricSummary).map(([metric, summary]) => [metric, {
        n: summary.n, mean: summary.mean, variance: summary.standardDeviation ** 2, standardDeviation: summary.standardDeviation, standardError: summary.n > 1 ? summary.standardDeviation / Math.sqrt(summary.n) : 0, min: summary.min, max: summary.max,
        confidence95: summary.n > 1 ? { lower: summary.mean - 1.96 * (summary.standardDeviation / Math.sqrt(summary.n)), upper: summary.mean + 1.96 * (summary.standardDeviation / Math.sqrt(summary.n)) } : { lower: null, upper: null },
        directionConsistency: null,
      }]))),
    } } : undefined,
    generalization: generalization ? { dimensions, crossDimension: generalization, byDimension } : undefined,
    evidence, conclusions, limitations,
  }
}

export function serializeInfinityScientificReport(report: InfinityScientificReport): string { return JSON.stringify(report, null, 2) }