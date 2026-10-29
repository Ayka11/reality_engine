/**
 * Reality Engine — Asset Import Manifest
 *
 * A normalized manifest is the bridge between external resources and the
 * semantic World Library. It records provenance and licensing before an
 * asset is allowed into a distributable world package.
 */

import type { AssetLicense } from './AssetProviders';

export type WorldAssetManifestEntry = {
  id: string;
  providerId: string;
  sourceUrl: string;
  sourceAssetId?: string;
  name: string;
  license: AssetLicense;
  attribution?: string;
  downloadedAt?: string;
  contentHash?: string;
  localPath?: string;
  format?: string;
  semanticEntryId?: string;
  tags?: string[];
};

export type WorldAssetImportManifest = {
  version: '1.0';
  generatedAt: string;
  project: string;
  entries: WorldAssetManifestEntry[];
};

export function createAssetImportManifest(
  entries: WorldAssetManifestEntry[] = [],
  project = 'Reality Engine',
): WorldAssetImportManifest {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    project,
    entries,
  };
}

export function validateAssetManifest(
  manifest: WorldAssetImportManifest,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (manifest.version !== '1.0') errors.push('Unsupported manifest version');

  for (const entry of manifest.entries) {
    if (!entry.id) errors.push('Asset entry is missing id');
    if (!entry.providerId) errors.push(`Asset ${entry.id || '<unknown>'} is missing providerId`);
    if (!entry.sourceUrl) errors.push(`Asset ${entry.id || '<unknown>'} is missing sourceUrl`);
    if (!entry.name) errors.push(`Asset ${entry.id || '<unknown>'} is missing name`);
    if (entry.license === 'UNKNOWN') {
      errors.push(`Asset ${entry.id || '<unknown>'} has unknown licensing`);
    }
  }

  return { valid: errors.length === 0, errors };
}
