import { describe, expect, it } from 'vitest';
import {
  breed,
  dTransmissionProbability,
  genotypeOf,
  summarize,
  transmitAllele,
  type Genotype,
  type Mosquito,
} from '../src/model/genetics';
import { Rng } from '../src/model/rng';
import { Experiment } from '../src/model/experiment';
import { Director } from '../src/model/director';

function parentsOf(female: Genotype, male: Genotype, n = 10): Mosquito[] {
  const list: Mosquito[] = [];
  for (let i = 0; i < n; i++) {
    list.push({
      id: i + 1,
      sex: i % 2 === 0 ? 'F' : 'M',
      genotype: i % 2 === 0 ? female : male,
      generation: 0,
      motherId: null,
      fatherId: null,
      inherited: null,
      released: false,
    });
  }
  return list;
}

function breedMany(female: Genotype, male: Genotype, e: number, size = 2000, seed = 7) {
  let id = 1000;
  return breed(parentsOf(female, male), {
    e,
    size,
    generation: 1,
    rng: new Rng(seed),
    nextId: () => ++id,
  });
}

describe('D/W 부모의 D 전달 확률', () => {
  it('e=0이면 50%, e=0.8이면 90%, e=1이면 100%', () => {
    expect(dTransmissionProbability(0)).toBeCloseTo(0.5, 12);
    expect(dTransmissionProbability(0.8)).toBeCloseTo(0.9, 12);
    expect(dTransmissionProbability(1)).toBe(1);
  });

  it('범위 밖의 e는 거부한다', () => {
    expect(() => dTransmissionProbability(-0.1)).toThrow();
    expect(() => dTransmissionProbability(1.1)).toThrow();
    expect(() => dTransmissionProbability(Number.NaN)).toThrow();
  });

  it('실제 배우자 생성 빈도가 설정 확률에 가깝다', () => {
    for (const [e, p] of [
      [0, 0.5],
      [0.8, 0.9],
      [1, 1],
    ] as const) {
      const rng = new Rng(99);
      let d = 0;
      const n = 100_000;
      for (let i = 0; i < n; i++) if (transmitAllele('DW', e, rng.next()) === 'D') d++;
      expect(Math.abs(d / n - p)).toBeLessThan(0.005);
    }
  });

  it('W/W는 항상 W, D/D는 항상 D를 전달한다 (e와 무관)', () => {
    for (const e of [0, 0.5, 1]) {
      for (const u of [0, 0.3, 0.99]) {
        expect(transmitAllele('WW', e, u)).toBe('W');
        expect(transmitAllele('DD', e, u)).toBe('D');
      }
    }
  });
});

