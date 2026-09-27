    this.camera.updateProjectionMatrix()
  }

  private chunkCenter(): ChunkCoord {
    const w = worldToChunk(this.worldPosition.x, 0, this.worldPosition.z)
    return w.chunk
  }

  private buildTerrainPatch(chunk: WorldChunk, lod = 1): THREE.Group {
    const group = new THREE.Group()
    const geometry = new THREE.BufferGeometry()
    const resolution = lodResolution(lod as LODLevel)
    const scale = WORLD_CHUNK_SIZE / resolution
    const n = resolution + 1
    const positions = new Float32Array(n * n * 3)
    const normals = new Float32Array(n * n * 3)
    const colors = new Float32Array(n * n * 3)
    const indices: number[] = []

    const originX = chunk.cx * WORLD_CHUNK_SIZE
    const originZ = chunk.cz * WORLD_CHUNK_SIZE

    const sampleTerrainHeight = (x: number, z: number) => {
      const base = this.generator.sampleHeight(x, z)
      const field = (window as any).sampleAuthoritativeWorldField?.(x, base, z)
      if (!field) return base
      // Scientific field is an overlay on the deterministic terrain, not a replacement
      // for its topology. Keep displacement bounded so extreme field values remain renderable.
      const densityLift = ((field.density ?? 0.5) - 0.5) * 8
      const energyLift = Math.log1p(Math.max(0, field.energy ?? 0)) * 0.35
      const entropyLift = (field.entropy ?? 0) * 2
      return base + densityLift + energyLift + entropyLift
    }

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x
        const gx = x * scale
        const gz = z * scale
        const h = sampleTerrainHeight(originX + gx, originZ + gz)
        positions[i * 3] = originX + gx
        positions[i * 3 + 1] = h
        positions[i * 3 + 2] = originZ + gz

        const hL = sampleTerrainHeight(originX + gx - 1, originZ + gz)
        const hR = sampleTerrainHeight(originX + gx + 1, originZ + gz)
        const hD = sampleTerrainHeight(originX + gx, originZ + gz - 1)
        const hU = sampleTerrainHeight(originX + gx, originZ + gz + 1)
        const normal = new THREE.Vector3(hL - hR, 2, hD - hU).normalize()
        normals[i * 3] = normal.x
        normals[i * 3 + 1] = normal.y
        normals[i * 3 + 2] = normal.z

        const biome = this.generator.sampleClimate(originX + gx, originZ + gz, h).biome
        const color = new THREE.Color(BIOME_COLORS[BIOME_ID[biome]])
        const slope = Math.max(0, 1 - normal.y)
        color.offsetHSL(0, 0, -slope * 0.18)

        if (this.materialMode === 'height') {
          const t = Math.max(0, Math.min(1, (h + 20) / 120))
          color.setHSL(0.68 - t * 0.68, 0.82, 0.28 + t * 0.34)
        }

        colors[i * 3] = color.r
        colors[i * 3 + 1] = color.g
        colors[i * 3 + 2] = color.b
      }
    }

    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const a = z * n + x
        const b = a + 1
        const c = a + n
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))