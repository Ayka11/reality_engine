import type { PhysicsInteractionRecord } from './PhysicsInteractionRecord'

export class PhysicsInteractionLog {
  private records: PhysicsInteractionRecord[] = []
  constructor(private readonly maxRecords = 5000) {}

  add(record: PhysicsInteractionRecord) {
    this.records.push(record)
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords)
    }
  }

  recent(limit = 100) {
    return this.records.slice(Math.max(0, this.records.length - limit))
  }

  byParticle(index: number) {
    return this.records.filter(record => record.particleIndex === index)
  }

  byObject(objectId: string) {
    return this.records.filter(record => record.objectId === objectId)
  }

  clear() {
    this.records = []
  }

  get size() {
    return this.records.length
  }

  snapshot() {
    return [...this.records]
  }
}
