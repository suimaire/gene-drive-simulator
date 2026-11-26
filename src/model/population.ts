import { Rng } from './rng';

export const TICKS_PER_UNIT = 20;
export const ROUND_TICKS = 4 * TICKS_PER_UNIT;
export const FADE_TICKS = 6;
export const INITIAL_COUNT = 80;
const CAPACITY = 120;

export interface Individual {
  id: number;
  sex: 'F' | 'M';
  canReproduce: boolean;
  bornAt: number;
  diesAt: number;
  mother: number | null;
  father: number | null;
}

export interface Mating {
  mother: number;
  father: number;
  birthTick: number;
}

export type Condition = 'usual' | 'limited';
export const CONDITIONS = ['usual', 'limited'] as const;
export const CONDITION_LABEL = { usual: '기본 번식 조건', limited: '번식 참여 제한' };

/** 일반적인 출생과 사망만 계산한다. 모든 시각은 정수 눈금 단위이다. */
export class Community {
  readonly living = new Map<number, Individual>();
  pairs: Mating[] = [];
  births = 0;
  deaths = 0;
  private nextId = 1;
  private readonly pairing: Rng;

  constructor(readonly condition: Condition, private readonly limit: number, private readonly seed: number) {
    this.pairing = new Rng(seed);
    for (let i = 0; i < INITIAL_COUNT; i++) this.add(0, null);
  }

  private add(tick: number, parents: Mating | null): void {
    const id = this.nextId++;
    // 같은 번호의 개체에는 양쪽에서 같은 수명과 참여 추첨값을 부여한다.
    const rng = new Rng(this.seed ^ Math.imul(id, 0x9e3779b1));
    const lifetime = Math.round(this.limit * TICKS_PER_UNIT * (0.7 + 0.3 * rng.next()));
    const initialAge = parents ? 0 : Math.floor(rng.next() * (lifetime - FADE_TICKS));
    const bornAt = tick - initialAge;
    const participates = rng.next() < (this.condition === 'usual' ? 1 : 0.35);
    this.living.set(id, { id, sex: id % 2 ? 'F' : 'M', canReproduce: participates,
      bornAt, diesAt: bornAt + lifetime, mother: parents?.mother ?? null, father: parents?.father ?? null });
  }

  private formPairs(tick: number): void {
    const pools: Record<'F' | 'M', Individual[]> = { F: [], M: [] };
    for (const item of this.living.values()) {
      if (item.canReproduce && item.diesAt - tick > FADE_TICKS &&
          (item.mother === null || tick - item.bornAt >= ROUND_TICKS)) pools[item.sex].push(item);
    }
    const take = (pool: Individual[]) => {
      const index = this.pairing.int(pool.length);
      const chosen = pool[index];
      pool[index] = pool[pool.length - 1];
      pool.pop();
      return chosen.id;
    };
    this.pairs = [];
    while (pools.F.length && pools.M.length) {
      this.pairs.push({ mother: take(pools.F), father: take(pools.M),
        birthTick: tick + TICKS_PER_UNIT + this.pairing.int(2 * TICKS_PER_UNIT) });
    }
  }

  step(tick: number): void {
    for (const item of this.living.values()) {
      if (item.diesAt <= tick) {
        this.living.delete(item.id);
        this.deaths++;
      }
    }
    if ((tick - 1) % ROUND_TICKS === 0) this.formPairs(tick);
    this.pairs = this.pairs.filter(pair => {
      const mother = this.living.get(pair.mother);
      const father = this.living.get(pair.father);
      if (!mother || !father || Math.min(mother.diesAt, father.diesAt) - tick <= FADE_TICKS) return false;
      if (pair.birthTick > tick) return true;
      if (this.living.size < CAPACITY) {
        this.add(tick, pair);
        this.births++;
      }
      return false;
    });
  }
}

export class PopulationObservation {
  readonly groups: Record<Condition, Community>;
  tick = 0;
  running = false;
  private stopAt = Infinity;
  private remainder = 0;

  constructor(limit: number, seed: number) {
    if (![10, 20, 40].includes(limit)) throw new RangeError('가상 수명은 10, 20, 40 중 하나입니다.');
    this.groups = { usual: new Community('usual', limit, seed), limited: new Community('limited', limit, seed) };
  }

  get finished(): boolean {
    return CONDITIONS.every(k => this.groups[k].living.size === 0);
  }

  play(oneRound = false): void {
    if (this.finished) return;
    this.stopAt = oneRound ? (Math.floor(this.tick / ROUND_TICKS) + 1) * ROUND_TICKS : Infinity;
    this.running = true;
  }

  advance(seconds: number, speed: number): void {
    if (!this.running || !Number.isFinite(seconds) || seconds <= 0) return;
    this.remainder += seconds * speed * TICKS_PER_UNIT;
    const steps = Math.floor(this.remainder + 1e-9);
    this.remainder = Math.max(0, this.remainder - steps);
    for (let i = 0; i < steps; i++) {
      this.tick++;
      for (const key of CONDITIONS) this.groups[key].step(this.tick);
      if (this.tick === this.stopAt || this.finished) {
        this.running = false;
        this.remainder = 0;
        break;
      }
    }
  }
}
