import type { RealityPackage, RealityPackageSummary } from './RealityPackage';

export class RealityPackageRegistry {
  packages = new Map<string, RealityPackageSummary>();

  async publish(pkg: RealityPackage): Promise<RealityPackageSummary> {
    const id = `${pkg.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
    const summary: RealityPackageSummary = {
      id,
      name: pkg.manifest.name,
      author: pkg.manifest.author,
      version: pkg.manifest.version,
      tags: pkg.manifest.tags,
      created: pkg.manifest.created,
      compatibility: pkg.manifest.compatibility,
    };
    this.packages.set(id, summary);
    return summary;
  }

  async load(id: string): Promise<RealityPackageSummary | null> {
    return this.packages.get(id) ?? null;
  }

  async fork(originalId: string, newName: string): Promise<RealityPackageSummary | null> {
    const original = this.packages.get(originalId);
    if (!original) return null;
    const forked = { ...original, id: `${originalId}-fork-${Date.now()}`, name: newName, created: new Date().toISOString() };
    this.packages.set(forked.id, forked);
    return forked;
  }
}
