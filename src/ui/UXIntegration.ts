/**
 * Integration Guide - How to wire up the new UX system
 * 
 * This guide shows how to integrate semantic controls, render modes, 
 * app modes, and the world composer wizard into your main app.
 */

// ============================================================================
// 1. INITIALIZATION
// ============================================================================

import { getAppModeManager } from './AppModes';
import { getRenderModeSwitch } from '../render/RenderModeSwitch';
import { getWorldComposerWizard } from './WorldComposerWizard';

export function initializeUXSystem() {
  const appModeManager = getAppModeManager();
  const renderModeSwitch = getRenderModeSwitch();
  const composerWizard = getWorldComposerWizard();

  console.log('✓ UX System initialized');

  return { appModeManager, renderModeSwitch, composerWizard };
}

// ============================================================================
// 2. MAIN APP SETUP (in your main.ts or app initialization)
// ============================================================================

/*
import { initializeUXSystem } from './ux/UXIntegration';

// After your Reality Engine is created:
const { appModeManager, renderModeSwitch, composerWizard } = initializeUXSystem();

// Set default mode for HF Spaces
appModeManager.setMode('create');

// Show welcome modal on first load (check localStorage)
if (!localStorage.getItem('reality-engine-visited')) {
  showWelcomeModal();
  localStorage.setItem('reality-engine-visited', 'true');
}

// Wire up keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && e.ctrlKey) {
    renderModeSwitch.toggle(); // Ctrl+Tab to switch render modes
  }
  if (e.key === 'm' && e.ctrlKey) {
    appModeManager.cycleMode(); // Ctrl+M to cycle modes
  }
});
*/

// ============================================================================
// 3. WELCOME FLOW
// ============================================================================

export function showWelcomeModal() {
  const composer = getWorldComposerWizard();
  
  composer.onCompletion((state) => {
    console.log('World created with config:', state);
    // Trigger world generation in your engine
    generateWorldFromComposer(state);
  });

  // Listen for "Create World" button click
  const btn = document.getElementById('btn-create-world');
  if (btn) {
    btn.addEventListener('click', () => {
      composer.nextStep(); // Move to biome selection
      showComposerUI(composer);
    });
  }
}

export function showComposerUI(composer: any) {
  const container = document.getElementById('composer-wizard-container');
  if (!container) return;

  const step = composer.getCurrentStep();
  
  // Render based on step type
  switch (step.component) {
    case 'preset-quick-select':
      renderPresetQuickSelect(container, composer);
      break;
    case 'biome-picker':
      renderBiomePicker(container, composer);
      break;
    case 'semantic-dialer':
      renderSemanticDialer(container, composer);
      break;
    case 'review':
      renderReview(container, composer);
      break;
  }
}

// ============================================================================
// 4. SEMANTIC CONTROLS PANEL
// ============================================================================

