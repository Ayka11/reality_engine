import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import { MATERIAL_LIBRARY } from '../materials/MaterialDef';
import { AgentMarker, AGENT_COLORS } from '../simulation/AgentSystem';

export type LayerName = 'energy' | 'density' | 'information' | 'entropy' | 'temperature' | 'bioPotential' | 'material' | 'chemistry' | 'signal' | 'memory' | 'diff';

const LAYER_FIELD: Record<Exclude<LayerName, 'diff'>, number> = {
  energy: F.ENERGY, density: F.DENSITY, information: F.INFORMATION,
  entropy: F.ENTROPY, temperature: F.TEMPERATURE, bioPotential: F.BIO_POTENTIAL,
  material: F.MATERIAL_ID, chemistry: F.CHEM_STATE,
  signal: F.SIGNAL, memory: F.MEM_FIELD,
};
const LAYER_MAX: Record<Exclude<LayerName, 'diff'>, number> = {
  energy: 1000, density: 1, information: 500, entropy: 1, temperature: 800, bioPotential: 1,
  material: 13, chemistry: 4, signal: 100, memory: 1,
};

const MAT_COLORS: [number, number, number][] = MATERIAL_LIBRARY.map(m => m.color);
const CHEM_COLORS: [number, number, number][] = [
  [0.3, 0.3, 0.6], [0.2, 0.5, 0.8], [0.6, 0.6, 0.6], [0.2, 0.7, 0.2], [0.9, 0.4, 0.1],
];

function layerColor(layer: LayerName, t: number): [number, number, number] {
  switch (layer) {
    case 'energy': {
      if (t < 0.15) return [0, 0, t / 0.15 * 0.7];
      if (t < 0.4)  { const s = (t-.15)/.25; return [0, s*.7, .7-s*.7]; }
      if (t < 0.7)  { const s = (t-.4)/.3;   return [s, .7-s*.23, 0]; }
      const s = (t-.7)/.3; return [1, .47+s*.53, s];
    }
    case 'density':      return [t*.24, t*.78, t*.24];
    case 'information':  return [t*.75, t*.08, t];
    case 'entropy':      return [t*.8+.1, t*.18, .2+t*.1];
    case 'temperature': {
      if (t < 0.5) return [t*2, 0, 1-t*2];
      const s = (t-.5)*2; return [1, s*.78, 0];
    }
    case 'bioPotential': return [t*.19, t*.9, t*.35];
    case 'material': {
      const c = MAT_COLORS[Math.min(Math.round(t*13), 13)] ?? [.1,.1,.1];
      return [c[0]*(.4+t*.6), c[1]*(.4+t*.6), c[2]*(.4+t*.6)];
    }
    case 'chemistry': {
      return CHEM_COLORS[Math.min(Math.round(t*4), 4)] ?? [.3,.3,.3];
    }
    case 'signal': {
      if (t < .5) { const s=t/.5; return [0, s*.5, s]; }
      const s=(t-.5)/.5; return [s, .5+s*.5, 1];
    }
    case 'memory': {
      if (t < .4) { const s=t/.4; return [0, s*.3, s*.8]; }
      const s=(t-.4)/.6; return [s*.7, .3+s*.4, .8-s*.5];
    }
    default: return [t, t, t];
  }
}

export interface EntityMarker {
  id: string;
  centroid: [number, number, number];
  stability: number;
  age: number;
  color: [number, number, number];
}

// ── Coordinate mapping ────────────────────────────────────────────────────────
// Grid:  x=0..W-1, y=0..H-1, z=0..D-1 (z = altitude layer)
// THREE: X=gridX,  Y=gridZ (altitude),  Z=gridY

const MAX_INSTANCES = 131072; // full grid max

export class VoxelRenderer {
  static isVoxelRenderer = true;
  readonly domElement: HTMLCanvasElement;

