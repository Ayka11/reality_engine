import assert from 'node:assert/strict';
import { AgentSystem } from '../src/simulation/AgentSystem.ts';
import { F } from '../src/core/CellState.ts';
import { SimulationEngine } from '../src/simulation/SimulationEngine.ts';
import type { ChemLayerSnapshot } from '../src/chemistry/ChemLayer.ts';

const engine = new SimulationEngine(16, 16, 8);
const chemistry = (engine as unknown as { chemLayer: { restore(snapshot: ChemLayerSnapshot, cellCount?: number): void; snapshot(): ChemLayerSnapshot } }).chemLayer;
chemistry.restore({ pendingDensityTransfers: [[17, -0.125], [31, 0.25]] }, engine.grid.size);
const fieldIndex = engine.grid.idx(7, 7, 3) + F.ENERGY;
engine.grid.buffer[fieldIndex] = 125;
engine.grid.backBuffer[fieldIndex] = 87;
engine.grid.syncDenseToChunks();
engine.agents.seed(engine.grid, 1);
const initialAgent = engine.agents.getAgents()[0];
assert.ok(initialAgent, 'seeded recovery fixture must create an agent');
const agentId = initialAgent.id;
initialAgent.energy = 210;
engine.grid.syncDenseToChunks();
engine.restoreTick(12);
engine.laws.setLawOverride('law_radiation', 'on');
engine.laws.toggleProcess(27, false);
engine.recorder.startRecording();
engine.causal.log(12, 1, 1, 1, 21, 'energy_spike', 45);
engine.worldEvents.trigger(engine.grid, 'meteor_strike', 12);
engine.grid.syncDenseToChunks();

// The local law RNG and generated IDs must replay from an identical snapshot.
const lawSnapshot = engine.laws.snapshot();
const firstMutation = engine.laws.spawnMutation('law_radiation');
assert.ok(firstMutation);
engine.laws.restore(lawSnapshot);
const replayedMutation = engine.laws.spawnMutation('law_radiation');
assert.deepEqual(replayedMutation, firstMutation, 'LawEngine RNG and mutation state must replay deterministically');

const before = engine.captureCoreRecoveryState();
const expectedLawMask = engine.laws.activeProcessMask;
engine.grid.buffer[fieldIndex] = -10;
engine.grid.backBuffer[fieldIndex] = -20;
engine.agents.getAgents()[0]!.energy = 1;
engine.agents.seed(engine.grid, 1);
engine.restoreTick(99);
engine.laws.setLawOverride('law_radiation', 'off');
engine.laws.toggleProcess(27, true);
engine.recorder.stopRecording();
engine.causal.clear();
engine.worldEvents.trigger(engine.grid, 'meteor_strike', 99);
chemistry.restore({ pendingDensityTransfers: [[9, 0.75]] }, engine.grid.size);

engine.restoreCoreRecoveryState(before);
assert.deepEqual(engine.captureCoreRecoveryState(), before, 'core recovery must restore all included subsystem state');
assert.deepEqual(chemistry.snapshot(), before.chemistry, 'core recovery must restore deferred chemistry boundary transfers');
assert.equal(engine.tick, 12);
assert.equal(engine.grid.buffer[fieldIndex], 125);
assert.equal(engine.grid.backBuffer[fieldIndex], 87);
assert.equal(engine.laws.getLawOverride('law_radiation'), 'on');
assert.equal(engine.laws.activeProcessMask, expectedLawMask);
assert.equal(engine.recorder.recording, true);
assert.equal(engine.causal.recent(1)[0]?.tick, 12);
assert.equal(engine.agents.getAgents().length, 1);
assert.equal(engine.agents.getAgents()[0]?.id, agentId);
assert.equal(engine.agents.getAgents()[0]?.energy, 210);

// Returned snapshots are detached from live mutable data.
const detached = engine.captureCoreRecoveryState();
detached.grid.buffer[fieldIndex] = -999;
detached.prevEnergy.fill(-1);
detached.laws.laws[0]!.name = 'mutated snapshot only';
assert.equal(engine.grid.buffer[fieldIndex], 125);
assert.notEqual(engine.laws.laws[0]?.name, 'mutated snapshot only');

// Invalid nested state must be rejected without leaving a partial restore behind.
const invalid = engine.captureCoreRecoveryState();
invalid.grid.width += 1;
const beforeInvalidRestore = engine.captureCoreRecoveryState();
assert.throws(() => engine.restoreCoreRecoveryState(invalid), /Invalid SparseVoxelGrid snapshot/);
assert.deepEqual(engine.captureCoreRecoveryState(), beforeInvalidRestore,
  'failed restore must roll back grid, entities, agents, laws, events, causal graph and recorder');
// Clearing a population is a deterministic reset boundary for its local RNG.
const resetSeed = 0x12345678;
const advancedRngState = 0x76543210;
const resetAgents = new AgentSystem(resetSeed);
resetAgents.seed(engine.grid, 2);
const populatedAgentSnapshot = resetAgents.snapshot();
assert.equal(populatedAgentSnapshot.agents.length, 2);
resetAgents.restore({ ...populatedAgentSnapshot, rngState: advancedRngState });
resetAgents.clear();
const clearedAgents = resetAgents.snapshot();
assert.equal(clearedAgents.rngState, resetSeed, 'AgentSystem.clear must rewind its local RNG to the constructor seed');
assert.equal(clearedAgents.nextAgentId, 1, 'AgentSystem.clear must reset the identity allocator');
assert.equal(clearedAgents.agents.length, 0, 'AgentSystem.clear must remove all agents');

console.log('SimulationEngine core recovery and deterministic LawEngine replay: PASS');
