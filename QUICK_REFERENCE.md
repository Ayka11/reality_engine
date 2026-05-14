/**
 * QUICK REFERENCE - Reality Engine UX System
 * Copy-paste snippets for common tasks
 */

// ============================================================================
// 1. INITIALIZE THE UX SYSTEM
// ============================================================================

import { getAppModeManager } from './src/ui/AppModes';
import { getRenderModeSwitch } from './src/render/RenderModeSwitch';
import { getWorldComposerWizard } from './src/ui/WorldComposerWizard';

const appModes = getAppModeManager();
const renderSwitch = getRenderModeSwitch();
const composer = getWorldComposerWizard();

// ============================================================================
// 2. APP MODES
// ============================================================================

// Switch mode
appModes.setMode('create');    // Create Mode
appModes.setMode('science');   // Science Mode
appModes.setMode('cinema');    // Cinema Mode
appModes.setMode('gamedev');   // Game Dev Mode

// Get current config
const config = appModes.getCurrentConfig();
console.log(config.primaryPanels);   // What panels are visible
console.log(config.color);            // Mode color (#FF6B9D, #00D9FF, etc.)

// Listen for mode changes
appModes.onChange((newMode) => {
  console.log(`Switched to ${newMode}`);
});

// ============================================================================
// 3. RENDER MODES
// ============================================================================

// Switch render mode
renderSwitch.switchTo('3d');      // Full 3D volumetric
renderSwitch.switchTo('2d');      // Multi-layer 2D
renderSwitch.switchTo('hybrid');  // 3D + 2D inspector

// Keyboard shortcuts
renderSwitch.toggle();    // Toggle 3D ↔ 2D
renderSwitch.cycle();     // Cycle: 3D → 2D → Hybrid → 3D

// Check current mode
if (renderSwitch.isMode('3d')) {
  console.log('Currently in 3D mode');
}

// Listen for changes
renderSwitch.onChange((mode) => {
  console.log(`Render mode changed to: ${mode}`);
});

// ============================================================================
// 4. SEMANTIC CONTROLS (High-Level Physics Tuning)
// ============================================================================

import { applySemanticControls, getPreset, describeSemanticConfig } from './src/composer/semanticMapper';

// Use a preset
const demoConfig = getPreset('demo');        // Demo preset
const artConfig = getPreset('artwork');      // Art preset
const gameConfig = getPreset('game');        // Game preset
const researchConfig = getPreset('research');// Research preset

// Apply to engine
const physicsParams = applySemanticControls(demoConfig);
window.realityEngine?.lawEngine.applyGlobalParams(physicsParams);

// Or create custom config
const customConfig = {
  worldMood: 'fertile',
  stability: 0.8,
  evolutionSpeed: 0.6,
  dominantForce: 'biology',
  targetOutcome: 'emergent_life',
  chaosLevel: 0.2,
};

applySemanticControls(customConfig);

// Get human-readable description
const description = describeSemanticConfig(demoConfig);
console.log(description);
// Output:
// 🌍 Mood: DEMO
// ⚖️ Stability: 60%
// ⚡ Evolution Speed: 70%
// etc.

// ============================================================================
// 5. WORLD COMPOSER WIZARD (Onboarding)
// ============================================================================

// Listen for completion
composer.onCompletion((state) => {
  console.log('World generated:', state);
  console.log('  Biome:', state.selectedBiome);
  console.log('  Seed:', state.seed);
  console.log('  Controls:', state.semanticControls);
});

// Navigate wizard
composer.nextStep();           // Go to next step
composer.previousStep();       // Go back
composer.goToStep('biome');    // Jump to step

// Select options
composer.selectPreset('demo');
composer.selectBiome('earth');
composer.updateSemanticControls({
  stability: 0.7,
  evolutionSpeed: 0.5,
});

// Finish
composer.complete();           // Generate world
composer.cancel();             // Exit

// Get info
console.log(composer.getProgress());    // 0–100%
console.log(composer.getCurrentStep()); // Current step object

// ============================================================================
// 6. UI COMPONENTS (Ready-to-Use)
// ============================================================================

import {
  createSemanticControlsPanel,
  createRenderModeSwitcher,
  createAppModeTabs,
} from './src/ui/UXIntegration';

// Create semantic controls panel
const semanticPanel = createSemanticControlsPanel((controls) => {
  console.log('User changed controls:', controls);
  applySemanticControls(controls);
});
document.getElementById('left-sidebar').appendChild(semanticPanel);

// Create render mode switcher
const renderSwitcher = createRenderModeSwitcher((mode) => {
  renderSwitch.switchTo(mode);
});
document.getElementById('top-bar').appendChild(renderSwitcher);

// Create app mode tabs
const modeTabs = createAppModeTabs((mode) => {
  appModes.setMode(mode);
});
document.getElementById('top-bar').appendChild(modeTabs);

// ============================================================================
// 7. KEYBOARD SHORTCUTS
// ============================================================================

