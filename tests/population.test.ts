import { describe, expect, it } from 'vitest';
import { CONDITIONS, FADE_TICKS, INITIAL_COUNT, PopulationObservation, ROUND_TICKS, type Individual } from '../src/model/population';
import { Director } from '../src/model/director';

function state(obs: PopulationObservation) {
  return CONDITIONS.map(k => {
    const g = obs.groups[k];
    return { births: g.births, deaths: g.deaths, living: [...g.living.values()], pairs: g.pairs };
  });
}

describe('유전 모형과 독립적인 개체수 관찰', () => {
  it.each([10, 20, 40])('수명 %i에서 모든 출생과 사망을 실제 개체와 대조한다', limit => {
    const obs = new PopulationObservation(limit, 52);
    const initial = obs.groups.usual.living;
    for (const m of initial.values()) {
      expect(obs.groups.limited.living.get(m.id)?.diesAt).toBe(m.diesAt);
    }
    let overlapping = false;
    obs.play();
    for (let i = 0; i < ROUND_TICKS * 6; i++) {
      const before = CONDITIONS.map(k => new Map(obs.groups[k].living));
      obs.advance(0.05, 1);
      for (const [idx, key] of CONDITIONS.entries()) {
        const g = obs.groups[key];
        expect(g.living.size).toBe(INITIAL_COUNT + g.births - g.deaths);
        for (const previous of before[idx].values()) {
          if (!g.living.has(previous.id)) expect(previous.diesAt).toBe(obs.tick);
        }
        for (const m of g.living.values()) {
          if (before[idx].has(m.id)) continue;
          expect(m.bornAt).toBe(obs.tick);
          expect(m.diesAt).toBeGreaterThan(obs.tick);
          const parents = [m.mother, m.father].map(id => g.living.get(id!) as Individual);
          expect(parents.map(p => p.sex)).toEqual(['F', 'M']);
          expect(parents.every(p => p.canReproduce && p.diesAt > obs.tick + FADE_TICKS)).toBe(true);
          overlapping = true;
        }
      }
    }
    expect(overlapping).toBe(true);
    for (const k of CONDITIONS) {
      expect(obs.groups[k].births).toBeGreaterThan(0);
      expect(obs.groups[k].deaths).toBeGreaterThan(0);
    }
  });

  it('배속, 프레임 간격, 일시정지와 한 회차 관찰이 같은 가상 시각의 결과를 보존한다', () => {
    const a = new PopulationObservation(20, 52), b = new PopulationObservation(20, 52);
    a.play(true);
    for (let i = 0; i < 300; i++) a.advance(1 / 30, 1);
    expect(a.tick).toBe(ROUND_TICKS);
    expect(a.running).toBe(false);
    b.play();
    for (let i = 0; i < 20; i++) {
      b.advance(0.03, 2);
      b.advance(0.07, 2);
    }
    expect(b.tick).toBe(a.tick);
    expect(state(a)).toEqual(state(b));
    b.running = false;
    b.advance(30, 2);
    expect(state(a)).toEqual(state(b));
    expect(b.tick).toBe(a.tick);
  });

  it('번식할 짝이 없는 집단은 0에 도달하면 이후에도 0이다', () => {
    const obs = new PopulationObservation(10, 3);
    for (const g of Object.values(obs.groups)) {
      for (const m of g.living.values()) m.canReproduce = false;
    }
    obs.play();
    obs.advance(40, 1);
    expect(obs.finished).toBe(true);
    expect(obs.running).toBe(false);
    obs.play();
    obs.advance(40, 1);
    for (const k of CONDITIONS) {
      expect(obs.groups[k].births).toBe(0);
      expect(obs.groups[k].deaths).toBe(INITIAL_COUNT);
    }
  });

  it('개체수 관찰 전후에 유전 모형의 시드 52 결과가 같다', () => {
    const d = new Director({seed: 52}), control = new Director({seed: 52});
    for (const engine of [d, control]) engine.experiment.release();
    const obs = new PopulationObservation(20, 52);
    obs.play();
    obs.advance(12, 2);
    for (let i = 0; i < 5; i++) expect(d.experiment.advance()).toEqual(control.experiment.advance());
  });
});
