import './style.css';
import { Director, STAGES, type Speed } from './model/director';
import { DEFAULT_CONFIG, POP_KEYS, type GenerationRecord, type PopKey } from './model/experiment';
import {
  dTransmissionProbability,
  GENOTYPE_LABEL,
  GENOTYPES,
  summarize,
  type Composition,
  type Genotype,
  type Mosquito,
} from './model/genetics';
import { cages, StudyPlayback } from './model/study';
import panelA from './view/figure5a.png?inline';
import panelB from './view/figure5b.png?inline';
import { CarrierChart } from './view/chart';
import { Habitat, type Example, type HabitatPick } from './view/habitat';
import { mosquitoIcon } from './view/mosquito';

// ---------- 설정 (난수 시드는 주소의 ?seed= 로만 바꾼다) ----------
const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));
const seed = Number.isFinite(seedParam) && params.has('seed') ? Math.floor(seedParam) : DEFAULT_CONFIG.seed;

const director = new Director({ seed });
let studyMode = false;
const study = new StudyPlayback();

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

const ui = {
  genNum: $('#gen-num'),
  genSub: $('#gen-sub'),
  eSlider: $<HTMLInputElement>('#e-slider'),
  eValue: $<HTMLOutputElement>('#e-value'),
  eHint: $('#e-hint'),
  pValue: $('#p-value'),
  release: $<HTMLButtonElement>('#btn-release'),
  step: $<HTMLButtonElement>('#btn-step'),
  play: $<HTMLButtonElement>('#btn-play'),
  reset: $<HTMLButtonElement>('#btn-reset'),
  mode: $<HTMLSelectElement>('#mode-select'),
  speedBtns: [...document.querySelectorAll<HTMLButtonElement>('.speed button')],
  stages: [...document.querySelectorAll<HTMLLIElement>('#stages li')],
  legend: $('#legend'),
  diff: $('#diff-value'),
  lmoBtn: $<HTMLButtonElement>('#btn-lmo'),
  lmoCard: $('#lmo-card'),
  lmoHintsBtn: $<HTMLButtonElement>('#btn-lmo-hints'),
  lmoHints: $('#lmo-hints'),
  modelBtn: $<HTMLButtonElement>('#btn-model'),
  dialog: $<HTMLDialogElement>('#model-dialog'),
  historyTable: $<HTMLTableElement>('#history-table'),
};

const pct = (f: number) => `${Math.round(f * 100)}%`;
const pctOfE = (e: number) => {
  const v = dTransmissionProbability(e) * 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
};

// ---------- 서식지 ----------
interface HabUi {
  section: HTMLElement;
  habitat: Habitat;
  counts: HTMLElement;
  inspector: HTMLElement;
  summary: HTMLElement;
  insp: InspectorState | null;
}

type InspectorState =
  | { kind: 'example'; example: Example; revealed: boolean; auto: boolean }
  | { kind: 'lineage'; mosquito: Mosquito }
  | { kind: 'founder'; mosquito: Mosquito };

const habs = {} as Record<PopKey, HabUi>;
for (const key of POP_KEYS) {
  const section = $(`.habitat[data-key="${key}"]`);
  const habitat = new Habitat($<HTMLCanvasElement>('canvas', section), key, director);
  habs[key] = {
    section,
    habitat,
    counts: $('.hab-counts', section),
    inspector: $('.inspector', section),
    summary: $(`#sum-${key}`),
    insp: null,
  };
  habitat.onPick = (pick) => onPick(key, pick);
  habitat.rebuild();
}

const chart = new CarrierChart($('#chart'), 10);

// ---------- 표시할 세대 ----------
/** 세대 번호와 수치는 '세대 교체' 단계에 들어설 때 바뀐다. */
function shownGeneration(): number {
  const a = director.activity;
  const g = director.experiment.generation;
  if (a.kind === 'generation' && a.stage < 3) return g - 1;
  return g;
}

