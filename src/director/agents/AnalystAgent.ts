export class AnalystAgent {
  analyze(metrics: any) {
    // simple usage of metrics for MVP
    const hint = metrics?.complexity > 100 ? 'reduce-complexity' : 'increase-mutation-rate';
    return { suggestions: [hint, 'focus-region-0'] };
  }
}
