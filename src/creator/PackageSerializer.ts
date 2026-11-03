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

export function serializePackageJson(value: unknown): string {
  return JSON.stringify(value, packageJsonReplacer, 2);
}

export function parsePackageJson(value: string): unknown {
  return JSON.parse(value, packageJsonReviver);
}

export class PackageSerializer {
  constructor(private thumbnailCanvas?: HTMLCanvasElement | null) {}

  async pack(pkg: RealityPackage): Promise<Blob> {
    const zip = new JSZip();

    zip.file('manifest.json', serializePackageJson(pkg.manifest));
    zip.file('graph.json', serializePackageJson(pkg.graph));
    zip.file('entities.json', serializePackageJson({
      entities: pkg.entities,
      runtimeEntityLayer: pkg.runtimeEntityLayer,
    }));
    zip.file('laws-override.json', serializePackageJson({
      laws: pkg.laws,
      lawEngineState: pkg.lawEngineState,
    }));
    if (pkg.runtimeState) {
      zip.file('runtime-state.json', serializePackageJson(pkg.runtimeState));
    }
    zip.file('processes.json', serializePackageJson(pkg.processes));
    zip.file('metadata/stats.json', serializePackageJson(pkg.metadata));

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
    const runtimeStateFile = zip.file('runtime-state.json');
    const runtimeState = runtimeStateFile
      ? await this.readJson(zip, 'runtime-state.json')
      : undefined;
    if (runtimeState !== undefined &&
        (!runtimeState || typeof runtimeState !== 'object' || Array.isArray(runtimeState))) {
      throw new Error('Reality package runtime state envelope is invalid.');
    }

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
      runtimeState,
      processes,
      metadata,
    };
  }

  private async readJson(zip: JSZip, path: string): Promise<any> {
    const file = zip.file(path);
    if (!file) throw new Error(`Reality package is missing ${path}.`);
    return parsePackageJson(await file.async('string')) as any;
  }

  private async captureThumbnail(): Promise<Blob | null> {
    if (!this.thumbnailCanvas) return null;
    return new Promise(resolve => {
      this.thumbnailCanvas!.toBlob(blob => resolve(blob), 'image/png');
    });
  }
}
