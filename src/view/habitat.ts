import type { Director } from '../model/director';
import type { PopKey, Transition } from '../model/experiment';
import type { Mosquito } from '../model/genetics';
import { drawMosquito, GENO_COLOR } from './mosquito';

/**
 * 한 서식지의 Canvas 렌더러.
 * 화면 위의 모기 하나는 모형의 개체 하나(Mosquito)에 대응한다.
 * 유전 상태는 읽기만 하고, 움직임과 투명도 같은 시각 상태만 여기서 관리한다.
 * 움직임에는 Math.random을 쓰므로 유전 계산용 난수와 섞이지 않는다.
 */

type Role = 'adult' | 'parent' | 'child' | 'incoming';

interface Sprite {
  m: Mosquito;
  role: Role;
  x: number;
  y: number;
  heading: number;
  speed: number;
  turnPhase: number;
  turnFreq: number;
  wing: number;
  wingRate: number;
  boost: number;
  alpha: number;
  scale: number;
  // 자손
  spawnAt: number;
  spawned: boolean;
  // 방사 개체
  from?: { x: number; y: number };
  ctrl?: { x: number; y: number };
  to?: { x: number; y: number };
  delay: number;
  // 교배 사례 부모가 모이는 위치
  meet?: { x: number; y: number };
}

export interface Example {
  child: Mosquito;
  mother: Mosquito;
  father: Mosquito;
  meet: { x: number; y: number };
}

export interface HabitatPick {
  key: PopKey;
  mosquito: Mosquito;
  example?: Example;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Habitat {
  readonly key: PopKey;
  private readonly director: Director;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement | null = null;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private L = 36;
  private adults: Sprite[] = [];
  private parents: Sprite[] = [];
  private children: Sprite[] = [];
  private incoming: Sprite[] = [];
  examples: Example[] = [];
  private exampleIds = new Set<number>();
  selectedId: number | null = null;
  /** 방사 직후 0세대 동안 도입 개체를 표시 */
  private showReleased = false;
  private releaseLabel = '';
  onPick: (pick: HabitatPick | null) => void = () => {};

  constructor(canvas: HTMLCanvasElement, key: PopKey, director: Director) {
    this.canvas = canvas;
    this.key = key;
    this.director = director;
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (ev) => this.handlePointer(ev));
    this.resize();
  }

  private get pop() {
    return this.director.experiment.pop(this.key);
  }

  get mosquitoSize(): number {
    return this.L;
  }

  // ---------- 상태 동기화 ----------

  private makeSprite(m: Mosquito, role: Role, x?: number, y?: number): Sprite {
    const margin = this.L * 0.7;
    return {
      m,
      role,
      x: x ?? rand(margin, Math.max(margin, this.W - margin)),
      y: y ?? rand(margin, Math.max(margin, this.H - margin)),
      heading: rand(0, TAU),
      speed: rand(0.45, 0.75),
      turnPhase: rand(0, TAU),
      turnFreq: rand(0.35, 0.8),
      wing: rand(0, TAU),
      wingRate: rand(26, 34),
      boost: 0,
      alpha: 1,
      scale: 1,
      spawnAt: 0,
      spawned: true,
      delay: 0,
    };
  }

  /** 처음으로: 현재 집단 그대로 새로 배치 */
  rebuild(): void {
    this.adults = this.pop.current.map((m) => this.makeSprite(m, 'adult'));
    this.parents = [];
    this.children = [];
    this.incoming = [];
    this.examples = [];
    this.exampleIds.clear();
    this.selectedId = null;
    this.showReleased = false;
    this.releaseLabel = '';
  }

  onReleaseStart(newcomers: Mosquito[]): void {
    const n = newcomers.length;
    const margin = this.L;
    this.incoming = newcomers.map((m, i) => {
      const s = this.makeSprite(m, 'incoming');
      const fx = this.W * 0.5 + (i - (n - 1) / 2) * this.L * 0.45;
      s.from = { x: fx, y: -this.L };
      s.to = { x: rand(margin, this.W - margin), y: rand(this.H * 0.25, this.H - margin) };
      s.ctrl = { x: (fx + s.to.x) / 2 + rand(-1, 1) * this.W * 0.15, y: this.H * 0.15 };
      s.delay = (i / Math.max(1, n - 1)) * 0.35;
      s.x = s.from.x;
      s.y = s.from.y;
      return s;
    });
    this.showReleased = true;
    this.releaseLabel = `D/W 수컷 ${n}마리 방사`;
  }

