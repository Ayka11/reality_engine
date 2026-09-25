import type { SimulationClockState } from './types';

export class SimulationClock {
  private _tick = 0;
  private _time = 0;
  private _dt: number;
  private readonly _seed: number;

  constructor(seed = 1, dt = 1 / 60) {
    if (!Number.isFinite(seed)) throw new Error('SimulationClock seed must be finite.');
    this.assertValidDt(dt);
    this._seed = Math.trunc(seed);
    this._dt = dt;
  }

  get tick(): number { return this._tick; }
  get time(): number { return this._time; }
  get dt(): number { return this._dt; }
  get seed(): number { return this._seed; }

  setDt(dt: number): void {
    this.assertValidDt(dt);
    this._dt = dt;
  }

  advance(dt = this._dt): SimulationClockState {
    this.assertValidDt(dt);
    this._dt = dt;
    this._time += dt;
    this._tick += 1;
    return this.state();
  }

  state(): SimulationClockState {
    return {
      tick: this._tick,
      time: this._time,
      dt: this._dt,
      seed: this._seed,
    };
  }

  reset(): void {
    this._tick = 0;
    this._time = 0;
  }

  private assertValidDt(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new Error('SimulationClock dt must be a finite non-negative number.');
    }
  }
}
