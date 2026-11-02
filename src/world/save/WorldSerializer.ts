import { CELL_FIELDS, F } from '../../core/CellState';

export const FIELD_ORDER = [
  'energy', 'density', 'information', 'entropy', 'temperature', 'pressure',
  'fieldX', 'fieldY', 'fieldZ', 'localTime', 'causalityId', 'bioPotential',
  'wavePhase', 'waveAmp', 'gravityPot', 'materialId', 'chemState', 'signal',
  'memory', 'agentMark', 'entityId', 'velocityX', 'velocityY', 'velocityZ',
] as const;

const FIELD_INDEX: Record<(typeof FIELD_ORDER)[number], number> = {
  energy: F.ENERGY, density: F.DENSITY, information: F.INFORMATION,
  entropy: F.ENTROPY, temperature: F.TEMPERATURE, pressure: F.PRESSURE,
  fieldX: F.FIELD_X, fieldY: F.FIELD_Y, fieldZ: F.FIELD_Z,
  localTime: F.LOCAL_TIME, causalityId: F.CAUSALITY_ID, bioPotential: F.BIO_POTENTIAL,
  wavePhase: F.WAVE_PHASE, waveAmp: F.WAVE_AMP, gravityPot: F.GRAVITY_POT,
  materialId: F.MATERIAL_ID, chemState: F.CHEM_STATE, signal: F.SIGNAL,
  memory: F.MEM_FIELD, agentMark: F.AGENT_MARK, entityId: F.ENTITY_ID,
  velocityX: F.VELOCITY_X, velocityY: F.VELOCITY_Y, velocityZ: F.VELOCITY_Z,
};
const VELOCITY_FIELDS = ['velocityX', 'velocityY', 'velocityZ'] as const;
const LEGACY_VELOCITY_FIELDS = ['spare1', 'spare2', 'spare3'] as const;

function resolveVelocitySources(fields: Record<string, ArrayBuffer>): Record<(typeof VELOCITY_FIELDS)[number], ArrayBuffer> {
  const currentCount = VELOCITY_FIELDS.filter(name => fields[name] !== undefined).length;
  const legacyCount = LEGACY_VELOCITY_FIELDS.filter(name => fields[name] !== undefined).length;
  if (currentCount === 3 && legacyCount === 0) return { velocityX: fields.velocityX, velocityY: fields.velocityY, velocityZ: fields.velocityZ };
  if (currentCount === 0 && legacyCount === 3) return { velocityX: fields.spare1, velocityY: fields.spare2, velocityZ: fields.spare3 };
  throw new Error('World snapshot velocity fields must be a complete current or legacy triple');
}
function copyBuffer(array: Float32Array): ArrayBuffer {
  const copy = new Float32Array(array.length);
  copy.set(array);
  return copy.buffer;
}
export class WorldSerializer {
  captureAllFields(buffer: Float32Array): Record<string, ArrayBuffer> {
    if (!(buffer instanceof Float32Array) || buffer.length % CELL_FIELDS !== 0) throw new Error('World capture buffer has an invalid cell-field layout');
    const cellCount = buffer.length / CELL_FIELDS;
    const fields: Record<string, ArrayBuffer> = {};
    for (const name of FIELD_ORDER) {
      const field = new Float32Array(cellCount), index = FIELD_INDEX[name];
      for (let i = 0; i < cellCount; i++) field[i] = buffer[i * CELL_FIELDS + index];
      fields[name] = field.buffer;
    }
    return fields;
  }
  flattenFields(fields: Record<string, ArrayBuffer>, cellCount?: number): ArrayBuffer {
    const first = new Float32Array(fields.energy ?? fields[FIELD_ORDER[0]]);
    const count = cellCount ?? first.length;
    const velocitySources = resolveVelocitySources(fields);
    const buffer = new Float32Array(count * CELL_FIELDS);
    for (const name of FIELD_ORDER) {
      const sourceBuffer = name === 'velocityX' || name === 'velocityY' || name === 'velocityZ' ? velocitySources[name] : fields[name];
      if (!sourceBuffer) continue;
      const source = new Float32Array(sourceBuffer), index = FIELD_INDEX[name];
      for (let i = 0; i < Math.min(count, source.length); i++) buffer[i * CELL_FIELDS + index] = source[i];
    }
    return copyBuffer(buffer);
  }
  applyFields(fields: Record<string, ArrayBuffer>, target: Float32Array): void {
    if (!(target instanceof Float32Array) || target.length % CELL_FIELDS !== 0) throw new Error('World snapshot target buffer has an invalid cell-field layout');
    if (!fields || typeof fields !== 'object') throw new Error('World snapshot fields must be an object');
    const velocitySources = resolveVelocitySources(fields);
    const count = target.length / CELL_FIELDS;
    for (const name of FIELD_ORDER) {
      const sourceBuffer = name === 'velocityX' || name === 'velocityY' || name === 'velocityZ' ? velocitySources[name] : fields[name];
      if (!(sourceBuffer instanceof ArrayBuffer) || sourceBuffer.byteLength !== count * Float32Array.BYTES_PER_ELEMENT) {
        throw new Error(`World snapshot field "${name}" has an invalid buffer size`);
      }
      if (!new Float32Array(sourceBuffer).every(Number.isFinite)) throw new Error(`World snapshot field "${name}" contains non-finite values`);
    }
    const restored = new Float32Array(this.flattenFields(fields, count));
    if (restored.length !== target.length) throw new Error(`World snapshot field size mismatch: ${restored.length} != ${target.length}.`);
    target.set(restored);
  }
  fieldsFromFlatBuffer(buffer: ArrayBuffer): Record<string, ArrayBuffer> {
    return this.captureAllFields(new Float32Array(buffer));
  }
}
