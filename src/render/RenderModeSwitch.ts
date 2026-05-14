/**
 * Render Mode Switch - 2D / 3D / Hybrid rendering
 * Allows users to toggle between viewing modes for accessibility and performance
 */

export type RenderMode = '2d' | '3d' | 'hybrid';

export interface RenderModeConfig {
  mode: RenderMode;
  label: string;
  icon: string;
  description: string;
}

export const RENDER_MODES: Record<RenderMode, RenderModeConfig> = {
  '2d': {
    mode: '2d',
    label: '2D Layers',
    icon: '📊',
    description: 'Multi-layer 2D Z-slice inspector. Great for precision and weaker devices.',
  },
  '3d': {
    mode: '3d',
    label: '3D Volumetric',
    icon: '🎨',
    description: 'Full 3D WebGPU raymarched rendering with bloom and lighting.',
  },
  hybrid: {
    mode: 'hybrid',
    label: 'Hybrid',
    icon: '🔀',
    description: '3D + 2D side-by-side inspector (experimental).',
  },
};

export class RenderModeSwitch {
  private currentMode: RenderMode = '3d';
  private canvas3D: HTMLCanvasElement | null = null;
  private canvas2D: HTMLCanvasElement | null = null;
  private listeners: ((mode: RenderMode) => void)[] = [];

  constructor() {
    this.initializeCanvases();
  }

  private initializeCanvases() {
    this.canvas3D = document.getElementById('three-canvas') as HTMLCanvasElement;
    this.canvas2D = document.getElementById('canvas-2d') as HTMLCanvasElement;
  }

  /**
   * Switch between render modes
   */
  switchTo(mode: RenderMode) {
    if (mode === this.currentMode) return;

    this.currentMode = mode;

    switch (mode) {
      case '2d':
        this.enable2DMode();
        break;
      case '3d':
        this.enable3DMode();
        break;
      case 'hybrid':
        this.enableHybridMode();
        break;
    }

    // Notify listeners
    this.listeners.forEach((cb) => cb(mode));

    // Dispatch custom event for other components
    window.dispatchEvent(
      new CustomEvent('renderModeChanged', { detail: { mode } })
    );
  }

  /**
   * Enable 2D multi-layer mode
   * Shows Z-slices stacked or as tabs
   */
  private enable2DMode() {
    if (this.canvas3D) {
      this.canvas3D.style.display = 'none';
    }
    if (this.canvas2D) {
      this.canvas2D.style.display = 'block';
    }

    // Notify engine if available
    const engine = (window as any).realityEngine;
    if (engine?.renderer?.enable2DMode) {
      engine.renderer.enable2DMode(true);
    }

    console.log('✓ 2D Layer Mode enabled');
  }

  /**
   * Enable 3D volumetric mode
   */
  private enable3DMode() {
    if (this.canvas3D) {
      this.canvas3D.style.display = 'block';
    }
    if (this.canvas2D) {
      this.canvas2D.style.display = 'none';
    }

    const engine = (window as any).realityEngine;
    if (engine?.renderer?.enable2DMode) {
      engine.renderer.enable2DMode(false);
    }

    console.log('✓ 3D Volumetric Mode enabled');
  }

  /**
   * Enable hybrid mode - 3D main view + 2D inspector side-by-side
   */
  private enableHybridMode() {
    if (this.canvas3D) {
      this.canvas3D.style.display = 'block';
      this.canvas3D.style.width = '70%';
    }
    if (this.canvas2D) {
      this.canvas2D.style.display = 'block';
      this.canvas2D.style.width = '30%';
    }

    console.log('✓ Hybrid Mode enabled (3D + 2D inspector)');
  }

  /**
   * Get current mode
   */
  getMode(): RenderMode {
    return this.currentMode;
  }

  /**
   * Subscribe to mode changes
   */
  onChange(callback: (mode: RenderMode) => void) {
    this.listeners.push(callback);
  }

  /**
   * Check if a specific mode is active
   */
  isMode(mode: RenderMode): boolean {
    return this.currentMode === mode;
  }

  /**
   * Toggle between 3D and 2D (keyboard shortcut)
   */
  toggle() {
    const next: RenderMode = this.currentMode === '3d' ? '2d' : '3d';
    this.switchTo(next);
  }

  /**
   * Cycle through all modes
   */
  cycle() {
    const modes: RenderMode[] = ['3d', '2d', 'hybrid'];
    const currentIdx = modes.indexOf(this.currentMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    this.switchTo(nextMode);
  }
}

// Global singleton
let renderModeSwitcher: RenderModeSwitch | null = null;

export function getRenderModeSwitch(): RenderModeSwitch {
  if (!renderModeSwitcher) {
    renderModeSwitcher = new RenderModeSwitch();
  }
  return renderModeSwitcher;
}
