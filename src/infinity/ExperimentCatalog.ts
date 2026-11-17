import type { ExperimentSnapshot } from './ExperimentRunner'

function cloneExperiment(snapshot: ExperimentSnapshot): ExperimentSnapshot {
  return structuredClone(snapshot)
}

export class ExperimentCatalog {
  #snapshots = new Map<string, ExperimentSnapshot>()

  constructor() { Object.freeze(this) }

  add(snapshot: ExperimentSnapshot) {
    const id = snapshot.protocol.experimentId
    const committed = cloneExperiment(snapshot)
    this.#snapshots.set(id, committed)
    return cloneExperiment(committed)
  }

  addMany(snapshots: Iterable<ExperimentSnapshot>) {
    for (const snapshot of snapshots) this.add(snapshot)
    return this.list()
  }

  get(experimentId: string) {
    const snapshot = this.#snapshots.get(experimentId)
    return snapshot ? cloneExperiment(snapshot) : undefined
  }

  getByFingerprint(fingerprint: string) {
    const snapshot = [...this.#snapshots.values()].find(snapshot => snapshot.fingerprint === fingerprint)
    return snapshot ? cloneExperiment(snapshot) : undefined
  }

  list() {
    return [...this.#snapshots.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(cloneExperiment)
  }

  recent(limit = 20) {
    return this.list().slice(-Math.max(0, limit))
  }

  filter(predicate: (snapshot: ExperimentSnapshot) => boolean) {
    return this.list().filter(predicate).map(cloneExperiment)
  }

  remove(experimentId: string) {
    return this.#snapshots.delete(experimentId)
  }

  clear() {
    this.#snapshots.clear()
  }

  get size() {
    return this.#snapshots.size
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
