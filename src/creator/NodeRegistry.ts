import type { MetaLaw } from '../laws/MetaLaw';
import type { ProcessDef } from '../process/ProcessDef';
import type { NodeCategory, Port, PortType, RealityNode } from './types';

type NodeTemplate = Omit<RealityNode, 'id' | 'position'>;

const FIELD_COLORS: Record<string, string> = {
  energy: '#ef8f3f',
  temperature: '#f47b7b',
  density: '#8eceab',
  entropy: '#b8a76a',
  information: '#7c9fff',
  bioPotential: '#4caf7d',
  signal: '#c084fc',
};

function fieldPort(name: string, direction: Port['direction']): Port {
  return { id: `${direction}_${name}`, name, type: 'field', direction };
}

function categoryForProcess(category: ProcessDef['category']): NodeCategory {
  if (category === 'biological') return 'Entity';
  if (category === 'informational') return 'Causal';
  if (category === 'geological') return 'World';
  return 'Process';
}

function processColor(category: ProcessDef['category']): string {
  if (category === 'biological') return '#4caf7d';
  if (category === 'geological') return '#a0855a';
  if (category === 'informational') return '#7c9fff';
  if (category === 'thermodynamic') return '#ef8f3f';
  return '#c084fc';
}

export class NodeRegistry {
  private nodes = new Map<string, NodeTemplate>();

  register(nodeTemplate: NodeTemplate): void {
    this.nodes.set(nodeTemplate.type, structuredClone(nodeTemplate));
  }

  getTemplate(type: string): NodeTemplate | undefined {
    const template = this.nodes.get(type);
    return template ? structuredClone(template) : undefined;
  }

  getTemplatesByCategory(category: string): NodeTemplate[] {
    return Array.from(this.nodes.values())
      .filter(node => node.category === category)
      .map(node => structuredClone(node));
  }

  getAllTemplates(): NodeTemplate[] {
    return Array.from(this.nodes.values()).map(node => structuredClone(node));
  }

  createNode(type: string, position: { x: number; y: number }): RealityNode | null {
    const template = this.getTemplate(type);
    if (!template) return null;
    return {
      ...template,
      id: `${type}_${Math.random().toString(36).slice(2, 8)}`,
      position,
    };
  }

  initializeFromEngine(lawEngine: { laws?: MetaLaw[] }, processDefs: ProcessDef[]): void {
    const fields = new Set<string>();
    for (const process of processDefs) {
      process.inputs.forEach(field => fields.add(field));
      process.outputs.forEach(field => fields.add(field));
    }

    for (const field of fields) {
      const type = `field.${field}`;
      this.register({
        type,
        category: 'Field',
        label: field,
        parameters: { field },
        inputs: [],
        outputs: [fieldPort(field, 'output')],
        enabled: true,
        metadata: {
          description: `Field source for ${field}.`,
          color: FIELD_COLORS[field] ?? '#9ca3af',
          icon: 'circle-dot',
          gpuCost: 1,
        },
      });
    }

    for (const process of processDefs) {
      this.register({
        type: `process.${process.name}`,
        category: categoryForProcess(process.category),
        label: process.label,
        parameters: {
          processId: process.id,
          entropyCost: process.entropyCost,
          mutable: process.mutable,
          stabilityImpact: process.stabilityImpact,
        },
        inputs: process.inputs.map(input => fieldPort(input, 'input')),
        outputs: [
          ...process.outputs.map(output => fieldPort(output, 'output')),
          { id: 'process_out', name: 'process', type: 'process' as PortType, direction: 'output' },
        ],
        enabled: process.defaultActive,
        metadata: {
          description: process.description,
          color: processColor(process.category),
          icon: 'activity',
          gpuCost: Math.max(1, process.inputs.length + process.outputs.length),
        },
      });
    }

    for (const law of lawEngine.laws ?? []) {
      this.register({
        type: `law.${law.id}`,
        category: 'Law',
        label: law.name,
        parameters: {
          lawId: law.id,
          generation: law.generation,
          mutationRate: law.mutationRate,
          fitness: law.fitness,
        },
        inputs: [{ id: 'law_in', name: 'process', type: 'process', direction: 'input' }],
        outputs: [{ id: 'law_out', name: 'law', type: 'law', direction: 'output' }],
        enabled: law.active,
        metadata: {
          description: `Meta-law controlling ${law.enablesProcesses.length} process bindings.`,
          color: law.color,
          icon: 'dna-2',
          gpuCost: 1,
        },
      });
    }
  }
}
