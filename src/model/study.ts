/** Closed-cage observations from Kyrou et al., Fig. 5. Counts and the printed
 * percentage column are transcribed from the original Supplementary Table S6 (p. 9).
 * Index zero is the starting generation. A missing row means observation ended.
 */
export interface CageRecord {
  carrier: number;
  eggs: number;
}
function records(rows: readonly (readonly [number, number])[]): readonly CageRecord[] {
  return rows.map(([carrier, eggs]) => ({ carrier, eggs }));
}
export const cages = [
  { name: '케이지 1', color: '#b73f43', data: records([
    [25, 27462], [49.65, 17405], [62.01, 14957], [68.94, 11249], [67.67, 9170],
    [58.67, 11364], [63.3, 7727], [69.47, 7785], [70.07, 6293], [75.58, 4107],
    [95.71, 4146], [100, 2645], [100, 0],
  ]) },
  { name: '케이지 2', color: '#355faf', data: records([
    [25, 26895], [50, 16578], [61.79, 15565], [68.05, 9376], [85.41, 6514],
    [86.5, 4805], [90.09, 4210], [100, 1668], [100, 0],
  ]) },
] as const;

const stops = new Set([7, 8, 11, 12]);
const last = Math.max(...cages.map(cage => cage.data.length)) - 1;

/** The clock selects a historical row. It never generates biological events. */
export class StudyPlayback {
  generation = 0;
  playing = false;
  speed: 1 | 2 = 1;
  private elapsed = 0;

  get finished(): boolean { return this.generation === last; }

  step(): void {
    this.playing = false;
    this.elapsed = 0;
    this.generation = Math.min(last, this.generation + 1);
  }

  toggle(): void { this.playing = !this.finished && !this.playing; }

  tick(seconds: number): boolean {
    if (!this.playing) return false;
    const before = this.generation;
    this.elapsed += seconds * this.speed;
    while (this.elapsed >= 1.6 && this.playing) {
      this.elapsed -= 1.6;
      this.generation++;
      if (stops.has(this.generation)) {
        this.playing = false;
        this.elapsed = 0;
      }
    }
    return before !== this.generation;
  }

  reset(): void {
    this.generation = 0;
    this.playing = false;
    this.elapsed = 0;
    this.speed = 1;
  }
}
