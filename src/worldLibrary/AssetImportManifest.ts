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

const ASSET_LICENSES = new Set<AssetLicense>(['CC0', 'PUBLIC_DOMAIN', 'MIXED', 'UNKNOWN']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.length > 0 &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

/** Validate untrusted package metadata without resolving or fetching external URLs. */
export function validateAssetManifest(
  manifest: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(manifest)) {
    return { valid: false, errors: ['Asset manifest must be an object'] };
  }

  if (manifest.version !== '1.0') errors.push('Unsupported manifest version');
  if (!isNonEmptyString(manifest.project)) errors.push('Asset manifest is missing project name');
  if (!isNonEmptyString(manifest.generatedAt) || !Number.isFinite(Date.parse(String(manifest.generatedAt)))) {
    errors.push('Asset manifest has an invalid generatedAt timestamp');
  }
  if (!Array.isArray(manifest.entries)) {
    errors.push('Asset manifest entries must be an array');
    return { valid: false, errors };
  }

  const seenIds = new Set<string>();
  for (let index = 0; index < manifest.entries.length; index++) {
    const entry = manifest.entries[index];
    if (!isRecord(entry)) {
      errors.push(`Asset entry ${index} must be an object`);
      continue;
    }

    const id = isNonEmptyString(entry.id) ? entry.id : '';
    if (!id) errors.push(`Asset entry ${index} is missing id`);
    else if (seenIds.has(id)) errors.push(`Asset ${id} has a duplicate manifest id`);
    else seenIds.add(id);

    if (!isNonEmptyString(entry.providerId)) errors.push(`Asset ${id || '<unknown>'} is missing providerId`);
    if (!isNonEmptyString(entry.name)) errors.push(`Asset ${id || '<unknown>'} is missing name`);
    if (!isValidHttpUrl(entry.sourceUrl)) {
      errors.push(`Asset ${id || '<unknown>'} has an invalid sourceUrl; only HTTP(S) URLs are supported`);
    }

    if (typeof entry.license !== 'string' || !ASSET_LICENSES.has(entry.license as AssetLicense)) {
      errors.push(`Asset ${id || '<unknown>'} has an unsupported license value`);
    } else if (entry.license === 'UNKNOWN') {
      errors.push(`Asset ${id || '<unknown>'} has unknown licensing`);
    }

    for (const field of [
      'sourceAssetId', 'attribution', 'contentHash', 'localPath',
      'format', 'semanticEntryId',
    ] as const) {
      if (entry[field] !== undefined && !isNonEmptyString(entry[field])) {
        errors.push(`Asset ${id || '<unknown>'} has an invalid ${field}`);
      }
    }
    if (entry.downloadedAt !== undefined &&
        (!isNonEmptyString(entry.downloadedAt) || !Number.isFinite(Date.parse(String(entry.downloadedAt))))) {
      errors.push(`Asset ${id || '<unknown>'} has an invalid downloadedAt timestamp`);
    }
    if (entry.tags !== undefined &&
        (!Array.isArray(entry.tags) || !entry.tags.every(isNonEmptyString))) {
      errors.push(`Asset ${id || '<unknown>'} has invalid tags`);
    }
  }

  return { valid: errors.length === 0, errors };
}
