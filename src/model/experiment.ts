import {
  breed,
  dTransmissionProbability,
  summarize,
  type Composition,
  type Mosquito,
} from './genetics';
import { Rng } from './rng';

export type PopKey = 'mendel' | 'drive';
export const POP_KEYS: readonly PopKey[] = ['mendel', 'drive'];

export interface ExperimentConfig {
  seed: number;
  /** 방사 이후 고정 집단 크기 */
  populationSize: number;
  /** 가상 방사로 도입하는 D/W 수컷 수 */
  releaseCount: number;
  /** 오른쪽 집단의 처음 호밍 효율 */
  initialE: number;
  maxGenerations: number;
}

export const DEFAULT_CONFIG: ExperimentConfig = {
  seed: 52,
  populationSize: 80,
  releaseCount: 8,
  initialE: 0.8,
  maxGenerations: 30,
};

export interface GenerationRecord {
  generation: number;
  /** 이 세대를 만들 때 사용한 e (0세대는 방사 시점의 설정값) */
  e: number;
  composition: Composition;
  individuals: readonly Mosquito[];
}

export interface Transition {
  key: PopKey;
  generation: number;
  e: number;
  parents: readonly Mosquito[];
  offspring: readonly Mosquito[];
}

export class Population {
  readonly key: PopKey;
  readonly rng: Rng;
  current: Mosquito[] = [];
  readonly history: GenerationRecord[] = [];
  private lastId = 0;
  private readonly byId = new Map<number, Mosquito>();

  constructor(key: PopKey, seed: number) {
    this.key = key;
    this.rng = new Rng(seed);
  }

  nextId = (): number => ++this.lastId;

  register(list: readonly Mosquito[]): void {
    for (const m of list) this.byId.set(m.id, m);
  }

  find(id: number | null): Mosquito | undefined {
    return id == null ? undefined : this.byId.get(id);
  }

  get generation(): number {
    return this.history.length ? this.history[this.history.length - 1].generation : 0;
  }

  get initial(): GenerationRecord | undefined {
    return this.history[0];
  }
}

/**
 * 왼쪽(멘델, e=0 고정)과 오른쪽(호밍 드라이브, e 조절) 두 집단을 함께 관리한다.
 * 두 집단은 같은 시드와 같은 초기 개체로 시작한다.
 * 유전 계산은 release()와 advance()에서만 일어난다.
 */
export class Experiment {
  readonly config: ExperimentConfig;
  readonly mendel: Population;
  readonly drive: Population;
  released = false;
  private driveE: number;

  constructor(config: Partial<ExperimentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const { seed, populationSize, releaseCount } = this.config;
    if (releaseCount <= 0 || releaseCount >= populationSize) {
      throw new RangeError('방사 개체 수는 1 이상, 집단 크기 미만이어야 합니다.');
    }
    this.driveE = this.config.initialE;
    dTransmissionProbability(this.driveE);
    this.mendel = new Population('mendel', seed);
    this.drive = new Population('drive', seed);
    for (const pop of this.pops()) {
      pop.current = this.makeWild(pop);
      pop.register(pop.current);
    }
  }

  pops(): Population[] {
    return [this.mendel, this.drive];
  }

  pop(key: PopKey): Population {
    return key === 'mendel' ? this.mendel : this.drive;
  }

  eFor(key: PopKey): number {
    return key === 'mendel' ? 0 : this.driveE;
  }

  /** 오른쪽 집단의 e를 바꾼다. 이미 태어난 개체에는 영향이 없고 다음 세대부터 적용된다. */
  setDriveE(e: number): void {
    dTransmissionProbability(e);
    this.driveE = e;
  }

  get generation(): number {
    return this.mendel.generation;
  }

  get wildCount(): number {
    return this.config.populationSize - this.config.releaseCount;
  }

  canAdvance(): boolean {
    return this.released && this.generation < this.config.maxGenerations;
  }

  private makeWild(pop: Population): Mosquito[] {
    const list: Mosquito[] = [];
    for (let i = 0; i < this.wildCount; i++) {
      list.push({
        id: pop.nextId(),
        sex: i % 2 === 0 ? 'F' : 'M',
        genotype: 'WW',
        generation: 0,
        motherId: null,
        fatherId: null,
        inherited: null,
        released: false,
      });
    }
    return list;
  }

  /** 가상 방사: 두 집단에 같은 D/W 수컷을 한 번만 도입한다. 반환값은 새로 들어온 개체. */
  release(): Record<PopKey, Mosquito[]> {
    if (this.released) throw new Error('가상 방사는 처음에 한 번만 할 수 있습니다.');
    this.released = true;
    const result = {} as Record<PopKey, Mosquito[]>;
    for (const pop of this.pops()) {
      const newcomers: Mosquito[] = [];
      for (let i = 0; i < this.config.releaseCount; i++) {
        newcomers.push({
          id: pop.nextId(),
          sex: 'M',
          genotype: 'DW',
          generation: 0,
          motherId: null,
          fatherId: null,
          inherited: null,
          released: true,
        });
      }
      pop.register(newcomers);
      pop.current = [...pop.current, ...newcomers];
      pop.history.push({
        generation: 0,
        e: this.eFor(pop.key),
        composition: summarize(pop.current),
        individuals: pop.current,
      });
      result[pop.key] = newcomers;
    }
    return result;
  }

  /** 두 집단 모두 다음 세대를 계산한다. */
  advance(): Record<PopKey, Transition> {
    if (!this.released) throw new Error('가상 방사 후에 세대를 진행할 수 있습니다.');
    if (!this.canAdvance()) throw new Error('최대 세대에 도달했습니다.');
    const generation = this.generation + 1;
    const result = {} as Record<PopKey, Transition>;
    for (const pop of this.pops()) {
      const e = this.eFor(pop.key);
      const parents = pop.current;
      const offspring = breed(parents, {
        e,
        size: this.config.populationSize,
        generation,
        rng: pop.rng,
        nextId: pop.nextId,
      });
      pop.register(offspring);
      pop.current = offspring;
      pop.history.push({ generation, e, composition: summarize(offspring), individuals: offspring });
      result[pop.key] = { key: pop.key, generation, e, parents, offspring };
    }
    return result;
  }
}
