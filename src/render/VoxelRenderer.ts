import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

export type LayerName = 'energy' | 'density' | 'information' | 'entropy' | 'temperature' | 'bioPotential';

const LAYER_FIELD: Record<LayerName, number> = {
  energy: F.ENERGY, density: F.DENSITY, information: F.INFORMATION,
  entropy: F.ENTROPY, temperature: F.TEMPERATURE, bioPotential: F.BIO_POTENTIAL,
};
const LAYER_MAX: Record<LayerName, number> = {
  energy: 1000, density: 1, information: 500, entropy: 1, temperature: 800, bioPotential: 1,
};

// Returns normalized [0..1] RGB
function layerColor(layer: LayerName, t: number): [number, number, number] {
  switch (layer) {
    case 'energy': {
      if (t < 0.15) return [0, 0, t / 0.15 * 0.7];
      if (t < 0.4)  { const s = (t - 0.15) / 0.25; return [0, s * 0.7, 0.7 - s * 0.7]; }
      if (t < 0.7)  { const s = (t - 0.4)  / 0.3;  return [s, 0.7 - s * 0.23, 0]; }
      const s = (t - 0.7) / 0.3; return [1, 0.47 + s * 0.53, s];
    }
    case 'density':      return [t * 0.24, t * 0.78, t * 0.24];
    case 'information':  return [t * 0.75, t * 0.08, t];
    case 'entropy':      return [t * 0.8 + 0.1, t * 0.18, 0.2 + t * 0.1];
    case 'temperature': {
      if (t < 0.5) return [t * 2, 0, 1 - t * 2];
      const s = (t - 0.5) * 2; return [1, s * 0.78, 0];
    }
    case 'bioPotential': return [t * 0.19, t * 0.9, t * 0.35];
  }
}

export interface EntityMarker {
  id: string;
  centroid: [number, number, number]; // grid (x, y, z)
  stability: number;                  // 0..1
  age: number;
  color: [number, number, number];    // RGB 0..1
}

// ── Coordinate mapping ────────────────────────────────────────────────────────
// Grid:  x=0..W-1, y=0..H-1, z=0..D-1 (z = altitude layer)
// THREE: X=gridX,  Y=gridZ (altitude),  Z=gridY
// This makes z-layers stack upward in THREE, giving a natural landscape view.

export class VoxelRenderer {
  readonly domElement: HTMLCanvasElement;

  private renderer: THREE.WebGLRenderer;
  private scene:    THREE.Scene;
  camera:           THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private cloud:    THREE.Points;
  private colorAttr: THREE.BufferAttribute;
  private entityGroup: THREE.Group;
  private _ro: ResizeObserver;
  private _W: number; private _H: number; private _D: number;

  layer: LayerName = 'energy';
  threshold = 0.015;   // voxels below this normalized value are hidden
  paintMode = false;   // true → OrbitControls disabled, left-click paints
  paintAltitude = 0;   // which grid Z layer to paint on (altitude)

