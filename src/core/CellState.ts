export const CELL_FIELDS = 24 as const;

export const F = {
  ENERGY: 0, DENSITY: 1, INFORMATION: 2, ENTROPY: 3, TEMPERATURE: 4, PRESSURE: 5,
  FIELD_X: 6, FIELD_Y: 7, FIELD_Z: 8, LOCAL_TIME: 9, CAUSALITY_ID: 10,
  BIO_POTENTIAL: 11, WAVE_PHASE: 12, WAVE_AMP: 13, GRAVITY_POT: 14,
  MATERIAL_ID: 15, CHEM_STATE: 16, SIGNAL: 17, MEM_FIELD: 18, AGENT_MARK: 19,
  ENTITY_ID: 20, SPARE_1: 21, SPARE_2: 22, SPARE_3: 23,
} as const;
export type FieldKey = keyof typeof F;

export class CellState {
  #buffer: Float32Array;
  #offset: number;
  #onMutation?: () => void;
  constructor(buffer: Float32Array, offset: number, onMutation?: () => void) {
    this.#buffer = buffer; this.#offset = offset; this.#onMutation = onMutation;
  }
  get(field: number): number { return this.#buffer[this.#offset + field]; }
  set(field: number, value: number): void {
    this.#buffer[this.#offset + field] = value;
    this.#onMutation?.();
  }
  get energy() { return this.get(F.ENERGY); }
  get density() { return this.get(F.DENSITY); }
  get information() { return this.get(F.INFORMATION); }
  get entropy() { return this.get(F.ENTROPY); }
  get temperature() { return this.get(F.TEMPERATURE); }
  get pressure() { return this.get(F.PRESSURE); }
  get fieldX() { return this.get(F.FIELD_X); }
  get fieldY() { return this.get(F.FIELD_Y); }
  get fieldZ() { return this.get(F.FIELD_Z); }
  get localTime() { return this.get(F.LOCAL_TIME); }
  get causalityId() { return this.get(F.CAUSALITY_ID); }
  get bioPotential() { return this.get(F.BIO_POTENTIAL); }
  get materialId() { return this.get(F.MATERIAL_ID); }
  get chemState() { return this.get(F.CHEM_STATE); }
  get signal() { return this.get(F.SIGNAL); }
  get memField() { return this.get(F.MEM_FIELD); }
  get agentMark() { return this.get(F.AGENT_MARK); }
  get entityId() { return this.get(F.ENTITY_ID); }
  set energy(v: number) { this.set(F.ENERGY, v); }
  set density(v: number) { this.set(F.DENSITY, v); }
  set information(v: number) { this.set(F.INFORMATION, v); }
  set entropy(v: number) { this.set(F.ENTROPY, v); }
  set temperature(v: number) { this.set(F.TEMPERATURE, v); }
  set pressure(v: number) { this.set(F.PRESSURE, v); }
  set localTime(v: number) { this.set(F.LOCAL_TIME, v); }
  set causalityId(v: number) { this.set(F.CAUSALITY_ID, v); }
  set bioPotential(v: number) { this.set(F.BIO_POTENTIAL, v); }
  set materialId(v: number) { this.set(F.MATERIAL_ID, v); }
  set chemState(v: number) { this.set(F.CHEM_STATE, v); }
  set signal(v: number) { this.set(F.SIGNAL, v); }
  set memField(v: number) { this.set(F.MEM_FIELD, v); }
  set agentMark(v: number) { this.set(F.AGENT_MARK, v); }
  set entityId(v: number) { this.set(F.ENTITY_ID, v); }
  isEmpty(): boolean {
    return this.energy < 0.001 && this.density < 0.001 && this.temperature < 0.1;
  }
}
