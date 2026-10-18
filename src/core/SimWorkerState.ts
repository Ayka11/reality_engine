export interface XorShift32Result {
  state: number;
  value: number;
}

/** Advance a non-zero uint32 xorshift state exactly once. */
export function nextXorShift32(state: number): XorShift32Result {
  if (!Number.isSafeInteger(state) || state <= 0 || state > 0xffffffff) {
    throw new Error("Invalid xorshift32 state");
  }
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const nextState = x >>> 0;
  if (nextState === 0) throw new Error("xorshift32 reached the forbidden zero state");
  return { state: nextState, value: nextState / 0x100000000 };
}


export interface SimWorkerCausalEvent {
  id: number;
  tick: number;
  x: number;
  y: number;
  z: number;
  delta: number;
}

/** Validate causal history before a worker snapshot is allowed to mutate live state. */
export function isValidSimWorkerCausalHistory(
  causal: unknown,
  evCount: number,
  snapshotTick: number,
  width: number,
  height: number,
  depth: number,
): causal is SimWorkerCausalEvent[] {
  if (!Array.isArray(causal) || causal.length > 400 ||
      !Number.isSafeInteger(evCount) || evCount < 0 ||
      !Number.isSafeInteger(snapshotTick) || snapshotTick < 0) return false;

  return causal.every((event: unknown, index: number) => {
    if (!event || typeof event !== "object") return false;
    const item = event as Record<string, unknown>;
    const previous = index > 0 ? causal[index - 1] as SimWorkerCausalEvent : null;
    return Number.isSafeInteger(item.id) && (item.id as number) > 0 &&
      (item.id as number) <= evCount &&
      Number.isSafeInteger(item.tick) && (item.tick as number) >= 0 &&
      (item.tick as number) <= snapshotTick &&
      (!previous || (item.id as number) > previous.id) &&
      [item.x, item.y, item.z, item.delta].every(value => typeof value === "number" && Number.isFinite(value)) &&
      Number.isInteger(item.x) && (item.x as number) >= 0 && (item.x as number) < width &&
      Number.isInteger(item.y) && (item.y as number) >= 0 && (item.y as number) < height &&
      Number.isInteger(item.z) && (item.z as number) >= 0 && (item.z as number) < depth;
  });
}
