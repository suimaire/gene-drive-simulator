import type { Genotype, Sex } from '../model/genetics';

export const GENO_COLOR: Record<Genotype, { body: string; dark: string; css: string }> = {
  WW: { body: '#a9b6c6', dark: '#5b6878', css: 'var(--ww)' },
  DW: { body: '#13a99a', dark: '#0a6a60', css: 'var(--dw)' },
  DD: { body: '#1d6a3e', dark: '#0b3820', css: 'var(--dd)' },
};

export interface MosquitoDraw {
  x: number;
  y: number;
  /** 머리에서 배 끝까지의 길이(px) */
  size: number;
  /** 머리가 향하는 방향(rad) */
  angle: number;
  genotype: Genotype;
  sex: Sex;
  /** 날갯짓 위상 */
  wing: number;
  alpha?: number;
  shadow?: boolean;
  /** 단색 연구 아이콘에는 대립유전자 수 표식을 그리지 않는다. */
  ink?: { body: string; dark: string };

}

/**
 * 위에서 내려다본 모기 실루엣. 몸 전체 색이 유전자형을 나타내고,
 * 배 위의 흰 점 개수가 D 대립유전자 수(0, 1, 2)를 나타낸다.
 */
type DrawingContext = Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'translate' | 'rotate' | 'globalAlpha' | 'lineCap' | 'lineJoin' |
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'beginPath' | 'ellipse' | 'arc' |
  'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'fill' | 'stroke'>;

