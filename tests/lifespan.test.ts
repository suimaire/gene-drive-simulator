import { describe, expect, it } from 'vitest';
import { Director } from '../src/model/director';
import { summarize } from '../src/model/genetics';
import { POP_KEYS } from '../src/model/experiment';
import { LifespanCohort } from '../src/model/lifespan';

function released(): Director {
  const d = new Director({ seed: 52 });
  d.startRelease();
  while (d.busy) d.tick(0.25);
  return d;
}

describe('현재 세대의 수명 관찰', () => {
  it.each([1, 3])('세대 전환 단계 %i에서 표시 중인 집단과 기록을 고정한다', (stage) => {
    const d = released();
    d.play();
    do { d.tick(0.125); } while (d.activity.kind !== 'generation' || d.activity.stage !== stage);
    const generation = d.shownGeneration;
    const records = d.experiment.pops().map((p) => p.history.slice());
    const states = d.experiment.pops().map((p) => p.rng.state);
    d.setLifespanEnabled(true, 10);
    const a = d.activity as Director['activity'];
    if (a.kind !== 'lifespan') throw Error('수명 관찰 시작 실패');
    expect(a.generation).toBe(stage === 3 ? 1 : 0);
    for (const key of POP_KEYS) {
      expect(a.cohorts[key].composition).toEqual(d.experiment.pop(key).history[generation].composition);
    }
    d.play();
    let previous = 80;
    for (let i = 0; i < 80; i++) {
      d.tick(0.125);
      for (const key of POP_KEYS) {
        const cohort = a.cohorts[key];
        const survivors = d.experiment.pop(key).history[generation].individuals.filter(
          (m) => cohort.fadeOpacity(m.id, a.elapsed) !== 0,
        );
        expect(cohort.composition).toEqual(summarize(survivors));
      }
      expect(a.cohorts.drive.composition.total).toBeLessThanOrEqual(previous);
      previous = a.cohorts.drive.composition.total;
      if (i === 39) {
        expect(previous).toBeGreaterThan(0);
        expect(previous).toBeLessThan(80);
      }
    }
    d.play();
    d.step();
    d.startRelease();
    expect(previous).toBe(0);
    expect(d.running).toBe(false);
    expect(d.experiment.pops().map((p) => p.history)).toEqual(records);
    expect(d.experiment.pops().map((p) => p.rng.state)).toEqual(states);
  });

  it('일시정지와 관찰 해제는 수명을 보존하고 배속은 같은 시각의 결과를 보존한다', () => {
    const run = (speed: 1 | 2) => {
      const d = released();
      d.setLifespanEnabled(true, 20);
      const a = d.activity;
      if (a.kind !== 'lifespan') throw Error('수명 관찰 시작 실패');
      d.setSpeed(speed);
      d.play();
      for (let i = 0; i < 32 / speed; i++) d.tick(0.125);
      d.pause();
      d.tick(0.25);
      d.setLifespanEnabled(false, 10);
      d.togglePlay();
      d.tick(0.25);
      expect(a.elapsed).toBe(4);
      d.setLifespanEnabled(true, 40);
      d.play();
      for (let i = 0; i < 48 / speed; i++) d.tick(0.125);
      expect(a.elapsed).toBe(10);
      return d.experiment.drive.current.map((m) => a.cohorts.drive.fadeOpacity(m.id, a.elapsed));
    };
    expect(run(1)).toEqual(run(2));
  });

  it('수명 설정을 늘리면 같은 개체가 더 오래 남고 제거 직전에는 서서히 사라진다', () => {
    const [m] = released().experiment.mendel.current;
    const short = new LifespanCohort([m], 10, 52);
    const long = new LifespanCohort([m], 40, 52);
    expect(long.endTime).toBeGreaterThan(short.endTime);
    expect(short.fadeOpacity(m.id, 0)).toBeNull();
    expect(short.fadeOpacity(m.id, short.endTime - 0.15)).toBeCloseTo(0.5);
    short.advanceTo(short.endTime);
    expect(short.fadeOpacity(m.id, short.endTime)).toBe(0);
    expect(short.composition.total).toBe(0);
  });

  it('방사 전에도 관찰할 수 있고 처음으로 돌아가면 시드 52의 유전 결과가 복원된다', () => {
    const d = new Director();
    d.setLifespanEnabled(true, 10);
    const a = d.activity;
    if (a.kind !== 'lifespan') throw Error('수명 관찰 시작 실패');
    expect(a.cohorts.drive.composition.total).toBe(72);
    d.startRelease();
    expect(d.experiment.released).toBe(false);
    d.reset();
    const baseline = released();
    d.startRelease();
    while (d.busy) d.tick(0.25);
    expect(d.experiment.advance()).toEqual(baseline.experiment.advance());
  });
});
