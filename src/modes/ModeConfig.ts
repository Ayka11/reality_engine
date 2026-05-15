/**
 * Mode panel configuration — drives which panels appear in each app mode.
 * Complements AppModes.ts (which manages switching/visibility logic).
 * This file is pure data — no DOM dependencies.
 */

export type AppMode = 'create' | 'science' | 'cinema' | 'gamedev'

export interface ModeConfig {
  id: AppMode
  name: string
  icon: string
  accentColor: string
  description: string
  /** Ordered panel IDs for the left sidebar */
  leftPanels: string[]
  /** Panel IDs for the right sidebar */
  rightPanels: string[]
  /** ID of the bottom panel area */
  bottomPanel: string
  /** Panel IDs to completely hide in this mode */
  hiddenPanels: string[]
  /** Default render mode when switching into this app mode */
  defaultRender: '3d' | '2d' | 'metrics'
  /** Show raw physics parameter sliders (Science mode only) */
  showLawRawParams: boolean
  /** Show agent list and agent-count overlay */
  showAgents: boolean
}

export const MODE_CONFIGS: Record<AppMode, ModeConfig> = {
  create: {
    id: 'create',
    name: 'Create',
    icon: '✨',
    accentColor: '#7c6fcd',
    description: 'Build worlds with semantic controls and smart brushes',
    leftPanels:   ['composer', 'worldMood', 'processes', 'smartBrushes', 'presets', 'zSlice'],
    rightPanels:  ['health', 'inspector', 'history', 'events'],
    bottomPanel:  'playback',
    hiddenPanels: ['rawLaws', 'advancedMetrics', 'director', 'timeline', 'cameraPath',
                   'renderSettings', 'recording', 'exportPanel', 'keyframeTimeline',
                   'entityEditor', 'agentDesigner', 'rulesetEditor', 'playtestStats',
                   'agentList', 'playtest'],
    defaultRender: '3d',
    showLawRawParams: false,
    showAgents: false,
  },

  science: {
    id: 'science',
    name: 'Science',
    icon: '🔬',
    accentColor: '#3db872',
    description: 'Detailed law regulation, metrics, deterministic replay',
    leftPanels:   ['metaLaws', 'lawStrength', 'processes', 'zSlice'],
    rightPanels:  ['metrics', 'health', 'inspector', 'causalGraph', 'timeline'],
    bottomPanel:  'dataExport',
    hiddenPanels: ['composer', 'worldMood', 'smartBrushes',
                   'director', 'cameraPath', 'renderSettings', 'recording', 'exportPanel',
                   'keyframeTimeline', 'entityEditor', 'agentDesigner', 'rulesetEditor',
                   'playtestStats', 'agentList', 'playtest'],
    defaultRender: '2d',
    showLawRawParams: true,
    showAgents: true,
  },

  cinema: {
    id: 'cinema',
    name: 'Cinema',
    icon: '🎬',
    accentColor: '#e09030',
    description: 'Animation recording, camera paths, AI director, Blender/Unreal export',
    leftPanels:   ['director', 'timeline', 'cameraPath', 'presets', 'smartBrushes'],
    rightPanels:  ['renderSettings', 'recording', 'exportPanel'],
    bottomPanel:  'keyframeTimeline',
    hiddenPanels: ['rawLaws', 'metaLaws', 'lawStrength', 'causalGraph', 'dataExport',
                   'entityEditor', 'agentDesigner', 'rulesetEditor', 'playtestStats',
                   'agentList', 'playtest'],
    defaultRender: '3d',
    showLawRawParams: false,
    showAgents: false,
  },

  gamedev: {
    id: 'gamedev',
    name: 'Game Dev',
    icon: '🎮',
    accentColor: '#e04848',
    description: 'Agent AI designer, ruleset editor, playtest mode',
    leftPanels:   ['entityEditor', 'agentDesigner', 'rulesetEditor', 'processes', 'presets'],
    rightPanels:  ['playtestStats', 'agentList', 'events'],
    bottomPanel:  'playtest',
    hiddenPanels: ['rawLaws', 'metaLaws', 'lawStrength', 'advancedMetrics', 'causalGraph',
                   'director', 'timeline', 'cameraPath', 'renderSettings', 'recording',
                   'exportPanel', 'keyframeTimeline', 'dataExport'],
    defaultRender: '3d',
    showLawRawParams: false,
    showAgents: true,
  },
}

/** Returns mode configs as an ordered array for tab rendering. */
export function getModeList(): ModeConfig[] {
  return ['create', 'science', 'cinema', 'gamedev'].map(id => MODE_CONFIGS[id as AppMode])
}
