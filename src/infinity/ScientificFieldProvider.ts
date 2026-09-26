import type { ScientificFieldSample } from './FieldSampler'

export type ScientificFieldProvider = {
  readonly id: string
  readonly version: string
  sample(x: number, y: number, z: number): ScientificFieldSample
}

export class GeneratorFieldProvider implements ScientificFieldProvider {
  readonly id = 'world-generator'
  readonly version = 'world-generator-v1'

  constructor(private readonly generator: { sampleField(x: number, y: number, z: number): ScientificFieldSample }) {}

  sample(x: number, y: number, z: number) {
    return this.generator.sampleField(x, y, z)
  }
}

export class FunctionFieldProvider implements ScientificFieldProvider {
  readonly id: string
  readonly version: string
  constructor(
    id: string,
    version: string,
    private readonly sampler: (x: number, y: number, z: number) => ScientificFieldSample,
  ) {
    this.id = id
    this.version = version
  }

  sample(x: number, y: number, z: number) {
    return this.sampler(x, y, z)
  }
}
