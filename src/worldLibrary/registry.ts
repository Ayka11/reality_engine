import { WORLD_LIBRARY_CATALOG } from './catalog';
import { WorldLibrary } from './WorldLibrary';

export const worldLibrary = new WorldLibrary(WORLD_LIBRARY_CATALOG);
import { WORLD_RULES } from './rules';
import { WorldRuleGraph } from './WorldRuleGraph';

export const worldRuleGraph = new WorldRuleGraph(WORLD_RULES);
