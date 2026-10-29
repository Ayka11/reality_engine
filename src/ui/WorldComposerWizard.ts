/**
 * World Composer Wizard
 * Interactive onboarding flow for creating first world
 * Used in HF Spaces as first-time user experience
 */

import { SemanticControls, getPreset, applySemanticControls } from '../composer/semanticMapper';

export interface WorldComposerStep {
  id: string;
  title: string;
  description: string;
  component: 'biome-picker' | 'preset-quick-select' | 'semantic-dialer' | 'review';
}

export const ONBOARDING_STEPS: WorldComposerStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Reality Engine',
    description: 'Create your first universe in 3 steps',
    component: 'preset-quick-select',
  },
  {
    id: 'biome',
    title: 'Choose a Biome',
    description: 'Start with procedural terrain generation',
    component: 'biome-picker',
  },
  {
    id: 'tune',
    title: 'Tune the Physics',
    description: 'High-level controls for world behavior',
    component: 'semantic-dialer',
  },
  {
    id: 'review',
    title: 'Review & Launch',
    description: 'See what you created',
    component: 'review',
  },
];

export const QUICK_PRESETS = [
  {
    name: 'Life Blooms',
    preset: 'demo',
    icon: '🌱',
    description: 'Watch organic life emerge and evolve',
  },
  {
    name: 'Chaotic Beauty',
    preset: 'artwork',
    icon: '🎨',
    description: 'Abstract entropy patterns',
  },
  {
    name: 'Lab Experiment',
    preset: 'research',
    icon: '🔬',
    description: 'Controlled scientific simulation',
  },
  {
    name: 'Game World',
    preset: 'game',
    icon: '🎮',
    description: 'Playable interactive scenario',
  },
];

export const BIOME_OPTIONS = [
  { name: 'Earth', value: 'earth', icon: '🌍', description: 'Terrain, water, weather' },
  { name: 'Ocean', value: 'ocean', icon: '🌊', description: 'Deep water ecosystems' },
  { name: 'Volcanic', value: 'volcanic', icon: '🌋', description: 'Magma vents and heat' },
  { name: 'Arctic', value: 'arctic', icon: '❄️', description: 'Ice and crystalline order' },
  { name: 'Alien', value: 'alien', icon: '👾', description: 'Crystal clusters, exotic' },
  { name: 'Forest', value: 'forest', icon: '🌲', description: 'Bio-dense canopy' },
  { name: 'Desert', value: 'desert', icon: '🏜️', description: 'Extreme heat and dunes' },
  { name: 'Crystalline', value: 'crystalline', icon: '💎', description: 'Fractal symmetry' },
];

export type BiomeType = 'earth' | 'ocean' | 'volcanic' | 'arctic' | 'alien' | 'forest' | 'desert' | 'crystalline';

export interface ComposerState {
  currentStep: number;
  selectedBiome: BiomeType | null;
  seed: number;
  semanticControls: SemanticControls | null;
  previewGenerated: boolean;
}

export class WorldComposerWizard {
  private state: ComposerState = {
    currentStep: 0,
    selectedBiome: null,
    seed: Math.floor(Math.random() * 100000),
    semanticControls: null,
    previewGenerated: false,
  };

  private listeners: (() => void)[] = [];
  private onComplete: ((state: ComposerState) => void) | null = null;

  constructor() {
    this.state.seed = Math.floor(Math.random() * 100000);
  }

  /**
   * Current step
   */
  getCurrentStep(): WorldComposerStep {
    return ONBOARDING_STEPS[this.state.currentStep];
  }

  /**
   * Move to next step
   */
  nextStep() {
    if (this.state.currentStep < ONBOARDING_STEPS.length - 1) {
      this.state.currentStep++;
      this.notifyListeners();
    }
  }

  /**
   * Move to previous step
   */
  previousStep() {
    if (this.state.currentStep > 0) {
      this.state.currentStep--;
      this.notifyListeners();
    }
  }

  /**
   * Jump to step by ID
   */
  goToStep(stepId: string) {
    const idx = ONBOARDING_STEPS.findIndex((s) => s.id === stepId);
    if (idx >= 0) {
      this.state.currentStep = idx;
      this.notifyListeners();
    }
  }

