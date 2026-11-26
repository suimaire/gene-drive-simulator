import { summarize, type Composition, type Mosquito } from './genetics';
import { Rng } from './rng';

/** 마지막 0.3 가상 시간 동안 정지한 채 사라지며, 제거와 집계는 같은 시점에 처리한다. */
const FADE_TIME = 0.3;

export class LifespanCohort {
  private readonly remaining = new Map<number, { mosquito: Mosquito; removeAt: number }>();
  readonly endTime: number;
  composition: Composition;

  constructor(individuals: readonly Mosquito[], limit: number, seed: number) {
    if (!Number.isFinite(limit) || limit <= FADE_TIME) throw new RangeError('가상 수명 범위를 확인하세요.');
    const rng = new Rng(seed);
    let last = 0;
    for (const mosquito of individuals) {
      const removeAt = FADE_TIME + rng.next() * (limit - FADE_TIME);
      this.remaining.set(mosquito.id, { mosquito, removeAt });
      last = Math.max(last, removeAt);
    }
    this.endTime = last;
    this.composition = summarize(individuals);
  }

  /** null은 정상 비행, 0 초과는 정지 후 남은 불투명도, 0은 제거된 개체이다. */
  fadeOpacity(id: number, elapsed: number): number | null {
    const individual = this.remaining.get(id);
    if (!individual) return 0;
    const left = individual.removeAt - elapsed;
    return left > FADE_TIME ? null : Math.max(0, left / FADE_TIME);
  }

  advanceTo(elapsed: number): boolean {
    const before = this.remaining.size;
    for (const [id, individual] of this.remaining) {
      if (individual.removeAt <= elapsed) this.remaining.delete(id);
    }
    if (before === this.remaining.size) return false;
    this.composition = summarize(Array.from(this.remaining.values(), (entry) => entry.mosquito));
    return true;
  }
}
