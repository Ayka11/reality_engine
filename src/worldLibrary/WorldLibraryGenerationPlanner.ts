import { worldLibrary, worldRuleGraph } from './registry'
import type { WorldLibraryEntry } from './WorldLibrary'
import { populationRuntimeKind, visualKindToWorldObject } from './WorldLibraryAdapter'
import type { WorldEnvironment } from './WorldEnvironmentResolver'
import { worldEnvironmentResolver } from './WorldEnvironmentResolver'

export type WorldGenerationPlan = {
  target: string
  environmentStatus: 'READY' | 'CONDITIONAL' | 'BLOCKED' | 'UNKNOWN'
  environmentScore: number
  ordered: string[]
  dependencies: string[]
  conflicts: string[]
  unresolved: string[]
  reasons: string[]
}

export class WorldLibraryGenerationPlanner {
  plan(id: string, environment?: WorldEnvironment): WorldGenerationPlan | null {
    const target = worldLibrary.get(id)
    if (!target) return null

    const ordered: string[] = []
    const dependencies: string[] = []
    const conflicts: string[] = []
    const unresolved: string[] = []
    const seen = new Set<string>()

    const visit = (entryId: string, root = false) => {
      if (seen.has(entryId)) return
      seen.add(entryId)
      const entry = worldLibrary.get(entryId)
      if (!entry) {
        unresolved.push(entryId)
        return
      }

      const requires = [
        ...(entry.requires ?? []),
        ...worldRuleGraph.outgoing(entry.id, 'requires').map((r) => r.to),
        ...worldRuleGraph.outgoing(entry.id, 'enables').map((r) => r.to),
      ]
      for (const dependency of requires) {
        if (dependency !== entry.id) visit(dependency)
        if (!dependencies.includes(dependency) && dependency !== id) dependencies.push(dependency)
      }

      for (const conflict of [
        ...(entry.conflictsWith ?? []),
        ...worldRuleGraph.outgoing(entry.id, 'conflicts').map((r) => r.to),
      ]) {
        if (!conflicts.includes(conflict)) conflicts.push(conflict)
      }

      if (root || visualKindToWorldObject(entry) || populationRuntimeKind(entry) !== 'visual') {
        ordered.push(entry.id)
      }
    }

    visit(id, true)

    const environmentMatch = environment ? worldEnvironmentResolver.resolve(environment).find((item) => item.entry.id === id) : undefined
    const environmentScore = environmentMatch?.score ?? (target.conditions ? 0 : 1)
    const environmentStatus = !environment ? 'UNKNOWN' : !environmentMatch && target.conditions ? 'BLOCKED' : environmentScore >= 0.8 ? 'READY' : 'CONDITIONAL'

    return {
      target: id,
      environmentStatus,
      environmentScore,
      ordered,
      dependencies,
      conflicts,
      unresolved,
      reasons: [
        'dependency-closure',
        'rule-graph-expanded',
        conflicts.length ? 'conflict-check-required' : 'no-known-conflicts',
      ],
    }
  }

  get(id: string): WorldLibraryEntry | undefined {
    return worldLibrary.get(id)
  }
}

export const worldLibraryGenerationPlanner = new WorldLibraryGenerationPlanner()