function shownHistory(key: PopKey): GenerationRecord[] {
  const pop = director.experiment.pop(key);
  return pop.history.slice(0, shownGeneration() + 1);
}

function shownComposition(key: PopKey): Composition {
  const ex = director.experiment;
  const a = director.activity;
  if (!ex.released || a.kind === 'release') {
    // 방사 전(또는 방사 중)에는 기존 집단만
    return summarize(ex.pop(key).current.filter((m) => !m.released));
  }
  return ex.pop(key).history[shownGeneration()].composition;
}

// ---------- 갱신 ----------
function genoSwatch(g: Genotype): string {
  return `<i class="sw-geno ${g}" aria-hidden="true"></i>`;
}

let summaryKey = '';
const countViews = new Map<PopKey, string>();
function renderCounts(): void {
  for (const key of POP_KEYS) {
    const c = shownComposition(key);
    const totals = [c.WW, c.DW, c.DD].join('/');
    if (countViews.get(key) === totals) continue;
    countViews.set(key, totals);
    habs[key].counts.innerHTML = GENOTYPES.map(
      (g) => `<span class="cnt ${g}">${genoSwatch(g)}<span class="cnt-l">${GENOTYPE_LABEL[g]}</span><b>${c[g]}</b></span>`,
    ).join('');
  }
}

function barHtml(c: Composition | undefined): string {
  if (!c || !c.total) return '<div class="bar empty"></div>';
  return `<div class="bar">${GENOTYPES.map((g) => {
    const f = c[g] / c.total;
    if (!c[g]) return '';
    return `<span class="seg ${g}" style="flex-grow:${c[g]}" title="${GENOTYPE_LABEL[g]} ${c[g]}">${f >= 0.09 ? c[g] : ''}</span>`;
  }).join('')}</div>`;
}

function renderSummary(): void {
  const key = [director.experiment.released, shownGeneration(), director.activity.kind === 'release', director.experiment.drive.history.length].join('/');
  if (key === summaryKey) return;
  summaryKey = key;
  const ex = director.experiment;
  const gen = shownGeneration();
  const carriers: Record<PopKey, number> = { mendel: 0, drive: 0 };
  for (const key of POP_KEYS) {
    const pop = ex.pop(key);
    const now = shownComposition(key);
    const releasing = director.activity.kind === 'release';
    const first = ex.released && !releasing ? pop.initial?.composition : undefined;
    carriers[key] = now.carrierFraction;
    const name = key === 'mendel' ? '멘델 유전' : '호밍 드라이브';
    const nowLabel = !ex.released ? '방사 전' : releasing ? '방사 중' : `지금 ${gen}세대`;
    habs[key].summary.innerHTML = `
      <div class="sum-head">
        <span class="sum-name">${name}</span>
        <span class="sum-carrier"><span class="sum-cap">D 보유</span><b>${now.carriers}</b><span class="sum-of">/ ${now.total}</span><em>${pct(now.carrierFraction)}</em></span>
      </div>
      <div class="bar-row"><span class="bar-label">처음</span>${barHtml(first)}</div>
      <div class="bar-row now"><span class="bar-label">${nowLabel}</span>${barHtml(now)}</div>`;
  }
  const d = Math.round((carriers.drive - carriers.mendel) * 100);
  ui.diff.textContent = ex.released ? `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}%p` : '0%p';
  chart.update(
    ex.released
      ? [
          { key: 'mendel', color: '#56688a', history: shownHistory('mendel') },
          { key: 'drive', color: '#e0600f', history: shownHistory('drive'), markE: true },
        ]
      : [],
  );
}

