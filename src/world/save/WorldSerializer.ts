import { CELL_FIELDS, F } from '../../core/CellState';

export const FIELD_ORDER = [
  'energy',
  'density',
  'information',
  'entropy',
  'temperature',
  'pressure',
  'fieldX',
  'fieldY',
  'fieldZ',
  'localTime',
  'causalityId',
  'bioPotential',
  'wavePhase',
  'waveAmp',
  'gravityPot',
  'materialId',
  'chemState',
  'signal',
  'memory',
  'agentMark',
  'entityId',
  'spare1',
  'spare2',
  'spare3',
] as const;

const FIELD_INDEX: Record<(typeof FIELD_ORDER)[number], number> = {
  energy: F.ENERGY,
  density: F.DENSITY,
  information: F.INFORMATION,
  entropy: F.ENTROPY,
  temperature: F.TEMPERATURE,
  pressure: F.PRESSURE,
  fieldX: F.FIELD_X,
  fieldY: F.FIELD_Y,
  fieldZ: F.FIELD_Z,
  localTime: F.LOCAL_TIME,
  causalityId: F.CAUSALITY_ID,
  bioPotential: F.BIO_POTENTIAL,
  wavePhase: F.WAVE_PHASE,
  waveAmp: F.WAVE_AMP,
  gravityPot: F.GRAVITY_POT,
  materialId: F.MATERIAL_ID,
  chemState: F.CHEM_STATE,
  signal: F.SIGNAL,
  memory: F.MEM_FIELD,
  agentMark: F.AGENT_MARK,
  entityId: F.ENTITY_ID,
  spare1: F.SPARE_1,
  spare2: F.SPARE_2,
  spare3: F.SPARE_3,
};

function copyBuffer(array: Float32Array): ArrayBuffer {
  const copy = new Float32Array(array.length);
  copy.set(array);
  return copy.buffer;
}

export class WorldSerializer {
  captureAllFields(buffer: Float32Array): Record<string, ArrayBuffer> {
    const cellCount = Math.floor(buffer.length / CELL_FIELDS);
    const fields: Record<string, ArrayBuffer> = {};

    for (const name of FIELD_ORDER) {
      const field = new Float32Array(cellCount);
      const fieldIndex = FIELD_INDEX[name];
      for (let i = 0; i < cellCount; i++) field[i] = buffer[i * CELL_FIELDS + fieldIndex];
      fields[name] = field.buffer;
    }

    return fields;
  }

  flattenFields(fields: Record<string, ArrayBuffer>, cellCount?: number): ArrayBuffer {
    const first = new Float32Array(fields.energy ?? fields[FIELD_ORDER[0]]);
    const count = cellCount ?? first.length;
    const buffer = new Float32Array(count * CELL_FIELDS);

    for (const name of FIELD_ORDER) {
      const sourceBuffer = fields[name];
      if (!sourceBuffer) continue;
      const source = new Float32Array(sourceBuffer);
      const fieldIndex = FIELD_INDEX[name];
      for (let i = 0; i < Math.min(count, source.length); i++) buffer[i * CELL_FIELDS + fieldIndex] = source[i];
    }

    return copyBuffer(buffer);
  }

  applyFields(fields: Record<string, ArrayBuffer>, target: Float32Array): void {
    const restored = new Float32Array(this.flattenFields(fields, Math.floor(target.length / CELL_FIELDS)));
    if (restored.length !== target.length) {
      throw new Error(`World snapshot field size mismatch: ${restored.length} != ${target.length}.`);
    }
    target.set(restored);
  }

  fieldsFromFlatBuffer(buffer: ArrayBuffer): Record<string, ArrayBuffer> {
    return this.captureAllFields(new Float32Array(buffer));
  }
}