describe('교배 결과', () => {
  it('W/W × W/W 자손은 모두 W/W', () => {
    expect(breedMany('WW', 'WW', 1).every((m) => m.genotype === 'WW')).toBe(true);
  });

  it('D/D × D/D 자손은 모두 D/D', () => {
    expect(breedMany('DD', 'DD', 0).every((m) => m.genotype === 'DD')).toBe(true);
  });

  it('W/W × D/D 자손은 모두 D/W', () => {
    expect(breedMany('WW', 'DD', 0.8).every((m) => m.genotype === 'DW')).toBe(true);
    expect(breedMany('DD', 'WW', 0).every((m) => m.genotype === 'DW')).toBe(true);
  });

  it('D/W × W/W 자손 중 D/W 비율은 e=0에서 약 50%, e=0.8에서 약 90%', () => {
    const f0 = summarize(breedMany('DW', 'WW', 0, 20000)).DW / 20000;
    const f8 = summarize(breedMany('DW', 'WW', 0.8, 20000)).DW / 20000;
    expect(Math.abs(f0 - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(f8 - 0.9)).toBeLessThan(0.02);
  });

  it('자손은 실제 부모 ID와 연결되고 받은 대립유전자가 유전자형과 일치한다', () => {
    const parents = parentsOf('DW', 'WW', 20);
    const ids = new Map(parents.map((p) => [p.id, p]));
    let id = 500;
    const kids = breed(parents, { e: 0.8, size: 200, generation: 1, rng: new Rng(3), nextId: () => ++id });
    for (const k of kids) {
      const mother = ids.get(k.motherId!);
      const father = ids.get(k.fatherId!);
      expect(mother?.sex).toBe('F');
      expect(father?.sex).toBe('M');
      expect(k.inherited).not.toBeNull();
      expect(genotypeOf(k.inherited!.fromMother, k.inherited!.fromFather)).toBe(k.genotype);
      // W/W 아비는 W만 줄 수 있다
      expect(k.inherited!.fromFather).toBe('W');
    }
    expect(new Set(kids.map((k) => k.id)).size).toBe(200);
  });
});

describe('집단 요약', () => {
  it('D 대립유전자 빈도와 D 보유 개체 비율을 구별한다', () => {
    const list = [
      ...parentsOf('WW', 'WW', 6),
      ...parentsOf('DW', 'DW', 3).map((m, i) => ({ ...m, id: 100 + i })),
      { ...parentsOf('DD', 'DD', 1)[0], id: 200 },
    ];
    const c = summarize(list);
    expect(c.total).toBe(10);
    expect(c.carriers).toBe(4);
    expect(c.carrierFraction).toBeCloseTo(0.4);
    // D 대립유전자: D/W 3개체 × 1 + D/D 1개체 × 2 = 5개 / 20개
    expect(c.dAlleleFrequency).toBeCloseTo(0.25);
    expect(c.dAlleleFrequency).not.toBeCloseTo(c.carrierFraction);
  });
});

describe('실험 (두 집단)', () => {
  it('두 집단은 같은 초기 구성에서 시작하고 방사는 한 번만 된다', () => {
    const ex = new Experiment({ seed: 1 });
    expect(ex.mendel.current.length).toBe(72);
    const nc = ex.release();
    expect(nc.mendel.length).toBe(8);
    expect(nc.mendel.every((m) => m.genotype === 'DW' && m.released)).toBe(true);
    expect(ex.mendel.history[0].composition).toEqual(ex.drive.history[0].composition);
    expect(ex.mendel.history[0].composition).toMatchObject({ total: 80, WW: 72, DW: 8, DD: 0 });
    expect(() => ex.release()).toThrow();
  });

  it('매 세대 개체 수가 고정 집단 크기와 같고, 이후 외부 D 개체가 추가되지 않는다', () => {
    const ex = new Experiment({ seed: 5 });
    ex.release();
    for (let g = 1; g <= 20; g++) {
      const t = ex.advance();
      for (const key of ['mendel', 'drive'] as const) {
        expect(t[key].offspring.length).toBe(80);
        expect(t[key].offspring.every((m) => m.generation === g && !m.released)).toBe(true);
        const parentIds = new Set(t[key].parents.map((p) => p.id));
        expect(t[key].offspring.every((m) => parentIds.has(m.motherId!) && parentIds.has(m.fatherId!))).toBe(true);
      }
    }
  });

  it('같은 시드와 초기 조건이면 결과가 재현된다', () => {
    const run = (seed: number) => {
      const ex = new Experiment({ seed });
      ex.release();
      for (let g = 0; g < 15; g++) ex.advance();
      return ex.pops().map((p) => p.history.map((h) => [h.composition.WW, h.composition.DW, h.composition.DD]));
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('e=0이면 오른쪽 집단은 멘델 집단과 같은 결과를 낸다 (e만 다른 비교)', () => {
    const ex = new Experiment({ seed: 11, initialE: 0 });
    ex.release();
    for (let g = 0; g < 10; g++) ex.advance();
    expect(ex.drive.history.map((h) => h.composition)).toEqual(ex.mendel.history.map((h) => h.composition));
  });

  it('e=0에서도 D 보유 비율은 우연에 의해 변동한다 (일정하게 강제하지 않음)', () => {
    const ex = new Experiment({ seed: 20261122 });
    ex.release();
    for (let g = 0; g < 10; g++) ex.advance();
    const carriers = new Set(ex.mendel.history.map((h) => h.composition.carriers));
    expect(carriers.size).toBeGreaterThan(1);
  });

  it('e 변경은 이미 태어난 개체를 바꾸지 않고 다음 세대부터 적용된다', () => {
    const ex = new Experiment({ seed: 8, initialE: 0.8 });
    ex.release();
    ex.advance();
    ex.advance();
    const before = JSON.stringify(ex.drive.history);
    ex.setDriveE(0.2);
    expect(JSON.stringify(ex.drive.history)).toBe(before);
    const t = ex.advance();
    expect(t.drive.e).toBe(0.2);
    expect(t.mendel.e).toBe(0);
    expect(ex.drive.history.map((h) => h.e)).toEqual([0.8, 0.8, 0.8, 0.2]);
  });

  it('e=0.8이면 여러 세대 후 오른쪽 집단의 D 보유 비율이 멘델 집단보다 높다 (여러 시드)', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const ex = new Experiment({ seed });
      ex.release();
      for (let g = 0; g < 10; g++) ex.advance();
      if (ex.drive.history[10].composition.carrierFraction > ex.mendel.history[10].composition.carrierFraction) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(27);
  });
});

describe('세대 전환 타임라인', () => {
  function runDirector(speed: 1 | 2, dts: () => number, toggles = false) {
    const d = new Director({ seed: 77 });
    d.setSpeed(speed);
    d.startRelease();
    let guard = 0;
    while (d.busy && guard++ < 10_000) d.tick(dts());
    d.play();
    let i = 0;
    while (d.experiment.generation < 12 && guard++ < 100_000) {
      d.tick(dts());
      if (toggles && ++i % 37 === 0) {
        d.pause();
        d.tick(0.5); // 멈춘 동안의 시간은 진행되지 않는다
        if (i % 74 === 0) d.setSpeed(d.speed === 1 ? 2 : 1);
        d.play();
      }
    }
    d.pause();
    return d.experiment.pops().map((p) => p.history.map((h) => h.individuals.map((m) => m.genotype + m.motherId + m.fatherId).join()));
  }

  it('재생 속도, 프레임 간격, 일시정지가 계산 결과에 영향을 주지 않는다', () => {
    const base = runDirector(1, () => 1 / 60);
    let k = 0;
    const jitter = () => [0.004, 0.033, 0.1, 0.016, 0.21][k++ % 5];
    expect(runDirector(2, () => 1 / 60)).toEqual(base);
    expect(runDirector(1, jitter, true)).toEqual(base);
    expect(runDirector(2, jitter, true)).toEqual(base);
  });

  it('1배속에서 한 세대는 약 4초, 2배속에서 약 2초', () => {
    for (const [speed, expected] of [
      [1, 4],
      [2, 2],
    ] as const) {
      const d = new Director({ seed: 1 });
      d.setSpeed(speed);
      d.startRelease();
      while (d.busy) d.tick(0.01);
      d.play();
      let t = 0;
      d.tick(0.001); // 첫 세대 시작
      while (d.experiment.generation < 2) {
        d.tick(0.01);
        t += 0.01;
      }
      expect(Math.abs(t - expected)).toBeLessThan(0.05);
    }
  });

  it('한 세대 관찰은 교배와 자손 등장 단계에서 멈춘 뒤 세대 교체로 끝난다', () => {
    const d = new Director({ seed: 2 });
    d.startRelease();
    while (d.busy) d.tick(0.05);
    d.step();
    const gen = () => d.experiment.generation;
    expect(gen()).toBe(1); // 계산은 시작 시점에 한 번
    for (let i = 0; i < 200; i++) d.tick(0.05);
    expect(d.held).toBe(true);
    expect(d.activity.kind === 'generation' && d.activity.stage).toBe(1);
    d.step();
    for (let i = 0; i < 200; i++) d.tick(0.05);
    expect(d.held).toBe(true);
    expect(d.activity.kind === 'generation' && d.activity.stage).toBe(2);
    d.step();
    for (let i = 0; i < 200; i++) d.tick(0.05);
    expect(d.activity.kind).toBe('idle');
    expect(gen()).toBe(1);
  });

  it('일시정지 후 재생하면 같은 단계와 진행도에서 이어진다', () => {
    const d = new Director({ seed: 3 });
    d.startRelease();
    while (d.busy) d.tick(0.05);
    d.play();
    for (let i = 0; i < 30; i++) d.tick(0.05);
    d.pause();
    const snap = JSON.stringify({ a: d.activity.kind === 'generation' ? [d.activity.stage, d.activity.progress] : null, g: d.experiment.generation });
    for (let i = 0; i < 50; i++) d.tick(0.05);
    expect(JSON.stringify({ a: d.activity.kind === 'generation' ? [d.activity.stage, d.activity.progress] : null, g: d.experiment.generation })).toBe(snap);
    d.play();
    d.tick(0.05);
    expect(d.running).toBe(true);
  });
});

describe('LMO 질문용 정지', () => {
  it('진행 중인 세대를 끝까지 보여 준 뒤 멈춘다', () => {
    const d = new Director({ seed: 4 });
    d.startRelease();
    while (d.busy) d.tick(0.05);
    d.play();
    for (let i = 0; i < 30; i++) d.tick(0.05); // 2세대 진행 중
    const g = d.experiment.generation;
    d.finishCurrentAndStop();
    for (let i = 0; i < 200; i++) d.tick(0.05);
    expect(d.activity.kind).toBe('idle');
    expect(d.playing).toBe(false);
    expect(d.experiment.generation).toBe(g);
  });
});
