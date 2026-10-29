/**
 * App Mode System
 * Create / Science / Cinema / Game Dev modes with context-aware UI layouts
 * Dramatically reduces cognitive overload by hiding irrelevant features
 */

export type AppMode = 'create' | 'science' | 'cinema' | 'gamedev';

export interface PanelConfig {
  id: string;
  title: string;
  icon: string;
  collapsible: boolean;
  defaultOpen: boolean;
}

export interface ModeConfig {
  mode: AppMode;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  primaryPanels: string[];        // Left sidebar panels
  rightPanel: string;              // Right sidebar single panel
  bottomPanels: string[];          // Bottom inspector/timeline
  hiddenPanels: string[];          // Completely hide these
  keyboardShortcuts: Record<string, string>;
  defaultBrushSet: string;
  autoIntroduction: boolean;
}

/**
 * Mode configurations - the heart of the UX overhaul
 */
export const MODE_CONFIGS: Record<AppMode, ModeConfig> = {
  create: {
    mode: 'create',
    title: 'Create Mode',
    subtitle: 'Paint universes with semantic controls',
    icon: '✨',
    color: '#FF6B9D',
    primaryPanels: ['world-composer', 'semantic-controls', 'intelligent-brushes', 'presets'],
    rightPanel: 'simulation-health',
    bottomPanels: ['quick-timeline'],
    hiddenPanels: ['raw-laws', 'advanced-metrics', 'data-export', 'entity-editor', 'rulesets', 'win-conditions', 'playtest'],
    keyboardShortcuts: {
      'C': 'Toggle Composer',
      'B': 'Brush Menu',
      'S': 'Save World',
      'V': 'Play/Pause',
    },
    defaultBrushSet: 'semantic',
    autoIntroduction: true,
  },

  science: {
    mode: 'science',
    title: 'Scientific Mode',
    subtitle: 'Analyze emergent phenomena in detail',
    icon: '📊',
    color: '#00D9FF',
    primaryPanels: ['metrics-dashboard', 'causal-inspector', 'timeline', 'process-monitor'],
    rightPanel: 'health-explainability',
    bottomPanels: ['data-inspector', 'csv-export'],
    hiddenPanels: ['semantic-controls', 'intelligent-brushes', 'camera-paths', 'lighting', 'entity-editor'],
    keyboardShortcuts: {
      'D': 'Toggle Dashboard',
      'E': 'Export Data',
      'R': 'Record Session',
      'T': 'Snapshot Timeline',
    },
    defaultBrushSet: 'none',
    autoIntroduction: false,
  },

  cinema: {
    mode: 'cinema',
    title: 'Cinematic Mode',
    subtitle: 'Direct and render beautiful sequences',
    icon: '🎥',
    color: '#6C63FF',
    primaryPanels: ['director-panel', 'camera-paths', 'lighting-controls', 'post-effects'],
    rightPanel: 'render-settings',
    bottomPanels: ['keyframe-timeline', 'animation-preview'],
    hiddenPanels: ['semantic-controls', 'process-monitor', 'entity-editor', 'data-export'],
    keyboardShortcuts: {
      'K': 'Set Keyframe',
      'P': 'Preview',
      'R': 'Render',
      'L': 'Lighting',
    },
    defaultBrushSet: 'none',
    autoIntroduction: false,
  },

  gamedev: {
    mode: 'gamedev',
    title: 'Game Dev Mode',
    subtitle: 'Build interactive experiences with rules',
    icon: '🎮',
    color: '#FF006E',
    primaryPanels: ['entity-editor', 'ai-agents', 'rulesets', 'win-conditions', 'interaction-mapper'],
    rightPanel: 'playtest-panel',
    bottomPanels: ['event-log', 'debug-console'],
    hiddenPanels: ['semantic-controls', 'lighting-controls', 'post-effects', 'causal-inspector'],
    keyboardShortcuts: {
      'E': 'Entity Editor',
      'R': 'Rules',
      'P': 'Playtest',
      'D': 'Debug',
    },
    defaultBrushSet: 'none',
    autoIntroduction: false,
  },
};

/**
 * Panel registry - all available panels in the system
 */
