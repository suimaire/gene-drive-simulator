/**
 * 시드 고정 난수 생성기 (mulberry32).
 * 같은 시드에서는 항상 같은 수열을 만든다. 유전 계산에만 사용하고,
 * 화면 움직임에는 사용하지 않는다.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** [0, 1) 구간의 균등 난수 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 0 이상 n 미만의 정수 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  get state(): number {
    return this.s;
  }
}
