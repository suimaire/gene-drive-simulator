import { Experiment, type ExperimentConfig, type PopKey, type Transition } from './experiment';
import type { Mosquito } from './genetics';
import { LifespanCohort } from './lifespan';

/**
 * 세대 전환 타임라인. 화면과 무관한 순수 상태 기계이다.
 * 유전 계산(Experiment.advance)은 세대 전환이 시작될 때 한 번만 호출된다.
 * 재생 속도와 프레임 간격은 화면이 진행되는 빠르기만 바꾸고 계산 결과는 바꾸지 않는다.
 */

export const STAGES = ['parents', 'mating', 'emergence', 'complete'] as const;
export type StageName = (typeof STAGES)[number];

/** 1배속 기준 단계별 길이(초). 합계 4초 */
export const STAGE_SECONDS: Record<StageName, number> = {
  parents: 0.6,
  mating: 1.3,
  emergence: 1.5,
  complete: 0.6,
};
export const RELEASE_SECONDS = 3.0;

export type Speed = 1 | 2;

export type Activity =
  | { kind: 'idle' }
  | { kind: 'lifespan'; generation: number; enabled: boolean; elapsed: number; endTime: number; cohorts: Record<PopKey, LifespanCohort> }
  | { kind: 'release'; progress: number; newcomers: Record<PopKey, Mosquito[]> }
  | {
      kind: 'generation';
      stage: number;
      progress: number;
      transitions: Record<PopKey, Transition>;
    };

export type DirectorEvent =
  | { type: 'reset' }
  | { type: 'lifespanStart'; showingParents: boolean }
  | { type: 'survivorsChanged' }
  | { type: 'releaseStart'; newcomers: Record<PopKey, Mosquito[]> }
  | { type: 'releaseEnd' }
  | { type: 'generationStart'; transitions: Record<PopKey, Transition> }
  | { type: 'stage'; stage: number }
  | { type: 'generationEnd'; transitions: Record<PopKey, Transition> }
  | { type: 'state' };

export class Director {
  experiment: Experiment;
  activity: Activity = { kind: 'idle' };
  speed: Speed = 1;
  /** 자동 재생 중인지 */
  playing = false;
  /** 타임라인이 실제로 흐르고 있는지 */
  running = false;
  /** 단계별 관찰: 이 단계가 끝나면 멈춘다. null이면 세대 끝까지 진행 */
  private holdAfter: number | null = null;
  private listeners: ((ev: DirectorEvent) => void)[] = [];

  constructor(config: Partial<ExperimentConfig> = {}) {
    this.experiment = new Experiment(config);
  }

