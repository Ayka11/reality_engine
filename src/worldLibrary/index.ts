import { WORLD_LIBRARY_CATALOG } from './catalog';
import { WorldLibrary } from './WorldLibrary';

export const worldLibrary = new WorldLibrary(WORLD_LIBRARY_CATALOG);

export * from './WorldLibrary';
export * from './catalog';

export default worldLibrary;