  onReleaseEnd(): void {
    for (const s of this.incoming) {
      if (s.to) {
        s.x = s.to.x;
        s.y = s.to.y;
      }
      s.role = 'adult';
      this.adults.push(s);
    }
    this.incoming = [];
    this.releaseLabel = '';
  }

  onGenerationStart(t: Transition): void {
    // 이전 세대가 끝나지 않은 상태라면 정리
    this.finishPending();
    this.showReleased = false;
    this.parents = this.adults;
    for (const p of this.parents) p.role = 'parent';
    this.adults = [];
    const byId = new Map(this.parents.map((s) => [s.m.id, s]));

    this.children = t.offspring.map((m) => {
      const s = this.makeSprite(m, 'child', -100, -100);
      s.spawned = false;
      s.spawnAt = rand(0.05, 0.6);
      return s;
    });

    // 교배 사례: D 보유 부모가 포함된 쌍을 우선, 부모가 겹치지 않게 최대 3쌍
    this.examples = [];
    this.exampleIds.clear();
    const used = new Set<number>();
    const pick = (pred: (c: Mosquito) => boolean) => {
      for (const c of t.offspring) {
        if (this.examples.length >= 3) return;
        if (!pred(c) || used.has(c.motherId!) || used.has(c.fatherId!)) continue;
        const ms = byId.get(c.motherId!);
        const fs = byId.get(c.fatherId!);
        if (!ms || !fs) continue;
        used.add(c.motherId!);
        used.add(c.fatherId!);
        // 위쪽 이름표와 아래쪽 확대 보기 창에 가리지 않는 위치에서 모인다
        const m = this.L * 1.2;
        const meet = {
          x: Math.min(this.W - m, Math.max(m, (ms.x + fs.x) / 2)),
          y: Math.min(this.H * 0.62, Math.max(this.L * 2.4, (ms.y + fs.y) / 2)),
        };
        // 다른 쌍과 겹치지 않게 조금 밀어낸다
        for (let tries = 0; tries < 6; tries++) {
          const near = this.examples.find((e) => Math.abs(e.meet.x - meet.x) < this.L * 2.6 && Math.abs(e.meet.y - meet.y) < this.L * 1.6);
          if (!near) break;
          meet.y = meet.y + this.L * 1.7 > this.H * 0.62 ? meet.y - this.L * 1.7 : meet.y + this.L * 1.7;
          meet.y = Math.min(this.H * 0.62, Math.max(this.L * 2.4, meet.y));
          if (tries >= 2) meet.x = Math.min(this.W - m, Math.max(m, meet.x + (meet.x < this.W / 2 ? 1 : -1) * this.L * 2.8));
        }
        ms.meet = { x: meet.x - this.L * 0.42, y: meet.y };
        fs.meet = { x: meet.x + this.L * 0.42, y: meet.y };
        this.examples.push({ child: c, mother: ms.m, father: fs.m, meet });
        this.exampleIds.add(c.id);
      }
    };
    const find = (id: number | null) => this.pop.find(id);
    pick((c) => find(c.motherId)!.genotype === 'DW' || find(c.fatherId)!.genotype === 'DW');
    pick((c) => find(c.motherId)!.genotype !== 'WW' || find(c.fatherId)!.genotype !== 'WW');
    pick(() => true);
    for (const c of this.children) {
      if (this.exampleIds.has(c.m.id)) c.spawnAt = 0;
    }
  }

  onGenerationEnd(): void {
    this.finishPending();
  }

  private finishPending(): void {
    if (!this.parents.length && !this.children.length) return;
    const byId = new Map(this.parents.map((s) => [s.m.id, s]));
    for (const c of this.children) {
      if (!c.spawned) this.spawn(c, byId);
      c.role = 'adult';
      c.alpha = 1;
      c.scale = 1;
    }
    this.adults = this.children;
    this.children = [];
    this.parents = [];
    for (const s of this.adults) s.meet = undefined;
  }

