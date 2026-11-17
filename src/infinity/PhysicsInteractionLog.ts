import type { PhysicsInteractionRecord } from './PhysicsInteractionRecord'

function cloneRecord(record: PhysicsInteractionRecord): PhysicsInteractionRecord {
  return structuredClone(record)
}

export class PhysicsInteractionLog {
  #records: PhysicsInteractionRecord[] = []
  readonly #maxRecords: number

  constructor(maxRecords = 5000) {
    this.#maxRecords = Number.isFinite(maxRecords) ? Math.max(1, Math.floor(maxRecords)) : 5000
    Object.freeze(this)
  }

  add(record: PhysicsInteractionRecord) {
    this.#records.push(cloneRecord(record))
    if (this.#records.length > this.#maxRecords) {
      this.#records.splice(0, this.#records.length - this.#maxRecords)
    }
  }

  recent(limit = 100) {
    return this.#records.slice(Math.max(0, this.#records.length - limit)).map(cloneRecord)
  }

  byParticle(index: number) {
    return this.#records.filter(record => record.particleIndex === index).map(cloneRecord)
  }

  byObject(objectId: string) {
    return this.#records.filter(record => record.objectId === objectId).map(cloneRecord)
  }

  clear() {
    this.#records = []
  }

  get size() {
    return this.#records.length
  }

  snapshot() {
    return this.#records.map(cloneRecord)
  }
}