function renderHeader(): void {
  if (studyMode) return renderStudyHeader();
  const ex = director.experiment;
  const a = director.activity;
  const gen = shownGeneration();
  ui.genNum.textContent = String(gen);
  let sub = '';
  if (!ex.released) sub = '방사 전';
  else if (a.kind === 'release') sub = '방사 중';
  else if (a.kind === 'generation' && a.stage < 3) sub = `${ex.generation}세대 만드는 중`;
  else if (!ex.canAdvance() && a.kind === 'idle') sub = '마지막 세대';
  else if (gen === 0) sub = '방사 직후';
  ui.genSub.textContent = sub;

  // 단계 표시
  const stage = a.kind === 'generation' ? a.stage : -1;
  ui.stages.forEach((li, i) => {
    li.classList.toggle('active', i === stage);
    li.classList.toggle('done', stage >= 0 && i < stage);
  });

  // 버튼
  const released = ex.released;
  ui.release.disabled = released || director.busy;
  ui.release.textContent = released ? '방사 완료' : '가상 방사';
  ui.release.classList.toggle('primary', !released);

  const canStep = released && a.kind !== 'release' && (a.kind === 'generation' || ex.canAdvance());
  ui.step.disabled = !canStep;
  ui.step.textContent = director.held ? '다음 단계' : '한 세대 관찰';
  ui.step.classList.toggle('primary', canStep && (director.held || (gen === 0 && a.kind === 'idle')));

  const canPlay = released && a.kind !== 'release' && (a.kind === 'generation' || ex.canAdvance());
  ui.play.disabled = !canPlay;
  ui.play.classList.toggle('playing', director.playing);
  $('.ico', ui.play).textContent = director.playing ? '❚❚' : '▶';
  $('.lbl', ui.play).textContent = director.playing ? '일시정지' : '재생';
  ui.play.setAttribute('aria-label', director.playing ? '일시정지' : '재생');

  ui.speedBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === director.speed));
}

function renderE(): void {
  const e = Number(ui.eSlider.value);
  ui.eValue.textContent = e.toFixed(1);
  ui.pValue.textContent = pctOfE(e);
  $('.drive-e').textContent = e.toFixed(1);
  $('.drive-p').textContent = pctOfE(e);
}

function renderAll(): void {
  renderHeader();
  renderCounts();
  renderSummary();
}

function renderStudyHeader(): void {
  ui.genNum.textContent = String(study.generation);
  ui.genSub.textContent = study.finished ? '관찰 종료' : study.playing ? '기록 재생 중' : '관찰 기록';
  ui.step.disabled = ui.play.disabled = study.finished;
  ui.step.textContent = '한 세대 관찰';
  ui.step.classList.remove('primary');
  ui.play.classList.toggle('playing', study.playing);
  const label = study.playing ? '일시정지' : '재생';
  $('.ico', ui.play).textContent = study.playing ? '❚❚' : '▶';
  $('.lbl', ui.play).textContent = label;
  ui.play.setAttribute('aria-label', label);
  ui.speedBtns.forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === study.speed));
}

function renderStudy(): void {
  renderStudyHeader();
  const g = study.generation;
  document.documentElement.style.setProperty('--figure-cursor', `${(366.6 - 327 + g * 10.19) / 2}%`);
  POP_KEYS.forEach((key, index) => {
    const cage = cages[index];
    const latest = Math.min(g, cage.data.length - 1);
    const row = cage.data[latest];
    const h = habs[key];
    const ended = g > latest;
    const pct = row.carrier.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '%';
    const relative = row.eggs / cage.data[0].eggs * 100;
    const eggLabel = relative.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '%';
    h.habitat.setStudy({ carrier: row.carrier, color: cage.color });
    h.counts.innerHTML = `<span class="cnt">D 보유 <b>${pct}</b></span>`;
    const note = row.eggs === 0 ? '새로운 알이 관찰되지 않았습니다.' :
      row.carrier === 100 ? '관찰한 자손 모두가 드라이브를 보유했습니다.' : '';
    $('.study-eggs', h.section).innerHTML = `<span>상대 산란량　${eggLabel}</span>` +
      `<div class="bar"><span style="width:${relative}%;background:${cage.color}"></span></div>` +
      (note ? `<small>${note}</small>` : '');
    h.summary.innerHTML = `<div class="sum-head"><span class="sum-name">${cage.name}</span><b>${ended ? latest+'세대 관찰 종료' : latest+'세대'}</b></div>
      <div class="study-summary">기준 산란량　${cage.data[0].eggs.toLocaleString('ko-KR')}개</div>
      <div class="study-summary">이 세대 산란량　<b>${row.eggs.toLocaleString('ko-KR')}개</b></div>`;
    $('.hab-rule.study-only', h.section).textContent = ended ? `${latest}세대 마지막 기록` : index ? '원논문 파란 관찰선' : '원논문 빨간 관찰선';
  });
}

