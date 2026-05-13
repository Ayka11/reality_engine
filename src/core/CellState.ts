export const CELL_FIELDS = 16 as const;

export const F = {
  ENERGY:       0,
  DENSITY:      1,
  INFORMATION:  2,
  ENTROPY:      3,
  TEMPERATURE:  4,
  PRESSURE:     5,
  FIELD_X:      6,
  FIELD_Y:      7,
  FIELD_Z:      8,
  LOCAL_TIME:   9,
  CAUSALITY_ID: 10,
  BIO_POTENTIAL:11,
  WAVE_PHASE:   12,
  WAVE_AMP:     13,
  GRAVITY_POT:  14,
  RESERVED:     15,
} as const;

export type FieldKey = keyof typeof F;

export class CellState {
  private buf: Float32Array;
  private offset: number;

  constructor(buf: Float32Array, offset: number) {
    this.buf = buf;
    this.offset = offset;
  }

  get(field: number): number { return this.buf[this.offset + field]; }
  set(field: number, v: number): void { this.buf[this.offset + field] = v; }

  get energy()       { return this.get(F.ENERGY); }
  get density()      { return this.get(F.DENSITY); }
  get information()  { return this.get(F.INFORMATION); }
  get entropy()      { return this.get(F.ENTROPY); }
  get temperature()  { return this.get(F.TEMPERATURE); }
  get pressure()     { return this.get(F.PRESSURE); }
  get fieldX()       { return this.get(F.FIELD_X); }
  get fieldY()       { return this.get(F.FIELD_Y); }
  get fieldZ()       { return this.get(F.FIELD_Z); }
  get localTime()    { return this.get(F.LOCAL_TIME); }
  get causalityId()  { return this.get(F.CAUSALITY_ID); }
  get bioPotential() { return this.get(F.BIO_POTENTIAL); }

  set energy(v: number)      { this.set(F.ENERGY, v); }
  set density(v: number)     { this.set(F.DENSITY, v); }
  set information(v: number) { this.set(F.INFORMATION, v); }
  set entropy(v: number)     { this.set(F.ENTROPY, v); }
  set temperature(v: number) { this.set(F.TEMPERATURE, v); }
  set pressure(v: number)    { this.set(F.PRESSURE, v); }
  set localTime(v: number)   { this.set(F.LOCAL_TIME, v); }
  set causalityId(v: number) { this.set(F.CAUSALITY_ID, v); }
  set bioPotential(v: number){ this.set(F.BIO_POTENTIAL, v); }

  isEmpty(): boolean {
    return this.energy < 0.001 && this.density < 0.001 && this.temperature < 0.1;
  }
}
