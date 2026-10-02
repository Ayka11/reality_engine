import type { BrushId, BrushProfile } from "./BrushContract";

export const BRUSH_PROFILES: Record<BrushId, BrushProfile> = {
  volcano: {
    id: "volcano", label: "Volcano", description: "Adds a hot, energetic volcanic region.",
    shape: "sphere", falloff: "gaussian", verticalExtent: "bounded-volume",
    effects: [
      { field: "energy", operation: "add", value: 800 },
      { field: "temperature", operation: "add", value: 500 },
      { field: "density", operation: "add", value: 0.2 },
      { field: "entropy", operation: "add", value: 0.2 }
    ]
  },
  forest: {
    id: "forest", label: "Forest", description: "Creates a biologically rich region.",
    shape: "sphere", falloff: "gaussian", verticalExtent: "bounded-volume",
    effects: [
      { field: "energy", operation: "add", value: 180 },
      { field: "density", operation: "add", value: 0.15 },
      { field: "information", operation: "add", value: 160 },
      { field: "biology", operation: "add", value: 0.3 }
    ]
  },
  ocean: {
    id: "ocean", label: "Ocean", description: "Creates a broad water-like column.",
    shape: "column", falloff: "linear", verticalExtent: "full-column",
    effects: [
      { field: "energy", operation: "add", value: 60 },
      { field: "density", operation: "set", value: 0.6 },
      { field: "temperature", operation: "set", value: 60 },
      { field: "information", operation: "add", value: 40 }
    ]
  },
  crystal: {
    id: "crystal", label: "Crystal", description: "Adds a structured crystalline shell.",
    shape: "shell", falloff: "constant", verticalExtent: "bounded-volume",
    effects: [
      { field: "energy", operation: "add", value: 700 },
      { field: "information", operation: "add", value: 280 },
      { field: "entropy", operation: "add", value: -0.08 }
    ]
  },
  storm: {
    id: "storm", label: "Storm", description: "Adds a turbulent column-like region.",
    shape: "column", falloff: "linear", verticalExtent: "bounded-volume",
    effects: [
      { field: "energy", operation: "add", value: 400 },
      { field: "entropy", operation: "add", value: 0.12 },
      { field: "temperature", operation: "add", value: 150 }
    ]
  },
  "life-cluster": {
    id: "life-cluster", label: "Life Cluster", description: "Creates a biologically active cluster.",
    shape: "sphere", falloff: "gaussian", verticalExtent: "bounded-volume",
    effects: [
      { field: "energy", operation: "add", value: 280 },
      { field: "density", operation: "add", value: 0.15 },
      { field: "information", operation: "add", value: 200 },
      { field: "biology", operation: "add", value: 0.3 },
      { field: "temperature", operation: "add", value: 110 },
      { field: "entropy", operation: "add", value: -0.1 }
    ]
  },
  radiation: {
    id: "radiation", label: "Radiation", description: "Adds a radiation-like high-entropy region.",
    shape: "sphere", falloff: "linear", verticalExtent: "bounded-volume",
    effects: [
      { field: "entropy", operation: "add", value: 0.3 },
      { field: "information", operation: "add", value: -50 }
    ]
  },
  "civilization-seed": {
    id: "civilization-seed", label: "Civilization Seed", description: "Creates conditions for a complex civilization seed.",
    shape: "sphere", falloff: "gaussian", verticalExtent: "bounded-volume",
    effects: [
      { field: "energy", operation: "add", value: 380 },
      { field: "density", operation: "add", value: 0.15 },
      { field: "information", operation: "add", value: 400 },
      { field: "biology", operation: "add", value: 0.3 },
      { field: "entropy", operation: "add", value: -0.15 },
      { field: "temperature", operation: "add", value: 100 }
    ]
  },
  "gravity-well": {
    id: "gravity-well", label: "Gravity Well", description: "Adds a dense energetic spherical region.",
    shape: "sphere", falloff: "gaussian", verticalExtent: "bounded-volume",
    effects: [
      { field: "energy", operation: "add", value: 450 },
      { field: "density", operation: "add", value: 0.2 }
    ]
  },
  "entropy-sink": {
    id: "entropy-sink", label: "Entropy Sink", description: "Reduces entropy and temperature locally.",
    shape: "sphere", falloff: "gaussian", verticalExtent: "bounded-volume",
    effects: [
      { field: "entropy", operation: "add", value: -0.4 },
      { field: "temperature", operation: "add", value: -200 }
    ]
  },
  "quantum-core": {
    id: "quantum-core", label: "Quantum Core", description: "Adds a high-information energetic core.",
    shape: "sphere", falloff: "gaussian", verticalExtent: "bounded-volume",
    effects: [
      { field: "information", operation: "add", value: 350 },
      { field: "biology", operation: "add", value: 0.2 },
      { field: "energy", operation: "add", value: 200 }
    ]
  },
  "meta-law-node": {
    id: "meta-law-node", label: "Meta Law Node", description: "Creates a concentrated information and energy node.",
    shape: "sphere", falloff: "gaussian", verticalExtent: "bounded-volume",
    effects: [
      { field: "energy", operation: "add", value: 400 },
      { field: "information", operation: "add", value: 300 },
      { field: "density", operation: "add", value: 0.15 }
    ]
  },
  "force-barrier": {
    id: "force-barrier", label: "Force Barrier", description: "Creates a dense energetic shell barrier.",
    shape: "shell", falloff: "constant", verticalExtent: "bounded-volume",
    effects: [
      { field: "density", operation: "set", value: 0.9 },
      { field: "energy", operation: "set", value: 150 }
    ]
  }
};