  private renderer:    THREE.WebGLRenderer;
  private _scene:      THREE.Scene;
  private composer:    EffectComposer;
  camera:              THREE.PerspectiveCamera;
  private controls:    OrbitControls;
  private mesh:        THREE.InstancedMesh;
  private dummy =      new THREE.Object3D();
  private _col =       new THREE.Color();
  private entityGroup: THREE.Group;
  private agentGroup:  THREE.Group;
  private _ro:         ResizeObserver;
  private _W: number; private _H: number; private _D: number;

  layer: LayerName = 'energy';
  threshold = 0.015;
  paintMode = false;
  paintAltitude = 0;
  private _diffBuf: Float32Array | null = null;

  constructor(canvas: HTMLCanvasElement, W: number, H: number, D: number) {
    this.domElement = canvas;
    this._W = W; this._H = H; this._D = D;

    // ── Renderer ──────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x06060d);

    // ── Scene ─────────────────────────────────────────────────────────────────
    this._scene = new THREE.Scene();
    this._scene.fog = new THREE.FogExp2(0x06060d, 0.008);

    // ── Camera ────────────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    this.camera.position.set(W * 1.4, D * 2.5, H * 1.4);

    // ── PBR Environment ──────────────────────────────────────────────────────
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this._scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // ── Post-processing: bloom ────────────────────────────────────────────────
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this._scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(800, 600), 0.55, 0.5, 0.72);
    this.composer.addPass(bloom);