  /**
   * Select a quick preset
   */
  selectPreset(presetName: 'demo' | 'artwork' | 'research' | 'game') {
    this.state.semanticControls = getPreset(presetName);
    this.nextStep();
  }

  /**
   * Select a biome
   */
  selectBiome(biome: BiomeType) {
    this.state.selectedBiome = biome;
    this.nextStep();
  }

  /**
   * Update semantic controls (from sliders/dials)
   */
  updateSemanticControls(controls: Partial<SemanticControls>) {
    if (!this.state.semanticControls) {
      this.state.semanticControls = {
        worldMood: 'balanced',
        stability: 0.5,
        evolutionSpeed: 0.5,
        dominantForce: 'matter',
        targetOutcome: 'emergent_life',
        chaosLevel: 0.3,
      };
    }
    Object.assign(this.state.semanticControls, controls);
    this.notifyListeners();
  }

  /**
   * Randomize seed
   */
  randomizeSeed() {
    this.state.seed = Math.floor(Math.random() * 100000);
    this.notifyListeners();
  }

  /**
   * Get current state
   */
  getState(): ComposerState {
    return { ...this.state };
  }

  /**
   * Set completion callback
   */
  onCompletion(callback: (state: ComposerState) => void) {
    this.onComplete = callback;
  }

  /**
   * Finish wizard and generate world
   */
  complete() {
    if (this.state.selectedBiome && this.state.semanticControls) {
      const physicsParams = applySemanticControls(this.state.semanticControls);

      if (this.onComplete) {
        this.onComplete(this.state);
      }

      window.dispatchEvent(
        new CustomEvent('worldGenerated', {
          detail: {
            biome: this.state.selectedBiome,
            seed: this.state.seed,
            semanticControls: this.state.semanticControls,
            physicsParams,
          },
        })
      );

      console.log('✓ World generation initiated with:', {
        biome: this.state.selectedBiome,
        seed: this.state.seed,
        controls: this.state.semanticControls,
      });
    } else {
      console.warn('Cannot complete wizard: missing biome or semantic controls');
    }
  }

  /**
   * Cancel wizard
   */
  cancel() {
    window.dispatchEvent(new CustomEvent('composerCancelled'));
  }

  /**
   * Subscribe to state changes
   */
  onChange(callback: () => void) {
    this.listeners.push(callback);
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners() {
    this.listeners.forEach((cb) => cb());
  }

  /**
   * Get progress percentage
   */
  getProgress(): number {
    return ((this.state.currentStep + 1) / ONBOARDING_STEPS.length) * 100;
  }

  /**
   * Check if wizard is complete
   */
  isComplete(): boolean {
    return this.state.currentStep === ONBOARDING_STEPS.length - 1;
  }

  /**
   * Get step description
   */
  getStepDescription(): string {
    const step = this.getCurrentStep();
    return step.description;
  }
}

// Global singleton
let wizard: WorldComposerWizard | null = null;

export function getWorldComposerWizard(): WorldComposerWizard {
  if (!wizard) {
    wizard = new WorldComposerWizard();
  }
  return wizard;
}

/**
 * Create welcome modal HTML
 */
export function createWelcomeModal(): HTMLElement {
  const modal = document.createElement('div');
  modal.className = 'welcome-modal';
  modal.innerHTML = `
    <div class="welcome-content">
      <h1>🌍 Welcome to Reality Engine</h1>
      <p>Create a universe where physics evolves in real-time</p>
      <p class="subtitle">In 3 simple steps, you'll have your first world running</p>
      
      <div class="cta-buttons">
        <button id="btn-create-world" class="btn btn-primary">
          Create Your First World
        </button>
        <button id="btn-load-preset" class="btn btn-secondary">
          Load a Preset
        </button>
        <button id="btn-skip" class="btn btn-tertiary">
          Skip for now
        </button>
      </div>
      
      <div class="quick-facts">
        <div class="fact">
          <span class="icon">⚡</span>
          <span>Real-time physics evolution</span>
        </div>
        <div class="fact">
          <span class="icon">🧬</span>
          <span>Emergent life systems</span>
        </div>
        <div class="fact">
          <span class="icon">🎨</span>
          <span>Paint with semantic controls</span>
        </div>
      </div>
    </div>
  `;

  return modal;
}