function showMode(): void {
  $('#app').classList.toggle('observing-study', studyMode);
  ui.lmoCard.hidden = true;
  for (const key of POP_KEYS) {
    const h = habs[key];
    const name = key === 'mendel' ? '멘델 유전' : '호밍 드라이브';
    $('canvas', h.section).setAttribute('aria-label', studyMode ?
      (key === 'mendel' ? '케이지 1' : '케이지 2') + '의 드라이브 보유 비율 대표 그림' : name + ' 집단의 모기');
    if (studyMode) h.inspector.hidden = true;
    else { h.habitat.setStudy(null); renderInspector(key); }
  }
  if (studyMode) renderStudy();
  else { countViews.clear(); summaryKey = ''; renderAll(); }
  restartClock();
}

function playOrPause(): void {
  if (!studyMode) return director.togglePlay();
  study.toggle();
  renderStudyHeader();
  restartClock();
}

function step(): void {
  if (!studyMode) return director.step();
  study.step();
  renderStudy();
  restartClock();
}

// ---------- 확대 보기 (교배 사례, 가계) ----------
function probNote(g: Genotype, e: number): string {
  if (g === 'WW') return 'W만 전달';
  if (g === 'DD') return 'D만 전달';
  return `D 전달 ${pctOfE(e)}`;
}

function indHtml(m: Mosquito, role: string, note?: string): string {
  return `<div class="insp-ind ${m.genotype}"><span class="icon" data-g="${m.genotype}" data-s="${m.sex}"></span><b>${GENOTYPE_LABEL[m.genotype]}</b><small>${role}</small>${note ? `<em>${note}</em>` : ''}</div>`;
}

function renderInspector(key: PopKey): void {
  const h = habs[key];
  const st = h.insp;
  const box = h.inspector;
  if (!st) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const pop = director.experiment.pop(key);
  let body = '';
  let title = '';
  if (st.kind === 'founder') {
    const m = st.mosquito;
    title = m.released ? '가상 방사 개체' : '처음 집단의 개체';
    body = `<div class="insp-row single">${indHtml(m, m.sex === 'F' ? '암컷, 0세대' : '수컷, 0세대')}<p>${
      m.released ? '0세대에 한 번 도입된 D/W 수컷' : '방사 전부터 있던 W/W 개체'
    }</p></div>`;
  } else {
    let mother: Mosquito | undefined;
    let father: Mosquito | undefined;
    let child: Mosquito;
    let revealed = true;
    if (st.kind === 'example') {
      ({ mother, father, child } = st.example);
      revealed = st.revealed;
      title = `교배 사례, ${child.generation}세대 자손`;
    } else {
      child = st.mosquito;
      mother = pop.find(child.motherId);
      father = pop.find(child.fatherId);
      title = `${child.generation}세대 개체의 부모`;
    }
    if (!mother || !father) return;
    const rec = pop.history.find((r) => r.generation === child.generation);
    const e = rec ? rec.e : director.experiment.eFor(key);
    const inh = child.inherited!;
    body = `<div class="insp-row">
      ${indHtml(mother, '어미', probNote(mother.genotype, e))}
      <div class="insp-x">×</div>
      ${indHtml(father, '아비', probNote(father.genotype, e))}
      <div class="insp-gametes ${revealed ? 'show' : ''}">
        <span class="chip ${inh.fromMother}">${revealed ? inh.fromMother : '?'}</span>
        <span class="chip ${inh.fromFather}">${revealed ? inh.fromFather : '?'}</span>
        <span class="arrow">→</span>
      </div>
      ${revealed ? indHtml(child, '자손') : '<div class="insp-ind pending"><span class="q">?</span><small>자손</small></div>'}
    </div>`;
  }
  box.innerHTML = `<div class="insp-head"><span>${title}</span><button class="close" type="button" aria-label="닫기">×</button></div>${body}`;
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  box.querySelectorAll<HTMLElement>('.icon').forEach((span) => {
    span.appendChild(mosquitoIcon(span.dataset.g as Genotype, span.dataset.s as 'F' | 'M', fs * 2.6, fs * 2.3));
  });
  $('.close', box).addEventListener('click', () => {
    h.insp = null;
    h.habitat.selectedId = null;
    renderInspector(key);
  });
  box.hidden = false;
}

