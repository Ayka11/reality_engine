import * as THREE from 'three';
import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

const MAX_CREATURES = 8;
const BIO_THRESHOLD = 0.32;
const SCAN_INTERVAL = 60;

interface Creature {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  lArm: THREE.Mesh;
  rArm: THREE.Mesh;
  lLeg: THREE.Mesh;
  rLeg: THREE.Mesh;
  tail: THREE.Mesh;
  energy: number;
  pos: THREE.Vector3;
}

export class FieldAnimator {
  private scene: THREE.Scene;
  private grid: VoxelGrid;
  private creatures: Creature[] = [];
  private time = 0;
  private lastScan = -999;

  constructor(scene: THREE.Scene, grid: VoxelGrid) {
    this.scene = scene;
    this.grid = grid;
  }

  update(tick: number, dt: number): void {
    this.time += dt;
    if (tick - this.lastScan >= SCAN_INTERVAL) {
      this.lastScan = tick;
      this._rebuild();
    }
    this._animate();
  }

  private _rebuild(): void {
    const clusters = this._bfsClusters();
    while (this.creatures.length > clusters.length) this._destroyLast();
    while (this.creatures.length < clusters.length) this.creatures.push(this._makeCreature());
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      // Grid → Three.js: (gx, gy, gz) → (gx+0.5, gz+0.5, gy+0.5)
      this.creatures[i].pos.set(cl.cx + 0.5, cl.cz + 0.5, cl.cy + 0.5);
      this.creatures[i].energy = cl.energy;
    }
  }

  private _bfsClusters(): { cx: number; cy: number; cz: number; energy: number }[] {
    const { grid } = this;
    const { W, H, D } = grid;
    const buf = grid.buffer;
    const visited = new Uint8Array(W * H * D);
    const results: { cx: number; cy: number; cz: number; energy: number }[] = [];

    for (let gz = 0; gz < D; gz++)
    for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const fi = gz * H * W + gy * W + gx;
      if (visited[fi]) continue;
      if (buf[fi * CELL_FIELDS + F.BIO_POTENTIAL] < BIO_THRESHOLD) continue;

      const queue = [fi]; visited[fi] = 1;
      let sx = 0, sy = 0, sz = 0, se = 0, cnt = 0;

      while (queue.length > 0 && cnt < 512) {
        const cur = queue.pop()!;
        const cz2 = Math.floor(cur / (H * W));
        const rem = cur % (H * W);
        const cy2 = Math.floor(rem / W);
        const cx2 = rem % W;
        sx += cx2; sy += cy2; sz += cz2;
        se += buf[cur * CELL_FIELDS + F.ENERGY];
        cnt++;
        if (cx2 + 1 < W) { const nb = cur + 1;     if (!visited[nb] && buf[nb * CELL_FIELDS + F.BIO_POTENTIAL] >= BIO_THRESHOLD) { visited[nb] = 1; queue.push(nb); } }
        if (cx2 - 1 >= 0) { const nb = cur - 1;    if (!visited[nb] && buf[nb * CELL_FIELDS + F.BIO_POTENTIAL] >= BIO_THRESHOLD) { visited[nb] = 1; queue.push(nb); } }
        if (cy2 + 1 < H) { const nb = cur + W;     if (!visited[nb] && buf[nb * CELL_FIELDS + F.BIO_POTENTIAL] >= BIO_THRESHOLD) { visited[nb] = 1; queue.push(nb); } }
        if (cy2 - 1 >= 0) { const nb = cur - W;    if (!visited[nb] && buf[nb * CELL_FIELDS + F.BIO_POTENTIAL] >= BIO_THRESHOLD) { visited[nb] = 1; queue.push(nb); } }
        if (cz2 + 1 < D) { const nb = cur + H * W; if (!visited[nb] && buf[nb * CELL_FIELDS + F.BIO_POTENTIAL] >= BIO_THRESHOLD) { visited[nb] = 1; queue.push(nb); } }
        if (cz2 - 1 >= 0) { const nb = cur - H * W; if (!visited[nb] && buf[nb * CELL_FIELDS + F.BIO_POTENTIAL] >= BIO_THRESHOLD) { visited[nb] = 1; queue.push(nb); } }
      }
      if (cnt >= 8) {
        results.push({ cx: sx / cnt, cy: sy / cnt, cz: sz / cnt, energy: se / cnt });
        if (results.length >= MAX_CREATURES) return results;
      }
    }
    return results;
  }

  private _mat(hex: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.15, transparent: true, opacity: 0.88 });
  }

  private _makeCreature(): Creature {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.6), this._mat(0x44aa66));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6),  this._mat(0x66dd88));
    const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 0.2), this._mat(0x44aa66));
    const rArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 0.2), this._mat(0x44aa66));
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.2), this._mat(0x338855));
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.2), this._mat(0x338855));
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.45, 0.14), this._mat(0x44aa66));

    head.position.set(0, 0.75, 0);
    lArm.position.set(-0.5, 0.1, 0); lArm.rotation.z =  0.3;
    rArm.position.set( 0.5, 0.1, 0); rArm.rotation.z = -0.3;
    lLeg.position.set(-0.25, -0.87, 0);
    rLeg.position.set( 0.25, -0.87, 0);
    tail.position.set(0, -0.4, -0.35);

    const group = new THREE.Group();
    group.add(body, head, lArm, rArm, lLeg, rLeg, tail);
    this.scene.add(group);
    return { group, body, head, lArm, rArm, lLeg, rLeg, tail, energy: 100, pos: new THREE.Vector3() };
  }

  private _destroyLast(): void {
    const c = this.creatures.pop();
    if (!c) return;
    this.scene.remove(c.group);
    c.group.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }

  private _animate(): void {
    for (const c of this.creatures) {
      c.group.position.lerp(c.pos, 0.05);
      const spd = 0.5 + Math.min(c.energy, 400) * 0.003;
      const t = this.time * spd;
      c.body.scale.y = 1 + Math.sin(t * 1.2) * 0.05;
      c.head.rotation.x = Math.sin(t * 0.8) * 0.15;
      c.lArm.rotation.z =  0.3 + Math.sin(t) * 0.4;
      c.rArm.rotation.z = -0.3 - Math.sin(t) * 0.4;
      c.lLeg.rotation.x =  Math.sin(t * 1.1) * 0.35;
      c.rLeg.rotation.x = -Math.sin(t * 1.1) * 0.35;
      c.tail.rotation.y  = Math.sin(t * 1.5) * 0.3;
      c.group.rotation.y += 0.001 * Math.sin(t * 0.25);
    }
  }

  dispose(): void {
    while (this.creatures.length) this._destroyLast();
  }

  get creatureCount(): number { return this.creatures.length; }
}
