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
}

/**
 * 위에서 내려다본 모기 실루엣. 몸 전체 색이 유전자형을 나타내고,
 * 배 위의 흰 점 개수가 D 대립유전자 수(0, 1, 2)를 나타낸다.
 */
export function drawMosquito(ctx: CanvasRenderingContext2D, o: MosquitoDraw): void {
  const L = o.size;
  if (L < 2) return;
  const c = GENO_COLOR[o.genotype];
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
  if (dots.length) {
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