export const PANEL_REGISTRY: Record<string, PanelConfig> = {
  // Create mode panels
  'world-composer': { id: 'world-composer', title: 'World Composer', icon: '🌍', collapsible: true, defaultOpen: true },
  'semantic-controls': { id: 'semantic-controls', title: 'Semantic Controls', icon: '🎚️', collapsible: true, defaultOpen: true },
  'intelligent-brushes': { id: 'intelligent-brushes', title: 'Intelligent Brushes', icon: '🖌️', collapsible: true, defaultOpen: true },
  'presets': { id: 'presets', title: 'Presets', icon: '📦', collapsible: true, defaultOpen: false },

  // Science mode panels
  'metrics-dashboard': { id: 'metrics-dashboard', title: 'Metrics Dashboard', icon: '📈', collapsible: true, defaultOpen: true },
  'causal-inspector': { id: 'causal-inspector', title: 'Causal Graph', icon: '🔗', collapsible: true, defaultOpen: true },
  'timeline': { id: 'timeline', title: 'Timeline', icon: '⏱️', collapsible: true, defaultOpen: true },
  'process-monitor': { id: 'process-monitor', title: 'Process Monitor', icon: '⚙️', collapsible: true, defaultOpen: false },

  // Cinema mode panels
  'director-panel': { id: 'director-panel', title: 'Scene Director', icon: '🎬', collapsible: true, defaultOpen: true },
  'camera-paths': { id: 'camera-paths', title: 'Camera Paths', icon: '📹', collapsible: true, defaultOpen: true },
  'lighting-controls': { id: 'lighting-controls', title: 'Lighting', icon: '💡', collapsible: true, defaultOpen: true },
  'post-effects': { id: 'post-effects', title: 'Post Effects', icon: '✨', collapsible: true, defaultOpen: false },

  // Game Dev mode panels
  'entity-editor': { id: 'entity-editor', title: 'Entity Editor', icon: '👾', collapsible: true, defaultOpen: true },
  'ai-agents': { id: 'ai-agents', title: 'AI Agents', icon: '🤖', collapsible: true, defaultOpen: true },
  'rulesets': { id: 'rulesets', title: 'Rulesets', icon: '📜', collapsible: true, defaultOpen: true },
  'win-conditions': { id: 'win-conditions', title: 'Win Conditions', icon: '🏆', collapsible: true, defaultOpen: false },

  // Shared panels
  'simulation-health': { id: 'simulation-health', title: 'Simulation Health', icon: '❤️', collapsible: false, defaultOpen: true },
  'health-explainability': { id: 'health-explainability', title: 'Explainability', icon: '💭', collapsible: false, defaultOpen: true },
  'render-settings': { id: 'render-settings', title: 'Render Settings', icon: '⚙️', collapsible: false, defaultOpen: true },
  'playtest-panel': { id: 'playtest-panel', title: 'Playtest', icon: '🎮', collapsible: false, defaultOpen: true },

  // Bottom panels
  'quick-timeline': { id: 'quick-timeline', title: 'Timeline', icon: '⏱️', collapsible: true, defaultOpen: false },
  'data-inspector': { id: 'data-inspector', title: 'Data Inspector', icon: '🔍', collapsible: true, defaultOpen: false },
  'csv-export': { id: 'csv-export', title: 'Export', icon: '💾', collapsible: true, defaultOpen: false },
  'keyframe-timeline': { id: 'keyframe-timeline', title: 'Keyframes', icon: '⏱️', collapsible: false, defaultOpen: true },
  'animation-preview': { id: 'animation-preview', title: 'Preview', icon: '▶️', collapsible: true, defaultOpen: true },
  'event-log': { id: 'event-log', title: 'Event Log', icon: '📝', collapsible: true, defaultOpen: false },
  'debug-console': { id: 'debug-console', title: 'Debug', icon: '🐛', collapsible: true, defaultOpen: false },
};

/**
 * App mode manager - handles switching and layout updates
 */
export class AppModeManager {
  private currentMode: AppMode = 'create';
  private listeners: ((mode: AppMode) => void)[] = [];

  constructor(initialMode: AppMode = 'create') {
    this.currentMode = initialMode;
  }

  /**
   * Switch to a new app mode and update UI
   */
  setMode(mode: AppMode) {
    if (mode === this.currentMode) return;

    this.currentMode = mode;
    const config = MODE_CONFIGS[mode];

    // Update layout
    this.updateLayout(config);

    // Show/hide panels
    this.updatePanelVisibility(config);

    // Dispatch event
    window.dispatchEvent(
      new CustomEvent('appModeChanged', { detail: { mode, config } })
    );

    // Notify listeners
    this.listeners.forEach((cb) => cb(mode));

    console.log(`✓ Mode switched to: ${mode}`);
  }

  /**
   * Get current mode config
   */
  getCurrentConfig(): ModeConfig {
    return MODE_CONFIGS[this.currentMode];
  }

  /**
   * Get current mode
   */
  getMode(): AppMode {
    return this.currentMode;
  }

  /**
   * Subscribe to mode changes
   */
  onChange(callback: (mode: AppMode) => void) {
    this.listeners.push(callback);
  }

  /**
   * Update DOM layout based on mode
   */
  private updateLayout(config: ModeConfig) {
    const root = document.documentElement;
    root.style.setProperty('--mode-color', config.color);
    root.style.setProperty('--mode', `'${config.mode}'`);

    // Update mode indicator
    const modeIndicator = document.getElementById('mode-indicator');
    if (modeIndicator) {
      modeIndicator.textContent = `${config.icon} ${config.title}`;
      modeIndicator.title = config.subtitle;
    }
  }

  /**
   * Show/hide panels based on mode
   */
  private updatePanelVisibility(config: ModeConfig) {
    // Show primary panels
    config.primaryPanels.forEach((panelId) => {
      const panel = document.getElementById(`panel-${panelId}`);
      if (panel) {
        panel.style.display = 'block';
        panel.classList.remove('hidden');
      }
    });

    // Hide irrelevant panels
    config.hiddenPanels.forEach((panelId) => {
      const panel = document.getElementById(`panel-${panelId}`);
      if (panel) {
        panel.style.display = 'none';
        panel.classList.add('hidden');
      }
    });

    // Update right panel
    const rightPanel = document.getElementById('panel-right-sidebar');
    if (rightPanel) {
      rightPanel.innerHTML = '';
      const panel = document.createElement('div');
      panel.id = `panel-${config.rightPanel}`;
      panel.className = 'panel';
      rightPanel.appendChild(panel);
    }
  }

  /**
   * Check if in a specific mode
   */
  isMode(mode: AppMode): boolean {
    return this.currentMode === mode;
  }

  /**
   * Cycle through modes (for testing)
   */
  cycleMode() {
    const modes: AppMode[] = ['create', 'science', 'cinema', 'gamedev'];
    const idx = modes.indexOf(this.currentMode);
    const next = modes[(idx + 1) % modes.length];
    this.setMode(next);
  }

  /**
   * Get all available modes
   */
  getAllModes(): AppMode[] {
    return Object.keys(MODE_CONFIGS) as AppMode[];
  }
}

// Global singleton
let appModeManager: AppModeManager | null = null;

export function getAppModeManager(): AppModeManager {
  if (!appModeManager) {
    appModeManager = new AppModeManager('create');
  }
  return appModeManager;
}