  private spawn(c: Sprite, parentsById: Map<number, Sprite>): void {
    const ex = this.examples.find((e) => e.child.id === c.m.id);
    const mother = parentsById.get(c.m.motherId!);
    const base = ex ? ex.meet : mother ? { x: mother.x, y: mother.y } : { x: this.W / 2, y: this.H / 2 };
    c.x = base.x + rand(-0.2, 0.2) * this.L;
    c.y = base.y + rand(-0.2, 0.2) * this.L;
    c.heading = rand(0, TAU);
    c.boost = 1;
    c.spawned = true;
  }

  // ---------- 크기 ----------

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    const sx = this.W ? W / this.W : 1;
    const sy = this.H ? H / this.H : 1;
    for (const list of [this.adults, this.parents, this.children, this.incoming]) {
      for (const s of list) {
        s.x *= sx;
        s.y *= sy;
        if (s.meet) s.meet = { x: s.meet.x * sx, y: s.meet.y * sy };
        if (s.to) s.to = { x: s.to.x * sx, y: s.to.y * sy };
        if (s.from) s.from = { x: s.from.x * sx, y: s.from.y * sy };
        if (s.ctrl) s.ctrl = { x: s.ctrl.x * sx, y: s.ctrl.y * sy };
      }
    }
    for (const e of this.examples) e.meet = { x: e.meet.x * sx, y: e.meet.y * sy };
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.L = Math.max(22, Math.min(96, 0.7 * Math.sqrt((W * H) / this.director.experiment.config.populationSize)));
    this.bg = null;
  }

  private drawBackground(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const g = cv.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    const W = this.W;
    const H = this.H;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#f6faf3');
    grad.addColorStop(1, '#e6efdf');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // 물웅덩이
    g.fillStyle = 'rgba(176, 212, 222, 0.28)';
    g.beginPath();
    g.ellipse(W * 0.72, H * 0.8, W * 0.2, H * 0.09, -0.05, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(W * 0.2, H * 0.3, W * 0.1, H * 0.05, 0.1, 0, TAU);
    g.fill();
    // 풀
    g.strokeStyle = 'rgba(120, 160, 110, 0.22)';
    g.lineCap = 'round';
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.lineWidth = Math.max(1.5, this.L * 0.05);
    for (let i = 0; i < 46; i++) {
      const x = r() * W;
      const h = (0.04 + r() * 0.08) * H;
      const lean = (r() - 0.5) * h * 0.6;
      g.beginPath();
      g.moveTo(x, H + 2);
      g.quadraticCurveTo(x + lean * 0.3, H - h * 0.5, x + lean, H - h);
      g.stroke();
    }
    return cv;
  }

  // ---------- 입력 ----------

  private handlePointer(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let best: Sprite | null = null;
    let bestD = (this.L * 0.7) ** 2;
    for (const s of this.visibleSprites()) {
      if (s.alpha < 0.3) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) {
      this.selectedId = null;
      this.onPick(null);
      return;
    }
    this.selectedId = best.m.id;
    const ex =
      best.role === 'parent'
        ? this.examples.find((e) => e.mother.id === best!.m.id || e.father.id === best!.m.id)
        : this.examples.find((e) => e.child.id === best!.m.id);
    this.onPick({ key: this.key, mosquito: best.m, example: ex });
  }

  private *visibleSprites(): Iterable<Sprite> {
    yield* this.parents;
    yield* this.adults;
    for (const c of this.children) if (c.spawned) yield c;
    yield* this.incoming;
  }

  // ---------- 프레임 ----------

  private wander(s: Sprite, dt: number, speedFactor = 1): void {
    const L = this.L;
    s.turnPhase += dt * s.turnFreq;
    let turn = Math.sin(s.turnPhase) * 1.0 + Math.sin(s.turnPhase * 0.37 + 1.3) * 0.4;
    const m = L * 0.9;
    let ax = 0;
    let ay = 0;
    if (s.x < m) ax += (m - s.x) / m;
    if (s.x > this.W - m) ax -= (s.x - (this.W - m)) / m;
    if (s.y < m) ay += (m - s.y) / m;
    if (s.y > this.H - m) ay -= (s.y - (this.H - m)) / m;
    if (ax || ay) {
      const desired = Math.atan2(ay, ax);
      let diff = desired - s.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      turn += diff * 4 * Math.min(1.5, Math.hypot(ax, ay));
    }
    s.heading += turn * dt;
    const v = s.speed * L * speedFactor * (1 + s.boost * 1.2);
    s.boost = Math.max(0, s.boost - dt * 0.8);
    s.x += Math.cos(s.heading) * v * dt;
    s.y += Math.sin(s.heading) * v * dt;
    s.x = Math.min(this.W - L * 0.3, Math.max(L * 0.3, s.x));
    s.y = Math.min(this.H - L * 0.3, Math.max(L * 0.3, s.y));
  }

  private steerTo(s: Sprite, target: { x: number; y: number }, faceAngle: number, dt: number, strength: number): void {
    const k = Math.min(1, dt * 3) * strength;
    const dx = target.x - s.x;
    const dy = target.y - s.y;
    s.x += dx * k;
    s.y += dy * k;
    const moving = Math.hypot(dx, dy) > this.L * 0.25;
    const want = moving ? Math.atan2(dy, dx) : faceAngle;
    let diff = want - s.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    s.heading += diff * Math.min(1, dt * 5);
  }

  frame(dt: number, time: number): void {
    if (!this.W || !this.H) return;
    const ctx = this.ctx;
    const L = this.L;
    const act = this.director.activity;
    const frozen = !this.director.running && act.kind === 'generation';
    const motion = frozen ? 0.55 : 1;

    let stage = -1;
    let p = 0;
    if (act.kind === 'generation') {
      stage = act.stage;
      p = act.progress;
    }

    const parentsById = new Map(this.parents.map((s) => [s.m.id, s]));

    // --- 자손 등장 처리 (타임라인 진행도 기준) ---
    if (stage >= 2) {
      for (const c of this.children) {
        if (!c.spawned && (stage > 2 || p >= c.spawnAt)) this.spawn(c, parentsById);
      }
    }

    // --- 위치 갱신 ---
    for (const s of this.adults) {
      s.wing += dt * s.wingRate;
      this.wander(s, dt, motion);
      s.alpha = 1;
      s.scale = 1;
    }

    // 부모: 교배 단계에서는 사례 쌍이 모이고, 자손 등장 이후 서서히 물러난다
    for (const s of this.parents) {
      s.wing += dt * s.wingRate;
      const meeting = s.meet && (stage === 1 || (stage === 2 && p < 0.4));
      if (meeting) {
        const face = s.m.sex === 'F' ? 0 : Math.PI;
        this.steerTo(s, s.meet!, face, dt, stage === 1 ? ease(clamp01(p * 2)) + 0.15 : 1);
      } else {
        this.wander(s, dt, (stage >= 2 ? 0.55 : 1) * motion);
      }
      let a = 1;
      let sc = 1;
      if (stage === 1 && !s.meet) a = 1 - 0.3 * ease(clamp01(p * 2));
      if (stage === 2) {
        const f = ease(clamp01((p - 0.15) / 0.85));
        a = (s.meet ? 1 : 0.7) * (1 - f) + 0.28 * f;
        sc = 1 - 0.18 * f;
      } else if (stage === 3) {
        a = 0.28 * (1 - ease(p));
        sc = 0.82 - 0.1 * p;
      }
      s.alpha = a;
      s.scale = sc;
    }

    for (const c of this.children) {
      if (!c.spawned) continue;
      c.wing += dt * c.wingRate;
      this.wander(c, dt, motion);
      const g = stage === 2 ? clamp01((p - c.spawnAt) / 0.4) : 1;
      c.alpha = ease(g);
      c.scale = 0.35 + 0.65 * easeOut(g);
    }

    // 방사 개체 비행
    if (act.kind === 'release') {
      for (const s of this.incoming) {
        s.wing += dt * s.wingRate;
        const q = easeOut(clamp01((act.progress - s.delay) / 0.6));
        const { from, ctrl, to } = s as Required<Sprite>;
        const u = 1 - q;
        const nx = u * u * from.x + 2 * u * q * ctrl.x + q * q * to.x;
        const ny = u * u * from.y + 2 * u * q * ctrl.y + q * q * to.y;
        if (Math.hypot(nx - s.x, ny - s.y) > 0.01) s.heading = Math.atan2(ny - s.y, nx - s.x);
        s.x = nx;
        s.y = ny;
      }
    }

    // --- 그리기 ---
    if (!this.bg) this.bg = this.drawBackground();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const draw = (s: Sprite) =>
      drawMosquito(ctx, {
        x: s.x,
        y: s.y,
        size: L * s.scale,
        angle: s.heading,
        genotype: s.m.genotype,
        sex: s.m.sex,
        wing: s.wing,
        alpha: s.alpha,
      });

    const highlighted = new Set<number>();
    if (stage === 1 || (stage === 2 && p < 0.4)) {
      for (const e of this.examples) {
        highlighted.add(e.mother.id);
        highlighted.add(e.father.id);
      }
    }

    for (const s of this.parents) if (!highlighted.has(s.m.id)) draw(s);
    for (const s of this.adults) draw(s);

    // 도입 개체 표시 (0세대)
    if (this.showReleased) {
      const pulse = 0.55 + 0.25 * Math.sin(time * 3.2);
      ctx.lineWidth = Math.max(2, L * 0.07);
      ctx.strokeStyle = `rgba(240, 150, 0, ${pulse})`;
      for (const s of [...this.adults, ...this.incoming]) {
        if (!s.m.released) continue;
        ctx.beginPath();
        ctx.arc(s.x, s.y, L * 0.62, 0, TAU);
        ctx.stroke();
      }
    }
    for (const s of this.incoming) draw(s);

    // 교배 쌍 강조
    if (highlighted.size) {
      // 부모가 거의 모였을 때 쌍 표시가 나타난다
      const a = stage === 1 ? ease(clamp01((p - 0.3) / 0.35)) : 1 - clamp01(p / 0.4);
      for (const e of this.examples) {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.strokeStyle = 'rgba(70, 80, 100, 0.8)';
        ctx.lineWidth = Math.max(1.5, L * 0.045);
        ctx.setLineDash([L * 0.16, L * 0.1]);
        ctx.beginPath();
        ctx.ellipse(e.meet.x, e.meet.y, L * 1.05, L * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      for (const s of this.parents) if (highlighted.has(s.m.id)) draw(s);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#3d4656';
      ctx.font = `700 ${Math.round(L * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const e of this.examples) ctx.fillText('×', e.meet.x, e.meet.y - L * 0.48);
      ctx.restore();
    }

    // 자손: 태어날 때 퍼지는 고리
    for (const c of this.children) {
      if (!c.spawned) continue;
      const g = stage === 2 ? clamp01((p - c.spawnAt) / 0.4) : 1;
      if (g < 1) {
        ctx.save();
        ctx.globalAlpha = 0.6 * (1 - g);
        ctx.strokeStyle = GENO_COLOR[c.m.genotype].body;
        ctx.lineWidth = Math.max(2, L * 0.08);
        ctx.beginPath();
        ctx.arc(c.x, c.y, L * (0.25 + 0.55 * g), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      draw(c);
    }

    // 선택한 개체
    if (this.selectedId != null) {
      const s = [...this.visibleSprites()].find((v) => v.m.id === this.selectedId);
      if (s) {
        ctx.save();
        ctx.strokeStyle = '#e8590c';
        ctx.lineWidth = Math.max(2.5, L * 0.08);
        ctx.setLineDash([L * 0.2, L * 0.12]);
        ctx.lineDashOffset = -time * L * 0.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, L * 0.66, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (this.releaseLabel && act.kind === 'release') {
      const a = act.progress < 0.85 ? 1 : 1 - (act.progress - 0.85) / 0.15;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `700 ${Math.round(Math.max(15, L * 0.42))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(this.releaseLabel).width;
      const y = this.H * 0.2;
      ctx.fillStyle = 'rgba(255, 244, 222, 0.95)';
      ctx.strokeStyle = 'rgba(240, 150, 0, 0.9)';
      ctx.lineWidth = 2;
      const pad = L * 0.25;
      const h = L * 0.62;
      ctx.beginPath();
      ctx.roundRect(this.W / 2 - tw / 2 - pad, y - pad * 0.5, tw + pad * 2, h + pad * 0.4, h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8a4b00';
      ctx.fillText(this.releaseLabel, this.W / 2, y);
      ctx.restore();
    }
  }
}
