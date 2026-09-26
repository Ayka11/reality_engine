/**
 * Reality Engine — Open Asset Provider Registry
 *
 * Provider metadata is kept separate from downloaded assets. This lets the
 * World Library discover legal/open sources without coupling the runtime to
 * any single CDN or API.
 */

export type AssetLicense = 'CC0' | 'PUBLIC_DOMAIN' | 'MIXED' | 'UNKNOWN';

export type AssetProviderCapability =
  | '3d'
  | 'materials'
  | 'hdri'
  | 'terrain'
  | 'gis'
  | 'elevation'
  | 'textures'
  | '2d'
  | 'metadata';

export type WorldAssetProvider = {
  id: string;
  name: string;
  website: string;
  api?: string;
  license: AssetLicense;
  liveApiAttributionRequired?: boolean;
  capabilities: AssetProviderCapability[];
  description: string;
  importFormats: string[];
  semanticCategories: string[];
};

export const WORLD_ASSET_PROVIDERS: WorldAssetProvider[] = [
  {
    id: 'polyhaven',
    name: 'Poly Haven',
    website: 'https://polyhaven.com/',
    api: 'https://api.polyhaven.com/',
    license: 'CC0',
    liveApiAttributionRequired: true,
    capabilities: ['3d', 'materials', 'hdri', 'textures', 'metadata'],
    description: 'Open 3D assets, materials and HDRIs suitable for world rendering.',
    importFormats: ['blend', 'fbx', 'gltf', 'glb', 'obj', 'hdr', 'exr'],
    semanticCategories: ['flora', 'fauna', 'terrain', 'structure', 'geology', 'celestial'],
  },
  {
    id: 'kenney',
    name: 'Kenney',
    website: 'https://kenney.nl/assets',
    license: 'CC0',
    capabilities: ['3d', 'textures', '2d', 'materials'],
    description: 'Large collection of public-domain game assets for environments, props and interfaces.',
    importFormats: ['glb', 'gltf', 'obj', 'fbx', 'png', 'jpg'],
    semanticCategories: ['structure', 'infrastructure', 'settlement', 'flora', 'fauna', 'celestial'],
  },
  {
    id: 'natural-earth',
    name: 'Natural Earth',
    website: 'https://www.naturalearthdata.com/',
    license: 'PUBLIC_DOMAIN',
    capabilities: ['gis', 'terrain', 'metadata'],
    description: 'Public-domain vector and raster geographic datasets for global-scale Earth reconstruction.',
    importFormats: ['shp', 'geojson', 'gpkg', 'sqlite', 'tif'],
    semanticCategories: ['terrain', 'water', 'geology', 'biome', 'infrastructure', 'settlement'],
  },
  {
    id: 'usgs-3dep',
    name: 'USGS 3DEP',
    website: 'https://www.usgs.gov/3d-elevation-program',
    license: 'PUBLIC_DOMAIN',
    capabilities: ['elevation', 'terrain', 'gis', 'metadata'],
    description: 'Public-domain elevation and lidar products for terrain reconstruction and analysis.',
    importFormats: ['geotiff', 'las', 'laz'],
    semanticCategories: ['terrain', 'geology', 'water'],
  },
];

export class WorldAssetProviderRegistry {
  private readonly providers = new Map<string, WorldAssetProvider>();

  constructor(providers: WorldAssetProvider[] = WORLD_ASSET_PROVIDERS) {
    providers.forEach((provider) => this.register(provider));
  }

  register(provider: WorldAssetProvider): WorldAssetProvider {
    this.providers.set(provider.id, provider);
    return provider;
  }

  get(id: string): WorldAssetProvider | undefined {
    return this.providers.get(id);
  }

  all(): WorldAssetProvider[] {
    return [...this.providers.values()];
  }

  byCapability(capability: AssetProviderCapability): WorldAssetProvider[] {
    return this.all().filter((provider) => provider.capabilities.includes(capability));
  }

  byCategory(category: string): WorldAssetProvider[] {
    return this.all().filter((provider) => provider.semanticCategories.includes(category));
  }

  stats() {
    return {
      providers: this.providers.size,
      cc0: this.all().filter((p) => p.license === 'CC0').length,
      publicDomain: this.all().filter((p) => p.license === 'PUBLIC_DOMAIN').length,
      capabilities: [...new Set(this.all().flatMap((p) => p.capabilities))],
    };
  }
}

export const worldAssetProviders = new WorldAssetProviderRegistry();