    // ── OrbitControls ─────────────────────────────────────────────────────────
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(W/2, D/2, H/2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 500;
    this.controls.enablePan = true;
    this.controls.panSpeed = 1.2;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.2;
    // Touch: one-finger rotate, two-finger dolly+pan
    (this.controls.touches as unknown as Record<string,unknown>) = {
      ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN,
    };
    (this.controls.mouseButtons as unknown as Record<string,unknown>) = {
      LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE,
    };

    // ── Lighting ──────────────────────────────────────────────────────────────
    this._scene.add(new THREE.AmbientLight(0x445566, 1.4));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
    sun.position.set(W * 0.8, D * 2.5, H * 0.4);
    this._scene.add(sun);
    const fill = new THREE.DirectionalLight(0x334488, 0.5);
    fill.position.set(-W * 0.5, D, H * 0.8);
    this._scene.add(fill);

    // ── World bounds helper ───────────────────────────────────────────────────
    const worldBox = new THREE.Box3(new THREE.Vector3(0,0,0), new THREE.Vector3(W,D,H));
    this._scene.add(new THREE.Box3Helper(worldBox, new THREE.Color(0x1a1a28)));

    const gridHelper = new THREE.GridHelper(Math.max(W,H), 8, 0x1a1a28, 0x1a1a28);
    gridHelper.position.set(W/2, 0, H/2);
    this._scene.add(gridHelper);

    this._scene.add(new THREE.AxesHelper(6));

    // ── Instanced voxel mesh ──────────────────────────────────────────────────
    const geo = new THREE.BoxGeometry(0.88, 0.88, 0.88);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: false,
      roughness: 0.7,
      metalness: 0.2,
      envMapIntensity: 1.0
    });

    // Add custom shader logic for material-specific properties
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `
        attribute vec3 instanceProps; // x: roughness, y: metalness, z: emissive
        varying vec3 vInstanceProps;
        ${shader.vertexShader}
      `.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vInstanceProps = instanceProps;`
      );

      shader.fragmentShader = `
        varying vec3 vInstanceProps;
        ${shader.fragmentShader}
      `.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = vInstanceProps.x;`
      ).replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
         metalnessFactor = vInstanceProps.y;`
      ).replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance = diffuseColor.rgb * vInstanceProps.z;`
      );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_INSTANCES * 3), 3
    );

    // Custom attribute for roughness/metalness/emissive
    const propAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
    geo.setAttribute('instanceProps', propAttr);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.scene.add(this.mesh);

    // ── Entity & agent groups ─────────────────────────────────────────────────
    this.entityGroup = new THREE.Group();
    this._scene.add(this.entityGroup);
    this.agentGroup = new THREE.Group();
    this._scene.add(this.agentGroup);

    // ── Resize ────────────────────────────────────────────────────────────────
    this._ro = new ResizeObserver(() => this._onResize());
    this._ro.observe(canvas.parentElement!);
    this._onResize();
  }

  private _onResize(): void {
    const p = this.domElement.parentElement!;
    const w = p.clientWidth || 800;
    const h = p.clientHeight || 600;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  get scene(): THREE.Scene { return this._scene; }

  setDiffBuffer(buf: Float32Array | null): void { this._diffBuf = buf; }

  render(grid: VoxelGrid, entities: EntityMarker[] = [], agents: AgentMarker[] = []): void {
    const buf  = grid.buffer;
    const { W, H, D } = grid;
    const thr  = this.threshold;
    let count  = 0;
    const dummy = this.dummy;
    const propAttr = this.mesh.geometry.getAttribute('instanceProps') as THREE.InstancedBufferAttribute;

    if (this.layer === 'diff') {
      const db = this._diffBuf;
      const scale = 500;
      for (let gz = 0; gz < D && count < MAX_INSTANCES - 1; gz++)
      for (let gy = 0; gy < H && count < MAX_INSTANCES - 1; gy++)
      for (let gx = 0; gx < W && count < MAX_INSTANCES - 1; gx++) {
        const i = gz*H*W + gy*W + gx;
        const d = db ? db[i * CELL_FIELDS + F.ENERGY] : 0;
        const t = Math.min(1, Math.abs(d) / scale);
        if (t < 0.02) continue;
        let r = 0, g = 0, b = 0;
        if (d > 0) { r = t; g = t * 0.3; }
        else       { g = t * 0.4; b = t; }
        dummy.position.set(gx+0.5, gz+0.5, gy+0.5);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(count, dummy.matrix);
        this.mesh.setColorAt(count, this._col.setRGB(r, g, b));
        propAttr.setXYZ(count, 0.7, 0.2, 0.0);
        count++;
      }
    } else {
      const fi   = LAYER_FIELD[this.layer as Exclude<LayerName,'diff'>];
      const maxV = LAYER_MAX[this.layer as Exclude<LayerName,'diff'>];

      for (let gz = 0; gz < D && count < MAX_INSTANCES - 1; gz++)
      for (let gy = 0; gy < H && count < MAX_INSTANCES - 1; gy++)
      for (let gx = 0; gx < W && count < MAX_INSTANCES - 1; gx++) {
        const i = gz*H*W + gy*W + gx;
        const v = buf[i * CELL_FIELDS + fi];
        if (v < thr * maxV) continue;

        let r: number, g: number, b: number;
        if (this.layer === 'material') {
          const matIdx = Math.min(Math.floor(v), 13);
          if (matIdx === 0) continue;
          const mc = MAT_COLORS[matIdx];
          [r,g,b] = [mc[0],mc[1],mc[2]];
        } else if (this.layer === 'chemistry') {
          const ci = Math.min(Math.floor(v), 4);
          if (ci === 0 && v < 0.5) continue;
          [r,g,b] = CHEM_COLORS[ci];
        } else {
          [r,g,b] = layerColor(this.layer as Exclude<LayerName,'diff'|'material'|'chemistry'>, Math.min(v/maxV,1));
          if (r < 0.01 && g < 0.01 && b < 0.01) continue;
        }

        dummy.position.set(gx+0.5, gz+0.5, gy+0.5);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(count, dummy.matrix);
        this.mesh.setColorAt(count, this._col.setRGB(r, g, b));

        // Visual properties based on material or energy
        let rough = 0.7, metal = 0.2, emissive = 0.0;
        const e = buf[i * CELL_FIELDS + F.ENERGY];
        if (e > 500) emissive = (e - 500) / 500;

        if (this.layer === 'material') {
          const matIdx = Math.min(Math.floor(v), 13);
          if (matIdx === 4) { rough = 0.2; metal = 0.9; } // Metal
          if (matIdx === 6 || matIdx === 3) { rough = 0.1; metal = 0.1; } // Ice/Crystal
          if (matIdx === 11 || matIdx === 5) { emissive += 0.5; } // Plasma/Magma
        }

        propAttr.setXYZ(count, rough, metal, emissive);
        count++;
      }
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    propAttr.needsUpdate = true;

    this._syncEntities(entities);
    this._syncAgents(agents);

    this.controls.update();
    this.composer.render();
  }

  private _syncEntities(entities: EntityMarker[]): void {
    while (this.entityGroup.children.length > entities.length) {
      const m = this.entityGroup.children[0] as THREE.Mesh;
      m.geometry.dispose(); (m.material as THREE.Material).dispose();
      this.entityGroup.remove(m);
    }
    const sGeo = new THREE.SphereGeometry(0.65, 8, 6);
    while (this.entityGroup.children.length < entities.length) {
      this.entityGroup.add(new THREE.Mesh(sGeo,
        new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, transparent: true, depthWrite: true })));
    }
    entities.forEach((e, idx) => {
      const m = this.entityGroup.children[idx] as THREE.Mesh;
      m.position.set(e.centroid[0]+0.5, e.centroid[2]+0.5, e.centroid[1]+0.5);
      const r = Math.min(1 + e.stability * 0.4, 2);
      m.scale.setScalar(r);
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.setRGB(e.color[0], e.color[1], e.color[2]);
      mat.opacity = 0.55 + e.stability * 0.45;
    });
  }

  private _syncAgents(agents: AgentMarker[]): void {
    while (this.agentGroup.children.length > agents.length) {
      const m = this.agentGroup.children[0] as THREE.Mesh;
      m.geometry.dispose(); (m.material as THREE.Material).dispose();
      this.agentGroup.remove(m);
    }
    const sGeo = new THREE.SphereGeometry(0.38, 7, 6);
    while (this.agentGroup.children.length < agents.length) {
      this.agentGroup.add(new THREE.Mesh(sGeo,
        new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    }
    agents.forEach((a, idx) => {
      const m = this.agentGroup.children[idx] as THREE.Mesh;
      m.position.set(a.position[0]+0.5, a.position[2]+0.5, a.position[1]+0.5);
      const [r,g,b] = AGENT_COLORS[a.behavior];
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(r, g, b);
      mat.opacity = 0.75 + Math.min(a.energy/600, 0.25);
    });
  }

  pickGridCell(e: PointerEvent): { x: number; y: number; z: number } | null {
    const rect = this.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -(this.paintAltitude+0.5));
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    const gx = Math.floor(hit.x);
    const gy = Math.floor(hit.z);
    if (gx < 0 || gx >= this._W || gy < 0 || gy >= this._H) return null;
    return { x: gx, y: gy, z: this.paintAltitude };
  }

  setPaintMode(enabled: boolean): void {
    this.paintMode = enabled;
    (this.controls.mouseButtons as unknown as Record<string,unknown>) = enabled
      ? { LEFT: -1,                   MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE,   MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    (this.controls.touches as unknown as Record<string,unknown>) = enabled
      ? { ONE: -1,                      TWO: THREE.TOUCH.DOLLY_PAN }
      : { ONE: THREE.TOUCH.ROTATE,      TWO: THREE.TOUCH.DOLLY_PAN };
  }

  panCamera(dx: number, dy: number): void {
    const offset = new THREE.Vector3();
    offset.copy(this.camera.position).sub(this.controls.target);
    const dist = offset.length();
    const right = new THREE.Vector3();
    right.crossVectors(this.camera.getWorldDirection(new THREE.Vector3()), this.camera.up).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const panScale = dist * 0.0012;
    this.controls.target.addScaledVector(right, -dx * panScale);
    this.controls.target.addScaledVector(up,     dy * panScale);
    this.camera.position.addScaledVector(right, -dx * panScale);
    this.camera.position.addScaledVector(up,     dy * panScale);
    this.controls.update();
  }

  resetCamera(): void {
    const { _W: W, _H: H, _D: D } = this;
    this.camera.position.set(W*1.4, D*2.5, H*1.4);
    this.controls.target.set(W/2, D/2, H/2);
    this.controls.update();
  }

  destroy(): void {
    this._ro.disconnect();
    this.renderer.dispose();
  }
}
