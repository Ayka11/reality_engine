import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

// Layer → field index + max value
const LAYER_FIELD = [F.ENERGY, F.DENSITY, F.INFORMATION, F.ENTROPY, F.TEMPERATURE, F.BIO_POTENTIAL, F.SIGNAL];
const LAYER_MAX   = [1000, 1, 500, 1, 800, 1, 100];

function buildWGSL(W: number, H: number, D: number, NF: number): string {
  return /* wgsl */`
struct Uniforms {
  camPos    : vec4f,   // xyz = pos
  camTarget : vec4f,   // xyz = target
  gridDim   : vec4f,   // x=W y=H z=D w=NF
  renderP   : vec4f,   // x=layer y=time z=screenW w=screenH
  sunDir    : vec4f,
  marchP    : vec4f,   // x=maxSteps y=stepSize z=fogDensity w=activeLayer
  layerInfo : vec4f,   // x=fieldIdx y=fieldMax
}
@group(0) @binding(0) var<storage,read> field : array<f32>;
@group(0) @binding(1) var<uniform>      u     : Uniforms;

const W_  = ${W};
const H_  = ${H};
const D_  = ${D};
const NF_ = ${NF};

fn safeIdx(x:i32, y:i32, z:i32, fi:i32) -> i32 {
  if (x<0 || x>=W_ || y<0 || y>=H_ || z<0 || z>=D_) { return -1; }
  return (z*H_*W_ + y*W_ + x)*NF_ + fi;
}
fn sampleF(x:i32, y:i32, z:i32, fi:i32) -> f32 {
  let i = safeIdx(x,y,z,fi);
  if (i < 0) { return 0.0; }
  return field[i];
}

fn trilinear(pos:vec3f, fi:i32) -> f32 {
  let fp = fract(pos);
  let x0 = i32(pos.x); let y0 = i32(pos.y); let z0 = i32(pos.z);
  let c000 = sampleF(x0,   y0,   z0,   fi);
  let c100 = sampleF(x0+1, y0,   z0,   fi);
  let c010 = sampleF(x0,   y0+1, z0,   fi);
  let c110 = sampleF(x0+1, y0+1, z0,   fi);
  let c001 = sampleF(x0,   y0,   z0+1, fi);
  let c101 = sampleF(x0+1, y0,   z0+1, fi);
  let c011 = sampleF(x0,   y0+1, z0+1, fi);
  let c111 = sampleF(x0+1, y0+1, z0+1, fi);
  let x0y0 = mix(c000, c100, fp.x);
  let x1y0 = mix(c010, c110, fp.x);
  let x0y1 = mix(c001, c101, fp.x);
  let x1y1 = mix(c011, c111, fp.x);
  return mix(mix(x0y0, x1y0, fp.y), mix(x0y1, x1y1, fp.y), fp.z);
}

fn energyCol(t:f32) -> vec3f {
  if (t < 0.15) { return vec3f(0.0, 0.0, t/0.15); }
  if (t < 0.4)  { let s=(t-0.15)/0.25; return vec3f(0.0, s*0.7, 1.0-s*0.7); }
  if (t < 0.7)  { let s=(t-0.4)/0.3;  return vec3f(s, 0.7-s*0.24, 0.0); }
  let s=(t-0.7)/0.3; return vec3f(1.0, 0.47+s*0.53, s);
}

fn layerCol(v:f32, layer:i32) -> vec4f {
  let mx = u.layerInfo.y;
  if (v < 0.5) { return vec4f(0.0); }
  let t = clamp(v / mx, 0.0, 1.0);
  var col: vec3f;
  if      (layer == 0) { col = energyCol(t); }
  else if (layer == 1) { col = mix(vec3f(0.0,0.15,0.05), vec3f(0.85,1.0,0.2), t); }
  else if (layer == 2) { col = mix(vec3f(0.12,0.0,0.22), vec3f(0.9,0.3,1.0),  t); }
  else if (layer == 3) { col = mix(vec3f(0.08,0.0,0.0),  vec3f(0.9,0.1,0.0),  t); }
  else if (layer == 4) { col = mix(vec3f(0.0,0.0,0.6),   vec3f(1.0,0.6,0.0),  t); }
  else if (layer == 5) { col = mix(vec3f(0.0,0.08,0.0),  vec3f(0.1,0.9,0.25), t); }
  else                 { col = mix(vec3f(0.0,0.1,0.25),  vec3f(0.0,0.8,1.0),  t); }
  let emissive = smoothstep(0.55, 1.0, t) * 1.6;
  return vec4f(col * (1.0 + emissive), t * 0.55);
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let sw = u.renderP.z; let sh = u.renderP.w;
  let uv = (fc.xy / vec2f(sw, sh)) * 2.0 - 1.0;
  let asp = sw / sh;

  let camPos    = u.camPos.xyz;
  let camTarget = u.camTarget.xyz;
  let fwd   = normalize(camTarget - camPos);
  let right = normalize(cross(fwd, vec3f(0.0,1.0,0.0)));
  let up    = cross(right, fwd);
  let halfFov = tan(radians(55.0));
  let rd = normalize(fwd + right*(uv.x*asp*halfFov) + up*(-uv.y*halfFov));

  // Ray vs AABB (world: x=0..W, y=0..D, z=0..H)
  let boxMin = vec3f(0.0,  0.0,  0.0);
  let boxMax = vec3f(f32(W_), f32(D_), f32(H_));
  let inv   = 1.0 / rd;
  let t1    = (boxMin - camPos) * inv;
  let t2    = (boxMax - camPos) * inv;
  let tN    = max(max(min(t1.x,t2.x), min(t1.y,t2.y)), min(t1.z,t2.z));
  let tF    = min(min(max(t1.x,t2.x), max(t1.y,t2.y)), max(t1.z,t2.z));
  if (tN > tF || tF < 0.0) { return vec4f(0.02,0.02,0.05,1.0); }

  let tStart = max(tN, 0.0);
  let layer  = i32(u.marchP.w);
  let fi     = i32(u.layerInfo.x);
  let step   = u.marchP.y;
  let maxSt  = i32(u.marchP.x);

  var acc  = vec3f(0.0); var alpha = 0.0;
  var tCur = tStart;

  for (var s = 0; s < maxSt; s++) {
    if (tCur > tF || alpha > 0.97) { break; }
    let wp  = camPos + rd * tCur;
    // world (x,y,z) → grid (gx=x, gy=z, gz=y)  (Three.js Y=up=altitude)
    let gp  = vec3f(wp.x, wp.z, wp.y);
    let v   = trilinear(gp, fi);
    let smp = layerCol(v, layer);
    let a   = smp.w * (1.0 - alpha) * step * 0.45;
    acc  += smp.xyz * a;
    alpha += a;
    tCur += step;
  }

  let fog    = exp(-tStart * u.marchP.z * 0.008);
  let fogCol = vec3f(0.02, 0.02, 0.06);
  let final  = mix(fogCol, acc / max(alpha, 0.001), fog * min(alpha*2.0, 1.0));
  return vec4f(final, min(alpha * 1.4, 1.0));
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f,6>(
    vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),
    vec2f(-1,-1),vec2f(1,1),vec2f(-1,1));
  return vec4f(pos[i], 0.0, 1.0);
}
`;
}

