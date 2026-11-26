import type { GenerationRecord } from '../model/experiment';

const NS = 'http://www.w3.org/2000/svg';

export interface ChartSeries {
  key: string;
  color: string;
  history: readonly GenerationRecord[];
  /** e 변경 지점을 표시할지 */
  markE?: boolean;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

/** 세대별 D 보유 개체 비율 선 그래프 (SVG) */
export class CarrierChart {
  private readonly svg: SVGSVGElement;
  private readonly host: HTMLElement;
  private series: ChartSeries[] = [];
  private minGenerations: number;

  constructor(host: HTMLElement, minGenerations = 10) {
    this.host = host;
    this.minGenerations = minGenerations;
    this.svg = el('svg', { role: 'img', 'aria-label': '세대별 D 보유 개체 비율 그래프' });
    host.appendChild(this.svg);
    new ResizeObserver(() => this.render()).observe(host);
  }

  update(series: ChartSeries[]): void {
    this.series = series;
    this.render();
  }

  private render(): void {
    const rect = this.host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const W = Math.max(50, rect.width);
    const H = Math.max(40, rect.height);
    const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.replaceChildren();

    const pad = { l: fs * 2.6, r: fs * 0.8, t: fs * 0.6, b: fs * 1.5 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const maxGen = Math.max(
      this.minGenerations,
      ...this.series.map((s) => (s.history.length ? s.history[s.history.length - 1].generation : 0)),
    );
    const x = (g: number) => pad.l + (g / maxGen) * iw;
    const y = (f: number) => pad.t + (1 - f) * ih;

    const axis = el('g', { class: 'chart-axis' }, svg);
    for (const f of [0, 0.5, 1]) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: y(f), y2: y(f), class: f === 0 ? 'base' : 'grid' }, axis);
      const t = el('text', { x: pad.l - fs * 0.4, y: y(f), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, axis);
      t.textContent = `${f * 100}%`;
    }
    const step = maxGen <= 10 ? 2 : maxGen <= 20 ? 5 : 10;
    for (let g = 0; g <= maxGen; g += step) {
      const t = el('text', { x: x(g), y: H - fs * 0.3, 'text-anchor': 'middle' }, axis);
      t.textContent = String(g);
    }
    const unit = el('text', { x: pad.l - fs * 0.4, y: H - fs * 0.3, 'text-anchor': 'end', class: 'unit' }, axis);
    unit.textContent = '세대';

    for (const s of this.series) {
      if (!s.history.length) continue;
      const pts = s.history.map((h) => [x(h.generation), y(h.composition.carrierFraction)] as const);
      el(
        'polyline',
        {
          points: pts.map((p) => p.join(',')).join(' '),
          fill: 'none',
          stroke: s.color,
          'stroke-width': Math.max(2.5, fs * 0.2),
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        },
        svg,
      );
      const last = pts[pts.length - 1];
      el('circle', { cx: last[0], cy: last[1], r: fs * 0.32, fill: s.color, stroke: '#fff', 'stroke-width': 2 }, svg);
      if (s.markE) {
        for (let i = 1; i < s.history.length; i++) {
          const prevE = s.history[i - 1].e;
          const h = s.history[i];
          if (Math.abs(h.e - prevE) > 1e-9) {
            const gx = x(h.generation);
            el('line', { x1: gx, x2: gx, y1: pad.t, y2: pad.t + ih, class: 'e-mark', stroke: s.color }, svg);
            const t = el('text', { x: gx + fs * 0.2, y: pad.t + fs * 0.7, class: 'e-label', fill: s.color }, svg);
            t.textContent = `e=${h.e.toFixed(1)}`;
          }
        }
      }
    }
  }
}
