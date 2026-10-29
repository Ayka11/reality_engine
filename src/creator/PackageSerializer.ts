import JSZip from 'jszip';
import { deflate, inflate } from 'pako';
import type { RealityPackage } from './RealityPackage';

function arrayBufferFromUint8(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export class PackageSerializer {
  constructor(private thumbnailCanvas?: HTMLCanvasElement | null) {}

  async pack(pkg: RealityPackage): Promise<Blob> {
    const zip = new JSZip();

    zip.file('manifest.json', JSON.stringify(pkg.manifest, null, 2));
    zip.file('graph.json', JSON.stringify(pkg.graph, null, 2));
    zip.file('entities.json', JSON.stringify(pkg.entities, null, 2));
    zip.file('laws-override.json', JSON.stringify(pkg.laws, null, 2));
    zip.file('processes.json', JSON.stringify(pkg.processes, null, 2));
    zip.file('metadata/stats.json', JSON.stringify(pkg.metadata, null, 2));

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
    const entities = await this.readJson(zip, 'entities.json');
    const laws = await this.readJson(zip, 'laws-override.json');
    const processes = await this.readJson(zip, 'processes.json');
    const metadata = await this.readJson(zip, 'metadata/stats.json');
    const voxelBin = await zip.file('voxel-state.bin')?.async('uint8array');
    if (!voxelBin) throw new Error('Reality package is missing voxel-state.bin.');

    return {
      manifest,
      graph,
      voxelState: arrayBufferFromUint8(inflate(voxelBin)),
      entities,
      laws,
      processes,
      metadata,
    };
  }

  private async readJson(zip: JSZip, path: string): Promise<any> {
    const file = zip.file(path);
    if (!file) throw new Error(`Reality package is missing ${path}.`);
    return JSON.parse(await file.async('string'));
  }

  private async captureThumbnail(): Promise<Blob | null> {
    if (!this.thumbnailCanvas) return null;
    return new Promise(resolve => {
      this.thumbnailCanvas!.toBlob(blob => resolve(blob), 'image/png');
    });
  }
}
