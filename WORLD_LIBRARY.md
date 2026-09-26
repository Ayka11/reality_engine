# Reality Engine World Library

The World Library is the data-first knowledge layer for Infinite World.

It is deliberately separate from rendering. A library entry describes a world element,
its ecological/physical constraints, relationships, and simulation hooks. Renderers,
procedural generators, editors, AI tools, and experiments can consume the same entry.

## Current model

`WorldLibraryEntry` contains:

- identity and category
- human-readable description
- semantic tags
- scale and rarity
- environmental conditions
- compatibility/conflict relations
- requirements and produced resources/events
- renderer mapping (`visualKind`)
- simulation hooks
- variants

## Categories

1. terrain
2. geology
3. water
4. climate
5. biome
6. flora
7. fauna
8. resource
9. structure
10. infrastructure
11. settlement
12. civilization
13. anomaly
14. celestial
15. phenomenon

## Target architecture

The catalogue should grow into a layered world knowledge system:

```
World Library
  ├── Physical World
  │   ├── terrain
  │   ├── geology
  │   ├── water
  │   └── climate
  ├── Biosphere
  │   ├── biomes
  │   ├── flora
  │   └── fauna
  ├── Resources
  │   ├── minerals
  │   ├── materials
  │   └── energy
  ├── Built World
  │   ├── structures
  │   ├── infrastructure
  │   └── settlements
  ├── Civilization
  │   ├── societies
  │   ├── technologies
  │   └── institutions
  └── Meta-Reality
      ├── anomalies
      ├── celestial systems
      └── phenomena/events
```

## Important design principle

Do not make the library a giant hard-coded switch statement.

The generator should eventually ask questions such as:

- What can exist in this biome?
- What can grow at this moisture/temperature/elevation?
- What resources can occur here?
- What structures can be built here?
- Which settlement types are compatible with this terrain?
- What entities depend on this resource?
- Which events can transform this region?

That allows the same library to serve procedural generation, manual world editing,
simulation, AI world composition, scientific experiments, and future asset ingestion.

## Growth path

### Phase A — semantic catalogue
Expand from the initial seed catalogue to hundreds/thousands of entries.

### Phase B — variants
Allow one semantic entity to have many visual/behavioral variants.

### Phase C — rule graph
Represent compatibility, dependencies, ecological relations, and transformation rules.

### Phase D — procedural adapters
Map library entries to terrain generators, object factories, settlement generators,
hydrology, climate and simulation processes.

### Phase E — external asset packs
Allow GLTF/texture/audio/metadata packages to register themselves against library IDs.

### Phase F — world knowledge graph
Connect entities, resources, processes, civilizations and events into a persistent
graph that can be queried by the World Composer and AI.

The long-term goal is not simply a larger asset list. It is a reusable **World Knowledge
System** from which an effectively unbounded number of coherent worlds can be generated.
