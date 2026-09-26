/**
 * Reality Engine — Semantic Asset Import Service
 *
 * Converts a discovered external resource into a provenance-safe manifest
 * entry and resolves it against the existing semantic World Library.
 */

import type { DiscoveredAsset } from './AssetDiscovery';
import type { WorldAssetManifestEntry, WorldAssetImportManifest } from './AssetImportManifest';
import { validateAssetManifest } from './AssetImportManifest';
import { worldLibrary } from './registry';

export type AssetSemanticMatch = {
  entryId: string;
  score: number;
  reasons: string[];
};

export type AssetImportResult = {
  accepted: boolean;
  manifestEntry?: WorldAssetManifestEntry;
  matches: AssetSemanticMatch[];
  errors: string[];
};

function normalize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function matchAssetToWorldLibrary(asset: DiscoveredAsset): AssetSemanticMatch[] {
  const tokens = new Set([
    ...normalize(asset.id),
    ...normalize(asset.name),
    ...normalize(asset.category || ''),
    ...asset.tags.flatMap(normalize),
  ]);

  return worldLibrary.all()
    .map((entry) => {
      const entryTokens = new Set([
        ...normalize(entry.id),
        ...normalize(entry.name),
        ...normalize(entry.category),
        ...entry.tags.flatMap(normalize),
      ]);
      const overlap = [...tokens].filter((token) => entryTokens.has(token));
      const categoryMatch = asset.category
        ? entry.category.toLowerCase() === asset.category.toLowerCase()
        : false;
      const score = overlap.length + (categoryMatch ? 3 : 0);
      return {
        entryId: entry.id,
        score,
        reasons: [
          ...overlap.slice(0, 5).map((token) => `token:${token}`),
          ...(categoryMatch ? ['category-match'] : []),
        ],
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export function createManifestEntry(
  asset: DiscoveredAsset,
  semanticEntryId?: string,
): WorldAssetManifestEntry {
  return {
    id: `asset.${asset.providerId}.${asset.id}`,
    providerId: asset.providerId,
    sourceUrl: asset.sourceUrl,
    sourceAssetId: asset.id,
    name: asset.name,
    license: asset.license as WorldAssetManifestEntry['license'],
    semanticEntryId,
    tags: asset.tags,
  };
}

export function importDiscoveredAsset(
  asset: DiscoveredAsset,
  manifest: WorldAssetImportManifest,
  semanticEntryId?: string,
): AssetImportResult {
  const matches = matchAssetToWorldLibrary(asset);
  const selected = semanticEntryId
    ? worldLibrary.get(semanticEntryId)
    : matches[0]?.entryId
      ? worldLibrary.get(matches[0].entryId)
      : undefined;

  const manifestEntry = createManifestEntry(asset, selected?.id);
  const candidateManifest = {
    ...manifest,
    entries: [...manifest.entries.filter((entry) => entry.id !== manifestEntry.id), manifestEntry],
  };
  const validation = validateAssetManifest(candidateManifest);

  return {
    accepted: validation.valid,
    manifestEntry: validation.valid ? manifestEntry : undefined,
    matches,
    errors: validation.errors,
  };
}