  constructor(canvas: HTMLCanvasElement, W: number, H: number, D: number) {
    this.domElement = canvas;
    this._W = W; this._H = H; this._D = D;

    // ── Renderer ──────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0a12);

    // ── Scene ─────────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Camera ────────────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
    this.camera.position.set(W * 1.5, D * 2.2, H * 1.5);

    // ── OrbitControls ─────────────────────────────────────────────────────────
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(W / 2, D / 2, H / 2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 400;
    // Paint-first: right-click = orbit, middle = pan, left is free for painting
    (this.controls.mouseButtons as any) = {
      LEFT: -1,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    // ── World bounds wireframe ─────────────────────────────────────────────────
    const worldBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(W, D, H)
    );
    this.scene.add(new THREE.Box3Helper(worldBox, new THREE.Color(0x2a2a40)));

    // Grid floor helper
    const grid = new THREE.GridHelper(Math.max(W, H), 8, 0x1a1a28, 0x1a1a28);
    grid.position.set(W / 2, 0, H / 2);
    this.scene.add(grid);

    // Axes
    const axes = new THREE.AxesHelper(6);
    this.scene.add(axes);

    // ── Point cloud: positions are static (x=gridX, y=gridZ, z=gridY) ────────
    const count = W * H * D;
    const positions = new Float32Array(count * 3);
    const colors    = new Float32Array(count * 3);

    let pi = 0;
    for (let gz = 0; gz < D; gz++)      // altitude
    for (let gy = 0; gy < H; gy++)      // south-north
    for (let gx = 0; gx < W; gx++) {   // east-west
      positions[pi++] = gx + 0.5;
      positions[pi++] = gz + 0.5;       // altitude → THREE Y (up)
      positions[pi++] = gy + 0.5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute('color', this.colorAttr);

    const mat = new THREE.PointsMaterial({
      size: 0.78,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.cloud = new THREE.Points(geo, mat);
    this.scene.add(this.cloud);

    // ── Entity group ──────────────────────────────────────────────────────────
    this.entityGroup = new THREE.Group();
    this.scene.add(this.entityGroup);

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
  }

  render(grid: VoxelGrid, entities: EntityMarker[] = []): void {
    // ── Update voxel colors ───────────────────────────────────────────────────
    const buf   = grid.buffer;
    const fi    = LAYER_FIELD[this.layer];
    const maxV  = LAYER_MAX[this.layer];
    const cols  = this.colorAttr.array as Float32Array;
    const n     = grid.size;
    const thr   = this.threshold;

    for (let i = 0; i < n; i++) {
      const v = buf[i * CELL_FIELDS + fi];
      const t = v / maxV;
      const ci = i * 3;
      if (t < thr) {
        cols[ci] = 0; cols[ci + 1] = 0; cols[ci + 2] = 0;
      } else {
        const [r, g, b] = layerColor(this.layer, Math.min(t, 1));
        cols[ci] = r; cols[ci + 1] = g; cols[ci + 2] = b;
      }
    }
    this.colorAttr.needsUpdate = true;

    // ── Paint-altitude guide plane (subtle horizontal ring) ───────────────────
    // (skip visual for MVP — altitude shown via z-slice label)

    // ── Entity markers ────────────────────────────────────────────────────────
    this._syncEntities(entities);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private _syncEntities(entities: EntityMarker[]): void {
    // Remove stale children
    while (this.entityGroup.children.length > entities.length) {
      const m = this.entityGroup.children[0] as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.entityGroup.remove(m);
    }
    // Add missing children
    const sGeo = new THREE.SphereGeometry(0.6, 8, 6);
    while (this.entityGroup.children.length < entities.length) {
      const m = new THREE.Mesh(sGeo, new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.entityGroup.add(m);
    }
    // Update positions + colors
    entities.forEach((e, idx) => {
      const m = this.entityGroup.children[idx] as THREE.Mesh;
      // grid (x, y, z) → THREE (x, z, y)
      m.position.set(e.centroid[0] + 0.5, e.centroid[2] + 0.5, e.centroid[1] + 0.5);
      const r = Math.min(1 + e.stability * 0.4, 2);
      m.scale.setScalar(r);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(e.color[0], e.color[1], e.color[2]);
      mat.opacity = 0.55 + e.stability * 0.45;
    });
  }

  // Returns the grid cell under the mouse on the current paint altitude plane.
  // Returns null if the ray misses or hits out of bounds.
  pickGridCell(e: PointerEvent): { x: number; y: number; z: number } | null {
    const rect = this.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);

    // Horizontal plane at THREE Y = paintAltitude + 0.5
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.paintAltitude + 0.5));
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;

    const gx = Math.floor(hit.x);
    const gy = Math.floor(hit.z);  // THREE Z → grid Y
    const gz = this.paintAltitude;

    if (gx < 0 || gx >= this._W || gy < 0 || gy >= this._H) return null;
    return { x: gx, y: gy, z: gz };
  }

  setPaintMode(enabled: boolean): void {
    this.paintMode = enabled;
    if (enabled) {
      // Paint mode: left-click is free for painting, right-click orbits
      (this.controls.mouseButtons as any) = {
        LEFT: -1,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    } else {
      // Explore mode: standard left=rotate, middle=zoom, right=pan
      (this.controls.mouseButtons as any) = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
    }
  }

  resetCamera(): void {
    const { _W: W, _H: H, _D: D } = this;
    this.camera.position.set(W * 1.5, D * 2.2, H * 1.5);
    this.controls.target.set(W / 2, D / 2, H / 2);
    this.controls.update();
  }

  destroy(): void {
    this._ro.disconnect();
    this.renderer.dispose();
  }
}