function onPick(key: PopKey, pick: HabitatPick | null): void {
  const h = habs[key];
  if (!pick) {
    h.insp = null;
  } else if (pick.example) {
    const a = director.activity;
    const revealed = pick.mosquito.id === pick.example.child.id || (a.kind === 'generation' && a.stage >= 2) || a.kind === 'idle';
    h.insp = { kind: 'example', example: pick.example, revealed, auto: false };
  } else if (pick.mosquito.generation === 0) {
    h.insp = { kind: 'founder', mosquito: pick.mosquito };
  } else {
    h.insp = { kind: 'lineage', mosquito: pick.mosquito };
  }
  renderInspector(key);
}

// ---------- 타임라인 이벤트 ----------
director.on((ev) => {
  switch (ev.type) {
    case 'reset':
      summaryKey = '';
      for (const key of POP_KEYS) {
        habs[key].habitat.rebuild();
        habs[key].insp = null;
        renderInspector(key);
      }
      ui.eHint.textContent = '';
      renderAll();
      break;
    case 'releaseStart':
      for (const key of POP_KEYS) habs[key].habitat.onReleaseStart(ev.newcomers[key]);
      renderAll();
      break;
    case 'releaseEnd':
      for (const key of POP_KEYS) habs[key].habitat.onReleaseEnd();
      renderAll();
      break;
    case 'generationStart':
      for (const key of POP_KEYS) {
        const h = habs[key];
        h.habitat.onGenerationStart(ev.transitions[key]);
        h.habitat.selectedId = null;
        // 단계별 관찰일 때만 교배 사례를 자동으로 확대해 보여 준다
        const ex = h.habitat.examples[0];
        h.insp = !director.playing && ex ? { kind: 'example', example: ex, revealed: false, auto: true } : null;
        renderInspector(key);
      }
      ui.eHint.textContent = '';
      renderHeader();
      break;
    case 'stage':
      if (ev.stage === 2) {
        for (const key of POP_KEYS) {
          const st = habs[key].insp;
          if (st?.kind === 'example' && !st.revealed) {
            st.revealed = true;
            renderInspector(key);
          }
        }
      }
      if (ev.stage === 3) {
        renderCounts();
        renderSummary();
      }
      renderHeader();
      break;
    case 'generationEnd':
      for (const key of POP_KEYS) {
        habs[key].habitat.onGenerationEnd();
        const st = habs[key].insp;
        if (st?.kind === 'example' && st.auto && director.playing) {
          habs[key].insp = null;
          renderInspector(key);
        }
      }
      renderAll();
      break;
    case 'state': {
      // 자동 재생 중에 단계별 관찰로 바꿔 멈춘 경우에도 교배 사례를 보여 준다
      const a = director.activity;
      if (director.held && a.kind === 'generation') {
        for (const key of POP_KEYS) {
          const h = habs[key];
          const ex = h.habitat.examples[0];
          if (!h.insp && ex) {
            h.insp = { kind: 'example', example: ex, revealed: a.stage >= 2, auto: true };
            renderInspector(key);
          }
        }
      }
      renderHeader();
      break;
    }
  }
});

