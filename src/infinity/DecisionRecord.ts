export type DecisionType =
  | 'buildability'
  | 'zone-cost'
  | 'settlement-site'
  | 'route-cost'
  | 'environmental-risk'

export type DecisionRecord<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> = {
  id: string
  type: DecisionType
  worldSeed: string
  generatorVersion: string
  decisionVersion: string
  fieldVersion: string
  position?: { x: number; y?: number; z: number }
  inputs: TInput
  weights: Record<string, number>
  output: TOutput
  timestamp: number
}

let sequence = 0

export function createDecisionRecord<TInput extends Record<string, unknown>, TOutput extends Record<string, unknown>>(
  type: DecisionType,
  worldSeed: string,
  inputs: TInput,
  weights: Record<string, number>,
  output: TOutput,
  position?: { x: number; y?: number; z: number },
): DecisionRecord<TInput, TOutput> {
  sequence += 1
  return {
    id: `decision-${Date.now().toString(36)}-${sequence.toString(36)}`,
    type,
    worldSeed,
    generatorVersion: 'world-generator-v1',
    decisionVersion: 'world-decision-v1',
    fieldVersion: 'field-sampler-v1',
    position,
    inputs,
    weights,
    output,
    timestamp: Date.now(),
  }
}