  on(fn: (ev: DirectorEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(ev: DirectorEvent): void {
    for (const fn of this.listeners) fn(ev);
  }

  /** 단계 끝에서 멈춰 다음 조작을 기다리는 중인지 */
  get held(): boolean {
    return (
      !this.running &&
      this.activity.kind === 'generation' &&
      this.activity.progress >= 1 &&
      this.activity.stage < STAGES.length - 1
    );
  }

  get busy(): boolean {
    return this.activity.kind !== 'idle';
  }

  /** 화면과 집계가 가리키는 세대. 세대 교체 전에는 부모를 관찰한다. */
  get shownGeneration(): number {
    const a = this.activity;
    if (a.kind === 'lifespan') return a.generation;
    return this.experiment.generation - (a.kind === 'generation' && a.stage < 3 ? 1 : 0);
  }

  setLifespanEnabled(enabled: boolean, limit: number): void {
    const a = this.activity;
    if (a.kind === 'lifespan') {
      a.enabled = enabled;
      this.pause();
      return;
    }
    if (!enabled || a.kind === 'release') return;
    const generation = this.shownGeneration;
    const showingParents = a.kind === 'generation' && a.stage < 3;
    const seed = this.experiment.config.seed ^ Math.imul(generation + 1, 0x9e3779b1);
    const cohort = (key: PopKey) => new LifespanCohort(
      showingParents ? a.transitions[key].parents : this.experiment.pop(key).current, limit, seed,
    );
    const cohorts = { mendel: cohort('mendel'), drive: cohort('drive') };
    this.activity = { kind: 'lifespan', generation, enabled: true, elapsed: 0,
      endTime: Math.max(cohorts.mendel.endTime, cohorts.drive.endTime), cohorts };
    this.holdAfter = null;
    this.playing = this.running = false;
    this.emit({ type: 'lifespanStart', showingParents });
    this.emit({ type: 'state' });
  }

  reset(config: Partial<ExperimentConfig> = {}): void {
    const prev = this.experiment.config;
    this.experiment = new Experiment({ ...prev, ...config });
    this.activity = { kind: 'idle' };
    this.playing = false;
    this.running = false;
    this.holdAfter = null;
    this.emit({ type: 'reset' });
    this.emit({ type: 'state' });
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.emit({ type: 'state' });
  }

  startRelease(): void {
    if (this.experiment.released || this.busy) return;
    const newcomers = this.experiment.release();
    this.activity = { kind: 'release', progress: 0, newcomers };
    this.running = true;
    this.emit({ type: 'releaseStart', newcomers });
    this.emit({ type: 'state' });
  }

  play(): void {
    if (this.activity.kind === 'lifespan') {
      if (this.activity.enabled && this.activity.elapsed < this.activity.endTime) {
        this.playing = this.running = true;
        this.emit({ type: 'state' });
      }
      return;
    }
    if (!this.experiment.released) return;
    if (!this.experiment.canAdvance() && this.activity.kind === 'idle') return;
    this.playing = true;
    this.holdAfter = null;
    if (this.activity.kind === 'generation' && this.activity.progress >= 1) {
      this.nextStage();
    }
    this.running = true;
    this.emit({ type: 'state' });
  }

  pause(): void {
    this.playing = false;
    if (this.activity.kind === 'generation' || this.activity.kind === 'lifespan') this.running = false;
    this.emit({ type: 'state' });
  }

  /** 자동 재생을 멈추되, 진행 중인 세대 전환은 끝까지 보여 준다 */
  finishCurrentAndStop(): void {
    if (this.activity.kind === 'lifespan') return this.pause();
    this.playing = false;
    this.holdAfter = null;
    if (this.activity.kind === 'generation' && this.activity.progress >= 1) this.nextStage();
    if (this.activity.kind === 'generation') this.running = true;
    this.emit({ type: 'state' });
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /**
   * 한 세대 관찰 / 다음 단계.
   * 대기 중이면 새 세대를 시작해 '교배와 유전' 끝에서 멈추고,
   * 다음 누름에서 '자손 등장' 끝까지, 그다음 누름에서 세대 교체까지 진행한다.
   */
  step(): void {
    const a = this.activity;
    if (a.kind === 'release' || a.kind === 'lifespan') return;
    this.playing = false;
    if (a.kind === 'idle') {
      if (!this.experiment.canAdvance()) return;
      this.beginGeneration();
      this.holdAfter = 1;
      this.running = true;
    } else if (this.held) {
      this.nextStage();
      const now = this.activity;
      this.holdAfter = now.kind === 'generation' && now.stage === 2 ? 2 : null;
      this.running = true;
    } else {
      // 진행 중이거나 단계 중간에 멈춘 경우: 현재 단계 끝에서 멈추도록 설정
      this.holdAfter = a.stage <= 1 ? 1 : a.stage === 2 ? 2 : null;
      this.running = true;
    }
    this.emit({ type: 'state' });
  }

  private beginGeneration(): void {
    const transitions = this.experiment.advance();
    this.activity = { kind: 'generation', stage: 0, progress: 0, transitions };
    this.emit({ type: 'generationStart', transitions });
    this.emit({ type: 'stage', stage: 0 });
  }

  private nextStage(): void {
    const a = this.activity;
    if (a.kind !== 'generation') return;
    if (a.stage >= STAGES.length - 1) {
      this.finishGeneration();
      return;
    }
    a.stage += 1;
    a.progress = 0;
    this.emit({ type: 'stage', stage: a.stage });
  }

  private finishGeneration(): void {
    const a = this.activity;
    if (a.kind !== 'generation') return;
    this.activity = { kind: 'idle' };
    this.holdAfter = null;
    this.emit({ type: 'generationEnd', transitions: a.transitions });
    if (this.playing && this.experiment.canAdvance()) {
      this.beginGeneration();
      this.running = true;
    } else {
      this.playing = false;
      this.running = false;
    }
    this.emit({ type: 'state' });
  }

  /** 시간 진행. dt는 실제 경과 시간(초) */
  tick(dt: number): void {
    if (dt <= 0) return;
    // 탭 전환 등으로 생긴 긴 공백은 한 번에 건너뛰지 않는다
    let remaining = Math.min(dt, 0.25) * this.speed;
    let guard = 0;
    while (remaining > 0 && guard++ < 16) {
      const a = this.activity;
      if (a.kind === 'lifespan') {
        if (!this.running) return;
        a.elapsed = Math.min(a.endTime, a.elapsed + remaining);
        const mendelChanged = a.cohorts.mendel.advanceTo(a.elapsed);
        const driveChanged = a.cohorts.drive.advanceTo(a.elapsed);
        if (mendelChanged || driveChanged) this.emit({ type: 'survivorsChanged' });
        if (a.elapsed === a.endTime) this.pause();
        return;
      }
      if (a.kind === 'idle') {
        if (this.playing && this.experiment.canAdvance()) {
          this.beginGeneration();
          this.running = true;
          continue;
        }
        if (this.playing) {
          this.playing = false;
          this.emit({ type: 'state' });
        }
        return;
      }
      if (!this.running) return;
      if (a.kind === 'release') {
        const need = (1 - a.progress) * RELEASE_SECONDS;
        if (remaining < need) {
          a.progress += remaining / RELEASE_SECONDS;
          return;
        }
        remaining -= need;
        this.activity = { kind: 'idle' };
        this.running = false;
        this.emit({ type: 'releaseEnd' });
        this.emit({ type: 'state' });
        return;
      }
      const dur = STAGE_SECONDS[STAGES[a.stage]];
      const need = (1 - a.progress) * dur;
      if (remaining < need) {
        a.progress += remaining / dur;
        return;
      }
      remaining -= need;
      a.progress = 1;
      if (this.holdAfter === a.stage) {
        this.running = false;
        this.holdAfter = null;
        this.emit({ type: 'state' });
        return;
      }
      this.nextStage();
    }
  }
}
