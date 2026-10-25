import { SimulationEngine } from './SimulationEngine';
import { CivilizationSystem, Civilization } from './CivilizationSystem';
import { F } from '../core/CellState';

export interface MarketHistory {
  tick: number;
  pE: number;
  pI: number;
  vol: number;
}

export interface EconomicMarketSnapshot {
  x: number;
  y: number;
  prices: { energy: number; density: number; information: number };
  volume: { energy: number; density: number; information: number };
  history: MarketHistory[];
  age: number;
}

export interface EconomicSystemSnapshot {
  markets: EconomicMarketSnapshot[];
  gdp: Array<[number, number]>;
  globalGDP: number;
  gini: number;
  tickCount: number;
}

class Market {
  readonly x: number;
  readonly y: number;
  private sim: SimulationEngine;
  prices = { energy: 1.0, density: 1.0, information: 2.0 };
  volume  = { energy: 0,  density: 0,   information: 0 };
  readonly history: MarketHistory[] = [];
  age = 0;

  constructor(x: number, y: number, sim: SimulationEngine) {
    this.x = x; this.y = y; this.sim = sim;
  }

  snapshot(): EconomicMarketSnapshot {
    return {
      x: this.x,
      y: this.y,
      prices: { ...this.prices },
      volume: { ...this.volume },
      history: this.history.map(entry => ({ ...entry })),
      age: this.age,
    };
  }

  restore(snapshot: EconomicMarketSnapshot): void {
    if (!snapshot ||
        !Number.isSafeInteger(snapshot.x) || snapshot.x !== this.x ||
        !Number.isSafeInteger(snapshot.y) || snapshot.y !== this.y ||
        !snapshot.prices || !snapshot.volume ||
        ![snapshot.prices.energy, snapshot.prices.density, snapshot.prices.information,
          snapshot.volume.energy, snapshot.volume.density, snapshot.volume.information,
          snapshot.age].every(Number.isFinite) ||
        snapshot.age < 0 || !Array.isArray(snapshot.history) || snapshot.history.length > 30) {
      throw new Error("Invalid economic market snapshot");
    }
    const history: MarketHistory[] = [];
    for (const item of snapshot.history) {
      if (!item || !Number.isSafeInteger(item.tick) || item.tick < 0 ||
          ![item.pE, item.pI, item.vol].every(Number.isFinite)) {
        throw new Error("Invalid economic market history");
      }
      history.push({ ...item });
    }
    this.prices = { ...snapshot.prices };
    this.volume = { ...snapshot.volume };
    this.history.splice(0, this.history.length, ...history);
    this.age = snapshot.age;
  }

  tick(dt: number, civs: Civilization[], gdpMap: Map<number, number>): void {
    this.age += dt * 60;
    const nearby = civs.filter(c => {
      const dx = c.origin[0] - this.x, dy = c.origin[1] - this.y;
      return Math.sqrt(dx*dx + dy*dy) < 15;
    });
    if (nearby.length < 2) return;

    const { grid } = this.sim;
    const { D } = grid;
    let supplyE = 0, supplyD = 0, supplyI = 0, count = 0;
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const nx = this.x + dx, ny = this.y + dy;
        if (!grid.inBounds(nx, ny, 0)) continue;
        const bi = grid.idx(nx, ny, Math.min(D - 1, D - 2));
        const buf = grid.buffer;
        supplyE += buf[bi + F.ENERGY];
        supplyD += buf[bi + F.DENSITY];
        supplyI += buf[bi + F.INFORMATION];
        count++;
      }
    }
    if (!count) return;
    supplyE /= count; supplyD /= count; supplyI /= count;

    const demandFactor = nearby.length * 0.3;
    this.prices.energy      = Math.max(0.1, (1000 - supplyE) / 200 * demandFactor);
    this.prices.density     = Math.max(0.1, (1 - supplyD) * 10 * demandFactor);
    this.prices.information = Math.max(0.1, (500 - supplyI) / 100 * demandFactor);

    // Trade between civs
    for (let i = 0; i < nearby.length - 1; i++) {
      const buyer  = nearby[i];
      const seller = nearby[(i + 1) % nearby.length];
      const bgdp = gdpMap.get(buyer.id)  ?? buyer.population * buyer.techLevel;
      const sgdp = gdpMap.get(seller.id) ?? seller.population * seller.techLevel;
      const tradeValue = Math.min(bgdp * 0.05, sgdp * 0.05);
      gdpMap.set(buyer.id,  (gdpMap.get(buyer.id)  ?? bgdp) - tradeValue * 0.01);
      gdpMap.set(seller.id, (gdpMap.get(seller.id) ?? sgdp) + tradeValue * 0.01);
      // Tech transfer (mutate techLevel via civ reference)
      const techGain = buyer.techLevel * 0.001;
      seller.techLevel += techGain;
      this.volume.energy += tradeValue;
    }

    if (this.age % 100 < dt * 60) {
      this.history.push({
        tick: this.sim.tick,
        pE:  Math.round(this.prices.energy * 100) / 100,
        pI:  Math.round(this.prices.information * 100) / 100,
        vol: Math.round(this.volume.energy),
      });
      if (this.history.length > 30) this.history.shift();
      this.volume = { energy: 0, density: 0, information: 0 };
    }
  }
}

