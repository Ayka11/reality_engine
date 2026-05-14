export class EvolutionAgent {
  planEvolution(params: any) {
    return { region: params.region ?? null, intensity: params.intensity ?? 'medium' };
  }
}
