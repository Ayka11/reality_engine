import assert from "node:assert/strict";
import { GlobalEntityIdentityRegistry } from "../src/entity/GlobalEntityIdentityRegistry";

const registry = new GlobalEntityIdentityRegistry();
assert.equal("domains" in registry, false,
  "registry domain storage must not be reachable through a TypeScript-private property");
assert.equal("_revision" in registry, false,
  "registry revision storage must not be reachable through a TypeScript-private property");
assert.equal(Reflect.set(registry, "domains", new Map()), false,
  "registry domain storage must reject ordinary JavaScript shadow properties");
assert.equal(Reflect.set(registry, "_revision", -1), false,
  "registry revision must reject ordinary JavaScript shadow properties");
assert.throws(() => Object.defineProperty(registry, "domains", { value: new Map() }), TypeError);
assert.throws(() => Object.defineProperty(registry, "_revision", { value: -1 }), TypeError);
registry.replaceDomains([
  {
    domain: "simulation-entity",
    entries: [
      { id: 1, kind: "mature" },
      { id: "1", kind: "imported-legacy-id" },
    ],
  },
  {
    domain: "infinite-world-object",
    entries: [{ id: "1", kind: "tree" }],
  },
  {
    domain: "simulation-agent",
    entries: [{ id: 1, kind: "explorer" }],
  },
]);

const first = registry.snapshot();
assert.equal(first.entries.length, 4);
assert.equal(first.domains.length, 3);
assert.equal(new Set(first.entries.map(entry => entry.identityKey)).size, 4,
  "same local IDs in separate domains and different ID types must have unique namespaced keys");
assert.notEqual(
  registry.get("simulation-entity", 1)?.identityKey,
  registry.get("simulation-entity", "1")?.identityKey,
  "numeric and string local IDs must remain distinct within a domain",
);
assert.notEqual(
  registry.get("simulation-entity", 1)?.identityKey,
  registry.get("infinite-world-object", "1")?.identityKey,
  "equal local IDs in different source domains must not collide",
);
assert.equal(registry.get("simulation-agent", 1)?.kind, "explorer");
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.entries));
assert.ok(Object.isFrozen(first.entries[0]));

const unchangedRevision = registry.revision;
registry.replaceDomains([
  {
    domain: "simulation-entity",
    entries: [
      { id: 1, kind: "mature" },
      { id: "1", kind: "imported-legacy-id" },
    ],
  },
  {
    domain: "infinite-world-object",
    entries: [{ id: "1", kind: "tree" }],
  },
  {
    domain: "simulation-agent",
    entries: [{ id: 1, kind: "explorer" }],
  },
]);
assert.equal(registry.revision, unchangedRevision,
  "publishing unchanged complete inventories must not advance the directory revision");

registry.replaceDomain("simulation-entity", [
  { id: 1, kind: "mature" },
  { id: "1", kind: "imported-legacy-id" },
]);
assert.equal(registry.revision, unchangedRevision,
  "publishing an unchanged subset of source domains must not advance the directory revision");

const beforeRejectedUpdate = registry.snapshot();
assert.throws(() => registry.replaceDomains([
  {
    domain: "simulation-entity",
    entries: [
      { id: 1, kind: "mature" },
      { id: 1, kind: "duplicate" },
    ],
  },
  {
    domain: "new-domain",
    entries: [{ id: "will-not-commit", kind: "fixture" }],
  },
]), /Duplicate local entity ID/);
assert.deepEqual(registry.snapshot(), beforeRejectedUpdate,
  "invalid identity in one source must reject the entire multi-domain publication");

const delimiterSafe = new GlobalEntityIdentityRegistry();
delimiterSafe.replaceDomains([
  { domain: "a|1:b", entries: [{ id: "c|3:d", kind: "first" }] },
  { domain: "a", entries: [{ id: "1:b|c|3:d", kind: "second" }] },
]);
assert.equal(new Set(delimiterSafe.snapshot().entries.map(entry => entry.identityKey)).size, 2,
  "length-prefixed identity encoding must remain collision-safe for delimiter-containing values");

const previousRevision = registry.revision;
registry.replaceDomain("infinite-world-object", []);
assert.equal(registry.revision, previousRevision + 1,
  "a complete source inventory that removes an entity must advance the registry revision");
assert.equal(registry.get("infinite-world-object", "1"), undefined);
assert.equal(registry.snapshot().domains.find(domain => domain.domain === "infinite-world-object")?.count, 0);

assert.equal(registry.clearDomain("simulation-agent"), true);
assert.equal(registry.get("simulation-agent", 1), undefined);
assert.equal(registry.clearDomain("simulation-agent"), false);
console.log("Global entity identity directory namespace, atomicity and revision contracts: PASS");