document.addEventListener('keydown', (e) => {
  // Ctrl+Tab: Toggle render mode
  if (e.ctrlKey && e.key === 'Tab') {
    renderSwitch.toggle();
  }

  // Ctrl+M: Cycle app mode
  if (e.ctrlKey && e.key === 'm') {
    appModes.cycleMode();
  }

  // Ctrl+Shift+P: Show presets
  if (e.ctrlKey && e.shiftKey && e.key === 'P') {
    console.log('Show presets menu');
  }
});

// ============================================================================
// 8. EVENTS (Listen to UX Changes)
// ============================================================================

// App mode changed
window.addEventListener('appModeChanged', (e) => {
  const { mode, config } = e.detail;
  console.log(`App mode changed to: ${mode}`);
  console.log('Config:', config);
});

// Render mode changed
window.addEventListener('renderModeChanged', (e) => {
  const { mode } = e.detail;
  console.log(`Render mode changed to: ${mode}`);
});

// World generated (from wizard)
window.addEventListener('worldGenerated', (e) => {
  const { biome, seed, semanticControls, physicsParams } = e.detail;
  console.log('New world:', { biome, seed, semanticControls });
});

// ============================================================================
// 9. COMMON WORKFLOWS
// ============================================================================

// Workflow 1: First-time user onboarding
function onboardNewUser() {
  appModes.setMode('create');
  
  composer.onCompletion((state) => {
    generateWorld(state);
  });
  
  // Show welcome modal or wizard UI
}

// Workflow 2: Science mode with metrics
function switchToScience() {
  appModes.setMode('science');
  
  // Now only science-relevant panels are visible
  // User can see metrics, causal graphs, data export, etc.
}

// Workflow 3: Cinematic recording
function startCinematicMode() {
  appModes.setMode('cinema');
  renderSwitch.switchTo('3d');  // Ensure high-quality 3D
  
  // Now user has access to:
  // - Camera paths
  // - Lighting controls
  // - Post-effects
  // - Timeline
}

// Workflow 4: Low-power device fallback
function detectWeakDevice() {
  if (!navigator.gpu) {
    // WebGPU not available, use 2D mode
    renderSwitch.switchTo('2d');
    
    // Optionally warn user
    console.warn('WebGPU not available, using 2D mode');
  }
}

// ============================================================================
// 10. DEBUGGING
// ============================================================================

// Log all available modes
const allModes = appModes.getAllModes();
console.log('Available modes:', allModes);

// Check current mode
console.log('Current app mode:', appModes.getMode());
console.log('Current render mode:', renderSwitch.getMode());

// Get full configuration
const fullConfig = appModes.getCurrentConfig();
console.log('Full mode config:', fullConfig);

// Describe semantic configuration
import { describeSemanticConfig } from './src/composer/semanticMapper';
const desc = describeSemanticConfig(customConfig);
console.log(desc);

// ============================================================================
// 11. CSS CUSTOMIZATION
// ============================================================================

/*
In your CSS or <style> tag:

:root {
  --mode-color: #FF6B9D;        // Current mode color (updates automatically)
  --color-create: #FF6B9D;      // Create mode pink
  --color-science: #00D9FF;     // Science mode cyan
  --color-cinema: #6C63FF;      // Cinema mode purple
  --color-gamedev: #FF006E;     // Game Dev mode red
  --bg-primary: #0a0e27;        // Dark background
  --text-primary: #ffffff;      // Light text
}

.mode-btn.active {
  background: var(--mode-color);  // Automatically uses correct color
}
*/

// ============================================================================
// 12. RESPONSIVE HANDLING
// ============================================================================

// Detect mobile
const isMobile = window.innerWidth < 768;

if (isMobile) {
  // On mobile, use 2D mode for better performance
  renderSwitch.switchTo('2d');
  
  // Hide complex panels
  // (automatically handled by mode system)
}

// Listen for window resize
window.addEventListener('resize', () => {
  if (window.innerWidth < 768) {
    // Switch to mobile layout
  }
});

// ============================================================================
// 13. INTEGRATION WITH REALITY ENGINE
// ============================================================================

/*
Your main.ts should look like:

import { SimulationEngine } from './src/simulation/SimulationEngine';
import { initializeUXSystem } from './src/ui/UXIntegration';

// Create engine
const engine = new SimulationEngine();
window.realityEngine = engine;

// Initialize UX
const { appModeManager, renderSwitch, composerWizard } = initializeUXSystem();

// Set default mode for HF Spaces
appModeManager.setMode('create');

// Show onboarding if first visit
if (!localStorage.getItem('reality-visited')) {
  showWelcomeModal(composerWizard);
  localStorage.setItem('reality-visited', 'true');
}

// Listen for world generation
window.addEventListener('worldGenerated', (e) => {
  const { biome, seed, semanticControls } = e.detail;
  engine.generateWorld(biome, seed, semanticControls);
});
*/
