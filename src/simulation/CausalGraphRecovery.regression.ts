import { CausalGraph, type CausalGraphSnapshot } from "./CausalGraph";

function cloneSnapshot(snapshot: CausalGraphSnapshot): CausalGraphSnapshot {
  return {
    events: snapshot.events.map(event => ({ ...event })),
    nextId: snapshot.nextId,
    lastEventByCell: snapshot.lastEventByCell.map(([cellIndex, eventId]) => [cellIndex, eventId] as [number, number]),
  };
}

export function runCausalGraphRecoveryRegression(): void {
  const graph = new CausalGraph();
  const first = graph.log(1, 1, 2, 3, 7, "energy_spike", 10);
  const second = graph.log(2, 1, 2, 3, 7, "entropy_burst", -2);
  const third = graph.log(3, 2, 2, 3, 8, "info_bloom", 4);
  const snapshot = graph.snapshot();
  const expected = JSON.stringify(snapshot);

  graph.log(4, 4, 2, 3, 7, "phase_transition", 8);
  graph.clear();
  graph.log(99, 0, 0, 0, 99, "bio_emergence", 1);
  graph.restore(snapshot);

  if (JSON.stringify(graph.snapshot()) !== expected) {
    throw new Error("CausalGraph recovery did not restore events, next ID, and last-event index");
  }
  const chain = graph.chainFrom(second.id);
  if (chain.length !== 2 || chain[0].id !== second.id || chain[1].id !== first.id) {
    throw new Error("CausalGraph recovery did not restore event parent relationships");
  }
  if (graph.recent(3).map(event => event.id).join(",") !== [third.id, second.id, first.id].join(",")) {
    throw new Error("CausalGraph recovery did not preserve chronological event history");
  }

  // Snapshots and restored graph state must not alias each other's objects or tuples.
  const detached = graph.snapshot();
  detached.events[0].delta = -999;
  detached.lastEventByCell[0][1] = 0;
  if (graph.snapshot().events[0].delta !== first.delta ||
      graph.snapshot().lastEventByCell[0][1] === 0) {
    throw new Error("CausalGraph snapshot aliases live event or cell-index state");
  }

  runCausalGraphInvalidSnapshotRegression(graph);

  // CausalGraph retains a bounded event history but keeps last-event indexes for
  // cells whose parent event may have aged out; such valid snapshots must restore.
  const truncated = new CausalGraph();
  for (let i = 0; i < 501; i++) {
    truncated.log(i, 0, 0, 0, i, "energy_spike", i);
  }
  const truncatedSnapshot = truncated.snapshot();
  if (truncatedSnapshot.events.length !== 500 ||
      truncatedSnapshot.lastEventByCell[0]?.[1] !== 1) {
    throw new Error("CausalGraph history eviction test did not exercise an aged-out cell event");
  }
  const recoveredTruncated = new CausalGraph();
  recoveredTruncated.restore(truncatedSnapshot);
  if (JSON.stringify(recoveredTruncated.snapshot()) !== JSON.stringify(truncatedSnapshot)) {
    throw new Error("CausalGraph recovery rejected or changed a valid snapshot with evicted history");
  }
}

export function runCausalGraphInvalidSnapshotRegression(graph = new CausalGraph()): void {
  graph.clear();
  graph.log(1, 0, 0, 0, 0, "energy_spike", 1);
  graph.log(2, 0, 0, 0, 0, "entropy_burst", 2);
  const baseline = graph.snapshot();

  const assertRejectedWithoutMutation = (candidate: unknown, label: string): void => {
    const before = JSON.stringify(graph.snapshot());
    let rejected = false;
    try {
      graph.restore(candidate as CausalGraphSnapshot);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`CausalGraph recovery accepted malformed snapshot: ${label}`);
    }
    if (JSON.stringify(graph.snapshot()) !== before) {
      throw new Error(`Rejected CausalGraph snapshot partially mutated live state: ${label}`);
    }
  };

  assertRejectedWithoutMutation(null, "null snapshot");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), nextId: 0 }, "invalid next ID");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), events: null }, "non-array events");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), lastEventByCell: null }, "non-array cell index");

  const tooManyEvents = cloneSnapshot(baseline);
  tooManyEvents.events = Array.from({ length: 501 }, (_, index) => ({
    ...baseline.events[0],
    id: index + 1,
  }));
  assertRejectedWithoutMutation(tooManyEvents, "over-limit event history");

  const duplicateId = cloneSnapshot(baseline);
  duplicateId.events[1].id = duplicateId.events[0].id;
  assertRejectedWithoutMutation(duplicateId, "duplicate event ID");

  const wrongOrder = cloneSnapshot(baseline);
  [wrongOrder.events[0], wrongOrder.events[1]] = [wrongOrder.events[1], wrongOrder.events[0]];
  assertRejectedWithoutMutation(wrongOrder, "non-monotonic event IDs");

  const invalidType = cloneSnapshot(baseline);
  (invalidType.events[0] as unknown as { type: string }).type = "unknown";
  assertRejectedWithoutMutation(invalidType, "invalid event type");

  const nonFiniteDelta = cloneSnapshot(baseline);
  nonFiniteDelta.events[0].delta = Number.NaN;
  assertRejectedWithoutMutation(nonFiniteDelta, "non-finite delta");

  const invalidCoordinate = cloneSnapshot(baseline);
  invalidCoordinate.events[0].x = Number.POSITIVE_INFINITY;
  assertRejectedWithoutMutation(invalidCoordinate, "non-finite coordinate");

  const invalidParent = cloneSnapshot(baseline);
  invalidParent.events[0].parentId = invalidParent.events[1].id;
  assertRejectedWithoutMutation(invalidParent, "parent points to current/future event");

  const idPastNext = cloneSnapshot(baseline);
  idPastNext.events[0].id = idPastNext.nextId;
  assertRejectedWithoutMutation(idPastNext, "event ID not below next ID");

  const invalidCellIndex = cloneSnapshot(baseline);
  (invalidCellIndex.lastEventByCell as unknown as unknown[])[0] = ["not-an-index", 2];
  assertRejectedWithoutMutation(invalidCellIndex, "invalid cell index key");

  const duplicateCellIndex = cloneSnapshot(baseline);
  duplicateCellIndex.lastEventByCell.push([...duplicateCellIndex.lastEventByCell[0]] as [number, number]);
  assertRejectedWithoutMutation(duplicateCellIndex, "duplicate cell index");

  const cellIdPastNext = cloneSnapshot(baseline);
  cellIdPastNext.lastEventByCell[0][1] = cellIdPastNext.nextId;
  assertRejectedWithoutMutation(cellIdPastNext, "cell index event ID not below next ID");
}