// ---------- 조작 ----------
ui.mode.addEventListener('change', () => {
  // Keep the inactive timeline, including an unfinished release or held example, intact.
  studyMode = ui.mode.value === 'study';
  study.playing = false;
  showMode();
});
ui.release.addEventListener('click', () => director.startRelease());
ui.step.addEventListener('click', step);
ui.play.addEventListener('click', playOrPause);
ui.reset.addEventListener('click', () => {
  if (studyMode) {
    study.reset();
    ui.lmoCard.hidden = true;
    renderStudy();
    restartClock();
    return;
  }
  director.reset({ initialE: Number(ui.eSlider.value) });
  ui.lmoCard.hidden = true;
});
ui.speedBtns.forEach(b => b.addEventListener('click', () => {
  const speed = Number(b.dataset.speed) as Speed;
  if (studyMode) { study.speed = speed; renderStudyHeader(); }
  else director.setSpeed(speed);
}));

ui.eSlider.addEventListener('input', () => {
  const e = Number(ui.eSlider.value);
  director.experiment.setDriveE(e);
  renderE();
  ui.eHint.textContent = director.experiment.released ? '다음 세대부터 적용' : '';
});

ui.lmoBtn.addEventListener('click', () => {
  const show = ui.lmoCard.hidden;
  ui.lmoCard.hidden = !show;
  // 진행 중인 세대 교체는 마무리하고 그 화면을 유지한다
  if (show && studyMode) {
    study.playing = false;
    renderStudyHeader();
    restartClock();
  } else if (show) director.finishCurrentAndStop();
});
$('.close', ui.lmoCard).addEventListener('click', () => (ui.lmoCard.hidden = true));
ui.lmoHintsBtn.addEventListener('click', () => {
  ui.lmoHints.hidden = !ui.lmoHints.hidden;
});

let lastTableRecord: GenerationRecord | undefined;
let tableReady = false;
function renderHistoryTable(): void {
  const ex = director.experiment;
  const m = ex.mendel.history;
  const d = ex.drive.history;
  const record = d.at(-1);
  if (tableReady && lastTableRecord === record) return;
  tableReady = true;
  lastTableRecord = record;
  const head = `<thead><tr><th rowspan="2">세대</th><th colspan="5">멘델 유전 (e = 0)</th><th colspan="6">호밍 드라이브</th></tr>
    <tr><th>W/W</th><th>D/W</th><th>D/D</th><th>D 보유</th><th>D 빈도</th><th>e</th><th>W/W</th><th>D/W</th><th>D/D</th><th>D 보유</th><th>D 빈도</th></tr></thead>`;
  const rows = m
    .map((r, i) => {
      const a = r.composition;
      const b = d[i].composition;
      return `<tr><td>${r.generation}</td><td>${a.WW}</td><td>${a.DW}</td><td>${a.DD}</td><td>${pct(a.carrierFraction)}</td><td>${pct(a.dAlleleFrequency)}</td>
      <td>${d[i].e.toFixed(1)}</td><td>${b.WW}</td><td>${b.DW}</td><td>${b.DD}</td><td>${pct(b.carrierFraction)}</td><td>${pct(b.dAlleleFrequency)}</td></tr>`;
    })
    .join('');
  ui.historyTable.innerHTML = head + `<tbody>${rows || '<tr><td colspan="12">가상 방사 후 기록됩니다.</td></tr>'}</tbody>`;
  $('#seed-info').textContent = `난수 시드 ${ex.config.seed}. 주소 끝에 ?seed=숫자 를 붙이면 다른 시드로 실행합니다. 같은 시드와 같은 조작이면 같은 결과가 나옵니다.`;
}