export class EconomicSystem {
  private sim: SimulationEngine;
  private civSys: CivilizationSystem;
  readonly markets: Market[] = [];
  readonly gdpMap: Map<number, number> = new Map();
  globalGDP = 0;
  gini = 0;
  private tickCount = 0;

  constructor(sim: SimulationEngine, civSys: CivilizationSystem) {
    this.sim = sim;
    this.civSys = civSys;
  }

  snapshot(): EconomicSystemSnapshot {
    return {
      markets: this.markets.map(market => market.snapshot()),
      gdp: [...this.gdpMap.entries()].map(([id, value]) => [id, value]),
      globalGDP: this.globalGDP,
      gini: this.gini,
      tickCount: this.tickCount,
    };
  }

  restore(snapshot: EconomicSystemSnapshot): void {
    if (!snapshot ||
        !Array.isArray(snapshot.markets) || snapshot.markets.length > 6 ||
        !Array.isArray(snapshot.gdp) || snapshot.gdp.length > 100_000 ||
        !Number.isFinite(snapshot.globalGDP) ||
        !Number.isFinite(snapshot.gini) || snapshot.gini < 0 ||
        !Number.isSafeInteger(snapshot.tickCount) || snapshot.tickCount < 0) {
      throw new Error("Invalid EconomicSystem snapshot");
    }
    const gdp = new Map<number, number>();
    for (const entry of snapshot.gdp) {
      if (!Array.isArray(entry) || entry.length !== 2 ||
          !Number.isSafeInteger(entry[0]) || entry[0] < 0 ||
          !Number.isFinite(entry[1]) || gdp.has(entry[0])) {
        throw new Error("Invalid economic GDP entry");
      }
      gdp.set(entry[0], entry[1]);
    }
    const markets = snapshot.markets.map(data => {
      const market = new Market(data.x, data.y, this.sim);
      market.restore(data);
      return market;
    });
    this.markets.splice(0, this.markets.length, ...markets);
    this.gdpMap.clear();
    for (const [id, value] of gdp) this.gdpMap.set(id, value);
    this.globalGDP = snapshot.globalGDP;
    this.gini = snapshot.gini;
    this.tickCount = snapshot.tickCount;
  }

  reset(): void {
    this.markets.length = 0;
    this.gdpMap.clear();
    this.globalGDP = 0;
    this.gini = 0;
    this.tickCount = 0;
  }

  tick(dt: number): void {
    this.tickCount++;
    const civs = this.civSys.civs;
    if (civs.length < 2) return;

    if (this.tickCount % 200 === 0) this._spawnMarkets(civs);

    for (const market of this.markets) market.tick(dt, civs, this.gdpMap);

    if (civs.length) {
      // Init missing gdp entries
      for (const c of civs) {
        if (!this.gdpMap.has(c.id)) this.gdpMap.set(c.id, c.population * c.techLevel);
      }
      this.globalGDP = [...this.gdpMap.values()].reduce((s, v) => s + v, 0);
      const mean = this.globalGDP / civs.length;
      const variance = [...this.gdpMap.values()].reduce((s, v) => s + (v - mean) ** 2, 0) / civs.length;
      this.gini = mean > 0 ? Math.sqrt(variance) / mean : 0;
    }
  }

  private _spawnMarkets(civs: Civilization[]): void {
    if (this.markets.length >= 6) return;
    for (let i = 0; i < civs.length - 1; i++) {
      const a = civs[i], b = civs[i + 1];
      const mx = Math.floor((a.origin[0] + b.origin[0]) / 2);
      const my = Math.floor((a.origin[1] + b.origin[1]) / 2);
      const already = this.markets.find(m => Math.abs(m.x - mx) < 8 && Math.abs(m.y - my) < 8);
      if (!already) this.markets.push(new Market(mx, my, this.sim));
    }
  }

  getStats(): { markets: number; globalGDP: number; gini: number; avgPrice: number } {
    return {
      markets:   this.markets.length,
      globalGDP: Math.round(this.globalGDP),
      gini:      Math.round(this.gini * 100) / 100,
      avgPrice:  this.markets.length
        ? Math.round(this.markets.reduce((s, m) => s + m.prices.energy, 0) / this.markets.length * 100) / 100
        : 0,
    };
  }
}