export function drawMosquito(ctx: DrawingContext, o: MosquitoDraw): void {
  const L = o.size;
  if (L < 2) return;
  const c = o.ink ?? GENO_COLOR[o.genotype];
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;

  if (o.shadow !== false) {
    ctx.fillStyle = 'rgba(40, 60, 40, 0.10)';
    ctx.beginPath();
    ctx.ellipse(o.x + L * 0.06, o.y + L * 0.32, L * 0.32, L * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 다리 3쌍
  ctx.strokeStyle = c.dark;
  ctx.globalAlpha = (o.alpha ?? 1) * 0.75;
  ctx.lineWidth = Math.max(1, L * 0.022);
  const legs: [number, number, number, number, number, number][] = [
    [0.1, 0.04, 0.26, 0.3, 0.46, 0.38],
    [0.05, 0.05, 0.02, 0.36, -0.06, 0.52],
    [0.0, 0.05, -0.2, 0.34, -0.46, 0.46],
  ];
  for (const s of [-1, 1]) {
    ctx.beginPath();
    for (const [x0, y0, x1, y1, x2, y2] of legs) {
      ctx.moveTo(x0 * L, s * y0 * L);
      ctx.quadraticCurveTo(x1 * L, s * y1 * L, x2 * L, s * y2 * L);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = o.alpha ?? 1;

  // 날개 (작은 폭으로 펄럭임)
  const flap = Math.sin(o.wing) * 0.12;
  ctx.fillStyle = 'rgba(226, 238, 246, 0.62)';
  ctx.strokeStyle = 'rgba(80, 100, 120, 0.55)';
  ctx.lineWidth = Math.max(0.8, L * 0.014);
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(0.03 * L, s * 0.03 * L);
    ctx.rotate(s * (Math.PI - 0.42 - flap));
    ctx.beginPath();
    ctx.ellipse(L * 0.25, 0, L * 0.27, L * 0.075, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 배
  ctx.fillStyle = c.body;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = Math.max(1, L * 0.024);
  ctx.beginPath();
  ctx.ellipse(-0.22 * L, 0, 0.29 * L, 0.1 * L, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 마디 무늬
  ctx.globalAlpha = (o.alpha ?? 1) * 0.35;
  ctx.lineWidth = Math.max(0.8, L * 0.016);
  ctx.beginPath();
  for (const sx of [-0.06, -0.15, -0.28, -0.38]) {
    const hw = 0.1 * L * Math.sqrt(Math.max(0, 1 - ((sx + 0.22) / 0.29) ** 2));
    ctx.moveTo(sx * L, -hw * 0.85);
    ctx.lineTo(sx * L, hw * 0.85);
  }
  ctx.stroke();
  ctx.globalAlpha = o.alpha ?? 1;

  // 가슴
  ctx.lineWidth = Math.max(1, L * 0.024);
  ctx.beginPath();
  ctx.ellipse(0.07 * L, 0, 0.12 * L, 0.105 * L, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 머리, 주둥이, 더듬이
  ctx.beginPath();
  ctx.arc(0.22 * L, 0, 0.058 * L, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = Math.max(1, L * 0.022);
  ctx.beginPath();
  ctx.moveTo(0.27 * L, 0);
  ctx.lineTo(0.5 * L, 0);
  for (const s of [-1, 1]) {
    ctx.moveTo(0.25 * L, s * 0.02 * L);
    ctx.lineTo(0.37 * L, s * 0.1 * L);
  }
  ctx.stroke();
  if (o.sex === 'M') {
    // 수컷의 깃털 모양 더듬이
    ctx.lineWidth = Math.max(0.7, L * 0.012);
    ctx.beginPath();
    for (const s of [-1, 1]) {
      for (const t of [0.35, 0.6, 0.85]) {
        const ax = (0.25 + 0.12 * t) * L;
        const ay = s * (0.02 + 0.08 * t) * L;
        ctx.moveTo(ax - 0.03 * L, ay - s * 0.03 * L);
        ctx.lineTo(ax + 0.03 * L, ay + s * 0.03 * L);
      }
    }
    ctx.stroke();
  }

  // D 표식: 흰 점 개수 = D 대립유전자 수
  const dots = o.genotype === 'DD' ? [-0.13, -0.31] : o.genotype === 'DW' ? [-0.22] : [];
  if (!o.ink && dots.length) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = Math.max(0.8, L * 0.018);
    for (const dx of dots) {
      ctx.beginPath();
      ctx.arc(dx * L, 0, Math.max(1.6, 0.068 * L), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** HTML용 작은 정지 아이콘 */
export function mosquitoIcon(genotype: Genotype, sex: Sex, cssWidth: number, cssHeight = cssWidth * 0.8): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  cv.width = Math.round(cssWidth * dpr);
  cv.height = Math.round(cssHeight * dpr);
  cv.style.width = `${cssWidth}px`;
  cv.style.height = `${cssHeight}px`;
  cv.className = 'mq-icon';
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const L = Math.min(cssWidth * 0.95, cssHeight * 1.05);
  drawMosquito(ctx, {
    x: cssWidth * 0.5 + L * 0.02,
    y: cssHeight * 0.5,
    size: L,
    angle: -Math.PI / 2,
    genotype,
    sex,
    wing: 0,
    shadow: false,
  });
  return cv;
}



interface InkLayer {
  path: Path2D;
  stroke: boolean;
  color: string;
  width: number;
  alpha: number;
}

/** Compile the same artwork to native vector paths for large display sizes. */
class OutlineRecorder {
  globalAlpha = 1;
  lineWidth = 1;
  lineCap: CanvasLineCap = 'round';
  lineJoin: CanvasLineJoin = 'round';
  fillStyle = '';
  strokeStyle = '';
  readonly layers: InkLayer[] = [];
  private matrix = new DOMMatrix();
  private stack: DOMMatrix[] = [];
  private path = new Path2D();
  private placed: Path2D | null = null;

  // In drawMosquito the nested save/restore pairs isolate wing transforms.
  save(): void { this.stack.push(DOMMatrix.fromMatrix(this.matrix)); }
  restore(): void { this.matrix = this.stack.pop()!; }
  translate(x: number, y: number): void { this.matrix.translateSelf(x, y); }
  rotate(rad: number): void { this.matrix.rotateSelf(rad * 180 / Math.PI); }
  beginPath(): void { this.path = new Path2D(); this.placed = null; }
  moveTo(x: number, y: number): void { this.path.moveTo(x, y); }
  lineTo(x: number, y: number): void { this.path.lineTo(x, y); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.path.quadraticCurveTo(cx, cy, x, y);
  }
  ellipse(...args: Parameters<Path2D['ellipse']>): void { this.path.ellipse(...args); }
  arc(...args: Parameters<Path2D['arc']>): void { this.path.arc(...args); }
  fill(): void { this.record(false); }
  stroke(): void { this.record(true); }

  private record(stroke: boolean): void {
    if (!this.placed) {
      this.placed = new Path2D();
      this.placed.addPath(this.path, this.matrix);
    }
    this.layers.push({ path: this.placed, stroke, color: stroke ? this.strokeStyle : this.fillStyle,
      width: this.lineWidth, alpha: this.globalAlpha });
  }
}

/** Original CSS-space drawing rasterized above the habitat's backing resolution. */
export class MosquitoSprites {
  private readonly sheets = new Map<string, HTMLCanvasElement | ImageBitmap>();
  private readonly side: number;
  private readonly pixels: number;
  private readonly columns = 5;
  private readonly outlines = new Map<string, InkLayer[]>();
  private static readonly wingSteps = 16;

  constructor(readonly size: number, readonly dpr: number) {
    this.side = size * 1.24 + 4;
    this.pixels = Math.ceil(this.side * dpr * 1.5);
  }

  private sheet(genotype: Genotype, sex: Sex): HTMLCanvasElement | ImageBitmap {
    const key = genotype + sex;
    const existing = this.sheets.get(key);
    if (existing) return existing;
    const width = this.columns * this.pixels;
    const height = Math.ceil((MosquitoSprites.wingSteps + 1) / this.columns) * this.pixels;
    const tile = typeof OffscreenCanvas === 'function' && 'transferToImageBitmap' in OffscreenCanvas.prototype
      ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    tile.width = width;
    tile.height = height;
    const ctx = tile.getContext('2d')!;
    const factor = this.pixels / this.side;
    ctx.scale(factor, factor);
    for (let i = 0; i <= MosquitoSprites.wingSteps; i++) {
      drawMosquito(ctx, {
        x: (i % this.columns + 0.5) * this.side,
        y: (Math.floor(i / this.columns) + 0.5) * this.side,
        size: this.size, angle: 0, genotype, sex,
        wing: Math.asin(i * 2 / MosquitoSprites.wingSteps - 1), shadow: false,
      });
    }
    const image = 'transferToImageBitmap' in tile ? tile.transferToImageBitmap() : tile;
    this.sheets.set(key, image);
    return image;
  }

  private outline(genotype: Genotype, sex: Sex, index: number): InkLayer[] {
    const key = genotype + sex + index;
    let layers = this.outlines.get(key);
    if (!layers) {
      const recorder = new OutlineRecorder();
      drawMosquito(recorder, { x: 0, y: 0, size: this.size, angle: 0, genotype, sex,
        wing: Math.asin(index * 2 / MosquitoSprites.wingSteps - 1), shadow: false });
      this.outlines.set(key, layers = recorder.layers);
    }
    return layers;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale: number,
       genotype: Genotype, sex: Sex, wing: number, alpha: number): void {
    if (alpha <= 0 || scale * this.size < 2) return;
    // The original artwork has minimum widths for legs and genotype dots.
    // Raster scaling would thin these details on newly emerging offspring.
    if (scale < 0.78) {
      drawMosquito(ctx, { x, y, size: this.size * scale, angle, genotype, sex, wing, alpha });
      return;
    }
    const side = this.side * scale;
    const half = side / 2;
    const index = Math.round((Math.sin(wing) + 1) * MosquitoSprites.wingSteps / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    const size = this.size * scale;
    ctx.fillStyle = 'rgba(40, 60, 40, 0.10)';
    ctx.beginPath();
    ctx.ellipse(x + size * 0.06, y + size * 0.32, size * 0.32, size * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // At 4K, rotating mostly transparent bitmap tiles costs more than drawing
    // the sparse strokes. Reuse those strokes at full device resolution.
    if (this.size * this.dpr >= 96) {
      ctx.scale(scale, scale);
      ctx.lineJoin = ctx.lineCap = 'round';
      for (const layer of this.outline(genotype, sex, index)) {
        ctx.globalAlpha = alpha * layer.alpha;
        if (layer.stroke) {
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = layer.width;
          ctx.stroke(layer.path);
        } else {
          ctx.fillStyle = layer.color;
          ctx.fill(layer.path);
        }
      }
    } else {
      ctx.drawImage(this.sheet(genotype, sex), index % this.columns * this.pixels,
        Math.floor(index / this.columns) * this.pixels, this.pixels, this.pixels, -half, -half, side, side);
    }
    ctx.restore();
  }
}

// Both habitats normally share one size. Retain at most the two current size classes.
const recentAtlases: MosquitoSprites[] = [];
export function spritesFor(size: number, dpr: number): MosquitoSprites {
  const existing = recentAtlases.find(atlas => atlas.size === size && atlas.dpr === dpr);
  if (existing) return existing;
  const atlas = new MosquitoSprites(size, dpr);
  if (recentAtlases.length === 2) recentAtlases.shift();
  recentAtlases.push(atlas);
  return atlas;
}