ui.modelBtn.addEventListener('click', () => {
  if (studyMode) {
    study.playing = false;
    renderStudyHeader();
    restartClock();
  } else director.pause();
  renderHistoryTable();
  ui.dialog.showModal();
});
$('.close', ui.dialog).addEventListener('click', () => ui.dialog.close());
$('#btn-figure').addEventListener('click', () => {
  ui.modelBtn.click();
  $('#original-figure').scrollIntoView({ block: 'start' });
});
ui.dialog.addEventListener('click', (ev) => {
  if (ev.target === ui.dialog) ui.dialog.close();
});

document.addEventListener('keydown', (ev) => {
  if (ui.dialog.open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const t = ev.target as HTMLElement;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (!studyMode && !director.experiment.released) director.startRelease();
    else playOrPause();
  } else if (ev.code === 'ArrowRight') {
    ev.preventDefault();
    step();
  }
});
document.addEventListener('keyup', (ev) => {
  if (ev.code === 'Space' && !(ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement)) ev.preventDefault();
});

// ---------- 범례 ----------
function renderLegend(): void {
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  ui.legend.replaceChildren();
  const names: Record<Genotype, string> = { WW: 'W/W', DW: 'D/W', DD: 'D/D' };
  for (const g of GENOTYPES) {
    const item = document.createElement('span');
    item.className = `legend-item ${g}`;
    item.appendChild(mosquitoIcon(g, 'F', fs * 2.2, fs * 1.9));
    const b = document.createElement('b');
    b.textContent = names[g];
    item.appendChild(b);
    ui.legend.appendChild(item);
  }
}
let legendFs = 0;
new ResizeObserver(() => {
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (Math.abs(fs - legendFs) > 0.5) {
    legendFs = fs;
    renderLegend();
    if (!studyMode) renderSummary();
  }
}).observe(document.documentElement);

// ---------- 애니메이션 루프 ----------
function frame(dt: number, time: number): void {
  if (studyMode) {
    if (study.tick(dt)) renderStudy();
    return;
  }
  director.tick(dt);
  for (const key of POP_KEYS) habs[key].habitat.frame(dt, time);
}

let frameId: number | null = null;
let last: number | null = null;
let motionTime = performance.now() / 1000;
function schedule(): void {
  if (frameId === null && !document.hidden && (!studyMode || study.playing))
    frameId = requestAnimationFrame(loop);
}
function restartClock(): void {
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = last = null;
  schedule();
}
function loop(now: number): void {
  frameId = null;
  const dt = last === null ? 0 : Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  if (!studyMode) motionTime += dt;
  frame(dt, motionTime);
  schedule();
}
document.addEventListener('visibilitychange', restartClock);

function watchDpr(): void {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
    for (const key of POP_KEYS) habs[key].habitat.resize();
    renderLegend();
    watchDpr();
  }, { once: true });
}
watchDpr();
document.querySelectorAll<HTMLImageElement>('[data-panel]').forEach(img => {
  img.src = img.dataset.panel === 'a' ? panelA : panelB;
});

ui.eSlider.value = String(director.experiment.eFor('drive'));
renderE();
renderLegend();
renderAll();
schedule();

// 개발 및 검증용
declare global {
  interface Window {
    __sim: { readonly study: StudyPlayback | null; director: Director; stages: typeof STAGES; advance: (seconds: number) => string };
  }
}
/** 검증용: 화면 프레임 속도와 무관하게 지정한 시간만큼 진행한다 */
function advanceFor(seconds: number): string {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    frame(dt, performance.now() / 1000 + t);
  }
  const a = director.activity;
  return JSON.stringify({ activity: a.kind, stage: a.kind === 'generation' ? a.stage : null, generation: director.experiment.generation, held: director.held });
}
window.__sim = { get study() { return studyMode ? study : null; }, director, stages: STAGES, advance: advanceFor };
