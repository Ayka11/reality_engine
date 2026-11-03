import JSZip from 'jszip';
import { deflate, inflate } from 'pako';
import type { RealityPackage } from './RealityPackage';

const TYPED_ARRAY_MARKER = '__realityTypedArray';

function arrayBufferFromUint8(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function packageJsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Float32Array) {
    return { [TYPED_ARRAY_MARKER]: 'Float32Array', values: Array.from(value) };
  }
  return value;
}

function packageJsonReviver(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (candidate[TYPED_ARRAY_MARKER] !== 'Float32Array') return value;
  if (!Array.isArray(candidate.values) ||
      !candidate.values.every(item => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error('Reality package contains an invalid Float32Array payload.');
  }
  return new Float32Array(candidate.values as number[]);
}

export class PackageSerializer {
  constructor(private thumbnailCanvas?: HTMLCanvasElement | null) {}

  async pack(pkg: RealityPackage): Promise<Blob> {
    const zip = new JSZip();

    zip.file('manifest.json', JSON.stringify(pkg.manifest, packageJsonReplacer, 2));
    zip.file('graph.json', JSON.stringify(pkg.graph, packageJsonReplacer, 2));
    zip.file('entities.json', JSON.stringify({
      entities: pkg.entities,
      runtimeEntityLayer: pkg.runtimeEntityLayer,
    }, packageJsonReplacer, 2));
    zip.file('laws-override.json', JSON.stringify({
      laws: pkg.laws,
      lawEngineState: pkg.lawEngineState,
    }, packageJsonReplacer, 2));
    zip.file('processes.json', JSON.stringify(pkg.processes, packageJsonReplacer, 2));
    zip.file('metadata/stats.json', JSON.stringify(pkg.metadata, packageJsonReplacer, 2));

    const compressed = deflate(new Uint8Array(pkg.voxelState));
    zip.file('voxel-state.bin', compressed);

    const thumbnail = await this.captureThumbnail();
    if (thumbnail) zip.file('metadata/thumbnail.png', thumbnail);

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  async unpack(file: File | Blob): Promise<RealityPackage> {
    const zip = await JSZip.loadAsync(file);
    const manifest = await this.readJson(zip, 'manifest.json');
    const graph = await this.readJson(zip, 'graph.json');
    const entityPayload = await this.readJson(zip, 'entities.json');
    const lawPayload = await this.readJson(zip, 'laws-override.json');
    const processes = await this.readJson(zip, 'processes.json');
    const metadata = await this.readJson(zip, 'metadata/stats.json');
    const voxelBin = await zip.file('voxel-state.bin')?.async('uint8array');
    if (!voxelBin) throw new Error('Reality package is missing voxel-state.bin.');

    // Accept legacy package files whose entities/laws roots were arrays.
    const entityEnvelope = Array.isArray(entityPayload)
      ? { entities: entityPayload, runtimeEntityLayer: undefined }
      : entityPayload;
    const lawEnvelope = Array.isArray(lawPayload)
      ? { laws: lawPayload, lawEngineState: undefined }
      : lawPayload;

    return {
      manifest,
      graph,
      voxelState: arrayBufferFromUint8(inflate(voxelBin)),
      entities: entityEnvelope.entities,
      runtimeEntityLayer: entityEnvelope.runtimeEntityLayer,
      laws: lawEnvelope.laws,
      lawEngineState: lawEnvelope.lawEngineState,
      processes,
      metadata,
    };
  }

  private async readJson(zip: JSZip, path: string): Promise<any> {
    const file = zip.file(path);
    if (!file) throw new Error(`Reality package is missing ${path}.`);
    return JSON.parse(await file.async('string'), packageJsonReviver);
  }

  private async captureThumbnail(): Promise<Blob | null> {
    if (!this.thumbnailCanvas) return null;
    return new Promise(resolve => {
      this.thumbnailCanvas!.toBlob(blob => resolve(blob), 'image/png');
    });
  }
}
