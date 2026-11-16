export type EntityIdentityLocalId = string | number;

export interface EntityIdentityInput {
  readonly id: EntityIdentityLocalId;
  readonly kind: string;
}

export interface EntityIdentityRecord {
  readonly identityKey: string;
  readonly domain: string;
  readonly localId: EntityIdentityLocalId;
  readonly kind: string;
}

export interface EntityIdentityDomainSummary {
  readonly domain: string;
  readonly count: number;
}

export interface GlobalEntityIdentitySnapshot {
  readonly revision: number;
  readonly domains: readonly EntityIdentityDomainSummary[];
  readonly entries: readonly EntityIdentityRecord[];
}

interface PreparedDomain {
  readonly domain: string;
  readonly entries: ReadonlyMap<string, EntityIdentityRecord>;
}

function encodeSegment(value: string): string {
  return `${value.length}:${value}`;
}

function localIdToken(id: EntityIdentityLocalId): string {
  if (typeof id === "number") {
    if (!Number.isSafeInteger(id)) {
      throw new TypeError("Numeric entity identity IDs must be safe integers");
    }
    return `number:${String(id)}`;
  }
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new TypeError("String entity identity IDs must be non-empty");
  }
  return `string:${encodeSegment(id)}`;
}

function createIdentityRecord(domain: string, input: EntityIdentityInput): EntityIdentityRecord {
  if (typeof domain !== "string" || domain.trim().length === 0) {
    throw new TypeError("Entity identity domain must be a non-empty string");
  }
  if (!input || typeof input !== "object") {
    throw new TypeError("Entity identity entry must be an object");
  }
  const token = localIdToken(input.id);
  if (typeof input.kind !== "string" || input.kind.trim().length === 0) {
    throw new TypeError("Entity identity kind must be a non-empty string");
  }

  const identityKey = `${encodeSegment(domain)}|${encodeSegment(token)}`;
  return Object.freeze({
    identityKey,
    domain,
    localId: input.id,
    kind: input.kind,
  });
}

function sameDomainEntries(
  left: ReadonlyMap<string, EntityIdentityRecord> | undefined,
  right: ReadonlyMap<string, EntityIdentityRecord>,
): boolean {
  if (!left || left.size !== right.size) return false;
  for (const [token, record] of right) {
    const previous = left.get(token);
    if (!previous ||
        previous.identityKey !== record.identityKey ||
        previous.kind !== record.kind ||
        previous.localId !== record.localId) {
      return false;
    }
  }
  return true;
}

function compareLocalIds(a: EntityIdentityLocalId, b: EntityIdentityLocalId): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a !== typeof b) return typeof a === "number" ? -1 : 1;
  return String(a).localeCompare(String(b));
}

/**
 * A read-only identity directory across independently-owned runtime domains.
 *
 * This registry does not own entity state, allocate subsystem IDs, or perform
 * lifecycle mutations. Each source domain remains authoritative; callers
 * publish complete domain inventories atomically through replaceDomains().
 */
export class GlobalEntityIdentityRegistry {
  #domains = new Map<string, ReadonlyMap<string, EntityIdentityRecord>>();
  #revision = 0;

  constructor() {
    // The registry owns its domain map; callers can only publish through the
    // validated methods and read detached immutable snapshots.
    Object.freeze(this);
  }

  get revision(): number {
    return this.#revision;
  }

  replaceDomain(domain: string, inputs: readonly EntityIdentityInput[]): void {
    this.replaceDomains([{ domain, entries: inputs }]);
  }

  /**
   * Atomically replace a set of complete source-domain inventories.
   * Duplicate local IDs are rejected within a domain, while the same local ID
   * is valid in different domains and receives a different identityKey.
   */
  replaceDomains(sources: readonly { domain: string; entries: readonly EntityIdentityInput[] }[]): void {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new TypeError("Global entity identity replacement requires at least one domain");
    }

    const prepared: PreparedDomain[] = [];
    const seenDomains = new Set<string>();
    for (const source of sources) {
      if (!source || typeof source !== "object" ||
          typeof source.domain !== "string" || source.domain.trim().length === 0 ||
          !Array.isArray(source.entries)) {
        throw new TypeError("Global entity identity source is invalid");
      }
      if (seenDomains.has(source.domain)) {
        throw new Error(`Duplicate entity identity domain "${source.domain}" in atomic replacement`);
      }
      seenDomains.add(source.domain);

      const entries = new Map<string, EntityIdentityRecord>();
      for (const input of source.entries) {
        const record = createIdentityRecord(source.domain, input);
        const token = localIdToken(input.id);
        if (entries.has(token)) {
          throw new Error(`Duplicate local entity ID in domain "${source.domain}": ${String(input.id)}`);
        }
        entries.set(token, record);
      }
      prepared.push({ domain: source.domain, entries });
    }

    let changed = false;
    for (const source of prepared) {
      if (!sameDomainEntries(this.#domains.get(source.domain), source.entries)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const next = new Map(this.#domains);
    for (const source of prepared) next.set(source.domain, source.entries);
    this.#domains = next;
    this.#revision += 1;
  }

  clearDomain(domain: string): boolean {
    if (!this.#domains.has(domain)) return false;
    const next = new Map(this.#domains);
    next.delete(domain);
    this.#domains = next;
    this.#revision += 1;
    return true;
  }

  get(domain: string, id: EntityIdentityLocalId): EntityIdentityRecord | undefined {
    return this.#domains.get(domain)?.get(localIdToken(id));
  }

  snapshot(): GlobalEntityIdentitySnapshot {
    const entries = [...this.#domains.values()]
      .flatMap(domainEntries => [...domainEntries.values()])
      .sort((a, b) =>
        a.domain.localeCompare(b.domain) ||
        compareLocalIds(a.localId, b.localId));

    const domains = [...this.#domains.entries()]
      .map(([domain, domainEntries]) => Object.freeze({ domain, count: domainEntries.size }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return Object.freeze({
      revision: this.#revision,
      domains: Object.freeze(domains),
      entries: Object.freeze(entries),
    });
  }
}
