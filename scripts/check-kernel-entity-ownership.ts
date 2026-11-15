import assert from "node:assert/strict";
import { ComponentStore, createComponent } from "../src/kernel/Component";
import { World } from "../src/kernel/World";

interface AgentState {
  profile: {
    energy: number;
    traits: string[];
  };
}

const world = new World(17);
const entity = world.createEntity("agent:stable-1");
const liveComponent = createComponent<AgentState>("agent-state", {
  profile: {
    energy: 100,
    traits: ["adaptive"],
  },
}, 3);
world.setComponent(entity.id, liveComponent);

const entitySnapshot = entity.snapshot();
assert.equal(entitySnapshot.id, "agent:stable-1");
assert.equal(entitySnapshot.components.length, 1);
const entitySnapshotComponent = entitySnapshot.components[0] as typeof liveComponent;
assert.notEqual(entitySnapshotComponent, liveComponent);
assert.notEqual(entitySnapshotComponent.state, liveComponent.state);
assert.notEqual(entitySnapshotComponent.state.profile, liveComponent.state.profile);
assert.notEqual(entitySnapshotComponent.state.profile.traits, liveComponent.state.profile.traits);

liveComponent.state.profile.energy = 40;
liveComponent.state.profile.traits.push("mutated-live");
assert.equal(entitySnapshotComponent.state.profile.energy, 100,
  "live ECS component edits must not mutate an already captured Entity snapshot");
assert.deepEqual(entitySnapshotComponent.state.profile.traits, ["adaptive"],
  "nested arrays must be detached from the live ECS component");

entitySnapshotComponent.state.profile.energy = 5;
entitySnapshotComponent.state.profile.traits.push("mutated-snapshot");
assert.equal(liveComponent.state.profile.energy, 40,
  "mutating an Entity snapshot must not mutate the live ECS component");
assert.deepEqual(liveComponent.state.profile.traits, ["adaptive", "mutated-live"]);

const store = new ComponentStore();
store.set(entity.id, liveComponent);
const storeSnapshot = store.snapshot();
const storeSnapshotComponent = storeSnapshot.get("agent-state")?.get(entity.id) as typeof liveComponent;
assert.ok(storeSnapshotComponent);
assert.notEqual(storeSnapshotComponent, liveComponent);
assert.notEqual(storeSnapshotComponent.state.profile, liveComponent.state.profile);

liveComponent.state.profile.energy = 25;
assert.equal(storeSnapshotComponent.state.profile.energy, 40,
  "later live component writes must not mutate a ComponentStore snapshot");

storeSnapshotComponent.state.profile.energy = 7;
assert.equal(liveComponent.state.profile.energy, 25,
  "mutating a ComponentStore snapshot must not mutate the live component");

store.set(entity.id, createComponent("health", { value: 1 }));
assert.equal(storeSnapshot.has("health"), false,
  "later component registrations must not alter the snapshot's component map");

const stateHashBeforeSnapshotMutation = world.stateHash();
entitySnapshotComponent.state.profile.energy = 999;
assert.equal(world.stateHash(), stateHashBeforeSnapshotMutation,
  "mutating a detached entity snapshot must not alter the authoritative world hash");

console.log("ECS entity and component-store deep snapshot ownership: PASS");
