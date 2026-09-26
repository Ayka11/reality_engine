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
