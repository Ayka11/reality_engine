import { VoxelGrid } from '../core/VoxelGrid';
import { F, CELL_FIELDS } from '../core/CellState';

export type BlenderMode = 'voxels' | 'bio_clusters' | 'energy_field';

interface VoxPoint { x: number; y: number; z: number; e: number; bio: number }

export class BlenderBridge {
  constructor(private grid: VoxelGrid) {}

  private _collect(threshold: number): VoxPoint[] {
    const { W, H, D, buffer: buf } = this.grid;
    const pts: VoxPoint[] = [];
    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (z * H * W + y * W + x) * CELL_FIELDS;
      const e = buf[o + F.ENERGY];
      if (e < threshold) continue;
      pts.push({ x, y, z, e: Math.round(e), bio: parseFloat(buf[o + F.BIO_POTENTIAL].toFixed(3)) });
    }
    return pts;
  }

  generateBlenderPython(mode: BlenderMode = 'voxels', threshold = 10): string {
    const pts = this._collect(threshold);
    if (mode === 'voxels')       return this._voxelScript(pts.slice(0, 2000));
    if (mode === 'bio_clusters') return this._bioScript(pts.filter(p => p.bio > 0.3).slice(0, 500));
    return this._energyFieldScript(pts.filter(p => p.e > 200).slice(0, 1000));
  }

  private _voxelScript(pts: VoxPoint[]): string {
    const ptStr = pts.map(p => `(${p.x},${p.y},${p.z})`).join(',');
    const eStr  = pts.map(p => p.e).join(',');
    return `# Reality Engine v3 — Voxel Import
# Paste in Blender Scripting tab → Run Script

import bpy
pts=[${ptStr}]
energies=[${eStr}]
max_e=max(energies) if energies else 1

coll=bpy.data.collections.get("RE_Voxels") or bpy.data.collections.new("RE_Voxels")
if "RE_Voxels" not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(coll)

mat=bpy.data.materials.get("RE_Energy") or bpy.data.materials.new("RE_Energy")
mat.use_nodes=True
bsdf=mat.node_tree.nodes.get("Principled BSDF")

for i,(p,e) in enumerate(zip(pts,energies)):
    bpy.ops.mesh.primitive_cube_add(size=0.9,location=p)
    obj=bpy.context.active_object
    obj.name=f"Vox_{i}"
    t=e/max_e
    if bsdf:
        bsdf.inputs["Base Color"].default_value=(t,t*0.4,1-t,1)
        bsdf.inputs["Emission Strength"].default_value=t*2
    obj.data.materials.append(mat)
    coll.objects.link(obj)
    bpy.context.scene.collection.objects.unlink(obj)

print(f"Reality Engine: imported {len(pts)} voxels")
`;
  }

  private _bioScript(pts: VoxPoint[]): string {
    const ptStr  = pts.map(p => `(${p.x},${p.y},${p.z})`).join(',');
    const bioStr = pts.map(p => p.bio).join(',');
    return `# Reality Engine v3 — Bio Cluster Import
import bpy
pts=[${ptStr}]
bio=[${bioStr}]
for i,(p,b) in enumerate(zip(pts,bio)):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=b*0.8+0.1,location=p,subdivisions=2)
    obj=bpy.context.active_object
    obj.name=f"Bio_{i}"
    mat=bpy.data.materials.new(f"BioMat_{i}")
    mat.use_nodes=True
    n=mat.node_tree.nodes["Principled BSDF"]
    n.inputs["Base Color"].default_value=(0.1,b,0.3,1)
    n.inputs["Emission Strength"].default_value=b*3
    obj.data.materials.append(mat)
print(f"Reality Engine: imported {len(pts)} bio clusters")
`;
  }

  private _energyFieldScript(pts: VoxPoint[]): string {
    const ptStr = pts.map(p => `(${p.x},${p.y},${p.z})`).join(',');
    return `# Reality Engine v3 — Energy Field (point cloud)
import bpy
pts=[${ptStr}]
mesh=bpy.data.meshes.new("RE_EnergyField")
obj=bpy.data.objects.new("RE_EnergyField",mesh)
bpy.context.scene.collection.objects.link(obj)
mesh.from_pydata(pts,[],[])
mesh.update()
print(f"Reality Engine: energy field with {len(pts)} points")
`;
  }

  exportCSV(threshold = 10): string {
    const { W, H, D, buffer: buf } = this.grid;
    const rows = ['x,y,z,energy,density,temperature,information,entropy,bioPotential'];
    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (z * H * W + y * W + x) * CELL_FIELDS;
      if (buf[o + F.ENERGY] < threshold) continue;
      rows.push([
        x, y, z,
        buf[o + F.ENERGY].toFixed(2),
        buf[o + F.DENSITY].toFixed(4),
        buf[o + F.TEMPERATURE].toFixed(2),
        buf[o + F.INFORMATION].toFixed(2),
        buf[o + F.ENTROPY].toFixed(6),
        buf[o + F.BIO_POTENTIAL].toFixed(4),
      ].join(','));
    }
    return rows.join('\n');
  }

  downloadBlenderScript(mode: BlenderMode = 'voxels', threshold = 10): void {
    const blob = new Blob([this.generateBlenderPython(mode, threshold)], { type: 'text/plain' });
    _dl(blob, `reality_blender_${mode}_${Date.now()}.py`);
  }

  downloadCSV(threshold = 10): void {
    const blob = new Blob([this.exportCSV(threshold)], { type: 'text/csv' });
    _dl(blob, `reality_pointcloud_${Date.now()}.csv`);
  }
}

function _dl(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
