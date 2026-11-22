import type { Rng } from './rng';

/** W: 야생형 대립유전자, D: 드라이브 대립유전자 */
export type Allele = 'W' | 'D';
export type Genotype = 'WW' | 'DW' | 'DD';
export type Sex = 'F' | 'M';

export const GENOTYPES: readonly Genotype[] = ['WW', 'DW', 'DD'];

export const GENOTYPE_LABEL: Record<Genotype, string> = {
  WW: 'W/W',
  DW: 'D/W',
  DD: 'D/D',
};

export interface Inheritance {
  fromMother: Allele;
  fromFather: Allele;
}

export interface Mosquito {
  id: number;
  sex: Sex;
  genotype: Genotype;
  generation: number;
  motherId: number | null;
  fatherId: number | null;
  /** 부모에게서 실제로 받은 대립유전자. 0세대 개체는 null */
  inherited: Inheritance | null;
  /** 가상 방사로 도입된 개체 여부 */
  released: boolean;
}

/**
 * D/W 부모의 배우자가 D를 가질 확률.
 * 교육용 단순 호밍 모형: P(D) = (1 + e) / 2
 */
export function dTransmissionProbability(e: number): number {
  if (!Number.isFinite(e) || e < 0 || e > 1) {
    throw new RangeError(`호밍 효율 e는 0 이상 1 이하여야 합니다: ${e}`);
  }
  return (1 + e) / 2;
}

/**
 * 부모 유전자형과 균등 난수 u로 배우자에 들어갈 대립유전자를 정한다.
 * W/W는 항상 W, D/D는 항상 D, D/W는 확률 (1+e)/2로 D.
 */
export function transmitAllele(genotype: Genotype, e: number, u: number): Allele {
  switch (genotype) {
    case 'WW':
      return 'W';
    case 'DD':
      return 'D';
    case 'DW':
      return u < dTransmissionProbability(e) ? 'D' : 'W';
  }
}

export function genotypeOf(a: Allele, b: Allele): Genotype {
  const d = (a === 'D' ? 1 : 0) + (b === 'D' ? 1 : 0);
  return d === 2 ? 'DD' : d === 1 ? 'DW' : 'WW';
}

export function dAlleleCount(g: Genotype): 0 | 1 | 2 {
  return g === 'DD' ? 2 : g === 'DW' ? 1 : 0;
}

export interface Composition {
  total: number;
  WW: number;
  DW: number;
  DD: number;
  /** D를 하나 이상 가진 개체 수 (D/W + D/D) */
  carriers: number;
  /** D 보유 개체 비율 */
  carrierFraction: number;
  /** 집단 전체 대립유전자 중 D의 비율 */
  dAlleleFrequency: number;
}

export function summarize(list: readonly Mosquito[]): Composition {
  let WW = 0;
  let DW = 0;
  let DD = 0;
  for (const m of list) {
    if (m.genotype === 'WW') WW++;
    else if (m.genotype === 'DW') DW++;
    else DD++;
  }
  const total = list.length;
  const carriers = DW + DD;
  return {
    total,
    WW,
    DW,
    DD,
    carriers,
    carrierFraction: total ? carriers / total : 0,
    dAlleleFrequency: total ? (DW + 2 * DD) / (2 * total) : 0,
  };
}

export interface BreedOptions {
  e: number;
  size: number;
  generation: number;
  rng: Rng;
  nextId: () => number;
}

/**
 * 부모 세대에서 다음 세대 자손을 만든다 (무작위 교배, 고정 집단 크기).
 * 자손 한 마리마다 난수 4개를 같은 순서로 사용한다:
 * 어미 선택, 아비 선택, 어미 배우자, 아비 배우자.
 * 유전자형과 관계없이 같은 수의 난수를 쓰므로 두 집단을 같은 시드로
 * 계산하면 e만 다른 조건으로 비교할 수 있다.
 */
export function breed(parents: readonly Mosquito[], opts: BreedOptions): Mosquito[] {
  const females = parents.filter((m) => m.sex === 'F');
  const males = parents.filter((m) => m.sex === 'M');
  if (females.length === 0 || males.length === 0) {
    throw new Error('암컷과 수컷이 모두 있어야 교배할 수 있습니다.');
  }
  const { e, size, generation, rng, nextId } = opts;
  dTransmissionProbability(e); // 범위 검사

  const offspring: Mosquito[] = [];
  for (let i = 0; i < size; i++) {
    const mother = females[rng.int(females.length)];
    const father = males[rng.int(males.length)];
    const fromMother = transmitAllele(mother.genotype, e, rng.next());
    const fromFather = transmitAllele(father.genotype, e, rng.next());
    offspring.push({
      id: nextId(),
      // 성비 1:1 고정 (모형 가정)
      sex: i % 2 === 0 ? 'F' : 'M',
      genotype: genotypeOf(fromMother, fromFather),
      generation,
      motherId: mother.id,
      fatherId: father.id,
      inherited: { fromMother, fromFather },
      released: false,
    });
  }
  return offspring;
}