export function createSemanticControlsPanel(onUpdate: (controls: any) => void) {
  const panel = document.createElement('div');
  panel.className = 'semantic-controls-panel';
  
  panel.innerHTML = `
    <div class="control-group">
      <label>🌍 World Mood</label>
      <div class="mood-buttons">
        <button class="mood-btn" data-mood="frozen">❄️ Frozen</button>
        <button class="mood-btn" data-mood="volatile">🔥 Volatile</button>
        <button class="mood-btn" data-mood="fertile">🌿 Fertile</button>
        <button class="mood-btn" data-mood="hostile">⚠️ Hostile</button>
        <button class="mood-btn" data-mood="chaotic">🌀 Chaotic</button>
        <button class="mood-btn active" data-mood="balanced">⚖️ Balanced</button>
      </div>
    </div>

    <div class="control-group">
      <label>⚖️ Stability <span id="stability-value">50%</span></label>
      <input type="range" id="slider-stability" min="0" max="100" value="50" class="slider">
      <p class="hint">Fragile → Self-Repairing</p>
    </div>

    <div class="control-group">
      <label>⚡ Evolution Speed <span id="speed-value">50%</span></label>
      <input type="range" id="slider-evolution" min="0" max="100" value="50" class="slider">
      <p class="hint">Slow → Explosive</p>
    </div>

    <div class="control-group">
      <label>💫 Dominant Force</label>
      <div class="force-buttons">
        <button class="force-btn" data-force="matter">⚪ Matter</button>
        <button class="force-btn" data-force="energy">🔋 Energy</button>
        <button class="force-btn" data-force="information">💭 Information</button>
        <button class="force-btn" data-force="biology">🧬 Biology</button>
        <button class="force-btn" data-force="civilization">🏛️ Civilization</button>
      </div>
    </div>

    <div class="control-group">
      <label>🎯 Target Outcome</label>
      <select id="outcome-select">
        <option value="emergent_life">🌱 Emergent Life</option>
        <option value="stable_ecosystem">🏞️ Stable Ecosystem</option>
        <option value="civilization_rise">📈 Civilization Rise</option>
        <option value="info_singularity">🧠 Info Singularity</option>
        <option value="entropy_art">🎨 Entropy Art</option>
      </select>
    </div>

    <div class="control-group">
      <label>🌀 Chaos <span id="chaos-value">30%</span></label>
      <input type="range" id="slider-chaos" min="0" max="100" value="30" class="slider">
    </div>

    <div class="control-actions">
      <button id="btn-randomize" class="btn btn-secondary">🎲 Randomize</button>
      <button id="btn-apply" class="btn btn-primary">✓ Apply</button>
    </div>
  `;

  // Event listeners
  panel.querySelectorAll('.mood-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      panel.querySelectorAll('.mood-btn').forEach((b) => b.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');
      updateControls();
    });
  });

  panel.querySelectorAll('.force-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      panel.querySelectorAll('.force-btn').forEach((b) => b.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');
      updateControls();
    });
  });

  const updateValueDisplay = (slider: HTMLInputElement, valueSpan: HTMLElement) => {
    valueSpan.textContent = slider.value + '%';
  };

  const sliders = {
    stability: panel.querySelector('#slider-stability') as HTMLInputElement,
    evolution: panel.querySelector('#slider-evolution') as HTMLInputElement,
    chaos: panel.querySelector('#slider-chaos') as HTMLInputElement,
  };

  sliders.stability?.addEventListener('input', (e) => {
    const span = panel.querySelector('#stability-value') as HTMLElement | null;
    if (span) updateValueDisplay(e.target as HTMLInputElement, span);
    updateControls();
  });

  sliders.evolution?.addEventListener('input', (e) => {
    const span = panel.querySelector('#speed-value') as HTMLElement | null;
    if (span) updateValueDisplay(e.target as HTMLInputElement, span);
    updateControls();
  });

  sliders.chaos?.addEventListener('input', (e) => {
    const span = panel.querySelector('#chaos-value') as HTMLElement | null;
    if (span) updateValueDisplay(e.target as HTMLInputElement, span);
    updateControls();
  });

  const updateControls = () => {
    const activeMood = panel.querySelector('.mood-btn.active')?.getAttribute('data-mood') || 'balanced';
    const activeForce = panel.querySelector('.force-btn.active')?.getAttribute('data-force') || 'matter';
    const outcome = (panel.querySelector('#outcome-select') as HTMLSelectElement).value;

    onUpdate({
      worldMood: activeMood,
      stability: parseInt(sliders.stability.value) / 100,
      evolutionSpeed: parseInt(sliders.evolution.value) / 100,
      dominantForce: activeForce,
      targetOutcome: outcome,
      chaosLevel: parseInt(sliders.chaos.value) / 100,
    });
  };

  return panel;
}

// ============================================================================
// 5. RENDER MODE SWITCHER UI
// ============================================================================

export function createRenderModeSwitcher(onModeChange: (mode: string) => void) {
  const switcher = document.createElement('div');
  switcher.className = 'render-mode-switcher';
  
  switcher.innerHTML = `
    <div class="mode-buttons">
      <button class="mode-btn active" data-mode="3d">
        <span class="icon">🎨</span>
        <span class="label">3D Volumetric</span>
      </button>
      <button class="mode-btn" data-mode="2d">
        <span class="icon">📊</span>
        <span class="label">2D Layers</span>
      </button>
      <button class="mode-btn" data-mode="hybrid">
        <span class="icon">🔀</span>
        <span class="label">Hybrid</span>
      </button>
    </div>
  `;

  switcher.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      switcher.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
      (e.target as HTMLElement).closest('.mode-btn')?.classList.add('active');
      const mode = (e.target as HTMLElement).closest('.mode-btn')?.getAttribute('data-mode');
      if (mode) {
        onModeChange(mode);
      }
    });
  });

  return switcher;
}

// ============================================================================
// 6. APP MODE TABS
// ============================================================================

export function createAppModeTabs(onModeChange: (mode: string) => void) {
  const tabs = document.createElement('div');
  tabs.className = 'app-mode-tabs';
  
  tabs.innerHTML = `
    <button class="mode-tab active" data-mode="create">✨ Create</button>
    <button class="mode-tab" data-mode="science">📊 Science</button>
    <button class="mode-tab" data-mode="cinema">🎥 Cinema</button>
    <button class="mode-tab" data-mode="gamedev">🎮 Game Dev</button>
  `;

  tabs.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      tabs.querySelectorAll('.mode-tab').forEach((b) => b.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');
      const mode = (e.target as HTMLElement).getAttribute('data-mode');
      if (mode) {
        onModeChange(mode);
      }
    });
  });

  return tabs;
}

// ============================================================================
// 7. PLACEHOLDER IMPLEMENTATIONS (replace with real generators)
// ============================================================================

function renderPresetQuickSelect(_container: HTMLElement, _composer: any) {
  // TODO: Implement preset UI
}

function renderBiomePicker(_container: HTMLElement, _composer: any) {
  // TODO: Implement biome selector UI
}

function renderSemanticDialer(container: HTMLElement, composer: any) {
  const panel = createSemanticControlsPanel((controls) => {
    composer.updateSemanticControls(controls);
  });
  container.innerHTML = '';
  container.appendChild(panel);
}

function renderReview(_container: HTMLElement, _composer: any) {
  // TODO: Implement review/confirm UI
}

function generateWorldFromComposer(state: any) {
  // TODO: Wire to your world generation system
  console.log('Generating world:', state);
}
