import type { ExperimentSnapshot } from './ExperimentRunner'

export class ExperimentCatalog {
  private snapshots = new Map<string, ExperimentSnapshot>()

  add(snapshot: ExperimentSnapshot) {
    const id = snapshot.protocol.experimentId
    this.snapshots.set(id, snapshot)
    return snapshot
  }

  addMany(snapshots: Iterable<ExperimentSnapshot>) {
    for (const snapshot of snapshots) this.add(snapshot)
    return this.list()
  }

  get(experimentId: string) {
    return this.snapshots.get(experimentId)
  }

  getByFingerprint(fingerprint: string) {
    return [...this.snapshots.values()].find(snapshot => snapshot.fingerprint === fingerprint)
  }

  list() {
    return [...this.snapshots.values()].sort(
      (a, b) => a.startedAt - b.startedAt,
    )
  }

  recent(limit = 20) {
    return this.list().slice(-Math.max(0, limit))
  }

  filter(predicate: (snapshot: ExperimentSnapshot) => boolean) {
    return this.list().filter(predicate)
  }

  remove(experimentId: string) {
    return this.snapshots.delete(experimentId)
  }

  clear() {
    this.snapshots.clear()
  }

  get size() {
    return this.snapshots.size
  }

  snapshot() {
    return this.list().map(experiment => ({
      experimentId: experiment.protocol.experimentId,
      fingerprint: experiment.fingerprint,
      status: experiment.status,
      startedAt: experiment.startedAt,
      finishedAt: experiment.finishedAt,
      providerId: experiment.protocol.field.providerId,
      providerVersion: experiment.protocol.field.providerVersion,
      worldSeed: experiment.protocol.world.seed,
    }))
  }
}
