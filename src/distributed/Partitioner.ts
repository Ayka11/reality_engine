/**
 * Simple static partitioner: split chunk grid into N rectangular regions
 */
export class Partitioner {
  constructor() {}

  partitionRect(cxCount: number, cyCount: number, czCount: number, parts: number): string[][] {
    // produce `parts` groups of chunk keys by slicing along X then Y then Z
    const result: string[][] = Array.from({ length: parts }, () => []);
    let idx = 0;
    for (let cz = 0; cz < czCount; cz++) {
      for (let cy = 0; cy < cyCount; cy++) {
        for (let cx = 0; cx < cxCount; cx++) {
          const key = `${cx},${cy},${cz}`;
          result[idx % parts].push(key);
          idx++;
        }
      }
    }
    return result;
  }
}