export class RaymarchRenderer {
  private canvas: HTMLCanvasElement;
  private grid: VoxelGrid;
  supported = false;
  layer = 0;
  time = 0;

  // Camera in THREE-style world coords (y=up)
  camPos:    [number,number,number];
  camTarget: [number,number,number];

  private device!:   GPUDevice;
  private ctx!:      GPUCanvasContext;
  private format!:   GPUTextureFormat;
  private pipeline!: GPURenderPipeline;
  private fieldBuf!: GPUBuffer;
  private unifBuf!:  GPUBuffer;
  private bindGroup!:GPUBindGroup;

  constructor(canvas: HTMLCanvasElement, grid: VoxelGrid) {
    this.canvas = canvas;
    this.grid   = grid;
    const { W, H, D } = grid;
    this.camPos    = [W * 1.4, D * 2.5, H * 1.4];
    this.camTarget = [W / 2,   0,       H / 2  ];
  }

  async init(): Promise<boolean> {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    this.device = await adapter.requestDevice();
    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) return false;
    this.ctx    = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
    this.supported = true;
    this._build();
    return true;
  }

  private _build(): void {
    const { device, grid } = this;
    const { W, H, D } = grid;
    const NF = CELL_FIELDS;

    this.fieldBuf = device.createBuffer({
      size: W * H * D * NF * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.unifBuf = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = device.createShaderModule({ code: buildWGSL(W, H, D, NF) });
    const bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ]});
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex:   { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs',
        targets: [{ format: this.format,
          blend: { color: { srcFactor:'src-alpha', dstFactor:'one-minus-src-alpha', operation:'add' },
                   alpha: { srcFactor:'one',       dstFactor:'one-minus-src-alpha', operation:'add' } } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.bindGroup = device.createBindGroup({ layout: bgl, entries: [
      { binding: 0, resource: { buffer: this.fieldBuf } },
      { binding: 1, resource: { buffer: this.unifBuf  } },
    ]});
  }

  private _uploadUniforms(): void {
    const { camPos: cp, camTarget: ct, layer, time, canvas, grid } = this;
    const { W, H, D } = grid;
    const d = new Float32Array(32);
    // camPos (vec4)
    d[0]=cp[0]; d[1]=cp[1]; d[2]=cp[2]; d[3]=1;
    // camTarget (vec4)
    d[4]=ct[0]; d[5]=ct[1]; d[6]=ct[2]; d[7]=0;
    // gridDim (vec4)
    d[8]=W; d[9]=H; d[10]=D; d[11]=CELL_FIELDS;
    // renderP (vec4): layer, time, screenW, screenH
    d[12]=layer; d[13]=time; d[14]=canvas.width||800; d[15]=canvas.height||600;
    // sunDir (vec4) - animated
    const sa = time * 0.08;
    d[16]=Math.cos(sa); d[17]=1.6; d[18]=Math.sin(sa); d[19]=0;
    // marchP (vec4): maxSteps, stepSize, fogDensity, activeLayer
    d[20]=72; d[21]=0.55; d[22]=0.04; d[23]=layer;
    // layerInfo (vec4): fieldIdx, fieldMax
    d[24]=LAYER_FIELD[layer] ?? 0; d[25]=LAYER_MAX[layer] ?? 1000;
    this.device.queue.writeBuffer(this.unifBuf, 0, d);
  }

  render(buf: Float32Array): void {
    if (!this.supported) return;
    this.time += 0.016;
    this.device.queue.writeBuffer(this.fieldBuf, 0, buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
    this._uploadUniforms();

    const tex = this.ctx.getCurrentTexture();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: tex.createView(),
        clearValue: { r:0.025, g:0.025, b:0.05, a:1 },
        loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  // Orbit camera around target
  orbit(dTheta: number, dPhi: number, dZoom: number): void {
    const [cx, cy, cz] = this.camPos;
    const [tx, , tz] = this.camTarget;
    const dx = cx - tx, dz = cz - tz;
    const r     = Math.sqrt(dx*dx + dz*dz);
    const theta = Math.atan2(dz, dx) + dTheta;
    const newR  = Math.max(8, r + dZoom);
    this.camPos = [
      tx + Math.cos(theta) * newR,
      Math.max(4, cy + dPhi * r * 0.4),
      tz + Math.sin(theta) * newR,
    ];
  }

  // Bind mouse/touch events to the canvas
  bindControls(canvas: HTMLCanvasElement): void {
    let lastX = 0, lastY = 0, down = false;
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 2 || e.button === 0) { down = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); }
    });
    canvas.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      this.orbit(dx * 0.008, -dy * 0.6, 0);
      lastX = e.clientX; lastY = e.clientY;
    });
    canvas.addEventListener('pointerup', () => { down = false; });
    canvas.addEventListener('wheel', e => { this.orbit(0, 0, e.deltaY * 0.15); e.preventDefault(); }, { passive: false });
  }

  resize(w: number, h: number): void {
    this.canvas.width = w; this.canvas.height = h;
  }
}
