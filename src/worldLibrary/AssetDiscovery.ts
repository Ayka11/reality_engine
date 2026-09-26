/**
 * Reality Engine — Remote Asset Discovery
 *
 * Discovery only: this module reads provider metadata and does not download
 * binary assets into the application. Binary acquisition can be added later
 * behind an explicit user action and provenance manifest.
 */

import { worldAssetProviders, type WorldAssetProvider } from './AssetProviders';

export type DiscoveredAsset = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags: string[];
  providerId: string;
  sourceUrl: string;
  license: string;
  runtimeUrl?: string;
  format?: string;
};

export async function discoverPolyHavenAssets(
  signal?: AbortSignal,
): Promise<DiscoveredAsset[]> {
  const provider = worldAssetProviders.get('polyhaven');
  if (!provider?.api) throw new Error('Poly Haven provider is not configured');

  const response = await fetch(`${provider.api}assets`, {
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Poly Haven API returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, any>;

  return Object.entries(payload).map(([id, value]) => ({
    id,
    name: String(value?.name || id),
    description: value?.description ? String(value.description) : undefined,
    category: value?.category ? String(value.category) : undefined,
    tags: Array.isArray(value?.tags) ? value.tags.map(String) : [],
    providerId: 'polyhaven',
    sourceUrl: `https://polyhaven.com/a/${encodeURIComponent(id)}`,
    license: provider.license,
  }));
}

export function providerSummary(provider: WorldAssetProvider) {
  return {
    id: provider.id,
    name: provider.name,
    license: provider.license,
    capabilities: provider.capabilities,
    formats: provider.importFormats,
    categories: provider.semanticCategories,
  };
}

export async function resolvePolyHavenRuntimeUrl(
  asset: DiscoveredAsset,
  signal?: AbortSignal,
): Promise<{ url: string; format: string } | null> {
  if (asset.providerId !== 'polyhaven') return null
  const response = await fetch(`https://api.polyhaven.com/files/${encodeURIComponent(asset.id)}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`Poly Haven files API returned HTTP ${response.status}`)
  const payload = await response.json() as unknown

  const candidates: Array<{ url: string; format: string; score: number }> = []
  const visit = (value: unknown, path: string[] = []) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]))
      return
    }
    const record = value as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url : ''
    if (url) {
      const lower = url.toLowerCase()
      if (lower.endsWith('.glb') || lower.endsWith('.gltf') || lower.includes('.glb?') || lower.includes('.gltf?')) {
        const format = lower.includes('.glb') ? 'glb' : 'gltf'
        const score = format === 'glb' ? 100 : 90
        candidates.push({ url, format, score })
      }
    }
    Object.entries(record).forEach(([key, child]) => visit(child, [...path, key]))
  }
  visit(payload)
  candidates.sort((a, b) => b.score - a.score)
  const selected = candidates[0]
  return selected ? { url: selected.url, format: selected.format } : null
}
