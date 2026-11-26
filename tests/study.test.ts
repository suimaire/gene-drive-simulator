import { describe, expect, it } from 'vitest';
import { cages, StudyPlayback } from '../src/model/study';

describe('published cage observations', () => {
  it('retains the two measured intervals, including eggs at first complete prevalence', () => {
    expect(cages.map(c => c.data.length)).toEqual([13, 9]);
    for (const [index, first] of [11, 7].entries()) {
      const data = cages[index].data;
      expect(data.findIndex(r => r.carrier === 100)).toBe(first);
      expect(data[first].eggs).toBeGreaterThan(0);
      expect(data[first + 1]).toEqual({ carrier: 100, eggs: 0 });
      expect(data[first + 2]).toBeUndefined();
    }
    expect(cages.map(c => c.data[0].eggs)).toEqual([27462, 26895]);
    expect(cages[0].data[5].eggs).toBeGreaterThan(cages[0].data[4].eggs);
  });
  it('stops once at each reported milestone even when given a long interval', () => {
    const clock = new StudyPlayback();
    for (const g of [7, 8, 11, 12]) {
      clock.toggle(); clock.tick(100);
      expect([clock.generation, clock.playing]).toEqual([g, false]);
      expect(clock.tick(100)).toBe(false);
    }
    clock.toggle(); clock.step();
    expect([clock.generation, clock.playing]).toEqual([12, false]);
  });
  it('supports pause, step, speed and reset without changing historical rows', () => {
    const clock = new StudyPlayback();
    clock.toggle(); clock.tick(0.6); clock.toggle(); clock.tick(10);
    expect(clock.generation).toBe(0);
    clock.speed = 2; clock.toggle(); clock.tick(0.51);
    expect(clock.generation).toBe(1);
    clock.step(); expect([clock.generation, clock.playing]).toEqual([2, false]);
    clock.reset();
    expect([clock.generation, clock.speed, clock.playing]).toEqual([0, 1, false]);
  });
});
