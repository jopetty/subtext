/* ===========================
   SUBTEXT — app.js
   Client-side image captioning
   =========================== */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  imageLoaded: false,
  imageNaturalW: 0,
  imageNaturalH: 0,
  imageObjectUrl: null,
  uploadBusy: false,
  objects: [],           // array of canvas object instances (TextObject, SpriteObject, ...)
  selectedObject: null,  // currently selected object or null
  lastStyle: null,       // style copied from last-edited object (for new object defaults)
  lastPreset: 'classic', // preset name of last-edited field (or null if manually edited)
  dragState: null,       // { field, startX, startY, origLeft, origTop }
  filter: { name: 'none', intensity: 75, params: {}, applyOnTop: false },
  copyActionAvailable: true,
  paint: {
    enabled: false,
    color: '#ff3b30',
    size: 8,
    hasStrokes: false,
  },
};

const PERF_MAX_SAMPLES = 200;
const perf = {
  devMode: false,
  panelEl: null,
  panelX: null,
  panelY: null,
  panelDragging: false,
  panelDragDx: 0,
  panelDragDy: 0,
  previewSamples: [],
  exportSamples: [],
  previewFrameTs: [],
  workerFallbacks: 0,
  workerErrors: 0,
  workerTimeouts: 0,
  stalePreviewDrops: 0,
  previewQueueDepthMax: 0,
  previewRenderQueueWaitMs: 0,
  previewInputTs: 0,
  previewPendingCount: 0,
  previewRenderInFlight: 0,
  previewSourceCacheHits: 0,
  previewSourceCacheMisses: 0,
  settleExecMode: 'worker',
  sampleCounter: 0,
};

function pushPerfSample(arr, sample) {
  arr.push(sample);
  if (arr.length > PERF_MAX_SAMPLES) arr.shift();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function calcPreviewFps() {
  const now = performance.now();
  const cutoff = now - 1000;
  while (perf.previewFrameTs.length && perf.previewFrameTs[0] < cutoff) {
    perf.previewFrameTs.shift();
  }
  return perf.previewFrameTs.length;
}

function perfSummary(samples, key) {
  const vals = samples.map(s => s[key]);
  return {
    p50: percentile(vals, 0.5),
    p95: percentile(vals, 0.95),
    max: vals.length ? Math.max(...vals) : 0,
  };
}

function renderPerfPanel() {
  if (!perf.devMode || !perf.panelEl) return;
  const pr = perfSummary(perf.previewSamples, 'totalMs');
  const pf = perfSummary(perf.previewSamples, 'filterMs');
  const ps = perfSummary(perf.previewSamples, 'sourceBuildMs');
  const pq = perfSummary(perf.previewSamples, 'queueWaitMs');
  const ex = perfSummary(perf.exportSamples, 'totalMs');
  const ef = perfSummary(perf.exportSamples, 'filterMs');
  const fps = calcPreviewFps();
  const sampleCount = perf.previewSamples.length;
  const cacheHitCount = perf.previewSamples.reduce((n, s) => n + (s.sourceCacheHit ? 1 : 0), 0);
  const cacheHitPct = sampleCount > 0 ? (cacheHitCount / sampleCount) * 100 : 0;
  perf.panelEl.textContent =
    `dev perf\n` +
    `preview fps: ${fps}\n` +
    `preview total ms p50/p95/max: ${pr.p50.toFixed(1)} / ${pr.p95.toFixed(1)} / ${pr.max.toFixed(1)}\n` +
    `preview source-build ms p50/p95/max: ${ps.p50.toFixed(1)} / ${ps.p95.toFixed(1)} / ${ps.max.toFixed(1)}\n` +
    `preview filter ms p50/p95/max: ${pf.p50.toFixed(1)} / ${pf.p95.toFixed(1)} / ${pf.max.toFixed(1)}\n` +
    `preview queue ms p50/p95/max: ${pq.p50.toFixed(1)} / ${pq.p95.toFixed(1)} / ${pq.max.toFixed(1)}\n` +
    `preview source cache hit-rate: ${cacheHitPct.toFixed(1)}% (${perf.previewSourceCacheHits}h/${perf.previewSourceCacheMisses}m)\n` +
    `settle exec mode: ${perf.settleExecMode}\n` +
    `preview in-flight/pending/max-pending: ${perf.previewRenderInFlight} / ${perf.previewPendingCount} / ${perf.previewQueueDepthMax}\n` +
    `preview stale drops: ${perf.stalePreviewDrops}\n` +
    `worker fallback/errors/timeouts: ${perf.workerFallbacks} / ${perf.workerErrors} / ${perf.workerTimeouts}\n` +
    `export total ms p50/p95/max: ${ex.p50.toFixed(1)} / ${ex.p95.toFixed(1)} / ${ex.max.toFixed(1)}\n` +
    `export filter ms p50/p95/max: ${ef.p50.toFixed(1)} / ${ef.p95.toFixed(1)} / ${ef.max.toFixed(1)}\n` +
    `samples preview/export: ${perf.previewSamples.length} / ${perf.exportSamples.length}`;
}

function ensurePerfPanel() {
  if (perf.panelEl) return perf.panelEl;
  const el = document.createElement('pre');
  el.id = 'dev-perf-panel';
  el.style.cssText = [
    'position:fixed',
    'top:56px',
    'left:8px',
    'z-index:120',
    'padding:8px 10px',
    'max-width:min(86vw, 520px)',
    'max-height:60vh',
    'overflow:auto',
    'white-space:pre',
    'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    'background:rgba(15,15,15,0.88)',
    'color:#e9f0ff',
    'border:1px solid rgba(145,170,210,0.45)',
    'border-radius:6px',
    'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
    'pointer-events:auto',
    'user-select:none',
    'touch-action:none',
    'cursor:move',
    'display:none',
  ].join(';');
  const clampPanel = () => {
    if (!perf.panelEl) return;
    const margin = 6;
    const maxX = Math.max(margin, window.innerWidth - perf.panelEl.offsetWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - perf.panelEl.offsetHeight - margin);
    if (perf.panelX === null || perf.panelY === null) return;
    perf.panelX = Math.max(margin, Math.min(maxX, perf.panelX));
    perf.panelY = Math.max(margin, Math.min(maxY, perf.panelY));
    perf.panelEl.style.left = `${perf.panelX}px`;
    perf.panelEl.style.top = `${perf.panelY}px`;
    perf.panelEl.style.right = 'auto';
  };
  el.addEventListener('pointerdown', (e) => {
    perf.panelDragging = true;
    const rect = el.getBoundingClientRect();
    perf.panelDragDx = e.clientX - rect.left;
    perf.panelDragDy = e.clientY - rect.top;
    perf.panelX = rect.left;
    perf.panelY = rect.top;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!perf.panelDragging) return;
    perf.panelX = e.clientX - perf.panelDragDx;
    perf.panelY = e.clientY - perf.panelDragDy;
    clampPanel();
  });
  const stopDrag = (e) => {
    if (!perf.panelDragging) return;
    perf.panelDragging = false;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {}
  };
  el.addEventListener('pointerup', stopDrag);
  el.addEventListener('pointercancel', stopDrag);
  window.addEventListener('resize', clampPanel);
  document.body.appendChild(el);
  perf.panelEl = el;
  return el;
}

function setDevMode(enabled) {
  perf.devMode = enabled;
  const panel = ensurePerfPanel();
  panel.style.display = enabled ? 'block' : 'none';
  renderPerfPanel();
}

function recordPreviewPerf(sample) {
  if (sample.sourceCacheHit) perf.previewSourceCacheHits++;
  else perf.previewSourceCacheMisses++;
  pushPerfSample(perf.previewSamples, sample);
  perf.previewFrameTs.push(performance.now());
  perf.sampleCounter++;
  if (perf.sampleCounter % 30 === 0) {
    console.log('[perf][preview]', sample);
  }
  renderPerfPanel();
}

function recordExportPerf(sample) {
  pushPerfSample(perf.exportSamples, sample);
  console.log('[perf][export]', sample);
  renderPerfPanel();
}

// Preset styles
const PRESETS = {
  classic: {
    font:         "var(--font-helvetica)",
    size:         5,   // percent of image width
    lineHeight:   1.2,
    rotateDeg:    0,
    weight:       '400',
    italic:       false,
    align:        'center',
    fgColor:      '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 2,
    blur:         0,
  },
  cinema: {
    font:         "var(--font-helvetica)",
    size:         5,   // percent of image width
    lineHeight:   1.2,
    rotateDeg:    0,
    weight:       '400',
    italic:       true,
    align:        'center',
    fgColor:      '#faf0a0',
    outlineColor: '#000000',
    outlineWidth: 0,
    blur:         0,
  },
  vaporwave: {
    font:         "var(--font-handjet)",
    size:         5,
    lineHeight:   1.2,
    rotateDeg:    0,
    weight:       '700',
    italic:       true,
    align:        'center',
    fgColor:      '#ffcce6',
    outlineColor: '#9656f0',
    outlineWidth: 7,
    blur:         0.15,
  },
  darkAcademia: {
    font:         "var(--font-garamontio)",
    size:         5,
    lineHeight:   1.2,
    rotateDeg:    0,
    weight:       '400',
    italic:       false,
    align:        'center',
    fgColor:      '#f0e2c0',
    outlineColor: '#1a1008',
    outlineWidth: 3,
    blur:         0,
  },
  deco: {
    font:         "var(--font-limelight)",
    size:         5,
    lineHeight:   1.2,
    rotateDeg:    0,
    weight:       '400',
    italic:       false,
    align:        'center',
    fgColor:      '#fff4dd',
    outlineColor: '#2b1a0c',
    outlineWidth: 2,
    blur:         0,
  },
  nouveau: {
    font:         "var(--font-amarante)",
    size:         5,
    lineHeight:   1.2,
    rotateDeg:    0,
    weight:       '400',
    italic:       false,
    align:        'left',
    fgColor:      '#e9784a',
    outlineColor: '#241710',
    outlineWidth: 5,
    blur:         0,
  },
};

// ─── Image vibes ───────────────────────────────────────────────────────────────

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

const TWILIGHT_POLY_MAX_DEG = 2;
const TWILIGHT_POLY_EXPS = (() => {
  const exps = [];
  for (let deg = 0; deg <= TWILIGHT_POLY_MAX_DEG; deg++) {
    for (let a = deg; a >= 0; a--) {
      for (let b = deg - a; b >= 0; b--) {
        const c = deg - a - b;
        exps.push([a, b, c]);
      }
    }
  }
  return exps;
})();

const TWILIGHT_POLY_COEFS = [
  [0.00597373, 0.03161590, 0.01277683],
  [0.29334462, 0.00999607, 0.00449393],
  [-0.01554910, 1.07771063, 0.21552968],
  [0.02220535, -0.08185787, 0.94232863],
  [0.73997974, -0.32378590, -0.41492039],
  [-1.44380820, -0.19136424, -0.00707934],
  [0.68360651, 0.79999304, 0.72149783],
  [0.77170402, 0.12911780, 0.38621324],
  [-0.50027823, -1.23625672, -0.93374157],
  [0.12329674, 0.62832433, -0.23901433],
];

const MEXICO_COEFS = [
  [-0.07086585, -0.00842946,  0.05177793],
  [ 2.62209105, -0.02575670, -0.16334338],
  [-0.03539947,  0.49390715, -0.02859681],
  [-0.06194337,  0.07698684, -0.37386778],
  [-1.17756331, -0.50214225,  0.36419725],
  [-1.18718219,  1.39672267, -0.53655916],
  [ 0.28874910, -0.36011073,  0.09994905],
  [ 0.95353884, -0.27611768,  0.52998900],
  [-0.38004848,  0.38436118, -0.40951315],
  [ 0.03741731, -0.13591971,  1.07161438],
];

// Each vibe has:
//   cssPreview(t)         → optional CSS approximation (debug/reference only)
//   apply(data, w, h, t)  → pixel-level function used during canvas export
const FILTERS = {
  film: {
    label: '35mm',
    cssPreview: (t) =>
      `contrast(${1 + 0.02*t}) saturate(${1 + 0.06*t}) sepia(${0.08*t}) brightness(${1 + 0.2*t})`,
    apply(data, w, h, t, params) {
      const cx = w / 2, cy = h / 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let r = data[i], g = data[i+1], b = data[i+2];
          // Warm tone
          r = clamp255(r + 9 * t);
          g = clamp255(g + 3 * t);
          b = clamp255(b - 8 * t);
          // Gentle saturation bump for a pastel, airy stock look
          const lm = 0.299*r + 0.587*g + 0.114*b;
          const s  = 1 + 0.05 * t;
          r = clamp255(lm + (r - lm) * s);
          g = clamp255(lm + (g - lm) * s);
          b = clamp255(lm + (b - lm) * s);
          // Lift midtones and shadows for a bright, airy base
          r = clamp255(r * (1 - 0.03*t) + 24*t);
          g = clamp255(g * (1 - 0.03*t) + 22*t);
          b = clamp255(b * (1 - 0.03*t) + 20*t);
          // Very gentle contrast keeps tones soft
          const c = 1 + 0.02 * t;
          r = clamp255((r - 128) * c + 128);
          g = clamp255((g - 128) * c + 128);
          b = clamp255((b - 128) * c + 128);
          // Keep vignette subtle so the frame stays bright
          const dx = (x - cx) / cx, dy = (y - cy) / cy;
          const vig = Math.max(0, 1 - 0.08 * t * (dx*dx + dy*dy));
          r = clamp255(r * vig); g = clamp255(g * vig); b = clamp255(b * vig);
          // Grain — independent param
          const grainT = (params.grain ?? 10) / 100;
          const noise = (Math.random() - 0.5) * 28 * grainT;
          data[i]   = clamp255(r + noise);
          data[i+1] = clamp255(g + noise * 0.92);
          data[i+2] = clamp255(b + noise * 0.80);
        }
      }
    },
  },

  hyperpop: {
    label: 'Hyperpop',
    cssPreview: (t) =>
      `saturate(${1 + 1.8*t}) hue-rotate(${18*t}deg) contrast(${1 + 0.42*t}) brightness(${1 + 0.06*t})`,
    apply(data, w, h, t, _params = {}, pixelScale = 1, scratch) {
      const rawT = Math.max(0, Math.min(1, t));
      if (rawT <= 0) return;
      // Non-linear response so lower slider values have real impact.
      const shapedT = Math.pow(rawT, 0.42);
      const drive = 0.24 + 1.48 * shapedT;
      const mixT = Math.min(1, 0.2 + 1.08 * shapedT);
      const localScratch = scratch || getFilterScratch('hyperpop', data.length);
      const orig = localScratch.orig;
      orig.set(data);
      let sliceCache = localScratch.sliceCache;
      if (!sliceCache) {
        sliceCache = localScratch.sliceCache = new Map();
      } else {
        sliceCache.clear();
      }
      const posterLevels = Math.max(4, Math.round(12 - 7 * drive));
      const qScale = posterLevels - 1;
      const satBoost = 1 + 1.45 * drive;
      const contrast = 1 + 0.36 * drive;
      const bloomW = 0.2 + 0.3 * drive;
      const edgeW = 0.18 + 0.48 * drive;
      const angleRad = ((Number(_params?.angle) || 0) * Math.PI) / 180;
      const lineDx = Math.cos(angleRad);
      const lineDy = -Math.sin(angleRad);
      const normalX = -lineDy;
      const normalY = lineDx;
      const sliceH = Math.max(2, Math.round((3 + 11 * drive) * Math.max(0.8, pixelScale)));
      const maxJitter = Math.max(1, Math.round((2 + 28 * drive) * Math.max(0.9, pixelScale)));
      const glitchT = Math.max(0, (drive - 0.15) / 0.85);
      const sliceThreshold = 0.3 - 0.22 * drive;
      const colorJitterScale = 18 * glitchT * Math.min(1.4, drive);
      const hash01 = (v) => {
        const s = Math.sin(v * 12.9898 + 78.233) * 43758.5453;
        return s - Math.floor(s);
      };
      for (let y = 0; y < h; y++) {
        const ym1 = y > 0 ? y - 1 : 0;
        const yp1 = y < h - 1 ? y + 1 : h - 1;
        for (let x = 0; x < w; x++) {
          const sliceCoord = x * normalX + y * normalY;
          const sliceIdx = Math.floor(sliceCoord / sliceH);
          let sliceParams = sliceCache.get(sliceIdx);
          if (!sliceParams) {
            const jitterSeed = hash01(sliceIdx + 31.7);
            const jitter = Math.round((jitterSeed * 2 - 1) * maxJitter * glitchT);
            const colorJitter = (hash01(sliceIdx + 7.3) * 2 - 1) * colorJitterScale;
            const sliceGate = hash01(sliceIdx + 97.1) > sliceThreshold ? 1 : 0;
            const accentPhase = hash01(sliceIdx + 13.9);
            sliceParams = { jitter, colorJitter, sliceGate, accentPhase };
            sliceCache.set(sliceIdx, sliceParams);
          }
          const xm1 = x > 0 ? x - 1 : 0;
          const xp1 = x < w - 1 ? x + 1 : w - 1;
          const sxRaw = x + lineDx * sliceParams.jitter * sliceParams.sliceGate;
          const syRaw = y + lineDy * sliceParams.jitter * sliceParams.sliceGate;
          const sx = sxRaw < 0 ? 0 : sxRaw >= w ? w - 1 : Math.round(sxRaw);
          const sy = syRaw < 0 ? 0 : syRaw >= h ? h - 1 : Math.round(syRaw);
          const i = (y * w + x) * 4;
          const si = (sy * w + sx) * 4;

          const cR = orig[si];
          const cG = orig[si + 1];
          const cB = orig[si + 2];
          let r = cR;
          let g = cG;
          let b = cB;
          const lm = 0.299 * cR + 0.587 * cG + 0.114 * cB;
          const bright = lm / 255;

          r = clamp255(lm + (r - lm) * satBoost);
          g = clamp255(lm + (g - lm) * satBoost);
          b = clamp255(lm + (b - lm) * satBoost);

          const qr = Math.round((r / 255) * qScale) * (255 / qScale);
          const qg = Math.round((g / 255) * qScale) * (255 / qScale);
          const qb = Math.round((b / 255) * qScale) * (255 / qScale);
          r = (qr - 128) * contrast + 128;
          g = (qg - 128) * contrast + 128;
          b = (qb - 128) * contrast + 128;

          const shadowW = Math.max(0, 1 - bright * 2.2);
          const hiW = Math.max(0, (bright - 0.42) / 0.58);
          const midW = Math.max(0, 1 - shadowW - hiW);
          // Rotating neon accents: magenta / lime / cyan by slice.
          const accentPhase = sliceParams.accentPhase;
          const isMagenta = accentPhase < 0.22;
          const isLime = accentPhase >= 0.22 && accentPhase < 0.55;
          const isCyan = accentPhase >= 0.55 && accentPhase < 0.82;
          const aR = isMagenta ? 30 : isLime ? 8 : isCyan ? 9 : 24;
          const aG = isMagenta ? 10 : isLime ? 34 : isCyan ? 20 : 28;
          const aB = isMagenta ? 26 : isLime ? 9 : isCyan ? 34 : 10;
          r = clamp255(r + (aR * hiW + 12 * midW - 8 * shadowW + sliceParams.colorJitter * 0.7));
          g = clamp255(g + (aG * hiW + 16 * midW + 20 * shadowW - sliceParams.colorJitter * 0.2));
          b = clamp255(b + (aB * hiW + 2 * midW + 24 * shadowW));

          const left = (y * w + xm1) * 4;
          const right = (y * w + xp1) * 4;
          const up = (ym1 * w + x) * 4;
          const down = (yp1 * w + x) * 4;
          const edge =
            Math.abs(4 * cR - orig[left] - orig[right] - orig[up] - orig[down]) * 0.28 +
            Math.abs(4 * cG - orig[left + 1] - orig[right + 1] - orig[up + 1] - orig[down + 1]) * 0.22 +
            Math.abs(4 * cB - orig[left + 2] - orig[right + 2] - orig[up + 2] - orig[down + 2]) * 0.32;
          const edgeTint = edge * edgeW;
          r = clamp255(r + edgeTint);
          g = clamp255(g + edgeTint * 0.25);
          b = clamp255(b + edgeTint * 0.8);

          const blr = (orig[left] + orig[right] + orig[up] + orig[down]) * 0.25;
          const blg = (orig[left + 1] + orig[right + 1] + orig[up + 1] + orig[down + 1]) * 0.25;
          const blb = (orig[left + 2] + orig[right + 2] + orig[up + 2] + orig[down + 2]) * 0.25;
          const gloss = hiW * hiW;
          r = clamp255(r + (blr - cR) * bloomW + gloss * 34 * bloomW);
          g = clamp255(g + (blg - cG) * bloomW + gloss * 18 * bloomW);
          b = clamp255(b + (blb - cB) * bloomW + gloss * 24 * bloomW);

          const noise = (Math.random() - 0.5) * (7 + 14 * drive);
          r = clamp255(r + noise);
          g = clamp255(g + noise * 0.55);
          b = clamp255(b + noise * 0.75);

          data[i] = clamp255(cR * (1 - mixT) + r * mixT);
          data[i + 1] = clamp255(cG * (1 - mixT) + g * mixT);
          data[i + 2] = clamp255(cB * (1 - mixT) + b * mixT);
        }
      }
    },
  },

  noir: {
    label: 'Noir',
    cssPreview: (t) =>
      `grayscale(${t}) contrast(${1 + 0.2*t}) brightness(${1 - 0.05*t})`,
    apply(data, w, h, t) {
      const cont = 1 + 0.2 * t;
      const bright = 1 - 0.05 * t;
      for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i+1], b = data[i+2];
        const lm = 0.299*r + 0.587*g + 0.114*b;
        r = clamp255(lm + (r - lm) * (1 - t));
        g = clamp255(lm + (g - lm) * (1 - t));
        b = clamp255(lm + (b - lm) * (1 - t));
        data[i]   = clamp255(((r - 128) * cont + 128) * bright);
        data[i+1] = clamp255(((g - 128) * cont + 128) * bright);
        data[i+2] = clamp255(((b - 128) * cont + 128) * bright);
      }
    },
  },

  redshift: {
    label: 'Redshift',
    cssPreview: (t) =>
      `grayscale(${t}) sepia(${t}) saturate(${1 + 2.2*t}) hue-rotate(${-38*t}deg)`,
    apply(data, w, h, t) {
      const blend = Math.max(0, Math.min(1, t));
      const invBlend = 1 - blend;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lm = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = clamp255(r * invBlend + lm * blend);
        data[i + 1] = clamp255(g * invBlend);
        data[i + 2] = clamp255(b * invBlend);
      }
    },
  },

  dithering: {
    label: 'Dithering',
    cssPreview: (t) =>
      `contrast(${1 + 0.22*t}) saturate(${1 - 0.35*t})`,
    apply(data, w, h, t, params = {}, pixelScale = 1) {
      const intensity = Math.max(0, Math.min(1, t));
      const monoT = Math.max(0, Math.min(1, (params.mono ?? 0) / 100));
      const curveT = Math.pow(intensity, 0.85);
      // Intensity changes tone->radius contrast, not global size.
      const gamma = 1.14 - 0.46 * curveT;
      const toneFloor = 0.08 - 0.03 * curveT;
      const minRadius = 0.085 - 0.01 * curveT;
      const maxRadius = 0.285 + 0.215 * curveT;
      const jitterAmp = 0.35 + 0.65 * curveT;
      const patternScale = Math.max(1, Math.round(pixelScale || 1));
      // Keep the "max" halftone cell feel from current behavior; intensity now
      // controls dot-size spread inside this cell instead of blending with source.
      const cell = Math.max(2, Math.round(6 * patternScale));
      const edge = 0.6 / Math.max(1, cell);
      const paperR = 245;
      const paperG = 242;
      const paperB = 230;
      const tau = Math.PI / 180;
      const aC = 15 * tau;
      const aM = 75 * tau;
      const aY = 0 * tau;
      const aK = 45 * tau;
      const cCos = Math.cos(aC), cSin = Math.sin(aC);
      const mCos = Math.cos(aM), mSin = Math.sin(aM);
      const yCos = Math.cos(aY), ySin = Math.sin(aY);
      const kCos = Math.cos(aK), kSin = Math.sin(aK);
      const modCell = (v) => {
        const m = v % cell;
        return m < 0 ? m + cell : m;
      };
      const smooth = (v0, v1, x) => {
        if (v1 <= v0) return x >= v1 ? 1 : 0;
        const u = Math.max(0, Math.min(1, (x - v0) / (v1 - v0)));
        return u * u * (3 - 2 * u);
      };
      const dotMask = (x, y, amount, cosA, sinA, jitter) => {
        const xr = x * cosA - y * sinA;
        const yr = x * sinA + y * cosA;
        const fx = (modCell(xr + 0.5 * cell) / cell) - 0.5;
        const fy = (modCell(yr + 0.5 * cell) / cell) - 0.5;
        const dist = Math.sqrt(fx * fx + fy * fy);
        const tone = Math.max(0, Math.min(1, amount));
        const toneMapped = Math.pow(toneFloor + (1 - toneFloor) * tone, gamma);
        const radius = Math.max(0, minRadius + (maxRadius - minRadius) * toneMapped + jitter * jitterAmp);
        const edgeLo = radius - edge;
        const edgeHi = radius + edge;
        return 1 - smooth(edgeLo, edgeHi, dist);
      };
      const bayer4 = [
        [0,  8,  2, 10],
        [12, 4, 14, 6],
        [3, 11, 1,  9],
        [15, 7, 13, 5],
      ];

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const sr = data[i];
          const sg = data[i + 1];
          const sb = data[i + 2];
          const lm = (0.299 * sr + 0.587 * sg + 0.114 * sb) / 255;
          const darkness = 1 - lm;
          const threshold = (bayer4[(Math.floor(y / patternScale)) & 3][(Math.floor(x / patternScale)) & 3] / 15) - 0.5;
          const jitter = threshold * 0.045;

          // Simple CMYK-ish separation: color always comes from halftone layers.
          const c0 = 1 - sr / 255;
          const m0 = 1 - sg / 255;
          const y0 = 1 - sb / 255;
          const k0 = Math.min(c0, m0, y0) * (0.58 + 0.35 * darkness);
          const cAmt = Math.max(0, c0 - k0 * 0.78);
          const mAmt = Math.max(0, m0 - k0 * 0.78);
          const yAmt = Math.max(0, y0 - k0 * 0.78);

          const covC = dotMask(x, y, cAmt, cCos, cSin, jitter);
          const covM = dotMask(x, y, mAmt, mCos, mSin, -jitter * 0.85);
          const covY = dotMask(x, y, yAmt, yCos, ySin, jitter * 0.65);
          const covK = dotMask(x, y, k0, kCos, kSin, -jitter * 0.4);

          // Subtractive paper/ink approximation.
          const hr = paperR
            * (1 - 0.88 * covC)
            * (1 - 0.12 * covM)
            * (1 - 0.06 * covY)
            * (1 - 0.72 * covK);
          const hg = paperG
            * (1 - 0.08 * covC)
            * (1 - 0.86 * covM)
            * (1 - 0.08 * covY)
            * (1 - 0.72 * covK);
          const hb = paperB
            * (1 - 0.06 * covC)
            * (1 - 0.12 * covM)
            * (1 - 0.88 * covY)
            * (1 - 0.72 * covK);

          const hLm = 0.299 * hr + 0.587 * hg + 0.114 * hb;
          data[i] = clamp255(hr * (1 - monoT) + hLm * monoT);
          data[i + 1] = clamp255(hg * (1 - monoT) + hLm * monoT);
          data[i + 2] = clamp255(hb * (1 - monoT) + hLm * monoT);
        }
      }
    },
  },

  pixelArt: {
    label: 'Pixel art',
    cssPreview: (t) =>
      `contrast(${1 + 0.2*t}) saturate(${1 + 0.08*t})`,
    apply(data, w, h, t, params = {}, pixelScale = 1, scratch) {
      const style = Math.max(0, Math.min(1, t));
      const bits = Math.max(2, Math.min(8, Math.round(params.bits ?? 5)));
      const detail = bits / 8;
      const blockSize = Math.max(
        1,
        Math.round((1 + (1 - detail) * 20) * Math.max(1, pixelScale) * 0.6)
      );
      const localScratch = scratch || getFilterScratch('pixelArt', data.length);
      const orig = localScratch.orig;
      orig.set(data);
      const bw = Math.max(1, Math.ceil(w / blockSize));
      const bh = Math.max(1, Math.ceil(h / blockSize));
      const blockCount = bw * bh;

      if (!localScratch.blockSumR || localScratch.blockSumR.length < blockCount) {
        localScratch.blockSumR = new Float32Array(blockCount);
        localScratch.blockSumG = new Float32Array(blockCount);
        localScratch.blockSumB = new Float32Array(blockCount);
        localScratch.blockN = new Uint16Array(blockCount);
        localScratch.blockLm = new Float32Array(blockCount);
        localScratch.blockOutR = new Float32Array(blockCount);
        localScratch.blockOutG = new Float32Array(blockCount);
        localScratch.blockOutB = new Float32Array(blockCount);
      }

      const sumR = localScratch.blockSumR;
      const sumG = localScratch.blockSumG;
      const sumB = localScratch.blockSumB;
      const n = localScratch.blockN;
      const lm = localScratch.blockLm;
      const outR = localScratch.blockOutR;
      const outG = localScratch.blockOutG;
      const outB = localScratch.blockOutB;
      sumR.fill(0, 0, blockCount);
      sumG.fill(0, 0, blockCount);
      sumB.fill(0, 0, blockCount);
      n.fill(0, 0, blockCount);

      for (let y = 0; y < h; y++) {
        const by = Math.min(bh - 1, Math.floor(y / blockSize));
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
          const bx = Math.min(bw - 1, Math.floor(x / blockSize));
          const bi = by * bw + bx;
          const i = row + x * 4;
          sumR[bi] += orig[i];
          sumG[bi] += orig[i + 1];
          sumB[bi] += orig[i + 2];
          n[bi]++;
        }
      }

      const stylePow = Math.pow(style, 0.9);
      const levelsHi = Math.max(8, Math.round(12 + bits * 3));
      const levelsLo = Math.max(4, Math.round(4 + bits * 0.75));
      const levels = Math.max(3, Math.round(levelsHi + (levelsLo - levelsHi) * stylePow));
      const qScale = levels - 1;
      const styleHigh = Math.max(0, Math.min(1, (style - 0.78) / 0.22));
      const satBoost = 1 + 0.95 * style;
      const contrast = 1 + 0.52 * style;
      const celLevels = Math.max(3, Math.round(8 + (3 - 8) * Math.pow(style, 0.8)));
      const celMix = 0.06 + 0.38 * style;

      for (let bi = 0; bi < blockCount; bi++) {
        const count = Math.max(1, n[bi]);
        let qr = Math.round(((sumR[bi] / count) / 255) * qScale) * (255 / qScale);
        let qg = Math.round(((sumG[bi] / count) / 255) * qScale) * (255 / qScale);
        let qb = Math.round(((sumB[bi] / count) / 255) * qScale) * (255 / qScale);

        const qLm = (0.299 * qr + 0.587 * qg + 0.114 * qb) / 255;
        lm[bi] = qLm;
        const celLm = Math.round(qLm * celLevels) / celLevels;
        qr = qr * (1 - celMix) + celLm * 255 * celMix;
        qg = qg * (1 - celMix) + celLm * 255 * celMix;
        qb = qb * (1 - celMix) + celLm * 255 * celMix;

        qr = qLm * 255 + (qr - qLm * 255) * satBoost;
        qg = qLm * 255 + (qg - qLm * 255) * satBoost;
        qb = qLm * 255 + (qb - qLm * 255) * satBoost;

        qr = (qr - 128) * contrast + 128;
        qg = (qg - 128) * contrast + 128;
        qb = (qb - 128) * contrast + 128;

        const shadowW = Math.max(0, (0.55 - qLm) / 0.55);
        const hiW = Math.max(0, (qLm - 0.58) / 0.42);
        const midW = Math.max(0, 1 - shadowW - hiW);
        const tintAmt = style * (1 - 0.32 * styleHigh);
        qr += (20 * hiW + 8 * midW - 7 * shadowW) * tintAmt;
        qg += (7 * hiW + 4 * midW - 6 * shadowW) * tintAmt;
        qb += (-3 * hiW + 6 * midW + 23 * shadowW) * tintAmt;
        const highContrast = 1 + 0.18 * styleHigh;
        qr = (qr - 128) * highContrast + 128 - 8 * styleHigh;
        qg = (qg - 128) * highContrast + 128 - 8 * styleHigh;
        qb = (qb - 128) * highContrast + 128 - 8 * styleHigh;

        const gamePop = Math.pow(styleHigh, 0.85);
        const lmNow = (0.299 * qr + 0.587 * qg + 0.114 * qb);
        const vib = 1 + 0.42 * gamePop;
        qr = lmNow + (qr - lmNow) * vib;
        qg = lmNow + (qg - lmNow) * vib;
        qb = lmNow + (qb - lmNow) * vib;
        qr += (13 + 20 * hiW - 8 * shadowW) * gamePop;
        qg += (5 + 10 * midW - 6 * shadowW) * gamePop;
        qb += (9 + 14 * hiW + 12 * shadowW) * gamePop;

        outR[bi] = qr;
        outG[bi] = qg;
        outB[bi] = qb;
      }

      const bayer4 = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5],
      ];
      const dAmp = (0.01 + 0.045 * style) * (style * (1 - 0.2 * style)) * 255;

      for (let by = 0; by < bh; by++) {
        const y0 = by * blockSize;
        const yEnd = Math.min(h, y0 + blockSize);
        for (let bx = 0; bx < bw; bx++) {
          const x0 = bx * blockSize;
          const xEnd = Math.min(w, x0 + blockSize);
          const bi = by * bw + bx;
          const cLm = lm[bi];
          const lL = lm[by * bw + Math.max(0, bx - 1)];
          const lR = lm[by * bw + Math.min(bw - 1, bx + 1)];
          const lU = lm[Math.max(0, by - 1) * bw + bx];
          const lD = lm[Math.min(bh - 1, by + 1) * bw + bx];
          const grad = Math.max(Math.abs(lR - cLm), Math.abs(lL - cLm), Math.abs(lU - cLm), Math.abs(lD - cLm));
          const ink = Math.max(0, Math.min(1, (grad - 0.06) / 0.22)) * Math.pow(style, 1.15);
          const inkMul = 1 - 0.46 * ink;
          const baseR = outR[bi] * inkMul;
          const baseG = outG[bi] * inkMul;
          const baseB = outB[bi] * inkMul;

          for (let y = y0; y < yEnd; y++) {
            const row = y * w * 4;
            const py = y & 3;
            for (let x = x0; x < xEnd; x++) {
              const px = x & 3;
              const i = row + x * 4;
              const dith = (bayer4[py][px] / 15) - 0.5;
              data[i] = clamp255(baseR + dith * dAmp);
              data[i + 1] = clamp255(baseG + dith * dAmp * 0.72);
              data[i + 2] = clamp255(baseB - dith * dAmp * 0.65);
            }
          }
        }
      }
    },
  },

  swirl: {
    label: 'Swirl',
    cssPreview: (t) =>
      `contrast(${1 + 0.05*t})`,
    apply(data, w, h, t, _params = {}, _pixelScale = 1, scratch) {
      const intensity = Math.max(0, Math.min(1, t));
      if (intensity <= 0) return;
      const localScratch = scratch || getFilterScratch('swirl', data.length);
      const orig = localScratch.orig;
      orig.set(data);

      const cx = (w - 1) * 0.5;
      const cy = (h - 1) * 0.5;
      const invCx = cx > 0 ? 1 / cx : 0;
      const invCy = cy > 0 ? 1 / cy : 0;
      const intensityShaped = Math.pow(intensity, 1.08);
      const maxAngle = 9.0 * intensityShaped; // radians

      for (let y = 0; y < h; y++) {
        const dy = y - cy;
        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const nx = dx * invCx;
          const ny = dy * invCy;
          const r = Math.hypot(nx, ny);
          const i = (y * w + x) * 4;
          if (r >= 1) {
            data[i] = orig[i];
            data[i + 1] = orig[i + 1];
            data[i + 2] = orig[i + 2];
            continue;
          }

          const falloff = Math.pow(1 - r, 2.2);
          const angle = maxAngle * falloff;
          const s = Math.sin(-angle);
          const c = Math.cos(-angle);
          const sx = cx + dx * c - dy * s;
          const sy = cy + dx * s + dy * c;
          const sxClamped = sx < 0 ? 0 : sx > (w - 1) ? (w - 1) : sx;
          const syClamped = sy < 0 ? 0 : sy > (h - 1) ? (h - 1) : sy;
          const x0 = sxClamped | 0;
          const y0 = syClamped | 0;
          const x1 = x0 < (w - 1) ? x0 + 1 : x0;
          const y1 = y0 < (h - 1) ? y0 + 1 : y0;
          const fx = sxClamped - x0;
          const fy = syClamped - y0;
          const i00 = (y0 * w + x0) * 4;
          const i10 = (y0 * w + x1) * 4;
          const i01 = (y1 * w + x0) * 4;
          const i11 = (y1 * w + x1) * 4;
          const w00 = (1 - fx) * (1 - fy);
          const w10 = fx * (1 - fy);
          const w01 = (1 - fx) * fy;
          const w11 = fx * fy;
          data[i] = clamp255(orig[i00] * w00 + orig[i10] * w10 + orig[i01] * w01 + orig[i11] * w11);
          data[i + 1] = clamp255(orig[i00 + 1] * w00 + orig[i10 + 1] * w10 + orig[i01 + 1] * w01 + orig[i11 + 1] * w11);
          data[i + 2] = clamp255(orig[i00 + 2] * w00 + orig[i10 + 2] * w10 + orig[i01 + 2] * w01 + orig[i11 + 2] * w11);
        }
      }
    },
  },

  twilight: {
    label: 'Twilight',
    cssPreview: (t) =>
      `saturate(${1 - 0.03*t}) hue-rotate(${-10*t}deg) brightness(${1 - 0.08*t}) contrast(1)`,
    apply(data, w, h, t) {
      const blend = Math.max(0, Math.min(1, t));
      const invBlend = 1 - blend;
      const C = TWILIGHT_POLY_COEFS;
      for (let i = 0; i < data.length; i += 4) {
        const sr = data[i] / 255;
        const sg = data[i + 1] / 255;
        const sb = data[i + 2] / 255;
        const rr = sr * sr;
        const gg = sg * sg;
        const bb = sb * sb;
        const rg = sr * sg;
        const rb = sr * sb;
        const gb = sg * sb;
        let tr = C[0][0];
        let tg = C[0][1];
        let tb = C[0][2];
        tr += sr * C[1][0] + sg * C[2][0] + sb * C[3][0] + rr * C[4][0] + rg * C[5][0] + rb * C[6][0] + gg * C[7][0] + gb * C[8][0] + bb * C[9][0];
        tg += sr * C[1][1] + sg * C[2][1] + sb * C[3][1] + rr * C[4][1] + rg * C[5][1] + rb * C[6][1] + gg * C[7][1] + gb * C[8][1] + bb * C[9][1];
        tb += sr * C[1][2] + sg * C[2][2] + sb * C[3][2] + rr * C[4][2] + rg * C[5][2] + rb * C[6][2] + gg * C[7][2] + gb * C[8][2] + bb * C[9][2];

        tr = tr < 0 ? 0 : tr > 1 ? 1 : tr;
        tg = tg < 0 ? 0 : tg > 1 ? 1 : tg;
        tb = tb < 0 ? 0 : tb > 1 ? 1 : tb;
        data[i] = clamp255((sr * invBlend + tr * blend) * 255);
        data[i + 1] = clamp255((sg * invBlend + tg * blend) * 255);
        data[i + 2] = clamp255((sb * invBlend + tb * blend) * 255);
      }
    },
  },

  mexico: {
    label: 'Mexico',
    cssPreview: (t) =>
      `sepia(${0.8*t}) saturate(${1 + 0.2*t}) hue-rotate(${-20*t}deg) brightness(${1 - 0.1*t}) contrast(1)`,
    apply(data, w, h, t) {
      const C = MEXICO_COEFS;
      const blend = Math.max(0, Math.min(1, t));
      const invBlend = 1 - blend;

      for (let i = 0; i < data.length; i += 4) {
        const sr = data[i] / 255;
        const sg = data[i + 1] / 255;
        const sb = data[i + 2] / 255;
        const rr = sr * sr;
        const gg = sg * sg;
        const bb = sb * sb;
        const rg = sr * sg;
        const rb = sr * sb;
        const gb = sg * sb;

        let tr = C[0][0];
        let tg = C[0][1];
        let tb = C[0][2];
        tr += sr * C[1][0] + sg * C[2][0] + sb * C[3][0] + rr * C[4][0] + rg * C[5][0] + rb * C[6][0] + gg * C[7][0] + gb * C[8][0] + bb * C[9][0];
        tg += sr * C[1][1] + sg * C[2][1] + sb * C[3][1] + rr * C[4][1] + rg * C[5][1] + rb * C[6][1] + gg * C[7][1] + gb * C[8][1] + bb * C[9][1];
        tb += sr * C[1][2] + sg * C[2][2] + sb * C[3][2] + rr * C[4][2] + rg * C[5][2] + rb * C[6][2] + gg * C[7][2] + gb * C[8][2] + bb * C[9][2];
        tr = tr < 0 ? 0 : tr > 1 ? 1 : tr;
        tg = tg < 0 ? 0 : tg > 1 ? 1 : tg;
        tb = tb < 0 ? 0 : tb > 1 ? 1 : tb;

        const outR = (sr * invBlend + tr * blend) * 255;
        const outG = (sg * invBlend + tg * blend) * 255;
        const outB = (sb * invBlend + tb * blend) * 255;
        data[i] = clamp255(outR);
        data[i + 1] = clamp255(outG);
        data[i + 2] = clamp255(outB);
      }
    },
  },

  vaporwave: {
    label: 'Vaporwave',
    // Full pixel-level path used in export and in-editor preview overlay.
    cssPreview: (t) =>
      `saturate(${1 + 1.1*t}) hue-rotate(${-28*t}deg) contrast(${1 + 0.3*t}) brightness(${1 - 0.1*t})`,
    apply(data, w, h, t, params, pixelScale = 1, scratch) {
      const localScratch = scratch || getFilterScratch('vaporwave', data.length);
      const orig = localScratch.orig;
      orig.set(data);
      const chromaShift = Math.round(30 * (params.chroma ?? 50) / 100 * pixelScale);
      const sat = 1 + 1.1 * t;
      const contrast = 1 + 0.3 * t;
      const scanlinesT = (params.scanlines ?? 60) / 100;
      const scanlineSize = Math.max(1, Math.round((params.scanlineSize ?? 2) * pixelScale));

      for (let y = 0; y < h; y++) {
        const scan = (y % scanlineSize === 0) ? 1 : Math.max(0, 1 - 0.35 * scanlinesT);
        for (let x = 0; x < w; x++) {
          const i  = (y * w + x) * 4;

          // Chromatic aberration: read R from x+shift, B from x-shift, G in-place
          const rx  = Math.min(w - 1, x + chromaShift);
          const bx  = Math.max(0,     x - chromaShift);
          let r = orig[(y * w + rx) * 4];
          let g = orig[i + 1];
          let b = orig[(y * w + bx) * 4 + 2];

          // Use centre-pixel luma for consistent color grading
          const r0 = orig[i], g0 = orig[i+1], b0 = orig[i+2];
          const lm = 0.299*r0 + 0.587*g0 + 0.114*b0;

          // Heavy saturation boost
          r = clamp255(lm + (r - lm) * sat);
          g = clamp255(lm + (g - lm) * sat);
          b = clamp255(lm + (b - lm) * sat);

          // Color grade: purple/magenta midtones, deep blue shadows, hot-pink highlights
          const bright = lm / 255;
          r = clamp255(r + (10 + bright * 30) * t);   // more red in highlights → hot pink
          g = clamp255(g - (28 - bright * 8)  * t);   // suppress green throughout
          b = clamp255(b + (42 - bright * 22) * t);   // strong blue in shadows, less in highlights

          // Hard contrast + slight brightness pull-down
          r = clamp255((r - 128) * contrast + 128);
          g = clamp255((g - 128) * contrast + 128);
          b = clamp255((b - 128) * contrast + 128);

          // Scanlines — independent param
          data[i]   = clamp255(r * scan);
          data[i+1] = clamp255(g * scan);
          data[i+2] = clamp255(b * scan);
        }
      }
    },
  },

  darkAcademia: {
    label: 'Dark Academia',
    cssPreview: (t) =>
      `sepia(${0.45*t}) saturate(${1 - 0.3*t}) brightness(${1 - 0.18*t}) contrast(${1 + 0.22*t})`,
    apply(data, w, h, t, params) {
      const grainT    = (params.grain    ?? 45) / 100;
      const vignetteT = (params.vignette ?? 65) / 100;
      const cx = w / 2, cy = h / 2;

      for (let y = 0; y < h; y++) {
        // Vignette weight for this row
        const dy = (y - cy) / cy;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let r = data[i], g = data[i+1], b = data[i+2];

          // Desaturate
          const lm = 0.299*r + 0.587*g + 0.114*b;
          const s = 1 - 0.3 * t;
          r = clamp255(lm + (r - lm) * s);
          g = clamp255(lm + (g - lm) * s);
          b = clamp255(lm + (b - lm) * s);

          // Warm sepia toning: lift reds, pull blues
          r = clamp255(r + 20 * t);
          g = clamp255(g + 6  * t);
          b = clamp255(b - 28 * t);

          // Contrast + darken (crush shadows for chiaroscuro)
          const c = 1 + 0.22 * t;
          const br = 1 - 0.18 * t;
          r = clamp255(((r - 128) * c + 128) * br);
          g = clamp255(((g - 128) * c + 128) * br);
          b = clamp255(((b - 128) * c + 128) * br);

          // Vignette (radial darkening toward edges)
          const dx = (x - cx) / cx;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const vFactor = 1 - vignetteT * t * Math.pow(Math.min(dist, 1.4), 1.6) * 0.75;
          r = clamp255(r * vFactor);
          g = clamp255(g * vFactor);
          b = clamp255(b * vFactor);

          // Grain
          if (grainT > 0) {
            const noise = (Math.random() - 0.5) * 38 * grainT * t;
            r = clamp255(r + noise);
            g = clamp255(g + noise);
            b = clamp255(b + noise);
          }

          data[i] = r; data[i+1] = g; data[i+2] = b;
        }
      }
    },
  },

  solarpunk: {
    label: 'Solarpunk',
    cssPreview: (t, params = {}) => {
      const bloomT = (params.bloom ?? 35) / 100;
      const hazeT  = (params.haze  ?? 25) / 100;
      return `saturate(${1 + 0.7*t - 0.08*hazeT*t}) hue-rotate(${10*t}deg) brightness(${1 + 0.16*t + 0.16*hazeT*t + 0.1*bloomT*t}) contrast(${1 - (0.05*t + 0.2*hazeT*t)})`;
    },
    apply(data, w, h, t, params = {}) {
      const bloomT = (params.bloom ?? 35) / 100;
      const hazeT  = (params.haze  ?? 25) / 100;
      for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i+1], b = data[i+2];
        const lm = 0.299*r + 0.587*g + 0.114*b;
        const bright = lm / 255;

        // Saturation boost — greens and golds really pop
        const s = 1 + 0.7 * t;
        r = clamp255(lm + (r - lm) * s);
        g = clamp255(lm + (g - lm) * s);
        b = clamp255(lm + (b - lm) * s);

        // Split-tone: teal shadows → green midtones → amber-gold highlights
        const shadowW    = Math.max(0, 1 - bright * 2.5);
        const highlightW = Math.max(0, bright * 2.5 - 1.5);
        const midW       = Math.max(0, 1 - shadowW - highlightW);

        r = clamp255(r + t * (shadowW * -10 + midW *  3 + highlightW * 24));
        g = clamp255(g + t * (shadowW *   6 + midW * 13 + highlightW * 14));
        b = clamp255(b + t * (shadowW *  15 + midW * -6 + highlightW * -22));

        // Bloom: push highlights toward sunlit warmth.
        const glow = Math.max(0, (bright - 0.55) / 0.45);
        const bloom = glow * glow * bloomT * t;
        r = clamp255(r + 34 * bloom);
        g = clamp255(g + 26 * bloom);
        b = clamp255(b + 11 * bloom);

        // Haze: softened contrast with atmospheric lift.
        const hazeMix = 0.34 * hazeT * t;
        const hazeSat = 1 - 0.18 * hazeT * t;
        const hlm = 0.299*r + 0.587*g + 0.114*b;
        r = clamp255((hlm + (r - hlm) * hazeSat) * (1 - hazeMix) + 228 * hazeMix);
        g = clamp255((hlm + (g - hlm) * hazeSat) * (1 - hazeMix) + 232 * hazeMix);
        b = clamp255((hlm + (b - hlm) * hazeSat) * (1 - hazeMix) + 236 * hazeMix);

        // Luminous brightness lift — greens get extra push for lushness
        data[i]   = clamp255(r * (1 + 0.13 * t));
        data[i+1] = clamp255(g * (1 + 0.18 * t));
        data[i+2] = clamp255(b * (1 + 0.04 * t));
      }
    },
  },

  hegseth: {
    label: 'Hegseth',
    cssPreview: (t) =>
      `brightness(${1 - 0.01*t}) contrast(${1 - 0.04*t})`,
    apply(data, w, h, t, params = {}, pixelScale = 1, scratch) {
      const localScratch = scratch || getFilterScratch('hegseth', data.length);
      const orig = localScratch.orig;
      orig.set(data);
      if (!localScratch.xm1 || localScratch.xm1.length !== w) {
        localScratch.xm1 = new Int32Array(w);
        localScratch.xp1 = new Int32Array(w);
        localScratch.xByte = new Int32Array(w);
        localScratch.g1x = new Int32Array(w);
        localScratch.g2x = new Int32Array(w);
        for (let x = 0; x < w; x++) {
          localScratch.xm1[x] = x > 0 ? x - 1 : 0;
          localScratch.xp1[x] = x < w - 1 ? x + 1 : w - 1;
          localScratch.xByte[x] = x * 4;
        }
      }
      if (!localScratch.sinRow ||
          localScratch.sinRow.length !== h ||
          localScratch.lastWobbleScale !== pixelScale) {
        localScratch.sinRow = new Float32Array(h);
        const wobbleScaleForCache = Math.max(0.0001, pixelScale);
        for (let y = 0; y < h; y++) {
          localScratch.sinRow[y] = Math.sin((y / wobbleScaleForCache) * 0.08);
        }
        localScratch.lastWobbleScale = pixelScale;
      }
      const angleDeg = params.angle ?? 0;
      const ghostDistanceT = (params.ghostDistance ?? 50) / 100;
      const angleRad = angleDeg * Math.PI / 180;
      const dirX = Math.cos(angleRad);
      const dirY = Math.sin(angleRad);
      const distanceMul = 0.35 + 1.25 * ghostDistanceT;
      const shift1 = Math.max(1, Math.round((2 + 14 * t) * distanceMul * pixelScale));
      const shift2 = Math.max(2, Math.round((5 + 24 * t) * distanceMul * pixelScale));
      const mainW = 0.58;
      const g1W = 0.24 + 0.16 * t;
      const g2W = 0.12 + 0.1 * t;
      const invWSum = 1 / (mainW + g1W + g2W);
      const dy1 = Math.round(dirY * shift1);
      const dy2 = Math.round(dirY * shift2);
      const wobbleAmp = 2.3 * t * pixelScale;
      const xm1 = localScratch.xm1;
      const xp1 = localScratch.xp1;
      const xByte = localScratch.xByte;
      const g1x = localScratch.g1x;
      const g2x = localScratch.g2x;
      const sinRow = localScratch.sinRow;

      for (let y = 0; y < h; y++) {
        const wobble = Math.round(sinRow[y] * wobbleAmp);
        const yBase = y * w * 4;
        const g1y = y + dy1 < 0 ? 0 : y + dy1 >= h ? h - 1 : y + dy1;
        const g2y = y - dy2 < 0 ? 0 : y - dy2 >= h ? h - 1 : y - dy2;
        const g1BaseY = g1y * w * 4;
        const g2BaseY = g2y * w * 4;
        const dx1 = Math.round(dirX * shift1) + wobble;
        const dx2 = Math.round(dirX * shift2) + Math.round(wobble * 0.5);
        for (let x = 0; x < w; x++) {
          const gx1 = x + dx1;
          g1x[x] = gx1 < 0 ? 0 : gx1 >= w ? w - 1 : gx1;
          const gx2 = x - dx2;
          g2x[x] = gx2 < 0 ? 0 : gx2 >= w ? w - 1 : gx2;
        }

        for (let x = 0; x < w; x++) {
          const xB = xByte[x];
          const i = yBase + xB;
          const baseM1 = yBase + xByte[xm1[x]];
          const baseP1 = yBase + xByte[xp1[x]];
          const g1Base = g1BaseY + xByte[g1x[x]];
          const g1BaseN = g1BaseY + xByte[g1x[x] < w - 1 ? g1x[x] + 1 : w - 1];
          const g2Base = g2BaseY + xByte[g2x[x]];
          const g2BaseN = g2BaseY + xByte[g2x[x] > 0 ? g2x[x] - 1 : 0];

          for (let c = 0; c < 3; c++) {
            // In-place smear + two directional ghost copies.
            const base = (orig[baseM1 + c] + orig[i + c] + orig[baseP1 + c]) / 3;
            const g1 = (orig[g1Base + c] + orig[g1BaseN + c]) / 2;
            const g2 = (orig[g2Base + c] + orig[g2BaseN + c]) / 2;
            data[i + c] = clamp255((base * mainW + g1 * g1W + g2 * g2W) * invWSum);
          }
        }
      }
    },
  },
};

// Default values for vibe-specific extra params
const FILTER_PARAM_DEFAULTS = {
  film:        { grain: 10 },
  redshift:    {},
  dithering:   { mono: 0 },
  pixelArt:    { bits: 5 },
  swirl:       {},
  vaporwave:   { scanlines: 60, scanlineSize: 2, chroma: 20 },
  hyperpop:    { angle: 0 },
  twilight:    {},
  mexico:      {},
  darkAcademia: { grain: 45, vignette: 65 },
  solarpunk:   { bloom: 35, haze: 25 },
  hegseth:     { angle: 0, ghostDistance: 50 },
};

const _filterScratch = Object.create(null);

function getFilterScratch(name, size) {
  const scratch = _filterScratch[name] || (_filterScratch[name] = Object.create(null));
  if (size && (!scratch.orig || scratch.orig.length !== size)) {
    scratch.orig = new Uint8ClampedArray(size);
  }
  return scratch;
}

function normalizeFilterApplySource(fn) {
  return fn.toString().replace(/^\s*apply\s*\(/, 'function(');
}

function buildFilterWorkerScript() {
  const filterEntries = Object.entries(FILTERS)
    .map(([name, def]) => `${JSON.stringify(name)}: ${normalizeFilterApplySource(def.apply)}`)
    .join(',\n');

  return `
self.onmessage = null;
function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
const TWILIGHT_POLY_MAX_DEG = ${TWILIGHT_POLY_MAX_DEG};
const TWILIGHT_POLY_EXPS = ${JSON.stringify(TWILIGHT_POLY_EXPS)};
const TWILIGHT_POLY_COEFS = ${JSON.stringify(TWILIGHT_POLY_COEFS)};
const MEXICO_COEFS = ${JSON.stringify(MEXICO_COEFS)};
const FILTER_APPLY = {
${filterEntries}
};
const SCRATCH = Object.create(null);
function getScratch(name, size) {
  const s = SCRATCH[name] || (SCRATCH[name] = Object.create(null));
  if (size && (!s.orig || s.orig.length !== size)) {
    s.orig = new Uint8ClampedArray(size);
  }
  return s;
}
self.onmessage = (event) => {
  const payload = event.data || {};
  const id = payload.id;
  try {
    const data = new Uint8ClampedArray(payload.buffer);
    const name = payload.filterName || 'none';
    if (name !== 'none') {
      const fn = FILTER_APPLY[name];
      if (typeof fn === 'function') {
        fn(
          data,
          payload.w,
          payload.h,
          payload.intensity,
          payload.params || {},
          payload.pixelScale || 1,
          getScratch(name, data.length)
        );
      }
    }
    self.postMessage({ id, buffer: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
`;
}

let _filterWorker = null;
let _filterWorkerUrl = null;
let _filterWorkerReqId = 0;
const _filterWorkerPending = new Map();
let _appIsBackgrounded = false;
let _resumeRenderQueued = false;

function teardownFilterWorker() {
  for (const [, pending] of _filterWorkerPending) {
    pending.reject(new Error('Filter worker terminated'));
  }
  _filterWorkerPending.clear();
  try {
    _filterWorker?.terminate();
  } catch {}
  _filterWorker = null;
  if (_filterWorkerUrl) {
    try {
      URL.revokeObjectURL(_filterWorkerUrl);
    } catch {}
    _filterWorkerUrl = null;
  }
}

function ensureFilterWorker() {
  if (_filterWorker) return _filterWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    _filterWorkerUrl = URL.createObjectURL(new Blob([buildFilterWorkerScript()], { type: 'application/javascript' }));
    const worker = new Worker(_filterWorkerUrl);
    worker.onmessage = (event) => {
      const { id, buffer, error } = event.data || {};
      const pending = _filterWorkerPending.get(id);
      if (!pending) return;
      _filterWorkerPending.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(new Uint8ClampedArray(buffer));
      }
    };
    worker.onerror = (event) => {
      perf.workerErrors++;
      for (const [, pending] of _filterWorkerPending) {
        pending.reject(new Error(event?.message || 'Filter worker failed'));
      }
      _filterWorkerPending.clear();
      try {
        worker.terminate();
      } catch {}
      _filterWorker = null;
    };
    _filterWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

async function runFilterInWorker(name, imgData, w, h, intensity, params, pixelScale = 1, opts = {}) {
  if (name === 'none') return { data: imgData.data, usedWorker: false, fellBack: false };
  if (_appIsBackgrounded || document.visibilityState === 'hidden') {
    return { data: imgData.data, usedWorker: false, fellBack: false };
  }
  if (opts.forceMainThread) {
    const scratch = getFilterScratch(name, imgData.data.length);
    FILTERS[name].apply(imgData.data, w, h, intensity, params, pixelScale, scratch);
    return { data: imgData.data, usedWorker: false, fellBack: false };
  }
  const worker = ensureFilterWorker();
  if (!worker) {
    const scratch = getFilterScratch(name, imgData.data.length);
    FILTERS[name].apply(imgData.data, w, h, intensity, params, pixelScale, scratch);
    return { data: imgData.data, usedWorker: false, fellBack: false };
  }
  // Keep the source ImageData buffer intact; send a copy to the worker.
  // If worker execution fails, we can safely fall back to main-thread apply.
  const input = new Uint8ClampedArray(imgData.data);
  const id = ++_filterWorkerReqId;
  try {
    const out = await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        _filterWorkerPending.delete(id);
        perf.workerTimeouts++;
        reject(new Error('Filter worker timed out'));
      }, 4000);
      _filterWorkerPending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
      worker.postMessage({
        id,
        filterName: name,
        w,
        h,
        intensity,
        params: params || {},
        pixelScale,
        buffer: input.buffer,
      }, [input.buffer]);
    });
    return { data: out, usedWorker: true, fellBack: false };
  } catch {
    if (_appIsBackgrounded || document.visibilityState === 'hidden') {
      return { data: imgData.data, usedWorker: false, fellBack: false };
    }
    // Disable broken/hung worker and continue with deterministic fallback.
    perf.workerFallbacks++;
    teardownFilterWorker();
    const scratch = getFilterScratch(name, imgData.data.length);
    FILTERS[name].apply(imgData.data, w, h, intensity, params, pixelScale, scratch);
    return { data: imgData.data, usedWorker: false, fellBack: true };
  }
}

function defaultStyle() {
  return state.lastStyle
    ? { ...state.lastStyle }
    : { ...PRESETS.classic, blur: 0, glow: 0, opacity: 1, bgColor: null };
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const uploadScreen   = document.getElementById('upload-screen');
const editorScreen   = document.getElementById('editor-screen');
const fileInput      = document.getElementById('file-input');
const addObjectInput = document.getElementById('add-object-input');
const addObjectBtns  = document.querySelectorAll('.add-object-btn');
const backBtn        = document.getElementById('back-btn');
const exportBtn      = document.getElementById('export-btn');
const copyBtn        = document.getElementById('copy-btn');
const baseImage      = document.getElementById('base-image');
const paintLayer     = document.getElementById('paint-layer');
const canvasWrapper   = document.getElementById('canvas-wrapper');
const canvasContainer = document.getElementById('canvas-container');
const canvasHint      = document.getElementById('canvas-hint');
const exportCanvas   = document.getElementById('export-canvas');

// True on phones/tablets — used to gate the single-tap-to-select behaviour.
const isMobile = navigator.maxTouchPoints > 0;

const fontControls   = document.getElementById('font-controls');
const objectControls = document.getElementById('object-controls');
const bottomPanel    = document.getElementById('bottom-panel');
const panelTabBtns   = document.querySelectorAll('.panel-tab');
const sidebarSectionToggles = document.querySelectorAll('.section-heading-toggle');

const ctrlFont         = document.getElementById('ctrl-font');
const ctrlFontWrap     = document.getElementById('ctrl-font-wrap');
const ctrlFontTrigger  = document.getElementById('ctrl-font-trigger');
const ctrlFontLabel    = document.getElementById('ctrl-font-label');
const ctrlFontMenu     = document.getElementById('ctrl-font-menu');
const ctrlSize         = document.getElementById('ctrl-size');
const ctrlSizeVal      = document.getElementById('ctrl-size-val');
const ctrlLineHeight   = document.getElementById('ctrl-line-height');
const ctrlLineHeightVal = document.getElementById('ctrl-line-height-val');
const ctrlBold         = document.getElementById('ctrl-bold');
const ctrlItalic       = document.getElementById('ctrl-italic');
const ctrlBlur         = document.getElementById('ctrl-blur');
const ctrlGlow         = document.getElementById('ctrl-glow');
const ctrlOpacity      = document.getElementById('ctrl-opacity');
const ctrlBgEnabled    = document.getElementById('ctrl-bg-enabled');
const ctrlBgColor      = document.getElementById('ctrl-bg-color');
const ctrlFgColor      = document.getElementById('ctrl-fg-color');
const ctrlOutlineColor = document.getElementById('ctrl-outline-color');
const ctrlOutlineWidth = document.getElementById('ctrl-outline-width');
const ctrlOutlineWidthVal = document.getElementById('ctrl-outline-width-val');
const ctrlAutoContrast = document.getElementById('ctrl-auto-contrast');
const paintToggleBtns  = document.querySelectorAll('.paint-toggle-btn');
const ctrlPaintColor   = document.getElementById('ctrl-paint-color');
const ctrlPaintSize    = document.getElementById('ctrl-paint-size');
const alignBtns        = document.querySelectorAll('.align-btn');
const presetBtns       = document.querySelectorAll('.preset-chip');
const uploadStatus     = document.getElementById('upload-status');
const uploadStatusText = document.getElementById('upload-status-text');
const DEFAULT_SIZE_MIN = parseFloat(ctrlSize?.min || '1');
const DEFAULT_SIZE_MAX = parseFloat(ctrlSize?.max || '25');

function randomizeWordmarkFont() {
  if (!ctrlFont?.options?.length) return;
  const options = Array.from(ctrlFont.options).filter((opt) => !!opt.value);
  if (!options.length) return;
  const choice = options[Math.floor(Math.random() * options.length)];
  const rawFont = String(choice.value || '').trim();
  const varMatch = rawFont.match(/^var\((--[^)]+)\)$/);
  const resolvedFont = varMatch
    ? (getComputedStyle(document.documentElement).getPropertyValue(varMatch[1]).trim() || rawFont)
    : rawFont;
  const wordmarks = document.querySelectorAll('.wordmark, .wordmark-small');
  if (!wordmarks.length) return;
  wordmarks.forEach((el) => {
    el.style.fontFamily = resolvedFont;
  });

  // Kick font loading early for the selected face; assignment above already
  // makes the random face visible as soon as it is available.
  if (document.fonts?.load) {
    document.fonts.load(`400 32px ${resolvedFont}`, 'Subtext').catch(() => {});
  }
}
randomizeWordmarkFont();

if (baseImage) {
  baseImage.draggable = false;
  baseImage.addEventListener('dragstart', (e) => e.preventDefault());
}

// ─── Image loading ─────────────────────────────────────────────────────────────

const HEIC_MIME_RE = /^image\/hei(c|f|x|s)$/i;
const HEIC_EXT_RE  = /\.(hei(c|f|x|s))$/i;
const SVG_MIME_RE  = /^image\/svg\+xml$/i;
const SVG_EXT_RE   = /\.svg$/i;
const IMAGE_EXT_RE = /\.(avif|bmp|gif|heic|heif|heix|heis|jpg|jpeg|jpe|jfif|png|svg|tif|tiff|webp)$/i;

function isHeicLikeFile(file) {
  const name = file?.name || '';
  const type = file?.type || '';
  return HEIC_MIME_RE.test(type) || HEIC_EXT_RE.test(name);
}

function isLikelyImageFile(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  const name = file.name || '';
  return type.startsWith('image/') || IMAGE_EXT_RE.test(name);
}

function isSvgLikeFile(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  const name = file.name || '';
  return SVG_MIME_RE.test(type) || SVG_EXT_RE.test(name);
}

function extractFirstImageFile(transfer) {
  let file = transfer?.files?.[0] || null;
  if (file && isLikelyImageFile(file)) return file;
  if (!transfer?.items) return null;
  for (const item of transfer.items) {
    const candidate = item.getAsFile?.();
    if (candidate && isLikelyImageFile(candidate)) return candidate;
  }
  return null;
}

function setUploadBusy(isBusy, message = 'Loading image...') {
  state.uploadBusy = isBusy;
  fileInput.disabled = isBusy;
  addObjectBtns.forEach((btn) => {
    btn.disabled = isBusy;
  });
  if (!uploadStatus || !uploadStatusText) return;
  uploadStatus.classList.toggle('hidden', !isBusy);
  uploadStatusText.textContent = message;
}

function loadImgFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image decode failed'));
    };
    img.src = url;
  });
}

async function canDecodeBlob(blob) {
  try {
    await loadImgFromBlob(blob);
    return true;
  } catch {
    return false;
  }
}

async function convertBlobToJpeg(blob, quality = 0.93) {
  const img = await loadImgFromBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha channel; composite transparent pixels to white.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!outBlob) throw new Error('JPEG conversion failed');
  return outBlob;
}

async function convertHeicToJpeg(file) {
  const failures = [];

  if (typeof window.heic2any === 'function') {
    try {
      const converted = await window.heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.93,
      });
      const out = Array.isArray(converted) ? converted[0] : converted;
      if (out) return out;
      failures.push('heic2any returned no image data');
    } catch (err) {
      failures.push(err?.message || String(err));
    }
  }

  if (typeof window.HeicTo === 'function') {
    try {
      if (typeof window.HeicTo.isHeic === 'function') {
        const isHeic = await window.HeicTo.isHeic(file);
        if (!isHeic) throw new Error('not identified as HEIC by HeicTo');
      }
      const out = await window.HeicTo({
        blob: file,
        type: 'image/jpeg',
        quality: 0.93,
      });
      if (out) return out;
      failures.push('HeicTo returned no image data');
    } catch (err) {
      failures.push(err?.message || String(err));
    }
  }

  throw new Error(`HEIC conversion failed (${failures.join(' | ') || 'no converter available'})`);
}

async function normalizeUploadImage(file) {
  let inputBlob = file;
  let convertedFromHeic = false;

  const directlyDecodable = await canDecodeBlob(file);
  if (!directlyDecodable) {
    if (!isHeicLikeFile(file)) {
      throw new Error('This image format is not supported by your browser.');
    }
    setUploadBusy(true, 'Converting image...');
    inputBlob = await convertHeicToJpeg(file);
    convertedFromHeic = true;
  }

  const inputType = (inputBlob.type || '').toLowerCase();
  if (inputType === 'image/gif') {
    setUploadBusy(true, 'Animated GIF detected; using first frame...');
    return await convertBlobToJpeg(inputBlob, 0.93);
  }
  if (convertedFromHeic || inputType !== 'image/jpeg') {
    return await convertBlobToJpeg(inputBlob, 0.93);
  }
  return inputBlob;
}

function loadImageFile(file, opts = {}) {
  const { resetSession = false } = opts;
  if (!file) return;
  if (state.uploadBusy) return;
  if (resetSession) {
    showUpload();
  }
  if (!isLikelyImageFile(file)) {
    alert('Please choose an image file.');
    return;
  }
  setUploadBusy(true, 'Loading image...');
  (async () => {
    try {
      const normalizedBlob = await normalizeUploadImage(file);
      if (state.imageObjectUrl) {
        URL.revokeObjectURL(state.imageObjectUrl);
        state.imageObjectUrl = null;
      }
      const url = URL.createObjectURL(normalizedBlob);
      state.imageObjectUrl = url;
      baseImage.onload = () => {
        if (state.imageObjectUrl === url) {
          URL.revokeObjectURL(url);
          state.imageObjectUrl = null;
        }
        setUploadBusy(false);
        state.imageNaturalW = baseImage.naturalWidth;
        state.imageNaturalH = baseImage.naturalHeight;
        state.imageLoaded = true;
        markPreviewSourceDirty();
        showEditor();
      };
      baseImage.onerror = () => {
        if (state.imageObjectUrl === url) {
          URL.revokeObjectURL(url);
          state.imageObjectUrl = null;
        }
        setUploadBusy(false);
        alert('Could not open this image. Please try a different file.');
      };
      baseImage.src = url;
    } catch (err) {
      setUploadBusy(false);
      alert(err?.message || 'Could not open this image. Please try another format.');
    }
  })();
}

const DROPPED_IMAGE_OBJECT_SIZE_PCT = 10;

// Theme-color mirrors --bg so the browser chrome matches the app's
// safe-area zones, which are now all painted with the same --bg color.
const THEME = {
  upload: { light: '#f5f0e8', dark: '#191410' },  // --bg
  editor: { light: '#f5f0e8', dark: '#191410' },  // --bg (same; panels now use --bg)
};

const tcLight = document.querySelector('meta[name="theme-color"][media*="light"]');
const tcDark  = document.querySelector('meta[name="theme-color"][media*="dark"]');

function setThemeColors(screen) {
  const t = THEME[screen];
  if (tcLight) tcLight.content = t.light;
  if (tcDark)  tcDark.content  = t.dark;
}

let _hintTimer = null;

function dismissHint() {
  if (!canvasHint || canvasHint.classList.contains('hidden')) return;
  canvasHint.classList.add('hidden');
  clearTimeout(_hintTimer);
}

function showHintMessage(message, durationMs = 1300) {
  if (!canvasHint) return;
  canvasHint.textContent = message;
  canvasHint.classList.remove('hidden');
  clearTimeout(_hintTimer);
  _hintTimer = setTimeout(dismissHint, durationMs);
}

function fitImageToWrapper() {
  if (!state.imageLoaded) return;
  const availW = canvasWrapper.clientWidth  - 20; // subtract padding
  const availH = canvasWrapper.clientHeight - 20;
  if (availW <= 0 || availH <= 0) return;
  const scale = Math.min(availW / state.imageNaturalW, availH / state.imageNaturalH);
  baseImage.style.width  = Math.round(state.imageNaturalW * scale) + 'px';
  baseImage.style.height = Math.round(state.imageNaturalH * scale) + 'px';
  resizePaintLayerToImage({ preserve: true });
}

function getPreviewTextBlurPx(blurAmount, previewScale, opts = {}) {
  const { forDom = false } = opts;
  if (!blurAmount || blurAmount <= 0) return 0;
  // Export uses a 3-pass box blur with an integer kernel radius. That appears
  // stronger than CSS Gaussian blur at the same numeric radius, so we map the
  // preview radius to the equivalent Gaussian sigma of the export kernel.
  const exportRadius = blurAmount * previewScale;
  const kernelRadius = Math.max(1, Math.round(exportRadius));
  let px = Math.sqrt(kernelRadius * (kernelRadius + 1));
  // On mobile Safari/retina, CSS blur on DOM text tends to appear stronger
  // than canvas-export blur at the same nominal radius.
  if (forDom && isMobileViewport()) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    px /= dpr;
  }
  return px;
}

function getObjectBlurRadiusPx(blurAmount, scaleFactor) {
  if (!blurAmount || blurAmount <= 0) return 0;
  // Keep object blur visibly present in pixel-rendered preview/export while
  // preserving the existing 0..1 control range.
  return blurAmount * Math.max(1, scaleFactor) * 6;
}

function getObjectGlowRadiusPx(glowAmount, scaleFactor) {
  if (!glowAmount || glowAmount <= 0) return 0;
  // Glow uses a wider radius than blur so small slider changes are visible.
  return glowAmount * Math.max(1, scaleFactor) * 16;
}

function getPreviewGlowRadiusPx(glowAmount, previewScale, opts = {}) {
  const { forDom = false } = opts;
  let px = getObjectGlowRadiusPx(glowAmount, previewScale);
  if (forDom && isMobileViewport()) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    px /= dpr;
  }
  return px;
}

function colorToRgb(color, fallback = [255, 255, 255]) {
  const c = (color || '').trim();
  if (!c) return fallback;
  if (c.startsWith('#') && c.length === 7) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  }
  if (c.startsWith('#') && c.length === 4) {
    const r = parseInt(c[1] + c[1], 16);
    const g = parseInt(c[2] + c[2], 16);
    const b = parseInt(c[3] + c[3], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  }
  return fallback;
}

function colorWithAlpha(color, alpha = 1) {
  const [r, g, b] = colorToRgb(color, [255, 255, 255]);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function clampObjectOpacity(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.1, Math.min(1, n));
}

function blurCurrentAlphaIntoGlow(ctx, w, h, color, radiusPx) {
  if (!radiusPx || radiusPx <= 0) return;
  const [gr, gg, gb] = colorToRgb(color);
  const alphaBoost = Math.max(2.1, Math.min(5.2, 2.1 + radiusPx * 0.08));
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    // Keep RGB pinned to glow color even at alpha=0 so blur kernels
    // do not pull in black fringes from transparent pixels.
    d[i] = gr;
    d[i + 1] = gg;
    d[i + 2] = gb;
    if (a === 0) continue;
    d[i + 3] = Math.min(255, Math.round(a * alphaBoost));
  }
  ctx.putImageData(id, 0, 0);
  softBlur(ctx, w, h, radiusPx);

  // Post-boost halo alpha so exported glow more closely matches DOM
  // drop-shadow visibility, especially on thin glyph strokes.
  const out = ctx.getImageData(0, 0, w, h);
  const od = out.data;
  const gain = Math.max(1.3, Math.min(3.0, 1.3 + radiusPx * 0.026));
  for (let i = 0; i < od.length; i += 4) {
    // Re-pin color after blur pass for chroma stability.
    od[i] = gr;
    od[i + 1] = gg;
    od[i + 2] = gb;
    const a = od[i + 3];
    if (a === 0) continue;
    const lifted = Math.pow(a / 255, 0.8) * 255 * gain;
    od[i + 3] = Math.min(255, Math.round(lifted));
  }
  ctx.putImageData(out, 0, 0);
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 769px)').matches;
}

let _paintCtx = null;
let _paintDrawing = false;
let _paintPointerId = null;
let _paintLastX = 0;
let _paintLastY = 0;
let _paintMinX = Infinity;
let _paintMinY = Infinity;
let _paintMaxX = -Infinity;
let _paintMaxY = -Infinity;

function getPaintContext() {
  if (!_paintCtx && paintLayer) {
    _paintCtx = paintLayer.getContext('2d');
  }
  return _paintCtx;
}

function isPaintPanelActive() {
  return !isMobileViewport() || bottomPanel?.dataset?.panel === 'paint';
}

function isPaintInteractive() {
  return !!(state.imageLoaded && state.paint.enabled && isPaintPanelActive());
}

function syncPaintControls() {
  if (ctrlPaintColor) ctrlPaintColor.value = state.paint.color;
  if (ctrlPaintSize) ctrlPaintSize.value = String(state.paint.size);
  paintToggleBtns.forEach((btn) => {
    btn.classList.toggle('active', state.paint.enabled);
    const title = state.paint.enabled ? 'Drawing enabled' : 'Enable drawing';
    btn.title = title;
    btn.setAttribute('aria-label', title);
  });
}

function syncPaintInteractivity() {
  canvasContainer.classList.toggle('paint-mode', isPaintInteractive());
}

function clearPaintLayer({ schedule = true } = {}) {
  const ctx = getPaintContext();
  if (!ctx || !paintLayer) return;
  ctx.clearRect(0, 0, paintLayer.width, paintLayer.height);
  state.paint.hasStrokes = false;
  _paintMinX = Infinity;
  _paintMinY = Infinity;
  _paintMaxX = -Infinity;
  _paintMaxY = -Infinity;
  if (schedule) {
    markPreviewSourceDirty();
    scheduleImageFilterRender({ interactive: true });
  }
}

function resizePaintLayerToImage({ preserve = true } = {}) {
  if (!paintLayer) return;
  const nextW = Math.max(1, Math.round(baseImage.offsetWidth || 0));
  const nextH = Math.max(1, Math.round(baseImage.offsetHeight || 0));
  if (!nextW || !nextH) return;
  if (paintLayer.width === nextW && paintLayer.height === nextH) return;

  let prevCanvas = null;
  if (preserve && paintLayer.width > 0 && paintLayer.height > 0 && state.paint.hasStrokes) {
    prevCanvas = document.createElement('canvas');
    prevCanvas.width = paintLayer.width;
    prevCanvas.height = paintLayer.height;
    const prevCtx = prevCanvas.getContext('2d');
    prevCtx.drawImage(paintLayer, 0, 0);
  }

  paintLayer.width = nextW;
  paintLayer.height = nextH;
  _paintCtx = paintLayer.getContext('2d');
  if (prevCanvas) {
    _paintCtx.drawImage(prevCanvas, 0, 0, nextW, nextH);
  }
}

function drawBaseAndPaintToContext(ctx, w, h) {
  ctx.drawImage(baseImage, 0, 0, w, h);
  if (paintLayer && state.paint.hasStrokes && paintLayer.width > 0 && paintLayer.height > 0) {
    ctx.drawImage(paintLayer, 0, 0, w, h);
  }
}

function getPaintPointFromEvent(e) {
  const rect = paintLayer.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
  return { x, y };
}

function paintLineTo(x, y) {
  const ctx = getPaintContext();
  if (!ctx) return;
  const prevX = _paintLastX;
  const prevY = _paintLastY;
  ctx.save();
  ctx.strokeStyle = state.paint.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = state.paint.size;
  ctx.beginPath();
  ctx.moveTo(prevX, prevY);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
  _paintLastX = x;
  _paintLastY = y;
  const r = Math.max(1, state.paint.size * 0.5 + 2);
  _paintMinX = Math.min(_paintMinX, x - r, prevX - r);
  _paintMinY = Math.min(_paintMinY, y - r, prevY - r);
  _paintMaxX = Math.max(_paintMaxX, x + r, prevX + r);
  _paintMaxY = Math.max(_paintMaxY, y + r, prevY + r);
}

async function commitPaintLayerToImageObject() {
  if (!paintLayer || !state.paint.hasStrokes) return;
  const pw = paintLayer.width;
  const ph = paintLayer.height;
  if (pw <= 0 || ph <= 0) return;

  const minX = Math.max(0, Math.floor(_paintMinX));
  const minY = Math.max(0, Math.floor(_paintMinY));
  const maxX = Math.min(pw, Math.ceil(_paintMaxX));
  const maxY = Math.min(ph, Math.ceil(_paintMaxY));
  const cropW = Math.max(1, maxX - minX);
  const cropH = Math.max(1, maxY - minY);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(paintLayer, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

  const blob = await new Promise((resolve) => cropCanvas.toBlob(resolve, 'image/png'));
  if (!blob) return;

  const centerXPct = (minX + cropW / 2) / Math.max(1, pw);
  const centerYPct = (minY + cropH / 2) / Math.max(1, ph);
  const imageObj = await addImageObjectFromBlob(blob, centerXPct, centerYPct, { isVector: false });
  const sizePct = Math.max(1, Math.min(100, (cropW / Math.max(1, pw)) * 100));
  imageObj?.updateStyle?.({ size: sizePct });
}

async function endPaintStroke() {
  if (!_paintDrawing) return;
  _paintDrawing = false;
  _paintPointerId = null;
  try {
    await commitPaintLayerToImageObject();
  } catch {}
  state.paint.enabled = false;
  syncPaintControls();
  syncPaintInteractivity();
  clearPaintLayer({ schedule: false });
  markPreviewSourceDirty();
  scheduleImageFilterRender({ settle: true });
}

function showEditor() {
  uploadScreen.classList.remove('active');
  uploadScreen.classList.remove('drag-over');
  dragEnterCount = 0;
  editorScreen.classList.add('active');
  editorScreen.classList.remove('drag-over');
  editorDragEnterCount = 0;
  setThemeColors('editor');
  // Clear any leftover fields
  state.objects.forEach(obj => obj.destroy?.());
  state.objects = [];
  state.selectedObject = null;
  state.lastStyle = null;
  state.paint.enabled = false;
  state.paint.hasStrokes = false;
  _paintMinX = Infinity;
  _paintMinY = Infinity;
  _paintMaxX = -Infinity;
  _paintMaxY = -Infinity;
  markPreviewSourceDirty();
  // Always start on the Typography tab when opening the editor
  switchPanelTab('typography');
  syncPaintControls();
  syncPaintInteractivity();
  updatePanel();
  // Size image to fill available space after layout is committed
  requestAnimationFrame(() => {
    fitImageToWrapper();
    clearPaintLayer({ schedule: false });
    // Force fresh preview render so pixel-overlay vibes don't show stale image data.
    scheduleImageFilterRender({ settle: true });
  });
  // Show the canvas hint and auto-dismiss after 10 s
  showHintMessage('Double-click image to add text', 10000);
}

function showUpload() {
  editorScreen.classList.remove('active');
  editorScreen.classList.remove('drag-over');
  editorDragEnterCount = 0;
  uploadScreen.classList.add('active');
  uploadScreen.classList.remove('drag-over');
  dragEnterCount = 0;
  setThemeColors('upload');
  state.imageLoaded = false;
  state.imageNaturalW = 0;
  state.imageNaturalH = 0;
  if (state.imageObjectUrl) {
    URL.revokeObjectURL(state.imageObjectUrl);
    state.imageObjectUrl = null;
  }
  baseImage.onload = null;
  baseImage.onerror = null;
  baseImage.removeAttribute('src');
  baseImage.style.width  = '';
  baseImage.style.height = '';
  state.paint.enabled = false;
  state.paint.hasStrokes = false;
  if (paintLayer) {
    paintLayer.width = 1;
    paintLayer.height = 1;
  }
  _paintCtx = null;
  syncPaintControls();
  syncPaintInteractivity();
  deselectAll();
  state.objects.forEach(obj => obj.destroy?.());
  state.objects = [];
  // Reset filter
  state.filter = { name: 'none', intensity: 75, params: {}, applyOnTop: false };
  canvasContainer.style.filter = '';
  baseImage.style.filter = '';
  if (grainEl) grainEl.style.display = 'none';
  if (scanlineEl) scanlineEl.style.display = 'none';
  if (chromaEl) chromaEl.style.display = 'none';
  if (vignetteEl) vignetteEl.style.display = 'none';
  if (solarpunkEl) solarpunkEl.style.display = 'none';
  if (hegsethEl) hegsethEl.style.display = 'none';
  if (mexicoEl) mexicoEl.style.display = 'none';
  if (finalPreviewEl) finalPreviewEl.style.display = 'none';
  hideGpuPreviewOverlay();
  filterChips.forEach(c => c.classList.toggle('active', c.dataset.filter === 'none'));
  filterIntensityRow.classList.add('hidden');
  filterLayerRow.classList.add('hidden');
  filterFilmControls.classList.add('hidden');
  filterDitherControls.classList.add('hidden');
  filterVaporControls.classList.add('hidden');
  filterDarkAcadControls.classList.add('hidden');
  filterSolarpunkControls.classList.add('hidden');
  filterHegsethControls.classList.add('hidden');
  filterHyperpopControls.classList.add('hidden');
  filterPixelArtControls.classList.add('hidden');
  ctrlFilterIntensity.value = 75;
  ctrlFilterOnTop.checked = false;
  if (_filterRenderRaf) {
    cancelAnimationFrame(_filterRenderRaf);
    _filterRenderRaf = 0;
  }
  if (_previewThrottleTimer) {
    clearTimeout(_previewThrottleTimer);
    _previewThrottleTimer = 0;
  }
  _previewInteractionUntilTs = 0;
  _previewSettleRequested = false;
  _previewRenderSeq = 0;
  _previewRenderedSeq = 0;
  _previewRenderInFlight = false;
  _previewRenderPending = false;
  previewGpuSourceCache.w = 0;
  previewGpuSourceCache.h = 0;
  previewGpuSourceCache.key = '';
  previewGpuSourceCache.dirty = true;
  previewPixelSourceCache.data = null;
  previewPixelSourceCache.w = 0;
  previewPixelSourceCache.h = 0;
  previewPixelSourceCache.key = '';
  previewPixelSourceCache.dirty = true;
  perf.previewSourceCacheHits = 0;
  perf.previewSourceCacheMisses = 0;
  setUploadBusy(false);
}

fileInput.addEventListener('change', (e) => {
  loadImageFile(e.target.files[0]);
});

if (addObjectBtns.length && addObjectInput) {
  addObjectBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.uploadBusy || !state.imageLoaded) return;
      addObjectInput.click();
    });
  });

  addObjectInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      addImageObjectFromFile(file, { xPct: 0.5, yPct: 0.5 });
    }
    // Allow choosing the same file again.
    addObjectInput.value = '';
  });
}

// Drag-and-drop onto the upload screen
let dragEnterCount = 0;

uploadScreen.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (state.uploadBusy) return;
  dragEnterCount++;
  uploadScreen.classList.add('drag-over');
});

uploadScreen.addEventListener('dragleave', () => {
  dragEnterCount--;
  if (dragEnterCount === 0) uploadScreen.classList.remove('drag-over');
});

uploadScreen.addEventListener('dragover', (e) => {
  e.preventDefault(); // required to allow drop
  if (state.uploadBusy) return;
});

uploadScreen.addEventListener('drop', (e) => {
  e.preventDefault();
  if (state.uploadBusy) {
    dragEnterCount = 0;
    uploadScreen.classList.remove('drag-over');
    return;
  }
  dragEnterCount = 0;
  uploadScreen.classList.remove('drag-over');
  const file = extractFirstImageFile(e.dataTransfer);
  loadImageFile(file);
});

// Drag-and-drop onto the editor to add image objects.
let editorDragEnterCount = 0;

editorScreen.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (state.uploadBusy || !state.imageLoaded) return;
  editorDragEnterCount++;
  editorScreen.classList.add('drag-over');
});

editorScreen.addEventListener('dragleave', () => {
  editorDragEnterCount--;
  if (editorDragEnterCount <= 0) {
    editorDragEnterCount = 0;
    editorScreen.classList.remove('drag-over');
  }
});

editorScreen.addEventListener('dragover', (e) => {
  e.preventDefault();
});

editorScreen.addEventListener('drop', (e) => {
  e.preventDefault();
  editorDragEnterCount = 0;
  editorScreen.classList.remove('drag-over');
  if (state.uploadBusy || !state.imageLoaded) return;
  const file = extractFirstImageFile(e.dataTransfer);
  const rect = canvasContainer.getBoundingClientRect();
  const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
  const yPct = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
  addImageObjectFromFile(file, { xPct, yPct });
});

// Paste from clipboard
window.addEventListener('paste', (e) => {
  if (state.uploadBusy) return;
  const file = extractFirstImageFile(e.clipboardData);
  if (file) {
    loadImageFile(file, { resetSession: editorScreen.classList.contains('active') });
  }
});

backBtn.addEventListener('click', () => {
  if (confirm('Start over? Your work will be lost, like tears in the rain.')) {
    showUpload();
  }
});

// ─── TextObject class ──────────────────────────────────────────────────────────

let _fieldId = 0;

class TextObject {
  constructor(xPct, yPct, style) {
    this.id = _fieldId++;
    this.type = 'text';
    this.xPct = xPct;   // center-x as fraction of container width
    this.yPct = yPct;   // center-y as fraction of container height
    this.style = { lineHeight: 1.2, rotateDeg: 0, ...style };
    this.text = '';
    this.autoContrastStep = 0;
    this._pendingAnchorWidthPx = null;
    this.el = null;
    this.innerEl = null;
    this._build();
  }

  _shiftXPctForAnchorWidth(prevWidthPx, nextWidthPx, align = this.style.align) {
    const cw = Math.max(1, canvasContainer.offsetWidth || 1);
    const delta = (nextWidthPx - prevWidthPx) || 0;
    if (Math.abs(delta) < 0.01) return;
    if (align === 'left') {
      this.xPct += (delta * 0.5) / cw;
    } else if (align === 'right') {
      this.xPct -= (delta * 0.5) / cw;
    }
    this.xPct = Math.max(0, Math.min(1, this.xPct));
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'text-field';
    wrap.dataset.id = this.id;

    const del = document.createElement('div');
    del.className = 'text-field-delete';
    del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor" aria-hidden="true"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
    del.title = 'Delete';

    const rotate = document.createElement('button');
    rotate.type = 'button';
    rotate.className = 'text-field-rotate';
    rotate.title = 'Rotate';
    rotate.setAttribute('aria-label', 'Rotate object');
    rotate.innerHTML = '<img src="icons/switch_access_shortcut_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg?v=3" alt="" aria-hidden="true" />';

    const resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'text-field-resize';
    resize.title = 'Resize';
    resize.setAttribute('aria-label', 'Resize object');
    resize.innerHTML = '<img src="icons/open_in_full_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg" alt="" aria-hidden="true" />';

    const inner = document.createElement('div');
    inner.className = 'text-field-inner';
    inner.contentEditable = 'true';
    // Keep text rendering stable for outlined text fields.
    inner.spellcheck = false;
    inner.setAttribute('autocorrect', 'off');
    inner.setAttribute('autocapitalize', 'off');
    inner.setAttribute('autocomplete', 'off');
    inner.setAttribute('data-placeholder', 'Caption…');
    inner.textContent = this.text;

    wrap.appendChild(del);
    wrap.appendChild(rotate);
    wrap.appendChild(resize);
    wrap.appendChild(inner);
    canvasContainer.appendChild(wrap);

    this.el = wrap;
    this.innerEl = inner;
    this.delEl = del;
    this.rotateEl = rotate;
    this.resizeEl = resize;

    this._applyStyle();
    this._positionEl();
    this._attachEvents();
  }

  _applyStyle() {
    const s = this.style;
    const inner = this.innerEl;
    const previewScale = (baseImage.offsetWidth > 0)
      ? (state.imageNaturalW / baseImage.offsetWidth)
      : 1;

    // size is stored as % of image width; convert to pixels against the
    // current rendered container width so text is always image-proportional.
    const px = Math.round(s.size / 100 * canvasContainer.offsetWidth);

    inner.style.fontFamily    = s.font;
    inner.style.fontSize      = px + 'px';
    inner.style.lineHeight    = String(s.lineHeight ?? 1.2);
    inner.style.fontWeight    = s.weight;
    inner.style.fontStyle     = s.italic ? 'italic' : 'normal';
    inner.style.textAlign     = s.align;
    inner.style.color         = s.fgColor;
    const opacity = clampObjectOpacity(s.opacity ?? 1);
    inner.style.opacity = `${opacity}`;
    inner.style.backgroundColor = s.bgColor ? colorWithAlpha(s.bgColor, opacity) : 'transparent';

    // Blur + glow (halo) effects
    const previewBlur = getPreviewTextBlurPx(s.blur, previewScale, { forDom: true });
    const glowPx = getPreviewGlowRadiusPx(s.glow, previewScale, { forDom: true });
    const filterParts = [];
    if (previewBlur > 0) filterParts.push(`blur(${previewBlur.toFixed(3)}px)`);
    if (glowPx > 0) {
      filterParts.push(`drop-shadow(0 0 ${glowPx.toFixed(3)}px ${s.fgColor || '#ffffff'})`);
      filterParts.push(`drop-shadow(0 0 ${(glowPx * 0.65).toFixed(3)}px ${s.fgColor || '#ffffff'})`);
    }
    inner.style.filter = filterParts.join(' ');

    // Text outline using -webkit-text-stroke
    if (s.outlineWidth > 0) {
      inner.style.webkitTextStroke = `${s.outlineWidth}px ${s.outlineColor}`;
      inner.style.paintOrder = 'stroke fill';
    } else {
      inner.style.webkitTextStroke = '0px transparent';
    }

    // Keep a small edit/tap floor, but let the box hug text width.
    inner.style.minWidth = Math.max(24, px * 1.1) + 'px';
  }

  _positionEl() {
    const cw = canvasContainer.offsetWidth;
    const ch = canvasContainer.offsetHeight;
    const x  = this.xPct * cw;
    const y  = this.yPct * ch;

    // Center the element on (x, y)
    this.el.style.left      = x + 'px';
    this.el.style.top       = y + 'px';
    const deg = this.style.rotateDeg || 0;
    this.el.style.setProperty('--object-rotate-deg', `${deg}deg`);
    this.el.style.transform = Math.abs(deg) < 0.01
      ? 'translate(-50%, -50%)'
      : `translate(-50%, -50%) rotate(${deg}deg)`;
  }

  _attachEvents() {
    // PRIMARY SELECTION: rely on the browser's native focus event.
    // This fires whenever the user clicks or tabs into the contenteditable,
    // which is far more reliable than intercepting pointerdown ourselves.
    this.innerEl.addEventListener('focus', () => {
      this.el.classList.add('editing');
      selectField(this);
    });

    this.innerEl.addEventListener('blur', () => {
      this.el.classList.remove('editing');
    });

    // Direct-drag interaction: click+drag moves object; click on selected text enters edit mode.
    this.el.addEventListener('pointerdown', (e) => {
      if (
        e.button !== 0 ||
        e.target === this.delEl ||
        e.target === this.rotateEl || this.rotateEl.contains(e.target) ||
        e.target === this.resizeEl || this.resizeEl.contains(e.target)
      ) return;
      e.stopPropagation();
      if (document.activeElement === this.innerEl) return;

      const focusOnClick = (e.target === this.innerEl && state.selectedObject === this);
      e.preventDefault();
      selectField(this);
      startDrag(e, this, { focusOnClick });
    });

    this.rotateEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      selectField(this);
      startRotate(e, this);
      clearPreset();
    });

    this.resizeEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      selectField(this);
      startResize(e, this);
      clearPreset();
    });

    // Delete button
    this.delEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.delEl.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteField(this);
    });

    // Keep text in sync
    this.innerEl.addEventListener('beforeinput', () => {
      this._pendingAnchorWidthPx = this.innerEl.offsetWidth || 0;
    });

    this.innerEl.addEventListener('input', () => {
      const prevWidth = this._pendingAnchorWidthPx ?? (this.innerEl.offsetWidth || 0);
      this.text = this.innerEl.textContent;
      this._pendingAnchorWidthPx = null;
      this._shiftXPctForAnchorWidth(prevWidth, this.innerEl.offsetWidth || 0);
      this._positionEl();
      markPreviewSourceDirty();
      if (state.filter.applyOnTop) {
        scheduleImageFilterRender({ interactive: true });
      }
    });

    // Prevent enter from inserting <div> — use \n instead
    this.innerEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertLineBreak');
      }
    });
  }

  updateStyle(patch) {
    const prevWidth = this.innerEl?.offsetWidth || 0;
    Object.assign(this.style, patch);
    this._applyStyle();
    this._shiftXPctForAnchorWidth(prevWidth, this.innerEl?.offsetWidth || 0);
    // Reposition in case font-size changed and element grew
    this._positionEl();
    markPreviewSourceDirty();
  }

  reposition() {
    this._applyStyle(); // pixel size depends on container width; recompute on resize
    this._positionEl();
    markPreviewSourceDirty();
  }

  repositionFast() {
    this._positionEl();
    markPreviewSourceDirty();
  }

  select() {
    this.el.classList.add('selected');
  }

  deselect() {
    this.el.classList.remove('selected');
    this.innerEl.blur();
  }

  destroy() {
    this.el?.remove();
  }
}

class ImageObject {
  constructor(xPct, yPct, opts = {}) {
    this.id = _fieldId++;
    this.type = 'image';
    this.xPct = xPct;
    this.yPct = yPct;
    this.aspect = opts.aspect || 1;
    this.isVector = !!opts.isVector;
    this.objectUrl = opts.objectUrl || null;
    this.style = { size: DROPPED_IMAGE_OBJECT_SIZE_PCT, rotateDeg: 0, blur: 0, glow: 0, opacity: 1, ...opts.style };
    this.el = null;
    this.imgEl = null;
    this.delEl = null;
    this.rotateEl = null;
    this.resizeEl = null;
    this._build();
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'text-field image-object';
    wrap.dataset.id = this.id;

    const del = document.createElement('div');
    del.className = 'text-field-delete';
    del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor" aria-hidden="true"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
    del.title = 'Delete';

    const rotate = document.createElement('button');
    rotate.type = 'button';
    rotate.className = 'text-field-rotate';
    rotate.title = 'Rotate';
    rotate.setAttribute('aria-label', 'Rotate object');
    rotate.innerHTML = '<img src="icons/switch_access_shortcut_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg?v=3" alt="" aria-hidden="true" />';

    const resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'text-field-resize';
    resize.title = 'Resize';
    resize.setAttribute('aria-label', 'Resize object');
    resize.innerHTML = '<img src="icons/open_in_full_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg" alt="" aria-hidden="true" />';

    const img = document.createElement('img');
    img.className = 'image-object-inner';
    img.draggable = false;
    img.alt = '';
    img.src = this.objectUrl;

    wrap.appendChild(del);
    wrap.appendChild(rotate);
    wrap.appendChild(resize);
    wrap.appendChild(img);
    canvasContainer.appendChild(wrap);

    this.el = wrap;
    this.imgEl = img;
    this.delEl = del;
    this.rotateEl = rotate;
    this.resizeEl = resize;

    this._applyStyle();
    this._positionEl();
    this._attachEvents();
  }

  _applyStyle() {
    const widthPx = Math.max(8, Math.round((this.style.size / 100) * canvasContainer.offsetWidth));
    const heightPx = Math.max(8, Math.round(widthPx / Math.max(0.01, this.aspect)));
    this.imgEl.style.width = `${widthPx}px`;
    this.imgEl.style.height = `${heightPx}px`;
    const opacity = clampObjectOpacity(this.style.opacity ?? 1);
    this.el.style.backgroundColor = this.style.bgColor ? colorWithAlpha(this.style.bgColor, opacity) : 'transparent';
    const previewScale = (baseImage.offsetWidth > 0)
      ? (state.imageNaturalW / baseImage.offsetWidth)
      : 1;
    const previewBlur = getPreviewTextBlurPx(this.style.blur, previewScale, { forDom: true });
    const previewGlow = getPreviewGlowRadiusPx(this.style.glow, previewScale, { forDom: true });
    if (this.isVector) {
      const filters = [];
      if (previewBlur > 0) filters.push(`blur(${previewBlur.toFixed(3)}px)`);
      if (previewGlow > 0) {
        filters.push(`drop-shadow(0 0 ${previewGlow.toFixed(3)}px rgba(255,255,255,0.95))`);
        filters.push(`drop-shadow(0 0 ${(previewGlow * 0.6).toFixed(3)}px rgba(255,255,255,0.8))`);
      }
      this.imgEl.style.filter = filters.join(' ');
      this.imgEl.style.opacity = `${opacity}`;
      this.el.style.boxShadow = '';
    } else {
      this.imgEl.style.filter = previewBlur > 0 ? `blur(${previewBlur.toFixed(3)}px)` : '';
      this.imgEl.style.opacity = `${opacity}`;
      this.el.style.boxShadow = previewGlow > 0
        ? `0 0 ${previewGlow.toFixed(2)}px rgba(255,255,255,0.85)`
        : '';
    }
  }

  _positionEl() {
    const cw = canvasContainer.offsetWidth;
    const ch = canvasContainer.offsetHeight;
    const x = this.xPct * cw;
    const y = this.yPct * ch;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    const deg = this.style.rotateDeg || 0;
    this.el.style.setProperty('--object-rotate-deg', `${deg}deg`);
    this.el.style.transform = Math.abs(deg) < 0.01
      ? 'translate(-50%, -50%)'
      : `translate(-50%, -50%) rotate(${deg}deg)`;
  }

  _attachEvents() {
    this.el.addEventListener('pointerdown', (e) => {
      if (
        e.button !== 0 ||
        e.target === this.delEl ||
        e.target === this.rotateEl || this.rotateEl.contains(e.target) ||
        e.target === this.resizeEl || this.resizeEl.contains(e.target)
      ) return;
      e.stopPropagation();
      e.preventDefault();
      selectField(this);
      startDrag(e, this);
    });

    this.rotateEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      selectField(this);
      startRotate(e, this);
      clearPreset();
    });

    this.resizeEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      selectField(this);
      startResize(e, this);
      clearPreset();
    });

    this.delEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.delEl.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteField(this);
    });
  }

  updateStyle(patch) {
    Object.assign(this.style, patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'size')) {
      const { min: minSize, max: maxSize } = getObjectSizeBounds(this, { keepCurrent: false });
      this.style.size = Math.max(minSize, Math.min(maxSize, this.style.size || DROPPED_IMAGE_OBJECT_SIZE_PCT));
    }
    this._applyStyle();
    this._positionEl();
    if (state.selectedObject === this) syncSizeControlBoundsForObject(this);
    markPreviewSourceDirty();
  }

  reposition() {
    this._applyStyle();
    this._positionEl();
    markPreviewSourceDirty();
  }

  repositionFast() {
    this._positionEl();
    markPreviewSourceDirty();
  }

  select() {
    this.el.classList.add('selected');
  }

  deselect() {
    this.el.classList.remove('selected');
  }

  destroy() {
    this.el?.remove();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

// ─── Field management ─────────────────────────────────────────────────────────

function addTextObject(xPct, yPct) {
  const style = defaultStyle();
  const tf = new TextObject(xPct, yPct, style);
  tf.activePreset = state.lastPreset; // inherit last-used preset (null = manually edited)
  state.objects.push(tf);
  markPreviewSourceDirty();
  // Don't call selectField() here — the focus event on innerEl will do it.
  // Use a short timeout so the element is fully laid out before focus.
  tf.el.classList.add('selected'); // show as selected immediately
  updatePanel();                   // show controls immediately
  loadFieldStyle(tf);
  // Ensure layer-mode filter preview is applied to newly created text fields.
  scheduleImageFilterRender({ settle: true });
  const focusNewField = () => {
    tf.innerEl.focus({ preventScroll: true });
  };
  // Immediate focus keeps mobile behavior aligned with desktop; fallback handles
  // engines that require one more layout tick before contenteditable can focus.
  focusNewField();
  requestAnimationFrame(focusNewField);
  setTimeout(focusNewField, 30);
  return tf;
}

// Backward-compatible alias while text remains the only object type.
const addTextField = addTextObject;

function addImageObjectFromBlob(blob, xPct = 0.5, yPct = 0.5, opts = {}) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const probe = new Image();
    probe.onload = () => {
      const naturalW = probe.naturalWidth || 1;
      const naturalH = probe.naturalHeight || 1;
      const aspect = naturalW / Math.max(1, naturalH);
      const imageObj = new ImageObject(xPct, yPct, {
        objectUrl,
        aspect,
        isVector: !!opts.isVector,
        style: { size: DROPPED_IMAGE_OBJECT_SIZE_PCT, rotateDeg: 0, blur: 0, glow: 0, opacity: 1 },
      });
      state.objects.push(imageObj);
      selectField(imageObj);
      markPreviewSourceDirty();
      scheduleImageFilterRender({ settle: true });
      resolve(imageObj);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not open this image. Please try a different file.'));
    };
    probe.src = objectUrl;
  });
}

function addImageObjectFromFile(file, opts = {}) {
  const { xPct = 0.5, yPct = 0.5 } = opts;
  if (!file) return;
  if (state.uploadBusy || !state.imageLoaded) return;
  if (!isLikelyImageFile(file)) {
    alert('Please choose an image file.');
    return;
  }
  setUploadBusy(true, 'Loading image...');
  (async () => {
    try {
      // Keep SVG objects as SVG sources so they render as vectors in-editor.
      const isVector = isSvgLikeFile(file);
      const objectBlob = isVector
        ? file
        : await normalizeUploadImage(file);
      await addImageObjectFromBlob(objectBlob, xPct, yPct, { isVector });
    } catch (err) {
      alert(err?.message || 'Could not open this image. Please try another format.');
    } finally {
      setUploadBusy(false);
    }
  })();
}

function deleteField(tf) {
  tf.destroy?.();
  state.objects = state.objects.filter(f => f !== tf);
  if (state.selectedObject === tf) {
    state.selectedObject = null;
  }
  markPreviewSourceDirty();
  syncTextFieldLayering();
  scheduleImageFilterRender({ settle: true });
  updatePanel();
}

function selectField(tf) {
  if (state.selectedObject === tf) {
    // Already selected — let the browser handle click/cursor natively
    return;
  }
  if (state.selectedObject) {
    state.selectedObject.deselect();
    if (state.selectedObject.type === 'text') {
      state.lastStyle  = { ...state.selectedObject.style };
      state.lastPreset = state.selectedObject.activePreset ?? null;
    }
  }
  state.selectedObject = tf;
  tf.select();
  syncTextFieldLayering();
  if (shouldRefreshPreviewForSelectionChange()) {
    markPreviewSourceDirty();
    scheduleImageFilterRender({ settle: true, immediate: true });
  }
  loadFieldStyle(tf);
  updatePanel();
}

function deselectAll() {
  let hadSelection = false;
  if (state.selectedObject) {
    hadSelection = true;
    if (state.selectedObject.type === 'text') {
      state.lastStyle  = { ...state.selectedObject.style };
      state.lastPreset = state.selectedObject.activePreset ?? null;
    }
    state.selectedObject.deselect();
    state.selectedObject = null;
  }
  syncTextFieldLayering();
  if (hadSelection && shouldRefreshPreviewForSelectionChange()) {
    markPreviewSourceDirty();
    scheduleImageFilterRender({ settle: true, immediate: true });
  }
  updatePanel();
}

// ─── Double-tap detection & field creation ────────────────────────────────────

let _lastTap = 0;
let _lastTapX = 0;
let _lastTapY = 0;
let _justCreatedField = false; // guard against spurious post-creation events
const DBL_TAP_DELAY = 350; // ms

canvasContainer.addEventListener('pointerdown', (e) => {
  // Only handle taps on the container or image itself (not on text fields)
  if (e.target !== canvasContainer && e.target !== baseImage) return;

  const now = Date.now();
  const rect = canvasContainer.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  const dt = now - _lastTap;
  const dx = cx - _lastTapX;
  const dy = cy - _lastTapY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dt < DBL_TAP_DELAY && dist < 30) {
    // Double tap — do NOT preventDefault; it would suppress focus()
    dismissHint();
    const xPct = cx / canvasContainer.offsetWidth;
    const yPct = cy / canvasContainer.offsetHeight;
    const tf = addTextField(xPct, yPct);
    tf?.innerEl?.focus({ preventScroll: true });
    _lastTap = 0;
    _justCreatedField = true;
    setTimeout(() => { _justCreatedField = false; }, 400);
  } else {
    // Single tap — deselect (but not if we just created a field)
    if (!_justCreatedField) deselectAll();
    _lastTap = now;
    _lastTapX = cx;
    _lastTapY = cy;
  }
});

// dblclick is intentionally not used here — the pointerdown double-tap handler
// above covers both desktop and mobile without the double-creation race condition.

// ─── Snap guides ──────────────────────────────────────────────────────────────

const GUIDE_POSITIONS = [1 / 3, 1 / 2, 2 / 3];
// Hysteresis thresholds (as fraction of image dimension)
const SNAP_IN  = 0.021; // snap when raw position comes within this distance
const SNAP_OUT = 0.038; // unsnap when dragged this far past the guide
const ROTATE_SNAP_GUIDES = [0, 45, 90, 135, 180, 225, 270, 315];
const ROTATE_SNAP_IN_DEG = 4;
const ROTATE_SNAP_OUT_DEG = 9;

const guideVEls = []; // vertical lines (x positions)
const guideHEls = []; // horizontal lines (y positions)
let rotateGuideVEl = null;
let rotateGuideHEl = null;
let rotateGuideD1El = null;
let rotateGuideD2El = null;

function initGuides() {
  GUIDE_POSITIONS.forEach(p => {
    const v = document.createElement('div');
    v.className = 'guide guide-v';
    v.style.left = (p * 100) + '%';
    canvasContainer.appendChild(v);
    guideVEls.push(v);

    const h = document.createElement('div');
    h.className = 'guide guide-h';
    h.style.top = (p * 100) + '%';
    canvasContainer.appendChild(h);
    guideHEls.push(h);
  });

  rotateGuideVEl = document.createElement('div');
  rotateGuideVEl.className = 'guide guide-rotate guide-rotate-v';
  canvasContainer.appendChild(rotateGuideVEl);

  rotateGuideHEl = document.createElement('div');
  rotateGuideHEl.className = 'guide guide-rotate guide-rotate-h';
  canvasContainer.appendChild(rotateGuideHEl);

  rotateGuideD1El = document.createElement('div');
  rotateGuideD1El.className = 'guide guide-rotate guide-rotate-d1';
  canvasContainer.appendChild(rotateGuideD1El);

  rotateGuideD2El = document.createElement('div');
  rotateGuideD2El.className = 'guide guide-rotate guide-rotate-d2';
  canvasContainer.appendChild(rotateGuideD2El);
}

// Show or hide all guide lines, highlighting whichever axes are snapped.
// snapX / snapY are the currently snapped guide values (or null).
function showGuides(visible, snapX = null, snapY = null) {
  GUIDE_POSITIONS.forEach((p, i) => {
    guideVEls[i].classList.toggle('visible', visible);
    guideHEls[i].classList.toggle('visible', visible);
    guideVEls[i].classList.toggle('snapped', visible && snapX === p);
    guideHEls[i].classList.toggle('snapped', visible && snapY === p);
  });
}

function showRotateGuides(visible, centerXPct = 0.5, centerYPct = 0.5, snapAxis = null) {
  if (!rotateGuideVEl || !rotateGuideHEl || !rotateGuideD1El || !rotateGuideD2El) return;
  const left = `${centerXPct * 100}%`;
  const top = `${centerYPct * 100}%`;
  rotateGuideVEl.style.left = left;
  rotateGuideHEl.style.top = top;
  rotateGuideD1El.style.left = left;
  rotateGuideD2El.style.left = left;
  rotateGuideD1El.style.top = top;
  rotateGuideD2El.style.top = top;
  rotateGuideVEl.classList.toggle('visible', visible);
  rotateGuideHEl.classList.toggle('visible', visible);
  rotateGuideD1El.classList.toggle('visible', visible);
  rotateGuideD2El.classList.toggle('visible', visible);
  rotateGuideVEl.classList.toggle('snapped', visible && snapAxis === 'y');
  rotateGuideHEl.classList.toggle('snapped', visible && snapAxis === 'x');
  rotateGuideD1El.classList.toggle('snapped', visible && snapAxis === 'd1');
  rotateGuideD2El.classList.toggle('snapped', visible && snapAxis === 'd2');
}

// Apply sticky snapping to one axis.
// raw: the raw 0–1 position; currentSnap: the guide we're currently locked to (or null).
// Returns { pos, snap } — the snapped position and new snap state.
function snapAxis(raw, currentSnap) {
  // Hysteresis: harder to leave a snapped guide than to enter one
  if (currentSnap !== null && Math.abs(raw - currentSnap) > SNAP_OUT) {
    currentSnap = null;
  }
  if (currentSnap === null) {
    for (const g of GUIDE_POSITIONS) {
      if (Math.abs(raw - g) < SNAP_IN) {
        currentSnap = g;
        break;
      }
    }
  }
  return { pos: currentSnap !== null ? currentSnap : raw, snap: currentSnap };
}

function getNearestRotationGuide(rawDeg, targetDeg) {
  const turns = Math.round((rawDeg - targetDeg) / 360);
  return targetDeg + turns * 360;
}

function snapRotationDeg(rawDeg, currentSnapDeg) {
  if (currentSnapDeg !== null && Math.abs(rawDeg - currentSnapDeg) > ROTATE_SNAP_OUT_DEG) {
    currentSnapDeg = null;
  }
  if (currentSnapDeg === null) {
    let best = null;
    let bestDist = Infinity;
    for (const target of ROTATE_SNAP_GUIDES) {
      const candidate = getNearestRotationGuide(rawDeg, target);
      const dist = Math.abs(rawDeg - candidate);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    if (best !== null && bestDist <= ROTATE_SNAP_IN_DEG) {
      currentSnapDeg = best;
    }
  }
  return { deg: currentSnapDeg !== null ? currentSnapDeg : rawDeg, snap: currentSnapDeg };
}

function normalizeDeg0To360(deg) {
  let v = deg % 360;
  if (v < 0) v += 360;
  return v;
}

function getRotationSnapAxis(snapDeg) {
  if (snapDeg === null || snapDeg === undefined) return null;
  const normalized = normalizeDeg0To360(snapDeg);
  const snappedIndex = Math.round(normalized / 45) % 8;
  if (snappedIndex === 0 || snappedIndex === 4) return 'x';   // 0, 180
  if (snappedIndex === 2 || snappedIndex === 6) return 'y';   // 90, 270
  if (snappedIndex === 1 || snappedIndex === 5) return 'd1';  // 45, 225
  return 'd2'; // 135, 315
}

// ─── Drag to move ─────────────────────────────────────────────────────────────

function startDrag(e, tf, opts = {}) {
  const focusOnClick = !!opts.focusOnClick;
  const startX   = e.clientX;
  const startY   = e.clientY;
  const origXPct = tf.xPct;
  const origYPct = tf.yPct;
  let dragging = false;
  const DRAG_THRESH = 6;

  // Per-drag snap state: which guide (if any) each axis is currently locked to
  let snapX = null;
  let snapY = null;

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESH) return;
    if (!dragging) tf.el.classList.add('dragging');
    // Prevent the page from scrolling while the user is dragging a field.
    // Only called after the threshold so accidental touches still scroll normally.
    ev.preventDefault();
    dragging = true;

    const cw = canvasContainer.offsetWidth;
    const ch = canvasContainer.offsetHeight;

    const rawX = Math.max(0, Math.min(1, origXPct + dx / cw));
    const rawY = Math.max(0, Math.min(1, origYPct + dy / ch));

    ({ pos: tf.xPct, snap: snapX } = snapAxis(rawX, snapX));
    ({ pos: tf.yPct, snap: snapY } = snapAxis(rawY, snapY));

    tf.repositionFast?.();
    if (state.selectedObject === tf) syncSizeControlBoundsForObject(tf);
    showGuides(true, snapX, snapY);
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    showGuides(false);
    snapX = null;
    snapY = null;
    tf.el.classList.remove('dragging');
    if (dragging) {
      tf.innerEl?.blur?.();
    } else if (focusOnClick) {
      tf.innerEl?.focus?.();
    }
  }

  // { passive: false } is required to allow preventDefault() inside onMove;
  // browsers mark touch listeners passive by default which blocks preventDefault.
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function getObjectSizeBounds(obj = state.selectedObject, opts = {}) {
  const keepCurrent = opts.keepCurrent !== false;
  const min = DEFAULT_SIZE_MIN;
  if (!obj || obj.type !== 'image') {
    return { min, max: DEFAULT_SIZE_MAX };
  }

  const objectAspect = Math.max(0.01, obj.aspect || 1); // width / height
  const baseAspect = Math.max(
    0.01,
    state.imageNaturalW > 0 && state.imageNaturalH > 0
      ? (state.imageNaturalW / state.imageNaturalH)
      : ((canvasContainer.offsetWidth || 1) / Math.max(1, canvasContainer.offsetHeight || 1))
  );

  // Size is width % of base image width. Keep max independent of object
  // placement; cap by whichever base-image dimension fills first.
  const maxByWidthPct = 100;
  const maxByHeightPct = (100 * objectAspect) / baseAspect;
  const strictMaxPct = Math.max(min, Math.min(maxByWidthPct, maxByHeightPct));

  if (!keepCurrent) return { min, max: strictMaxPct };
  const currentSize = Number.isFinite(obj.style?.size) ? obj.style.size : min;
  return { min, max: Math.max(strictMaxPct, currentSize) };
}

function syncSizeControlBoundsForObject(obj = state.selectedObject) {
  const bounds = getObjectSizeBounds(obj);
  if (ctrlSize) {
    ctrlSize.min = String(bounds.min);
    ctrlSize.max = String(bounds.max);
  }
  return bounds;
}

function startRotate(e, tf) {
  const rect = canvasContainer.getBoundingClientRect();
  const centerX = rect.left + tf.xPct * canvasContainer.offsetWidth;
  const centerY = rect.top + tf.yPct * canvasContainer.offsetHeight;
  const origDeg = tf.style.rotateDeg || 0;
  const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
  tf.el.classList.add('rotating');
  let snapDeg = null;
  showRotateGuides(true, tf.xPct, tf.yPct, null);

  const angleDeltaDeg = (from, to) => {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d * (180 / Math.PI);
  };

  function onMove(ev) {
    ev.preventDefault();
    const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
    const deltaDeg = angleDeltaDeg(startAngle, angle);
    const rawDeg = origDeg + deltaDeg;
    ({ deg: tf.style.rotateDeg, snap: snapDeg } = snapRotationDeg(rawDeg, snapDeg));
    tf.repositionFast?.();
    tf.rotateEl.classList.toggle('snapped', snapDeg !== null);
    showRotateGuides(true, tf.xPct, tf.yPct, getRotationSnapAxis(snapDeg));
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    tf.el.classList.remove('rotating');
    tf.rotateEl.classList.remove('snapped');
    showRotateGuides(false);
  }

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function startResize(e, tf) {
  const rect = canvasContainer.getBoundingClientRect();
  const centerX = rect.left + tf.xPct * canvasContainer.offsetWidth;
  const centerY = rect.top + tf.yPct * canvasContainer.offsetHeight;
  const startDist = Math.max(1, Math.hypot(e.clientX - centerX, e.clientY - centerY));
  const origSize = tf.style.size || 5;
  const { min: minSize, max: maxSize } = getObjectSizeBounds(tf, { keepCurrent: false });
  tf.el.classList.add('resizing');

  function onMove(ev) {
    ev.preventDefault();
    const dist = Math.max(1, Math.hypot(ev.clientX - centerX, ev.clientY - centerY));
    const rawSize = origSize * (dist / startDist);
    const size = Math.max(minSize, Math.min(maxSize, rawSize));
    tf.updateStyle({ size });
    if (ctrlSize) ctrlSize.value = String(size);
    if (ctrlSizeVal) ctrlSizeVal.textContent = `${size}%`;
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    tf.el.classList.remove('resizing');
  }

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

// ─── Panel / controls ─────────────────────────────────────────────────────────

function getSelectedTextObject() {
  const obj = state.selectedObject;
  return obj && obj.type === 'text' ? obj : null;
}

function setTextControlsDisabled(disabled) {
  const textControlElements = [
    ctrlFont,
    ctrlLineHeight,
    ctrlBold,
    ctrlItalic,
    ctrlFgColor,
    ctrlOutlineColor,
    ctrlOutlineWidth,
    ...alignBtns,
    ...presetBtns,
  ];
  textControlElements.forEach((el) => {
    if (!el) return;
    el.disabled = disabled;
  });
}

function updatePanel() {
  const selectedText = getSelectedTextObject();
  const nonTextSelected = !!state.selectedObject && !selectedText;
  syncSizeControlBoundsForObject();
  setTextControlsDisabled(nonTextSelected);
  if (ctrlAutoContrast) {
    ctrlAutoContrast.disabled = !selectedText;
    ctrlAutoContrast.title = selectedText
      ? 'Cycle auto-contrast colors for the selected text field'
      : 'Select a text field first';
  }
}

function syncObjectControlsToStyle(s) {
  if (ctrlBlur) ctrlBlur.value = s.blur ?? 0;
  if (ctrlGlow) ctrlGlow.value = s.glow ?? 0;
  if (ctrlOpacity) ctrlOpacity.value = clampObjectOpacity(s.opacity ?? 1);
  if (ctrlBgEnabled) ctrlBgEnabled.checked = !!s.bgColor;
  if (ctrlBgColor) {
    if (s.bgColor) ctrlBgColor.value = s.bgColor;
    ctrlBgColor.disabled = !s.bgColor;
  }
}

function syncTextControlsToStyle(s, activePreset) {
  ctrlFont.value                  = s.font;
  syncFontSelectDisplay();
  ctrlSize.value                  = s.size;
  ctrlSizeVal.textContent         = s.size + '%';
  ctrlLineHeight.value            = s.lineHeight ?? 1.2;
  ctrlLineHeightVal.textContent   = (s.lineHeight ?? 1.2).toFixed(2);
  ctrlBold.classList.toggle('active', parseInt(s.weight) >= 700);
  ctrlItalic.classList.toggle('active', s.italic);
  ctrlFgColor.value               = s.fgColor;
  ctrlOutlineColor.value          = s.outlineColor;
  ctrlOutlineWidth.value          = s.outlineWidth;
  ctrlOutlineWidthVal.textContent = s.outlineWidth;
  alignBtns.forEach(b => b.classList.toggle('active', b.dataset.align === s.align));
  presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === activePreset));
}

function loadFieldStyle(tf) {
  const { min: minSize, max: maxSize } = syncSizeControlBoundsForObject(tf);
  syncObjectControlsToStyle(tf.style || {});
  if (ctrlSize && typeof tf?.style?.size === 'number') {
    const size = Math.max(minSize, Math.min(maxSize, tf.style.size));
    ctrlSize.value = String(size);
    if (ctrlSizeVal) ctrlSizeVal.textContent = `${size}%`;
  }
  if (tf.type === 'text') {
    syncTextControlsToStyle(tf.style, tf.activePreset);
  }
}

function applyObjectControlsToSelected(patch) {
  if (!state.selectedObject) {
    const base = state.lastStyle ?? { ...PRESETS.classic, blur: 0, glow: 0, opacity: 1, bgColor: null };
    state.lastStyle = { ...base, ...patch };
    return;
  }
  state.selectedObject.updateStyle(patch);
  if (state.selectedObject.type === 'text') {
    state.lastStyle = { ...state.selectedObject.style };
  }
}

function applyControlsToSelected(patch) {
  if (!state.selectedObject) {
    // No field selected — accumulate changes into lastStyle so the next
    // new field picks them up instead of reverting to Classic defaults.
    const base = state.lastStyle ?? { ...PRESETS.classic, blur: 0, glow: 0, opacity: 1, bgColor: null };
    state.lastStyle = { ...base, ...patch };
    return;
  }
  const selectedText = getSelectedTextObject();
  if (!selectedText) return;
  selectedText.updateStyle(patch);
  state.lastStyle = { ...state.selectedObject.style };
}

// Clear the active preset indicator when the user manually edits any control.
function clearPreset() {
  if (state.selectedObject) state.selectedObject.activePreset = null;
  state.lastPreset = null;
  presetBtns.forEach(b => b.classList.remove('active'));
}

let _contrastCanvas = null;
let _contrastCtx = null;

function getContrastCanvas(w, h) {
  if (!_contrastCanvas) {
    _contrastCanvas = document.createElement('canvas');
    _contrastCtx = _contrastCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (_contrastCanvas.width !== w || _contrastCanvas.height !== h) {
    _contrastCanvas.width = w;
    _contrastCanvas.height = h;
  }
  return _contrastCtx;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1/3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1/3);
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(v => {
    const n = Math.max(0, Math.min(255, Math.round(v)));
    return n.toString(16).padStart(2, '0');
  }).join('')}`;
}

function resolveFontFamilyStack(fontFamily) {
  const m = /^\s*var\((--[^),\s]+)\)\s*$/.exec(fontFamily || '');
  if (!m) return fontFamily;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return resolved || fontFamily;
}

function renderFilteredPreviewToContrastCanvas() {
  const w = baseImage.offsetWidth || 0;
  const h = baseImage.offsetHeight || 0;
  if (!w || !h) return { ctx: null, w: 0, h: 0 };

  const ctx = getContrastCanvas(w, h);
  const t = state.filter.intensity / 100;
  const name = state.filter.name;
  ctx.clearRect(0, 0, w, h);

  ctx.filter = 'none';
  drawBaseAndPaintToContext(ctx, w, h);
  ctx.filter = 'none';

  if (name !== 'none') {
    const px = ctx.getImageData(0, 0, w, h);
    FILTERS[name].apply(px.data, w, h, t, state.filter.params);
    ctx.putImageData(px, 0, 0);
  }
  return { ctx, w, h };
}

function sampleFieldBackgroundLuma(tf, ctx, w, h) {
  if (!ctx || !w || !h) return 128;

  const containerRect = canvasContainer.getBoundingClientRect();
  const imgRect = baseImage.getBoundingClientRect();
  const imgOffsetX = imgRect.left - containerRect.left;
  const imgOffsetY = imgRect.top - containerRect.top;

  const cx = tf.xPct * canvasContainer.offsetWidth  - imgOffsetX;
  const cy = tf.yPct * canvasContainer.offsetHeight - imgOffsetY;
  const sampleW = Math.max(20, Math.min(w, Math.round(tf.innerEl.offsetWidth * 0.86)));
  const sampleH = Math.max(16, Math.min(h, Math.round(tf.innerEl.offsetHeight * 0.8)));
  const sx = Math.max(0, Math.min(w - sampleW, Math.round(cx - sampleW / 2)));
  const sy = Math.max(0, Math.min(h - sampleH, Math.round(cy - sampleH / 2)));
  const data = ctx.getImageData(sx, sy, sampleW, sampleH).data;

  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return sum / (data.length / 4);
}

function sampleImagePalette(ctx, w, h) {
  if (!ctx || !w || !h) return { h: 0.08, s: 0.35, l: 0.5 };
  const step = Math.max(4, Math.floor(Math.max(w, h) / 120));
  const px = ctx.getImageData(0, 0, w, h).data;
  let sumSin = 0;
  let sumCos = 0;
  let sumS = 0;
  let sumL = 0;
  let count = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const a = px[i + 3];
      if (a < 8) continue;
      const { h: hh, s, l } = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      const hueWeight = 0.2 + s;
      const ang = hh * Math.PI * 2;
      sumSin += Math.sin(ang) * hueWeight;
      sumCos += Math.cos(ang) * hueWeight;
      sumS += s;
      sumL += l;
      count++;
    }
  }
  if (!count) return { h: 0.08, s: 0.35, l: 0.5 };
  let hAvg = Math.atan2(sumSin, sumCos) / (Math.PI * 2);
  if (hAvg < 0) hAvg += 1;
  return {
    h: hAvg,
    s: Math.max(0, Math.min(1, sumS / count)),
    l: Math.max(0, Math.min(1, sumL / count)),
  };
}

function makePaletteContrastPair(bgLuma, palette, stepIndex) {
  const variant = stepIndex % 6;
  const hueOffsets = [0, 0.06, -0.06, 0.12, -0.12, 0.5];
  const hue = (palette.h + hueOffsets[variant] + 1) % 1;
  const sat = Math.max(0.18, Math.min(0.72, palette.s * 0.82 + 0.18));
  const darkBg = bgLuma < 150;

  let fgL = darkBg ? 0.9 : 0.16;
  let outL = darkBg ? 0.14 : 0.9;
  if (variant === 1) { fgL += darkBg ? -0.05 : 0.05; outL += darkBg ? 0.06 : -0.06; }
  if (variant === 2) { fgL += darkBg ? -0.08 : 0.08; outL += darkBg ? 0.02 : -0.02; }
  if (variant === 3) { fgL += darkBg ? -0.02 : 0.03; outL += darkBg ? 0.08 : -0.08; }
  if (variant === 4) { fgL += darkBg ? -0.1 : 0.1; outL += darkBg ? 0.1 : -0.1; }
  if (variant === 5) { fgL += darkBg ? -0.03 : 0.03; outL += darkBg ? 0.05 : -0.05; }
  fgL = Math.max(0.08, Math.min(0.95, fgL));
  outL = Math.max(0.05, Math.min(0.96, outL));

  const fgRgb = hslToRgb(hue, sat, fgL);
  const outHue = (hue + (variant === 5 ? 0 : 0.5)) % 1;
  const outSat = Math.max(0.04, sat * 0.45);
  const outRgb = hslToRgb(outHue, outSat, outL);

  return {
    fgColor: rgbToHex(fgRgb.r, fgRgb.g, fgRgb.b),
    outlineColor: rgbToHex(outRgb.r, outRgb.g, outRgb.b),
  };
}

function applyAutoContrastToSelected() {
  const tf = getSelectedTextObject();
  if (!tf) return;

  const rendered = renderFilteredPreviewToContrastCanvas();
  const bgLuma = sampleFieldBackgroundLuma(tf, rendered.ctx, rendered.w, rendered.h);
  const palette = sampleImagePalette(rendered.ctx, rendered.w, rendered.h);
  const step = tf.autoContrastStep || 0;
  const pair = step === 0
    ? (bgLuma >= 150
      ? { fgColor: '#1a1410', outlineColor: '#f5f0e8' }
      : { fgColor: '#ffffff', outlineColor: '#000000' })
    : makePaletteContrastPair(bgLuma, palette, step - 1);
  const fgColor = pair.fgColor;
  const outlineColor = pair.outlineColor;
  const outlineWidth = Math.max(2, tf.style.outlineWidth || 0);

  applyControlsToSelected({ fgColor, outlineColor, outlineWidth });
  ctrlFgColor.value = fgColor;
  ctrlOutlineColor.value = outlineColor;
  ctrlOutlineWidth.value = outlineWidth;
  ctrlOutlineWidthVal.textContent = outlineWidth;
  tf.autoContrastStep = step + 1;
  clearPreset();
}

function closeFontMenu() {
  if (!ctrlFontWrap) return;
  ctrlFontWrap.classList.remove('open');
  if (ctrlFontTrigger) ctrlFontTrigger.setAttribute('aria-expanded', 'false');
}

function openFontMenu() {
  if (!ctrlFontWrap) return;
  ctrlFontWrap.classList.add('open');
  if (ctrlFontTrigger) ctrlFontTrigger.setAttribute('aria-expanded', 'true');
}

function toggleFontMenu() {
  if (!ctrlFontWrap) return;
  if (ctrlFontWrap.classList.contains('open')) closeFontMenu();
  else openFontMenu();
}

function buildFontDropdown() {
  if (!ctrlFontWrap || !ctrlFontMenu || !ctrlFontTrigger) return;
  ctrlFontMenu.innerHTML = '';
  Array.from(ctrlFont.options).forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'font-select-option';
    btn.role = 'option';
    btn.dataset.value = opt.value;
    btn.textContent = opt.textContent;
    btn.style.fontFamily = opt.value;
    btn.addEventListener('click', () => {
      ctrlFont.value = opt.value;
      ctrlFont.dispatchEvent(new Event('change', { bubbles: true }));
      closeFontMenu();
    });
    ctrlFontMenu.appendChild(btn);
  });

  ctrlFontTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFontMenu();
  });

  ctrlFontTrigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFontMenu();
      const active = ctrlFontMenu.querySelector('.font-select-option.active') || ctrlFontMenu.firstElementChild;
      active?.focus();
    }
  });

  ctrlFontMenu.addEventListener('keydown', (e) => {
    const items = Array.from(ctrlFontMenu.querySelectorAll('.font-select-option'));
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFontMenu();
      ctrlFontTrigger.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[(currentIndex + 1 + items.length) % items.length];
      next.focus();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      prev.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!ctrlFontWrap.contains(e.target)) closeFontMenu();
  });
}

function syncFontSelectDisplay() {
  ctrlFont.style.fontFamily = ctrlFont.value;
  const selectedOption = ctrlFont.options[ctrlFont.selectedIndex];
  if (ctrlFontLabel) {
    ctrlFontLabel.textContent = selectedOption?.textContent || 'Typeface';
    ctrlFontLabel.style.fontFamily = ctrlFont.value;
  }
  if (ctrlFontMenu) {
    ctrlFontMenu.querySelectorAll('.font-select-option').forEach((el) => {
      const isActive = el.dataset.value === ctrlFont.value;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }
}

// ─── Mobile panel tabs ────────────────────────────────────────────────────────

function switchPanelTab(tabName) {
  bottomPanel.dataset.panel = tabName;
  panelTabBtns.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  syncPaintInteractivity();

  // Ensure horizontally scrollable chip rows always start flush-left when
  // their section is shown, avoiding browser-restored mid-scroll clipping.
  const resetChipScroll = () => {
    const scrollerSelector =
      tabName === 'typography' ? '.preset-chips'
      : tabName === 'vibe' ? '.vibe-chips'
      : null;
    if (!scrollerSelector) return;
    const scroller = document.querySelector(scrollerSelector);
    if (!scroller) return;
    scroller.scrollLeft = 0;
    requestAnimationFrame(() => {
      scroller.scrollLeft = 0;
    });
  };
  requestAnimationFrame(resetChipScroll);

  requestAnimationFrame(() => {
    if (state.imageLoaded) {
      fitImageToWrapper();
    }
  });
}

function setSidebarSectionCollapsed(sectionEl, collapsed) {
  if (!sectionEl) return;
  sectionEl.classList.toggle('is-collapsed', collapsed);
  const toggle = sectionEl.querySelector('.section-heading-toggle');
  const body = sectionEl.querySelector('.panel-section-body');
  if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (body) body.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
}

function initSidebarSectionToggles() {
  sidebarSectionToggles.forEach((toggle) => {
    const section = toggle.closest('.panel-section');
    if (section) setSidebarSectionCollapsed(section, section.classList.contains('is-collapsed'));
    toggle.addEventListener('click', () => {
      const root = toggle.closest('.panel-section');
      if (!root) return;
      setSidebarSectionCollapsed(root, !root.classList.contains('is-collapsed'));
    });
  });
}

panelTabBtns.forEach(tab => {
  tab.addEventListener('click', () => switchPanelTab(tab.dataset.tab));
});

if (ctrlPaintColor) {
  ctrlPaintColor.addEventListener('input', () => {
    state.paint.color = ctrlPaintColor.value || '#ff3b30';
    syncPaintControls();
  });
}

if (ctrlPaintSize) {
  ctrlPaintSize.addEventListener('input', () => {
    const size = Math.max(1, Math.min(64, parseInt(ctrlPaintSize.value || '8', 10) || 8));
    state.paint.size = size;
    syncPaintControls();
  });
}

paintToggleBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    // One-shot behavior: arm drawing until the current stroke ends.
    state.paint.enabled = true;
    syncPaintControls();
    syncPaintInteractivity();
    deselectAll();
  });
});

if (paintLayer) {
  paintLayer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !isPaintInteractive()) return;
    e.preventDefault();
    e.stopPropagation();
    deselectAll();
    const { x, y } = getPaintPointFromEvent(e);
    _paintDrawing = true;
    _paintPointerId = e.pointerId;
    _paintLastX = x;
    _paintLastY = y;
    _paintMinX = x;
    _paintMinY = y;
    _paintMaxX = x;
    _paintMaxY = y;
    try {
      paintLayer.setPointerCapture(e.pointerId);
    } catch {}
    paintLineTo(x, y);
    state.paint.hasStrokes = true;
    markPreviewSourceDirty();
    scheduleImageFilterRender({ interactive: true });
  });

  paintLayer.addEventListener('pointermove', (e) => {
    if (!_paintDrawing || e.pointerId !== _paintPointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = getPaintPointFromEvent(e);
    paintLineTo(x, y);
    markPreviewSourceDirty();
    scheduleImageFilterRender({ interactive: true });
  });

  const finishStroke = async (e) => {
    if (!_paintDrawing || e.pointerId !== _paintPointerId) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      paintLayer.releasePointerCapture(e.pointerId);
    } catch {}
    await endPaintStroke();
  };

  paintLayer.addEventListener('pointerup', finishStroke);
  paintLayer.addEventListener('pointercancel', finishStroke);
}

// ─── Control listeners ────────────────────────────────────────────────────────

ctrlFont.addEventListener('change', () => {
  applyControlsToSelected({ font: ctrlFont.value });
  syncFontSelectDisplay();
  clearPreset();
});

ctrlSize.addEventListener('input', () => {
  const v = parseFloat(ctrlSize.value);
  ctrlSizeVal.textContent = v + '%';
  applyObjectControlsToSelected({ size: v });
  clearPreset();
});

ctrlLineHeight.addEventListener('input', () => {
  const v = parseFloat(ctrlLineHeight.value);
  ctrlLineHeightVal.textContent = v.toFixed(2);
  applyControlsToSelected({ lineHeight: v });
  clearPreset();
});

ctrlBold.addEventListener('click', () => {
  const isNowBold = !ctrlBold.classList.contains('active');
  ctrlBold.classList.toggle('active', isNowBold);
  applyControlsToSelected({ weight: isNowBold ? '700' : '400' });
  clearPreset();
});

ctrlItalic.addEventListener('click', () => {
  const isNowItalic = !ctrlItalic.classList.contains('active');
  ctrlItalic.classList.toggle('active', isNowItalic);
  applyControlsToSelected({ italic: isNowItalic });
  clearPreset();
});

ctrlBlur.addEventListener('input', () => {
  applyObjectControlsToSelected({ blur: parseFloat(ctrlBlur.value) });
  clearPreset();
});

if (ctrlGlow) {
  ctrlGlow.addEventListener('input', () => {
    applyObjectControlsToSelected({ glow: parseFloat(ctrlGlow.value) });
    clearPreset();
  });
}

if (ctrlOpacity) {
  ctrlOpacity.addEventListener('input', () => {
    applyObjectControlsToSelected({ opacity: clampObjectOpacity(parseFloat(ctrlOpacity.value)) });
    clearPreset();
  });
}

if (ctrlBgColor) {
  ctrlBgColor.addEventListener('input', () => {
    if (ctrlBgEnabled && !ctrlBgEnabled.checked) ctrlBgEnabled.checked = true;
    applyObjectControlsToSelected({ bgColor: ctrlBgColor.value });
    clearPreset();
  });
}

if (ctrlBgEnabled) {
  ctrlBgEnabled.addEventListener('change', () => {
    if (ctrlBgColor) ctrlBgColor.disabled = !ctrlBgEnabled.checked;
    applyObjectControlsToSelected({
      bgColor: ctrlBgEnabled.checked ? ctrlBgColor?.value || '#ffffff' : null,
    });
    clearPreset();
  });
}

// ─── Image filter controls ─────────────────────────────────────────────────────

const filterChips          = document.querySelectorAll('.vibe-chip');
const filterIntensityRow   = document.getElementById('filter-intensity-row');
const filterIntensityLabel = document.getElementById('filter-intensity-label');
const filterLayerRow       = document.getElementById('filter-layer-row');
const ctrlFilterIntensity  = document.getElementById('ctrl-filter-intensity');
const ctrlFilterOnTop      = document.getElementById('ctrl-filter-on-top');
const filterFilmControls   = document.getElementById('filter-film-controls');
const filterDitherControls = document.getElementById('filter-dithering-controls');
const filterVaporControls  = document.getElementById('filter-vaporwave-controls');
const filterDarkAcadControls = document.getElementById('filter-darkacademia-controls');
const filterSolarpunkControls = document.getElementById('filter-solarpunk-controls');
const filterHegsethControls = document.getElementById('filter-hegseth-controls');
const filterHyperpopControls = document.getElementById('filter-hyperpop-controls');
const filterPixelArtControls = document.getElementById('filter-pixelart-controls');
const ctrlGrain            = document.getElementById('ctrl-grain');
const ctrlDitherMono       = document.getElementById('ctrl-dither-mono');
const ctrlScanlines        = document.getElementById('ctrl-scanlines');
const ctrlScanlineSize     = document.getElementById('ctrl-scanline-size');
const ctrlChroma           = document.getElementById('ctrl-chroma');
const ctrlDaGrain          = document.getElementById('ctrl-da-grain');
const ctrlVignette         = document.getElementById('ctrl-vignette');
const ctrlBloom            = document.getElementById('ctrl-bloom');
const ctrlHaze             = document.getElementById('ctrl-haze');
const ctrlHegsethAngle     = document.getElementById('ctrl-hegseth-angle');
const ctrlHegsethGhostDistance = document.getElementById('ctrl-hegseth-ghost-distance');
const ctrlHyperpopAngle    = document.getElementById('ctrl-hyperpop-angle');
const ctrlPixelBits        = document.getElementById('ctrl-pixel-bits');
const FILTER_INTENSITY_LABELS = {
  hegseth: 'Beers',
  pixelArt: 'Style',
};
const FILTER_EXTRA_CONTROL_PANELS = {
  film: filterFilmControls,
  dithering: filterDitherControls,
  vaporwave: filterVaporControls,
  darkAcademia: filterDarkAcadControls,
  solarpunk: filterSolarpunkControls,
  hegseth: filterHegsethControls,
  hyperpop: filterHyperpopControls,
  pixelArt: filterPixelArtControls,
};
const FILTER_PARAM_CONTROLS = {
  film: [{ key: 'grain', el: ctrlGrain }],
  dithering: [{ key: 'mono', el: ctrlDitherMono }],
  vaporwave: [
    { key: 'scanlines', el: ctrlScanlines },
    { key: 'scanlineSize', el: ctrlScanlineSize },
    { key: 'chroma', el: ctrlChroma },
  ],
  darkAcademia: [
    { key: 'grain', el: ctrlDaGrain },
    { key: 'vignette', el: ctrlVignette },
  ],
  solarpunk: [
    { key: 'bloom', el: ctrlBloom },
    { key: 'haze', el: ctrlHaze },
  ],
  hegseth: [
    { key: 'angle', el: ctrlHegsethAngle },
    { key: 'ghostDistance', el: ctrlHegsethGhostDistance },
  ],
  hyperpop: [{ key: 'angle', el: ctrlHyperpopAngle }],
  pixelArt: [{ key: 'bits', el: ctrlPixelBits }],
};

// ── Vibe preview overlays ──────────────────────────────────────────────────────
// Film: random grain canvas  (mix-blend-mode: overlay)
// Vaporwave/Solarpunk: full pixel render canvas (exact export pipeline at preview res)
// These effects can't be replicated with CSS filters alone.

let grainEl    = null;
let scanlineEl = null;
let chromaEl   = null;
let vignetteEl = null;
let solarpunkEl = null;
let hegsethEl = null;
let mexicoEl = null;
let finalPreviewEl = null;
let gpuPreviewEl = null;
let vaporSrcCanvas = null;
let vaporSrcCtx    = null;
let grainBuffer    = null;
let grainBufferW   = 0;
let grainBufferH   = 0;
let grainNoiseTs   = 0;
const GPU_PREVIEW_FILTERS = new Set(['vaporwave', 'hegseth', 'pixelArt', 'hyperpop', 'swirl']);
const gpuPreview = {
  gl: null,
  program: null,
  posBuffer: null,
  tex: null,
  loc: null,
  ready: false,
  failed: false,
};

const previewGpuSourceCache = {
  dirty: true,
  w: 0,
  h: 0,
  key: '',
};

const previewPixelSourceCache = {
  dirty: true,
  w: 0,
  h: 0,
  key: '',
  data: null,
};

function resetPreviewSourceCaches() {
  previewGpuSourceCache.w = 0;
  previewGpuSourceCache.h = 0;
  previewGpuSourceCache.key = '';
  previewGpuSourceCache.dirty = true;
  previewPixelSourceCache.data = null;
  previewPixelSourceCache.w = 0;
  previewPixelSourceCache.h = 0;
  previewPixelSourceCache.key = '';
  previewPixelSourceCache.dirty = true;
}

function collapseCanvasSurface(el) {
  if (!el) return;
  el.style.display = 'none';
  if (el.width > 1) el.width = 1;
  if (el.height > 1) el.height = 1;
}

function releaseBackgroundPreviewResources() {
  resetPreviewSourceCaches();
  collapseCanvasSurface(finalPreviewEl);
  collapseCanvasSurface(chromaEl);
  collapseCanvasSurface(solarpunkEl);
  collapseCanvasSurface(hegsethEl);
  collapseCanvasSurface(mexicoEl);
  collapseCanvasSurface(grainEl);
  collapseCanvasSurface(scanlineEl);
  collapseCanvasSurface(vignetteEl);
  collapseCanvasSurface(gpuPreviewEl);
  if (vaporSrcCanvas) {
    vaporSrcCanvas.width = 1;
    vaporSrcCanvas.height = 1;
  }
  if (_contrastCanvas) {
    _contrastCanvas.width = 1;
    _contrastCanvas.height = 1;
  }
  if (gpuPreview.gl) {
    try {
      const loseCtx = gpuPreview.gl.getExtension('WEBGL_lose_context');
      loseCtx?.loseContext();
    } catch {}
  }
  gpuPreview.gl = null;
  gpuPreview.program = null;
  gpuPreview.posBuffer = null;
  gpuPreview.tex = null;
  gpuPreview.loc = null;
  gpuPreview.ready = false;
  gpuPreview.failed = false;
  teardownFilterWorker();
}

function markPreviewSourceDirty() {
  previewGpuSourceCache.dirty = true;
  previewPixelSourceCache.dirty = true;
}

function makePreviewSourceCacheKey(w, h) {
  return `${w}x${h}|onTop:${state.filter.applyOnTop ? 1 : 0}`;
}

function ensureVaporSrcContext() {
  if (!vaporSrcCanvas) {
    vaporSrcCanvas = document.createElement('canvas');
    vaporSrcCtx = vaporSrcCanvas.getContext('2d', { willReadFrequently: true });
  } else if (!vaporSrcCtx) {
    vaporSrcCtx = vaporSrcCanvas.getContext('2d', { willReadFrequently: true });
  }
}

function makeOverlayCanvas() {
  const el = document.createElement('canvas');
  el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  baseImage.insertAdjacentElement('afterend', el);
  return el;
}

function updateOverlayLayering(el) {
  if (!el) return;
  el.style.zIndex = state.filter.applyOnTop ? '30' : '2';
}

function hideGpuPreviewOverlay() {
  if (gpuPreviewEl) gpuPreviewEl.style.display = 'none';
}

function canUseGpuPreview(name, quality) {
  return quality === 'interactive' && GPU_PREVIEW_FILTERS.has(name) && !gpuPreview.failed;
}

function createGpuShader(gl, type, src) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createGpuProgram(gl, vertexSrc, fragSrc) {
  const vs = createGpuShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = createGpuShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function ensureGpuPreviewContext() {
  if (gpuPreview.failed) return null;
  if (!gpuPreviewEl) gpuPreviewEl = makeOverlayCanvas();
  updateOverlayLayering(gpuPreviewEl);
  gpuPreviewEl.style.mixBlendMode = 'normal';
  if (!gpuPreview.gl) {
    const gl = gpuPreviewEl.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    }) || gpuPreviewEl.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      gpuPreview.failed = true;
      return null;
    }
    const vertexSrc = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = (a_pos + 1.0) * 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
    const fragSrc = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_filterType;
uniform float u_intensity;
uniform float u_chroma;
uniform float u_scanlines;
uniform float u_scanlineSize;
uniform float u_angle;
uniform vec2 u_lineDir;
uniform float u_ghostDistance;
uniform float u_bits;
uniform float u_pixelScale;

float sat(float x) { return clamp(x, 0.0, 1.0); }
float hash11(float p) {
  return fract(sin(p * 127.1 + 311.7) * 43758.5453123);
}
float bayer4(vec2 p) {
  float x = mod(p.x, 4.0);
  float y = mod(p.y, 4.0);
  if (y < 1.0) {
    if (x < 1.0) return 0.0 / 15.0;
    if (x < 2.0) return 8.0 / 15.0;
    if (x < 3.0) return 2.0 / 15.0;
    return 10.0 / 15.0;
  }
  if (y < 2.0) {
    if (x < 1.0) return 12.0 / 15.0;
    if (x < 2.0) return 4.0 / 15.0;
    if (x < 3.0) return 14.0 / 15.0;
    return 6.0 / 15.0;
  }
  if (y < 3.0) {
    if (x < 1.0) return 3.0 / 15.0;
    if (x < 2.0) return 11.0 / 15.0;
    if (x < 3.0) return 1.0 / 15.0;
    return 9.0 / 15.0;
  }
  if (x < 1.0) return 15.0 / 15.0;
  if (x < 2.0) return 7.0 / 15.0;
  if (x < 3.0) return 13.0 / 15.0;
  return 5.0 / 15.0;
}

vec3 applyVaporwave(vec2 uv) {
  vec4 src = texture2D(u_tex, uv);
  float t = u_intensity;
  float chromaShiftPx = 30.0 * (u_chroma / 100.0) * u_pixelScale;
  vec2 off = vec2(chromaShiftPx * u_texel.x, 0.0);
  float r = texture2D(u_tex, uv + off).r;
  float g = src.g;
  float b = texture2D(u_tex, uv - off).b;
  float lm = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  vec3 c = vec3(r, g, b);
  float satBoost = 1.0 + 1.1 * t;
  c = vec3(lm) + (c - vec3(lm)) * satBoost;
  float bright = lm;
  c += vec3(10.0 + bright * 30.0, -(28.0 - bright * 8.0), 42.0 - bright * 22.0) * (t / 255.0);
  float contrast = 1.0 + 0.3 * t;
  c = (c - vec3(0.5019608)) * contrast + vec3(0.5019608);
  float scanSize = max(1.0, u_scanlineSize * max(0.25, u_pixelScale));
  float lineOn = step(mod(gl_FragCoord.y, scanSize), 0.5);
  float scanDim = max(0.0, 1.0 - 0.35 * (u_scanlines / 100.0));
  float scan = mix(scanDim, 1.0, lineOn);
  return clamp(c * scan, 0.0, 1.0);
}

vec3 applyHegseth(vec2 uv) {
  float t = u_intensity;
  vec4 src = texture2D(u_tex, uv);
  float angleRad = radians(u_angle);
  vec2 dir = vec2(cos(angleRad), sin(angleRad));
  float distanceMul = 0.35 + 1.25 * (u_ghostDistance / 100.0);
  float shift1 = max(1.0, (2.0 + 14.0 * t) * distanceMul * u_pixelScale);
  float shift2 = max(2.0, (5.0 + 24.0 * t) * distanceMul * u_pixelScale);
  float wobble = sin((gl_FragCoord.y / max(0.0001, u_pixelScale)) * 0.08) * (2.3 * t * u_pixelScale);
  vec2 off1 = (dir * shift1 + vec2(wobble, 0.0)) * u_texel;
  vec2 off2 = (dir * shift2 + vec2(wobble * 0.5, 0.0)) * u_texel;
  vec3 base = (
    texture2D(u_tex, uv - vec2(u_texel.x, 0.0)).rgb +
    src.rgb +
    texture2D(u_tex, uv + vec2(u_texel.x, 0.0)).rgb
  ) / 3.0;
  vec3 g1 = (
    texture2D(u_tex, uv + off1).rgb +
    texture2D(u_tex, uv + off1 + vec2(sign(off1.x) * u_texel.x, 0.0)).rgb
  ) * 0.5;
  vec3 g2 = (
    texture2D(u_tex, uv - off2).rgb +
    texture2D(u_tex, uv - off2 - vec2(sign(off2.x) * u_texel.x, 0.0)).rgb
  ) * 0.5;
  float mainW = 0.58;
  float g1W = 0.24 + 0.16 * t;
  float g2W = 0.12 + 0.10 * t;
  vec3 mixed = (base * mainW + g1 * g1W + g2 * g2W) / (mainW + g1W + g2W);
  return mix(src.rgb, mixed, t);
}

vec3 applyPixelArt(vec2 uv) {
  float t = u_intensity;
  float bits = clamp(u_bits, 2.0, 8.0);
  float detail = bits / 8.0;
  float blockPx = max(1.0, (1.0 + (1.0 - detail) * 20.0) * max(1.0, u_pixelScale) * 0.6);
  vec2 blockUV = max(vec2(u_texel.x * blockPx, u_texel.y * blockPx), u_texel);
  vec2 snapped = floor(uv / blockUV) * blockUV + blockUV * 0.5;
  vec3 quant = texture2D(u_tex, snapped).rgb;

  float levelsHi = max(8.0, floor(12.0 + bits * 3.0));
  float levelsLo = max(4.0, floor(4.0 + bits * 0.75));
  float levels = max(3.0, floor(mix(levelsHi, levelsLo, pow(t, 0.9))));
  float qScale = levels - 1.0;
  quant = floor(quant * qScale + 0.5) / qScale;
  float qLm = dot(quant, vec3(0.299, 0.587, 0.114));

  float celLevels = mix(8.0, 3.0, pow(t, 0.8));
  float celLm = floor(qLm * celLevels + 0.5) / celLevels;
  quant = mix(quant, vec3(celLm), 0.06 + 0.38 * t);

  float styleHigh = smoothstep(0.78, 1.0, t);
  float satBoost = 1.0 + 0.95 * t;
  float contrast = 1.0 + 0.52 * t;
  quant = vec3(qLm) + (quant - vec3(qLm)) * satBoost;
  quant = (quant - vec3(0.5)) * contrast + vec3(0.5);

  float shadowW = max(0.0, (0.55 - qLm) / 0.55);
  float hiW = max(0.0, (qLm - 0.58) / 0.42);
  float midW = max(0.0, 1.0 - shadowW - hiW);
  float tintAmt = t * (1.0 - 0.32 * styleHigh);
  quant += vec3(
    (0.078 * hiW + 0.032 * midW - 0.028 * shadowW) * tintAmt,
    (0.028 * hiW + 0.016 * midW - 0.024 * shadowW) * tintAmt,
    (-0.01 * hiW + 0.024 * midW + 0.09 * shadowW) * tintAmt
  );
  float highContrast = 1.0 + 0.18 * styleHigh;
  quant = (quant - vec3(0.5)) * highContrast + vec3(0.5) - vec3(0.0314 * styleHigh);

  float gamePop = pow(styleHigh, 0.85);
  float lmNow = dot(quant, vec3(0.299, 0.587, 0.114));
  float vib = 1.0 + 0.42 * gamePop;
  quant = vec3(lmNow) + (quant - vec3(lmNow)) * vib;
  quant += vec3(
    (13.0 / 255.0 + 20.0 / 255.0 * hiW - 8.0 / 255.0 * shadowW) * gamePop,
    (5.0 / 255.0 + 10.0 / 255.0 * midW - 6.0 / 255.0 * shadowW) * gamePop,
    (9.0 / 255.0 + 14.0 / 255.0 * hiW + 12.0 / 255.0 * shadowW) * gamePop
  );

  vec2 stepUV = blockUV;
  float lm = qLm;
  float lmR = dot(texture2D(u_tex, clamp(snapped + vec2(stepUV.x, 0.0), vec2(0.0), vec2(1.0))).rgb, vec3(0.299, 0.587, 0.114));
  float lmL = dot(texture2D(u_tex, clamp(snapped - vec2(stepUV.x, 0.0), vec2(0.0), vec2(1.0))).rgb, vec3(0.299, 0.587, 0.114));
  float lmD = dot(texture2D(u_tex, clamp(snapped + vec2(0.0, stepUV.y), vec2(0.0), vec2(1.0))).rgb, vec3(0.299, 0.587, 0.114));
  float lmU = dot(texture2D(u_tex, clamp(snapped - vec2(0.0, stepUV.y), vec2(0.0), vec2(1.0))).rgb, vec3(0.299, 0.587, 0.114));
  float grad = max(max(abs(lmR - lm), abs(lmL - lm)), max(abs(lmD - lm), abs(lmU - lm)));
  float ink = smoothstep(0.06, 0.28, grad) * pow(t, 1.15);
  quant *= (1.0 - 0.46 * ink);

  float dith = bayer4(gl_FragCoord.xy) - 0.5;
  float dAmp = (0.01 + 0.045 * t) * (t * (1.0 - 0.2 * t));
  quant += vec3(dith * dAmp, dith * dAmp * 0.72, -dith * dAmp * 0.65);
  return clamp(quant, 0.0, 1.0);
}

vec3 applyHyperpop(vec2 uv) {
  vec3 src0 = texture2D(u_tex, uv).rgb;
  float rawT = u_intensity;
  float shapedT = pow(rawT, 0.42);
  float drive = 0.24 + 1.48 * shapedT;
  float mixT = min(1.0, 0.2 + 1.08 * shapedT);
  vec2 lineDir = u_lineDir;
  vec2 normal = vec2(-lineDir.y, lineDir.x);
  vec2 px = vec2(uv.x / max(u_texel.x, 1e-6), uv.y / max(u_texel.y, 1e-6));
  float sliceH = max(2.0, (3.0 + 11.0 * drive) * max(0.8, u_pixelScale));
  float sliceCoord = dot(px, normal);
  float sliceIdx = floor(sliceCoord / sliceH);
  float glitchT = max(0.0, (drive - 0.15) / 0.85);
  float jitterSeed = hash11(sliceIdx + 31.7);
  float maxJitter = (2.0 + 28.0 * drive) * max(0.9, u_pixelScale);
  float jitter = (jitterSeed * 2.0 - 1.0) * maxJitter * glitchT;
  float sliceGate = step(0.3 - 0.22 * drive, hash11(sliceIdx + 97.1));
  vec2 suv = uv + vec2(
    lineDir.x * jitter * sliceGate * u_texel.x,
    lineDir.y * jitter * sliceGate * u_texel.y
  );
  vec3 src = texture2D(u_tex, clamp(suv, vec2(0.0), vec2(1.0))).rgb;
  float r = src.r;
  float g = src.g;
  float b = src.b;
  vec3 c = vec3(r, g, b);
  float lm = dot(src, vec3(0.299, 0.587, 0.114));
  float bright = lm;
  float satBoost = 1.0 + 1.45 * drive;
  c = vec3(lm) + (c - vec3(lm)) * satBoost;
  float levels = max(4.0, floor(12.0 - 7.0 * drive));
  float q = levels - 1.0;
  c = floor(c * q + 0.5) / q;
  float contrast = 1.0 + 0.36 * drive;
  c = (c - vec3(0.5)) * contrast + vec3(0.5);
  float shadowW = max(0.0, 1.0 - bright * 2.2);
  float hiW = max(0.0, (bright - 0.42) / 0.58);
  float midW = max(0.0, 1.0 - shadowW - hiW);
  float colorJitter = (hash11(sliceIdx + 7.3) * 2.0 - 1.0) * 18.0 * glitchT * min(1.4, drive);
  float accentPhase = hash11(sliceIdx + 13.9);
  float isMagenta = 1.0 - step(0.22, accentPhase);
  float isLime = step(0.22, accentPhase) * (1.0 - step(0.55, accentPhase));
  float isCyan = step(0.55, accentPhase) * (1.0 - step(0.82, accentPhase));
  float isYellow = step(0.82, accentPhase);
  float aR = isMagenta * 30.0 + isLime * 8.0 + isCyan * 9.0 + isYellow * 24.0;
  float aG = isMagenta * 10.0 + isLime * 34.0 + isCyan * 20.0 + isYellow * 28.0;
  float aB = isMagenta * 26.0 + isLime * 9.0 + isCyan * 34.0 + isYellow * 10.0;
  c += vec3(
    (aR * hiW + 12.0 * midW - 8.0 * shadowW + colorJitter * 0.7) / 255.0,
    (aG * hiW + 16.0 * midW + 20.0 * shadowW - colorJitter * 0.2) / 255.0,
    (aB * hiW + 2.0 * midW + 24.0 * shadowW) / 255.0
  );

  vec3 left = texture2D(u_tex, uv - vec2(u_texel.x, 0.0)).rgb;
  vec3 right = texture2D(u_tex, uv + vec2(u_texel.x, 0.0)).rgb;
  vec3 up = texture2D(u_tex, uv - vec2(0.0, u_texel.y)).rgb;
  vec3 down = texture2D(u_tex, uv + vec2(0.0, u_texel.y)).rgb;
  vec3 lap = abs(4.0 * src - left - right - up - down);
  float edge = dot(lap, vec3(0.28, 0.22, 0.32));
  float edgeW = 0.18 + 0.48 * drive;
  c += vec3(edge * edgeW, edge * edgeW * 0.25, edge * edgeW * 0.8);

  vec3 blur = (left + right + up + down) * 0.25;
  float bloomW = 0.2 + 0.3 * drive;
  float gloss = hiW * hiW;
  c += (blur - src) * bloomW + vec3(34.0, 18.0, 24.0) * ((gloss * bloomW) / 255.0);
  return mix(src0, clamp(c, 0.0, 1.0), mixT);
}

vec3 applySwirl(vec2 uv) {
  float t = clamp(u_intensity, 0.0, 1.0);
  if (t <= 0.0001) return texture2D(u_tex, uv).rgb;
  vec2 d = uv - vec2(0.5);
  vec2 nd = d * 2.0;
  float r = length(nd);
  if (r >= 1.0) return texture2D(u_tex, uv).rgb;
  float shaped = pow(t, 1.08);
  float maxAngle = 9.0 * shaped;
  float falloff = pow(max(0.0, 1.0 - r), 2.2);
  float a = maxAngle * falloff;
  float s = sin(a);
  float c = cos(a);
  vec2 sd = vec2(
    d.x * c - d.y * s,
    d.x * s + d.y * c
  );
  vec2 suv = clamp(vec2(0.5) + sd, vec2(0.0), vec2(1.0));
  return texture2D(u_tex, suv).rgb;
}

void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  if (u_filterType < 1.5) {
    c = applyVaporwave(v_uv);
  } else if (u_filterType < 2.5) {
    c = applyHegseth(v_uv);
  } else if (u_filterType < 3.5) {
    c = applyPixelArt(v_uv);
  } else if (u_filterType < 4.5) {
    c = applyHyperpop(v_uv);
  } else {
    c = applySwirl(v_uv);
  }
  gl_FragColor = vec4(sat(c.r), sat(c.g), sat(c.b), 1.0);
}
`;
    const program = createGpuProgram(gl, vertexSrc, fragSrc);
    if (!program) {
      gpuPreview.failed = true;
      return null;
    }

    const posBuffer = gl.createBuffer();
    const tex = gl.createTexture();
    if (!posBuffer || !tex) {
      gpuPreview.failed = true;
      return null;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1, 1,
      -1,  1,  1, -1,  1, 1,
    ]), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const loc = {
      aPos: gl.getAttribLocation(program, 'a_pos'),
      uTex: gl.getUniformLocation(program, 'u_tex'),
      uTexel: gl.getUniformLocation(program, 'u_texel'),
      uFilterType: gl.getUniformLocation(program, 'u_filterType'),
      uIntensity: gl.getUniformLocation(program, 'u_intensity'),
      uChroma: gl.getUniformLocation(program, 'u_chroma'),
      uScanlines: gl.getUniformLocation(program, 'u_scanlines'),
      uScanlineSize: gl.getUniformLocation(program, 'u_scanlineSize'),
      uAngle: gl.getUniformLocation(program, 'u_angle'),
      uLineDir: gl.getUniformLocation(program, 'u_lineDir'),
      uGhostDistance: gl.getUniformLocation(program, 'u_ghostDistance'),
      uBits: gl.getUniformLocation(program, 'u_bits'),
      uPixelScale: gl.getUniformLocation(program, 'u_pixelScale'),
    };

    gpuPreview.gl = gl;
    gpuPreview.program = program;
    gpuPreview.posBuffer = posBuffer;
    gpuPreview.tex = tex;
    gpuPreview.loc = loc;
    gpuPreview.ready = true;
  }
  return gpuPreview.gl;
}

function renderGpuPreviewFilter(sourceCanvas, w, h, name, intensity, params, pixelScale) {
  const gl = ensureGpuPreviewContext();
  if (!gl || !gpuPreview.ready || !gpuPreviewEl) return false;
  if (gpuPreviewEl.width !== w) gpuPreviewEl.width = w;
  if (gpuPreviewEl.height !== h) gpuPreviewEl.height = h;
  updateOverlayLayering(gpuPreviewEl);
  gpuPreviewEl.style.display = '';
  gpuPreviewEl.style.opacity = '1';
  gl.viewport(0, 0, w, h);
  gl.useProgram(gpuPreview.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpuPreview.posBuffer);
  gl.enableVertexAttribArray(gpuPreview.loc.aPos);
  gl.vertexAttribPointer(gpuPreview.loc.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gpuPreview.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
  gl.uniform1i(gpuPreview.loc.uTex, 0);
  gl.uniform2f(gpuPreview.loc.uTexel, 1 / Math.max(1, w), 1 / Math.max(1, h));
  gl.uniform1f(
    gpuPreview.loc.uFilterType,
    name === 'hegseth'
      ? 2
      : name === 'pixelArt'
        ? 3
        : name === 'hyperpop'
          ? 4
          : name === 'swirl'
            ? 5
            : 1
  );
  gl.uniform1f(gpuPreview.loc.uIntensity, intensity);
  gl.uniform1f(gpuPreview.loc.uChroma, params?.chroma ?? 20);
  gl.uniform1f(gpuPreview.loc.uScanlines, params?.scanlines ?? 60);
  gl.uniform1f(gpuPreview.loc.uScanlineSize, params?.scanlineSize ?? 2);
  const angleDeg = params?.angle ?? 0;
  gl.uniform1f(gpuPreview.loc.uAngle, angleDeg);
  const angleRad = angleDeg * Math.PI / 180;
  gl.uniform2f(gpuPreview.loc.uLineDir, Math.cos(angleRad), Math.sin(angleRad));
  gl.uniform1f(gpuPreview.loc.uGhostDistance, params?.ghostDistance ?? 50);
  gl.uniform1f(gpuPreview.loc.uBits, params?.bits ?? 5);
  gl.uniform1f(gpuPreview.loc.uPixelScale, pixelScale);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  return !gl.getError();
}

function isPixelPreviewFilter(name) {
  return name !== 'none';
}

function syncTextFieldLayering() {
  const onTopPixelFilter = state.filter.applyOnTop && isPixelPreviewFilter(state.filter.name);
  for (const obj of state.objects) {
    obj.el.style.zIndex = (onTopPixelFilter && state.selectedObject === obj) ? '40' : '12';
  }
}

function isObjectFilterBypassed(tf) {
  return state.filter.applyOnTop && state.selectedObject === tf;
}

function shouldRefreshPreviewForSelectionChange() {
  return state.filter.applyOnTop && isPixelPreviewFilter(state.filter.name);
}

function drawPreviewObjectLayers(ctx, w, h, opts = {}) {
  const { bypassSelectedObject = false } = opts;
  const renderedW = baseImage.offsetWidth || 1;
  const renderedH = baseImage.offsetHeight || 1;
  const previewScale = state.imageNaturalW > 0 ? (state.imageNaturalW / w) : 1;
  const sx = w / renderedW;
  const sy = h / renderedH;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tc = tempCanvas.getContext('2d', { willReadFrequently: true });

  const orderedObjects = [
    ...state.objects.filter(o => o.type === 'image'),
    ...state.objects.filter(o => o.type === 'text'),
  ];
  for (const tf of orderedObjects) {
    if (tf.type === 'image') {
      if (bypassSelectedObject && isObjectFilterBypassed(tf)) continue;
      const s = tf.style;
      const opacity = clampObjectOpacity(s.opacity ?? 1);
      const cx = tf.xPct * w;
      const cy = tf.yPct * h;
      const objW = (s.size / 100) * w;
      const objH = objW / Math.max(0.01, tf.aspect || 1);
      const previewBlur = getObjectBlurRadiusPx(s.blur, previewScale);
      const previewGlow = getObjectGlowRadiusPx(s.glow, previewScale);
      const rotDeg = s.rotateDeg || 0;
      tc.clearRect(0, 0, w, h);
      if (previewGlow > 0) {
        tc.save();
        tc.translate(cx, cy);
        if (Math.abs(rotDeg) >= 0.01) tc.rotate(rotDeg * Math.PI / 180);
        if (tf.isVector) {
          tc.drawImage(tf.imgEl, -objW / 2, -objH / 2, objW, objH);
        } else {
          tc.fillStyle = '#ffffff';
          tc.fillRect(-objW / 2, -objH / 2, objW, objH);
        }
        tc.restore();
        blurCurrentAlphaIntoGlow(tc, w, h, '#ffffff', previewGlow);
      }
      tc.save();
      tc.translate(cx, cy);
      if (Math.abs(rotDeg) >= 0.01) tc.rotate(rotDeg * Math.PI / 180);
      if (s.bgColor) {
        tc.fillStyle = s.bgColor;
        tc.fillRect(-objW / 2, -objH / 2, objW, objH);
      }
      tc.drawImage(tf.imgEl, -objW / 2, -objH / 2, objW, objH);
      tc.restore();
      if (previewBlur > 0) softBlur(tc, w, h, previewBlur);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
      continue;
    }
    if (tf.type !== 'text') continue;
    if (bypassSelectedObject && isObjectFilterBypassed(tf)) continue;
    const s = tf.style;
    const opacity = clampObjectOpacity(s.opacity ?? 1);
    const cx = tf.xPct * w;
    const cy = tf.yPct * h;
    const fontSize = s.size / 100 * w;
    const lines = tf.innerEl.innerText.split('\n');
    const lineHeight = fontSize * (s.lineHeight ?? 1.2);
    const totalH = lines.length * lineHeight;
    const startY = cy - totalH / 2 + lineHeight / 2;
    const elHalfW = (tf.innerEl.offsetWidth * sx) / 2;
    const lx = s.align === 'left'  ? cx - elHalfW :
               s.align === 'right' ? cx + elHalfW :
               cx;

    const resolvedFontFamily = resolveFontFamilyStack(s.font);
    tc.clearRect(0, 0, w, h);
    tc.font = `${s.italic ? 'italic ' : ''}${s.weight} ${fontSize}px ${resolvedFontFamily}`;
    tc.textAlign = s.align;
    tc.textBaseline = 'middle';
    const previewBlur = getObjectBlurRadiusPx(s.blur, previewScale);
    const previewGlow = getObjectGlowRadiusPx(s.glow, previewScale);
    const rotDeg = s.rotateDeg || 0;
    if (Math.abs(rotDeg) < 0.01) {
      if (previewGlow > 0) {
        lines.forEach((line, i) => {
          const ly = startY + i * lineHeight;
          if (s.outlineWidth > 0) {
            tc.lineWidth = s.outlineWidth;
            tc.strokeStyle = '#ffffff';
            tc.lineJoin = 'round';
            tc.strokeText(line, lx, ly);
          }
          tc.fillStyle = '#ffffff';
          tc.fillText(line, lx, ly);
        });
        blurCurrentAlphaIntoGlow(tc, w, h, s.fgColor || '#ffffff', previewGlow);
      }
      if (s.bgColor) {
        const bgW = tf.innerEl.offsetWidth * sx;
        const bgH = tf.innerEl.offsetHeight * sy;
        tc.fillStyle = s.bgColor;
        tc.fillRect(cx - bgW / 2, cy - bgH / 2, bgW, bgH);
      }

      lines.forEach((line, i) => {
        const ly = startY + i * lineHeight;
        if (s.outlineWidth > 0) {
          tc.lineWidth = s.outlineWidth;
          tc.strokeStyle = s.outlineColor;
          tc.lineJoin = 'round';
          tc.strokeText(line, lx, ly);
        }
        tc.fillStyle = s.fgColor;
        tc.fillText(line, lx, ly);
      });
    } else {
      const rotRad = rotDeg * Math.PI / 180;
      const localStartY = -totalH / 2 + lineHeight / 2;
      const localHalfW = (tf.innerEl.offsetWidth * sx) / 2;
      const localX = s.align === 'left'  ? -localHalfW :
                     s.align === 'right' ? localHalfW :
                     0;
      tc.save();
      tc.translate(cx, cy);
      tc.rotate(rotRad);
      if (previewGlow > 0) {
        lines.forEach((line, i) => {
          const ly = localStartY + i * lineHeight;
          if (s.outlineWidth > 0) {
            tc.lineWidth = s.outlineWidth;
            tc.strokeStyle = '#ffffff';
            tc.lineJoin = 'round';
            tc.strokeText(line, localX, ly);
          }
          tc.fillStyle = '#ffffff';
          tc.fillText(line, localX, ly);
        });
        tc.restore();
        blurCurrentAlphaIntoGlow(tc, w, h, s.fgColor || '#ffffff', previewGlow);
        tc.save();
        tc.translate(cx, cy);
        tc.rotate(rotRad);
      }
      if (s.bgColor) {
        const bgW = tf.innerEl.offsetWidth * sx;
        const bgH = tf.innerEl.offsetHeight * sy;
        tc.fillStyle = s.bgColor;
        tc.fillRect(-bgW / 2, -bgH / 2, bgW, bgH);
      }
      lines.forEach((line, i) => {
        const ly = localStartY + i * lineHeight;
        if (s.outlineWidth > 0) {
          tc.lineWidth = s.outlineWidth;
          tc.strokeStyle = s.outlineColor;
          tc.lineJoin = 'round';
          tc.strokeText(line, localX, ly);
        }
        tc.fillStyle = s.fgColor;
        tc.fillText(line, localX, ly);
      });
      tc.restore();
    }
    if (previewBlur > 0) softBlur(tc, w, h, previewBlur);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();
  }
}

function updateGrainOverlay() {
  const isDark = state.filter.name === 'darkAcademia';
  const isFilm = state.filter.name === 'film';
  if (!isFilm && !isDark) {
    if (grainEl) grainEl.style.display = 'none';
    return;
  }
  if (!grainEl) {
    grainEl = makeOverlayCanvas();
    grainEl.style.mixBlendMode = 'overlay';
  }
  updateOverlayLayering(grainEl);
  const grainT   = (state.filter.params.grain ?? (isDark ? 45 : 10)) / 100;
  const t        = state.filter.intensity / 100;
  // Film grain is intentionally independent of intensity in export. Dark
  // Academia grain is intensity-scaled in export, so mirror that here.
  const intensityFactor = isDark ? t : 1;
  const maxAlpha = isDark ? 0.28 : 0.35;
  const opacity  = maxAlpha * grainT * intensityFactor;
  if (opacity <= 0.001) {
    if (grainEl) grainEl.style.display = 'none';
    return;
  }
  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  const now = performance.now();
  const shouldRegenNoise = !grainBuffer || grainBufferW !== w || grainBufferH !== h || (now - grainNoiseTs) > 120;
  if (shouldRegenNoise) {
    grainBufferW = w;
    grainBufferH = h;
    grainNoiseTs = now;
    grainBuffer = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < grainBuffer.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      grainBuffer[i] = grainBuffer[i+1] = grainBuffer[i+2] = v;
      grainBuffer[i+3] = 255;
    }
  }
  grainEl.width         = w;
  grainEl.height        = h;
  grainEl.style.display = '';
  grainEl.style.opacity = opacity.toFixed(3);
  const gc = grainEl.getContext('2d');
  const id = gc.createImageData(w, h);
  const d  = id.data;
  d.set(grainBuffer);
  gc.putImageData(id, 0, 0);
}

function updateVignetteOverlay() {
  if (state.filter.name !== 'darkAcademia') {
    if (vignetteEl) vignetteEl.style.display = 'none';
    return;
  }
  const vigT = (state.filter.params.vignette ?? 65) / 100;
  const t    = state.filter.intensity / 100;
  if (!vignetteEl) vignetteEl = makeOverlayCanvas();
  updateOverlayLayering(vignetteEl);
  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  vignetteEl.width         = w;
  vignetteEl.height        = h;
  vignetteEl.style.display = '';
  const vc = vignetteEl.getContext('2d');
  vc.clearRect(0, 0, w, h);
  const grad = vc.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w, h) * 0.65);
  grad.addColorStop(0.25, 'rgba(0,0,0,0)');
  grad.addColorStop(1,    `rgba(0,0,0,${(vigT * t * 0.82).toFixed(3)})`);
  vc.fillStyle = grad;
  vc.fillRect(0, 0, w, h);
}

function updateScanlineOverlay() {
  // Vaporwave scanlines are now rendered in updateChromaOverlay() using the
  // same pixel pipeline as export, so this legacy overlay stays hidden.
  if (scanlineEl) scanlineEl.style.display = 'none';
}

function updateChromaOverlay() {
  if (state.filter.name !== 'vaporwave') {
    if (chromaEl) chromaEl.style.display = 'none';
    return;
  }
  if (!chromaEl) chromaEl = makeOverlayCanvas();
  updateOverlayLayering(chromaEl);
  chromaEl.style.mixBlendMode = 'normal';

  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  const t = state.filter.intensity / 100;
  const chromaT = (state.filter.params.chroma ?? 50) / 100;
  const scanlinesT = (state.filter.params.scanlines ?? 60) / 100;
  // Exact identity case for FILTERS.vaporwave.apply().
  if (t === 0 && chromaT === 0 && scanlinesT === 0) {
    chromaEl.style.display = 'none';
    return;
  }
  chromaEl.width         = w;
  chromaEl.height        = h;
  chromaEl.style.display = '';
  chromaEl.style.opacity = '1';

  // Render the exact export filter logic at preview resolution so the editor
  // image matches the saved JPEG (including chroma and scanlines).
  ensureVaporSrcContext();
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  drawBaseAndPaintToContext(vaporSrcCtx, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewObjectLayers(vaporSrcCtx, w, h);
  }
  const previewData = vaporSrcCtx.getImageData(0, 0, w, h);
  FILTERS.vaporwave.apply(
    previewData.data,
    w,
    h,
    t,
    state.filter.params
  );

  const cc  = chromaEl.getContext('2d');
  cc.putImageData(previewData, 0, 0);
}

function updateSolarpunkOverlay() {
  if (state.filter.name !== 'solarpunk') {
    if (solarpunkEl) solarpunkEl.style.display = 'none';
    return;
  }
  if (!solarpunkEl) solarpunkEl = makeOverlayCanvas();
  updateOverlayLayering(solarpunkEl);
  solarpunkEl.style.mixBlendMode = 'normal';

  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  const t = state.filter.intensity / 100;
  const bloomT = (state.filter.params.bloom ?? 35) / 100;
  const hazeT = (state.filter.params.haze ?? 25) / 100;
  if (t === 0 && bloomT === 0 && hazeT === 0) {
    solarpunkEl.style.display = 'none';
    return;
  }

  solarpunkEl.width = w;
  solarpunkEl.height = h;
  solarpunkEl.style.display = '';
  solarpunkEl.style.opacity = '1';

  ensureVaporSrcContext();
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  drawBaseAndPaintToContext(vaporSrcCtx, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewObjectLayers(vaporSrcCtx, w, h);
  }
  const previewData = vaporSrcCtx.getImageData(0, 0, w, h);
  FILTERS.solarpunk.apply(
    previewData.data,
    w,
    h,
    t,
    state.filter.params
  );
  const sc  = solarpunkEl.getContext('2d');
  sc.putImageData(previewData, 0, 0);
}

function updateHegsethOverlay() {
  if (state.filter.name !== 'hegseth') {
    if (hegsethEl) hegsethEl.style.display = 'none';
    return;
  }
  if (!hegsethEl) hegsethEl = makeOverlayCanvas();
  updateOverlayLayering(hegsethEl);
  hegsethEl.style.mixBlendMode = 'normal';

  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  const t = state.filter.intensity / 100;
  if (t === 0) {
    hegsethEl.style.display = 'none';
    return;
  }

  hegsethEl.width = w;
  hegsethEl.height = h;
  hegsethEl.style.display = '';
  hegsethEl.style.opacity = '1';

  ensureVaporSrcContext();
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  drawBaseAndPaintToContext(vaporSrcCtx, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewObjectLayers(vaporSrcCtx, w, h);
  }
  const previewData = vaporSrcCtx.getImageData(0, 0, w, h);
  FILTERS.hegseth.apply(
    previewData.data,
    w,
    h,
    t,
    state.filter.params
  );
  const hc = hegsethEl.getContext('2d');
  hc.putImageData(previewData, 0, 0);
}

function updateMexicoOverlay() {
  if (state.filter.name !== 'mexico') {
    if (mexicoEl) mexicoEl.style.display = 'none';
    return;
  }
  if (!mexicoEl) mexicoEl = makeOverlayCanvas();
  updateOverlayLayering(mexicoEl);
  mexicoEl.style.mixBlendMode = 'normal';

  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  const t = state.filter.intensity / 100;
  if (t === 0) {
    mexicoEl.style.display = 'none';
    return;
  }

  mexicoEl.width = w;
  mexicoEl.height = h;
  mexicoEl.style.display = '';
  mexicoEl.style.opacity = '1';

  ensureVaporSrcContext();
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  drawBaseAndPaintToContext(vaporSrcCtx, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewObjectLayers(vaporSrcCtx, w, h);
  }
  const previewData = vaporSrcCtx.getImageData(0, 0, w, h);
  FILTERS.mexico.apply(
    previewData.data,
    w,
    h,
    t,
    state.filter.params
  );
  const mc = mexicoEl.getContext('2d');
  mc.putImageData(previewData, 0, 0);
}

function hideLegacyFilterOverlays() {
  if (grainEl) grainEl.style.display = 'none';
  if (scanlineEl) scanlineEl.style.display = 'none';
  if (chromaEl) chromaEl.style.display = 'none';
  if (vignetteEl) vignetteEl.style.display = 'none';
  if (solarpunkEl) solarpunkEl.style.display = 'none';
  if (hegsethEl) hegsethEl.style.display = 'none';
  if (mexicoEl) mexicoEl.style.display = 'none';
}

const PREVIEW_INTERACTION_FPS = 60;
const PREVIEW_INTERACTIVE_SCALE = 0.72;
const PREVIEW_INTERACTIVE_MAX_PIXELS = 900000;
const PREVIEW_INTERACTION_WINDOW_MS = 160;
const SETTLE_MODE_MIN_SAMPLES = 16;
const SETTLE_MODE_TOTAL_MS_HIGH = 26;
const SETTLE_MODE_FILTER_MS_LOW = 9;

let _previewInteractionUntilTs = 0;
let _previewSettleRequested = false;
let _previewRenderSeq = 0;
let _previewRenderedSeq = 0;
let _previewRenderInFlight = false;
let _previewRenderPending = false;
let _previewThrottleTimer = 0;
let _lastPreviewRenderTs = 0;

function computePreviewTargetSize(quality = 'settle') {
  const renderedW = Math.max(1, baseImage.offsetWidth || 1);
  const renderedH = Math.max(1, baseImage.offsetHeight || 1);
  if (quality !== 'interactive') {
    return {
      w: Math.round(renderedW),
      h: Math.round(renderedH),
    };
  }

  let targetW = renderedW * PREVIEW_INTERACTIVE_SCALE;
  let targetH = renderedH * PREVIEW_INTERACTIVE_SCALE;
  const area = targetW * targetH;
  if (area > PREVIEW_INTERACTIVE_MAX_PIXELS) {
    const downscale = Math.sqrt(PREVIEW_INTERACTIVE_MAX_PIXELS / area);
    targetW *= downscale;
    targetH *= downscale;
  }
  return {
    w: Math.max(1, Math.round(targetW)),
    h: Math.max(1, Math.round(targetH)),
  };
}

function pickSettleExecMode() {
  if (perf.workerErrors > 0 || perf.workerTimeouts > 0) return 'main';
  if (perf.previewSamples.length < SETTLE_MODE_MIN_SAMPLES) return 'worker';
  const totalP95 = perfSummary(perf.previewSamples, 'totalMs').p95;
  const filterP95 = perfSummary(perf.previewSamples, 'filterMs').p95;
  // If total cost is high but filter work is light, worker round-trip overhead
  // is likely dominating; prefer main-thread for settle in that case.
  if (totalP95 >= SETTLE_MODE_TOTAL_MS_HIGH && filterP95 <= SETTLE_MODE_FILTER_MS_LOW) {
    return 'main';
  }
  return 'worker';
}

async function updateFinalFilterPreviewOverlay(renderSeq, quality = 'settle') {
  const previewStartTs = performance.now();
  const name = state.filter.name;
  if (name === 'none') {
    if (finalPreviewEl) finalPreviewEl.style.display = 'none';
    hideGpuPreviewOverlay();
    return;
  }

  const { w, h } = computePreviewTargetSize(quality);
  const bypassSelectedObject = state.filter.applyOnTop && !!state.selectedObject;
  const t = state.filter.intensity / 100;

  ensureVaporSrcContext();
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
    markPreviewSourceDirty();
  }
  const sourceKey = makePreviewSourceCacheKey(w, h);
  let sourceBuildMs = 0;
  let sourceCopyMs = 0;
  let sourceCacheHit = false;
  const canGpu = canUseGpuPreview(name, quality);
  if (canGpu) {
    if (!previewGpuSourceCache.dirty &&
        previewGpuSourceCache.w === w &&
        previewGpuSourceCache.h === h &&
        previewGpuSourceCache.key === sourceKey) {
      sourceCacheHit = true;
    } else {
      const sourceBuildStart = performance.now();
      vaporSrcCtx.clearRect(0, 0, w, h);
      drawBaseAndPaintToContext(vaporSrcCtx, w, h);
      if (state.filter.applyOnTop) {
        drawPreviewObjectLayers(vaporSrcCtx, w, h, { bypassSelectedObject });
      }
      sourceBuildMs = performance.now() - sourceBuildStart;
      previewGpuSourceCache.w = w;
      previewGpuSourceCache.h = h;
      previewGpuSourceCache.key = sourceKey;
      previewGpuSourceCache.dirty = false;
    }
    if (renderSeq !== _previewRenderSeq) {
      perf.stalePreviewDrops++;
      renderPerfPanel();
      return;
    }
    const renderedW = baseImage.offsetWidth || w;
    const pixelScale = renderedW > 0 ? (w / renderedW) : 1;
    const filterStartTs = performance.now();
    if (finalPreviewEl) finalPreviewEl.style.display = 'none';
    const usedGpu = renderGpuPreviewFilter(vaporSrcCanvas, w, h, name, t, state.filter.params, pixelScale);
    const endTs = performance.now();
    if (usedGpu) {
      perf.settleExecMode = 'gpu';
      recordPreviewPerf({
        filter: name,
        quality,
        w,
        h,
        queueWaitMs: perf.previewRenderQueueWaitMs,
        composeMs: sourceBuildMs,
        sourceBuildMs,
        sourceCopyMs: 0,
        sourceCacheHit,
        filterMs: endTs - filterStartTs,
        commitMs: 0,
        totalMs: endTs - previewStartTs,
        worker: false,
        workerFallback: false,
        mainThread: false,
        settleExecMode: 'gpu',
      });
      return;
    }
  }

  let previewData;
  if (!previewPixelSourceCache.dirty &&
      previewPixelSourceCache.data &&
      previewPixelSourceCache.w === w &&
      previewPixelSourceCache.h === h &&
      previewPixelSourceCache.key === sourceKey) {
    sourceCacheHit = true;
    const sourceCopyStart = performance.now();
    previewData = vaporSrcCtx.createImageData(w, h);
    previewData.data.set(previewPixelSourceCache.data);
    sourceCopyMs = performance.now() - sourceCopyStart;
  } else {
    const sourceBuildStart = performance.now();
    vaporSrcCtx.clearRect(0, 0, w, h);
    drawBaseAndPaintToContext(vaporSrcCtx, w, h);
    if (state.filter.applyOnTop) {
      drawPreviewObjectLayers(vaporSrcCtx, w, h, { bypassSelectedObject });
    }
    previewData = vaporSrcCtx.getImageData(0, 0, w, h);
    sourceBuildMs = performance.now() - sourceBuildStart;
    previewPixelSourceCache.data = new Uint8ClampedArray(previewData.data);
    previewPixelSourceCache.w = w;
    previewPixelSourceCache.h = h;
    previewPixelSourceCache.key = sourceKey;
    previewPixelSourceCache.dirty = false;
    previewGpuSourceCache.w = w;
    previewGpuSourceCache.h = h;
    previewGpuSourceCache.key = sourceKey;
    previewGpuSourceCache.dirty = false;
  }
  // Match perceived intensity with export for scale-sensitive filters by
  // compensating for preview downscale. Export uses natural/rendered scale,
  // while preview is displayed back up to rendered size.
  const renderedW = baseImage.offsetWidth || w;
  const pixelScale = renderedW > 0 ? (w / renderedW) : 1;
  const filterStartTs = performance.now();
  const settleExecMode = quality === 'settle' ? pickSettleExecMode() : 'main';
  perf.settleExecMode = settleExecMode;
  const preferMainThread = quality === 'interactive' || settleExecMode === 'main';
  const filterResult = await runFilterInWorker(
    name,
    previewData,
    w,
    h,
    t,
    state.filter.params,
    pixelScale,
    { forceMainThread: preferMainThread }
  );
  const filterEndTs = performance.now();
  previewData.data.set(filterResult.data);
  if (renderSeq !== _previewRenderSeq) {
    perf.stalePreviewDrops++;
    renderPerfPanel();
    return;
  }
  if (!finalPreviewEl) finalPreviewEl = makeOverlayCanvas();
  updateOverlayLayering(finalPreviewEl);
  finalPreviewEl.style.mixBlendMode = 'normal';
  if (finalPreviewEl.width !== w) finalPreviewEl.width = w;
  if (finalPreviewEl.height !== h) finalPreviewEl.height = h;
  finalPreviewEl.style.display = '';
  finalPreviewEl.style.opacity = '1';
  const commitStartTs = performance.now();
  const pc = finalPreviewEl.getContext('2d');
  pc.putImageData(previewData, 0, 0);
  // Keep GPU interactive preview visible until settle pixels are committed,
  // then swap overlays to avoid a flash back to the unfiltered base image.
  hideGpuPreviewOverlay();
  const endTs = performance.now();
  recordPreviewPerf({
    filter: name,
    quality,
    w,
    h,
    queueWaitMs: perf.previewRenderQueueWaitMs,
    composeMs: sourceBuildMs + sourceCopyMs,
    sourceBuildMs,
    sourceCopyMs,
    sourceCacheHit,
    filterMs: filterEndTs - filterStartTs,
    commitMs: endTs - commitStartTs,
    totalMs: endTs - previewStartTs,
    worker: filterResult.usedWorker,
    workerFallback: filterResult.fellBack,
    mainThread: preferMainThread,
    settleExecMode,
  });
}

async function applyImageFilter(renderSeq, quality = 'settle') {
  canvasContainer.style.filter = '';
  baseImage.style.filter = '';

  // Unified preview pipeline: never CSS-filter text fields directly.
  const textFilter = '';
  for (const tf of state.objects) {
    if (tf.type !== 'text') continue;
    tf.el.style.filter = isObjectFilterBypassed(tf) ? '' : textFilter;
  }
  syncTextFieldLayering();
  hideLegacyFilterOverlays();
  await updateFinalFilterPreviewOverlay(renderSeq, quality);
}

let _filterRenderRaf = 0;
let _resizeRaf = 0;

function runScheduledPreviewRender() {
  if (_appIsBackgrounded || document.visibilityState === 'hidden') {
    _resumeRenderQueued = true;
    _previewRenderPending = false;
    perf.previewPendingCount = 0;
    return;
  }
  if (_previewRenderInFlight) {
    _previewRenderPending = true;
    perf.previewPendingCount = Math.max(perf.previewPendingCount, 1);
    perf.previewQueueDepthMax = Math.max(perf.previewQueueDepthMax, perf.previewPendingCount);
    renderPerfPanel();
    return;
  }
  _previewRenderInFlight = true;
  perf.previewRenderInFlight = 1;
  perf.previewPendingCount = 0;
  perf.previewRenderQueueWaitMs = perf.previewInputTs > 0 ? Math.max(0, performance.now() - perf.previewInputTs) : 0;
  const renderSeq = _previewRenderSeq;
  const now = performance.now();
  const isInteractive = !_previewSettleRequested && now < _previewInteractionUntilTs;
  const quality = isInteractive ? 'interactive' : 'settle';
  if (isInteractive) _lastPreviewRenderTs = now;
  _previewSettleRequested = false;
  Promise.resolve(applyImageFilter(renderSeq, quality))
    .catch(() => {})
    .finally(() => {
      _previewRenderInFlight = false;
      perf.previewRenderInFlight = 0;
      _previewRenderedSeq = renderSeq;
      if (_previewRenderPending || _previewRenderedSeq !== _previewRenderSeq) {
        _previewRenderPending = false;
        perf.previewPendingCount = Math.max(perf.previewPendingCount, 1);
        perf.previewQueueDepthMax = Math.max(perf.previewQueueDepthMax, perf.previewPendingCount);
        scheduleImageFilterRender();
      } else {
        perf.previewPendingCount = 0;
      }
      renderPerfPanel();
    });
}

function scheduleImageFilterRender(opts = {}) {
  if (_appIsBackgrounded || document.visibilityState === 'hidden') {
    _resumeRenderQueued = true;
    return;
  }
  perf.previewInputTs = performance.now();
  if (opts.interactive) {
    _previewInteractionUntilTs = performance.now() + PREVIEW_INTERACTION_WINDOW_MS;
  }
  if (opts.settle) {
    _previewSettleRequested = true;
    _previewInteractionUntilTs = 0;
  }
  _previewRenderSeq++;
  if (_previewRenderInFlight) {
    _previewRenderPending = true;
    perf.previewPendingCount = Math.max(perf.previewPendingCount, 1);
    perf.previewQueueDepthMax = Math.max(perf.previewQueueDepthMax, perf.previewPendingCount);
    renderPerfPanel();
    return;
  }
  if (_filterRenderRaf || _previewThrottleTimer) return;
  if (opts.immediate) {
    runScheduledPreviewRender();
    return;
  }
  const now = performance.now();
  const isInteractive = !_previewSettleRequested && now < _previewInteractionUntilTs;
  if (isInteractive && !opts.noThrottle) {
    const minFrameMs = Math.round(1000 / PREVIEW_INTERACTION_FPS);
    const wait = Math.max(0, minFrameMs - (now - _lastPreviewRenderTs));
    if (wait > 0) {
      _previewThrottleTimer = window.setTimeout(() => {
        _previewThrottleTimer = 0;
        scheduleImageFilterRender();
      }, wait);
      return;
    }
  }
  _filterRenderRaf = requestAnimationFrame(() => {
    _filterRenderRaf = 0;
    runScheduledPreviewRender();
  });
}

function pausePreviewRendering() {
  if (_filterRenderRaf) {
    cancelAnimationFrame(_filterRenderRaf);
    _filterRenderRaf = 0;
  }
  if (_previewThrottleTimer) {
    clearTimeout(_previewThrottleTimer);
    _previewThrottleTimer = 0;
  }
  _previewInteractionUntilTs = 0;
  _previewSettleRequested = false;
  _previewRenderPending = false;
  _previewRenderSeq++;
  perf.previewPendingCount = 0;
}

function recoverFromDiscardedEditorSession() {
  if (!editorScreen.classList.contains('active') || !state.imageLoaded) return false;
  if (baseImage?.naturalWidth > 0 && baseImage?.naturalHeight > 0) return false;
  showUpload();
  alert('This tab was suspended by your browser. Please re-open your image.');
  return true;
}

function handleAppBecameHidden() {
  if (_appIsBackgrounded) return;
  _appIsBackgrounded = true;
  _resumeRenderQueued = _resumeRenderQueued || state.imageLoaded;
  pausePreviewRendering();
  releaseBackgroundPreviewResources();
}

function handleAppBecameVisible() {
  if (!_appIsBackgrounded) return;
  _appIsBackgrounded = false;
  const recovered = recoverFromDiscardedEditorSession();
  if (recovered) {
    _resumeRenderQueued = false;
    return;
  }
  if (_resumeRenderQueued && state.imageLoaded) {
    _resumeRenderQueued = false;
    markPreviewSourceDirty();
    scheduleImageFilterRender({ settle: true, immediate: true, noThrottle: true });
  }
}

function updateVibeExtraControls() {
  const name = state.filter.name;
  const isNone = name === 'none';
  filterIntensityRow.classList.toggle('hidden', isNone);
  if (filterIntensityLabel) {
    filterIntensityLabel.textContent = FILTER_INTENSITY_LABELS[name] || 'Intensity';
  }
  filterLayerRow.classList.toggle('hidden', isNone);
  Object.entries(FILTER_EXTRA_CONTROL_PANELS).forEach(([filterName, panel]) => {
    if (!panel) return;
    panel.classList.toggle('hidden', filterName !== name);
  });
  ctrlFilterOnTop.checked = !!state.filter.applyOnTop;
}

filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    // Avoid deferred stale render when switching filters quickly.
    if (_filterRenderRaf) {
      cancelAnimationFrame(_filterRenderRaf);
      _filterRenderRaf = 0;
    }
    if (_previewThrottleTimer) {
      clearTimeout(_previewThrottleTimer);
      _previewThrottleTimer = 0;
    }
    hideLegacyFilterOverlays();
    if (finalPreviewEl) finalPreviewEl.style.display = 'none';
    hideGpuPreviewOverlay();

    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.filter.name = chip.dataset.filter;
    // Reset to defaults for this vibe
    state.filter.params = { ...(FILTER_PARAM_DEFAULTS[state.filter.name] || {}) };
    // Sync extra control values to defaults.
    const controlBindings = FILTER_PARAM_CONTROLS[state.filter.name] || [];
    controlBindings.forEach(({ key, el }) => {
      if (!el) return;
      const fallback = Number(el.defaultValue || el.value || 0);
      const rawValue = state.filter.params[key];
      const nextValue = Number(rawValue ?? fallback);
      state.filter.params[key] = nextValue;
      el.value = String(nextValue);
    });
    updateVibeExtraControls();
    scheduleImageFilterRender({ settle: true });
  });
});

ctrlFilterIntensity.addEventListener('input', () => {
  state.filter.intensity = parseInt(ctrlFilterIntensity.value);
  scheduleImageFilterRender({ interactive: true });
});

ctrlFilterOnTop.addEventListener('change', () => {
  state.filter.applyOnTop = ctrlFilterOnTop.checked;
  markPreviewSourceDirty();
  scheduleImageFilterRender({ settle: true });
});

Object.values(FILTER_PARAM_CONTROLS).forEach((bindings) => {
  bindings.forEach(({ key, el }) => {
    if (!el) return;
    el.addEventListener('input', () => {
      state.filter.params[key] = parseInt(el.value, 10);
      scheduleImageFilterRender({ interactive: true });
    });
  });
});

[
  ctrlFilterIntensity,
  ...Object.values(FILTER_PARAM_CONTROLS).flatMap((bindings) => bindings.map((binding) => binding.el)),
].forEach((el) => {
  if (!el) return;
  el.addEventListener('change', () => {
    scheduleImageFilterRender({ settle: true });
  });
});

ctrlFgColor.addEventListener('input', () => {
  applyControlsToSelected({ fgColor: ctrlFgColor.value });
  clearPreset();
});
ctrlOutlineColor.addEventListener('input', () => {
  applyControlsToSelected({ outlineColor: ctrlOutlineColor.value });
  clearPreset();
});

ctrlOutlineWidth.addEventListener('input', () => {
  const v = parseFloat(ctrlOutlineWidth.value);
  ctrlOutlineWidthVal.textContent = v;
  applyControlsToSelected({ outlineWidth: v });
  clearPreset();
});

ctrlAutoContrast.addEventListener('click', () => {
  applyAutoContrastToSelected();
});

alignBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    alignBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyControlsToSelected({ align: btn.dataset.align });
    clearPreset();
  });
});

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    // Preserve object-level styling and geometry — presets only target text traits.
    const {
      size: _ignored,
      blur: _ignoredBlur,
      glow: _ignoredGlow,
      opacity: _ignoredOpacity,
      bgColor: _ignoredBg,
      rotateDeg: _ignoredRotate,
      ...presetWithoutSize
    } = preset;
    applyControlsToSelected(presetWithoutSize);
    state.lastPreset = btn.dataset.preset;
    if (state.selectedObject) {
      state.selectedObject.activePreset = btn.dataset.preset;
      loadFieldStyle(state.selectedObject);
    } else {
      syncObjectControlsToStyle(state.lastStyle);
      syncTextControlsToStyle(state.lastStyle, btn.dataset.preset);
    }
  });
});

// ─── Export / Render ──────────────────────────────────────────────────────────

// 3-pass separable box blur — O(n) per pass, good Gaussian approximation.
// Works on any browser without ctx.filter support (e.g. Safari < 18).
function softBlur(ctx, w, h, radius) {
  if (radius < 0.5) return;
  const r   = Math.max(1, Math.round(radius));
  const id  = ctx.getImageData(0, 0, w, h);
  const d   = id.data;
  const blurScratch = getFilterScratch('__soft_blur__', d.length);
  const tmp = blurScratch.orig;
  const diam = 2 * r + 1;

  for (let pass = 0; pass < 3; pass++) {
    // Horizontal pass: d → tmp
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let kx = -r; kx <= r; kx++) {
        const sx = Math.max(0, kx) * 4 + row;
        rr += d[sx]; gg += d[sx+1]; bb += d[sx+2]; aa += d[sx+3];
      }
      for (let x = 0; x < w; x++) {
        const i = row + x * 4;
        tmp[i] = rr/diam; tmp[i+1] = gg/diam; tmp[i+2] = bb/diam; tmp[i+3] = aa/diam;
        const lx = Math.max(0,   x - r    ) * 4 + row;
        const rx = Math.min(w-1, x + r + 1) * 4 + row;
        rr += d[rx]-d[lx]; gg += d[rx+1]-d[lx+1]; bb += d[rx+2]-d[lx+2]; aa += d[rx+3]-d[lx+3];
      }
    }
    d.set(tmp);

    // Vertical pass: d → tmp
    for (let x = 0; x < w; x++) {
      const col = x * 4;
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let ky = -r; ky <= r; ky++) {
        const sy = Math.max(0, ky) * w * 4 + col;
        rr += d[sy]; gg += d[sy+1]; bb += d[sy+2]; aa += d[sy+3];
      }
      for (let y = 0; y < h; y++) {
        const i = y * w * 4 + col;
        tmp[i] = rr/diam; tmp[i+1] = gg/diam; tmp[i+2] = bb/diam; tmp[i+3] = aa/diam;
        const ly = Math.max(0,   y - r    ) * w * 4 + col;
        const ry = Math.min(h-1, y + r + 1) * w * 4 + col;
        rr += d[ry]-d[ly]; gg += d[ry+1]-d[ly+1]; bb += d[ry+2]-d[ly+2]; aa += d[ry+3]-d[ly+3];
      }
    }
    d.set(tmp);
  }
  ctx.putImageData(id, 0, 0);
}

async function applyActiveFilterToContext(ctx, w, h, pixelScale) {
  if (state.filter.name === 'none') return;
  const imgData = ctx.getImageData(0, 0, w, h);
  const scaleForFilter = (state.filter.name === 'vaporwave' || state.filter.name === 'hegseth' || state.filter.name === 'dithering' || state.filter.name === 'pixelArt' || state.filter.name === 'hyperpop') ? pixelScale : 1;
  const result = await runFilterInWorker(
    state.filter.name,
    imgData,
    w,
    h,
    state.filter.intensity / 100,
    state.filter.params,
    scaleForFilter
  );
  imgData.data.set(result.data);
  ctx.putImageData(imgData, 0, 0);
  return result;
}

function drawObjectLayersForExport(ctx, nw, nh, scale) {
  // Reuse one scratch canvas for all text layers.
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width  = nw;
  tempCanvas.height = nh;
  const tc = tempCanvas.getContext('2d', { willReadFrequently: true });

  const orderedObjects = [
    ...state.objects.filter(o => o.type === 'image'),
    ...state.objects.filter(o => o.type === 'text'),
  ];
  for (const tf of orderedObjects) {
    if (tf.type === 'image') {
      const s = tf.style;
      const opacity = clampObjectOpacity(s.opacity ?? 1);
      const cx = tf.xPct * nw;
      const cy = tf.yPct * nh;
      const objW = (s.size / 100) * nw;
      const objH = objW / Math.max(0.01, tf.aspect || 1);
      const glowPx = getObjectGlowRadiusPx(s.glow, scale);
      const rotDeg = s.rotateDeg || 0;
      tc.clearRect(0, 0, nw, nh);
      if (glowPx > 0) {
        tc.save();
        tc.translate(cx, cy);
        if (Math.abs(rotDeg) >= 0.01) tc.rotate(rotDeg * Math.PI / 180);
        if (tf.isVector) {
          tc.drawImage(tf.imgEl, -objW / 2, -objH / 2, objW, objH);
        } else {
          tc.fillStyle = '#ffffff';
          tc.fillRect(-objW / 2, -objH / 2, objW, objH);
        }
        tc.restore();
        blurCurrentAlphaIntoGlow(tc, nw, nh, '#ffffff', glowPx);
      }
      tc.save();
      tc.translate(cx, cy);
      if (Math.abs(rotDeg) >= 0.01) tc.rotate(rotDeg * Math.PI / 180);
      if (s.bgColor) {
        tc.fillStyle = s.bgColor;
        tc.fillRect(-objW / 2, -objH / 2, objW, objH);
      }
      tc.drawImage(tf.imgEl, -objW / 2, -objH / 2, objW, objH);
      tc.restore();
      if (s.blur > 0) {
        softBlur(tc, nw, nh, getObjectBlurRadiusPx(s.blur, scale));
      }
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
      continue;
    }
    if (tf.type !== 'text') continue;
    const s = tf.style;
    const opacity = clampObjectOpacity(s.opacity ?? 1);

    // Compute center position in natural image coords from normalized object
    // coordinates so export aligns with editor regardless of DOM offsets.
    const cx = tf.xPct * nw;
    const cy = tf.yPct * nh;

    // size is % of image width; apply directly against natural image width
    const fontSize = s.size / 100 * nw;
    const resolvedFontFamily = resolveFontFamilyStack(s.font);
    ctx.font = `${s.italic ? 'italic ' : ''}${s.weight} ${fontSize}px ${resolvedFontFamily}`;
    ctx.textAlign = s.align;
    ctx.textBaseline = 'middle';

    const lines = tf.innerEl.innerText.split('\n');
    const lineHeight = fontSize * (s.lineHeight ?? 1.2);
    const totalH = lines.length * lineHeight;
    const startY = cy - totalH / 2 + lineHeight / 2;
    const rotDeg = s.rotateDeg || 0;

    // For left/right alignment, offset x so the text block stays centered on cx
    const elHalfW = (tf.innerEl.offsetWidth * scale) / 2;
    const lx = s.align === 'left'  ? cx - elHalfW :
               s.align === 'right' ? cx + elHalfW :
               cx;

    // Draw text to a temp canvas, optionally software-blur it, then composite.
    tc.clearRect(0, 0, nw, nh);
    tc.font         = ctx.font;
    tc.textAlign    = s.align;
    tc.textBaseline = 'middle';
    const glowPx = getObjectGlowRadiusPx(s.glow, scale);
    if (Math.abs(rotDeg) < 0.01) {
      if (glowPx > 0) {
        lines.forEach((line, i) => {
          const ly = startY + i * lineHeight;
          if (s.outlineWidth > 0) {
            tc.lineWidth = s.outlineWidth * scale;
            tc.strokeStyle = '#ffffff';
            tc.lineJoin = 'round';
            tc.strokeText(line, lx, ly);
          }
          tc.fillStyle = '#ffffff';
          tc.fillText(line, lx, ly);
        });
        blurCurrentAlphaIntoGlow(tc, nw, nh, s.fgColor || '#ffffff', glowPx);
      }
      if (s.bgColor) {
        const bgW = tf.innerEl.offsetWidth * scale;
        const bgH = tf.innerEl.offsetHeight * scale;
        tc.fillStyle = s.bgColor;
        tc.fillRect(cx - bgW / 2, cy - bgH / 2, bgW, bgH);
      }

      lines.forEach((line, i) => {
        const ly = startY + i * lineHeight;

        if (s.outlineWidth > 0) {
          tc.lineWidth   = s.outlineWidth * scale;
          tc.strokeStyle = s.outlineColor;
          tc.lineJoin    = 'round';
          tc.strokeText(line, lx, ly);
        }

        tc.fillStyle = s.fgColor;
        tc.fillText(line, lx, ly);
      });
    } else {
      const rotRad = rotDeg * Math.PI / 180;
      const localStartY = -totalH / 2 + lineHeight / 2;
      const localHalfW = (tf.innerEl.offsetWidth * scale) / 2;
      const localX = s.align === 'left'  ? -localHalfW :
                     s.align === 'right' ? localHalfW :
                     0;
      tc.save();
      tc.translate(cx, cy);
      tc.rotate(rotRad);
      if (glowPx > 0) {
        lines.forEach((line, i) => {
          const ly = localStartY + i * lineHeight;
          if (s.outlineWidth > 0) {
            tc.lineWidth = s.outlineWidth * scale;
            tc.strokeStyle = '#ffffff';
            tc.lineJoin = 'round';
            tc.strokeText(line, localX, ly);
          }
          tc.fillStyle = '#ffffff';
          tc.fillText(line, localX, ly);
        });
        tc.restore();
        blurCurrentAlphaIntoGlow(tc, nw, nh, s.fgColor || '#ffffff', glowPx);
        tc.save();
        tc.translate(cx, cy);
        tc.rotate(rotRad);
      }
      if (s.bgColor) {
        const bgW = tf.innerEl.offsetWidth * scale;
        const bgH = tf.innerEl.offsetHeight * scale;
        tc.fillStyle = s.bgColor;
        tc.fillRect(-bgW / 2, -bgH / 2, bgW, bgH);
      }
      lines.forEach((line, i) => {
        const ly = localStartY + i * lineHeight;

        if (s.outlineWidth > 0) {
          tc.lineWidth   = s.outlineWidth * scale;
          tc.strokeStyle = s.outlineColor;
          tc.lineJoin    = 'round';
          tc.strokeText(line, localX, ly);
        }

        tc.fillStyle = s.fgColor;
        tc.fillText(line, localX, ly);
      });
      tc.restore();
    }

    if (s.blur > 0) {
      softBlur(tc, nw, nh, getObjectBlurRadiusPx(s.blur, scale));
    }
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();
  }
}

async function renderCurrentImageBlob(options = {}) {
  const exportStartTs = performance.now();
  const {
    mime = 'image/jpeg',
    quality = 0.93,
  } = options;
  const img = baseImage;
  const nw = state.imageNaturalW;
  const nh = state.imageNaturalH;

  // Scale factor: natural image pixels vs rendered pixels
  const renderedW = img.offsetWidth;
  const renderedH = img.offsetHeight;
  const scale = nw / renderedW;

  exportCanvas.width  = nw;
  exportCanvas.height = nh;
  const ctx = exportCanvas.getContext('2d', { willReadFrequently: true });
  let filterMs = 0;
  let textMs = 0;
  let workerUsed = false;
  let workerFallback = false;

  // Draw base image
  ctx.drawImage(img, 0, 0, nw, nh);
  if (paintLayer && state.paint.hasStrokes && paintLayer.width > 0 && paintLayer.height > 0) {
    ctx.drawImage(paintLayer, 0, 0, nw, nh);
  }

  // Apply filter before text (default behavior) or after text (on-top mode).
  if (!state.filter.applyOnTop) {
    const t0 = performance.now();
    const result = await applyActiveFilterToContext(ctx, nw, nh, scale);
    filterMs += performance.now() - t0;
    if (result) {
      workerUsed = workerUsed || !!result.usedWorker;
      workerFallback = workerFallback || !!result.fellBack;
    }
  }

  const textStartTs = performance.now();
  drawObjectLayersForExport(ctx, nw, nh, scale);
  textMs += performance.now() - textStartTs;

  if (state.filter.applyOnTop) {
    const t0 = performance.now();
    const result = await applyActiveFilterToContext(ctx, nw, nh, scale);
    filterMs += performance.now() - t0;
    if (result) {
      workerUsed = workerUsed || !!result.usedWorker;
      workerFallback = workerFallback || !!result.fellBack;
    }
  }

  const blobStartTs = performance.now();
  const blob = await new Promise(resolve =>
    exportCanvas.toBlob(resolve, mime, quality)
  );
  if (!blob) throw new Error(`Failed to render ${mime} image`);
  const endTs = performance.now();
  recordExportPerf({
    filter: state.filter.name,
    w: nw,
    h: nh,
    filterMs,
    textMs,
    encodeMs: endTs - blobStartTs,
    totalMs: endTs - exportStartTs,
    worker: workerUsed,
    workerFallback,
    applyOnTop: !!state.filter.applyOnTop,
  });
  return blob;
}

async function exportImage() {
  const blob = await renderCurrentImageBlob({ mime: 'image/jpeg', quality: 0.93 });
  const mime = 'image/jpeg';
  const ext = 'jpg';

  // Platform detection.
  // maxTouchPoints > 0 would catch Mac trackpads on newer macOS too, so be specific.
  const isIOS     = /iP(ad|hone|od)/i.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);

  if (isIOS) {
    // iOS: Web Share API is the one-tap path to Photos (iOS 15+, requires HTTPS).
    const file = new File([blob], `subtext.${ext}`, { type: mime });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled'; // user dismissed
        // Share failed for another reason — fall through to overlay
      }
    }
    // Older iOS / non-Safari fallback: show the image so the user can save it.
    showRenderedPreviewOverlay(blob, { iosSaveMode: true });
    return 'overlay';
  }

  // Android + Desktop: standard download link (<a download> works on both).
  // On Android this saves to the gallery/downloads folder directly.
  // On desktop we append a short hash so repeated exports have unique filenames.
  let filename = `subtext.${ext}`;
  if (!isAndroid) {
    const buffer    = await blob.arrayBuffer();
    const hashBytes = await crypto.subtle.digest('SHA-256', buffer);
    const hex       = Array.from(new Uint8Array(hashBytes))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
    filename = `subtext-${hex.slice(0, 6)}.${ext}`;
  }

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

async function copyImageToClipboard() {
  if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
    throw new Error('Clipboard image copy is not supported on this browser.');
  }
  const clipboardTypes = ['image/png', 'image/jpeg'];
  let lastError = null;
  for (const type of clipboardTypes) {
    try {
      const blob = await renderCurrentImageBlob({
        mime: type,
        quality: type === 'image/jpeg' ? 0.93 : undefined,
      });
      const item = new ClipboardItem({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Clipboard image copy failed.');
}

async function getClipboardWritePermissionState() {
  if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
    return 'unknown';
  }
  try {
    const result = await navigator.permissions.query({ name: 'clipboard-write' });
    return result?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

function isIOSLikePlatform() {
  return /iP(ad|hone|od)/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function refreshCopyActionAvailability() {
  let enabled =
    window.isSecureContext &&
    !!navigator.clipboard &&
    typeof window.ClipboardItem !== 'undefined';

  // iOS frequently exposes Clipboard APIs but blocks image writes in practice.
  if (enabled && isIOSLikePlatform()) {
    enabled = false;
  }

  if (enabled && typeof window.ClipboardItem.supports === 'function') {
    enabled =
      window.ClipboardItem.supports('image/png') ||
      window.ClipboardItem.supports('image/jpeg');
  }

  if (enabled) {
    const permissionState = await getClipboardWritePermissionState();
    if (permissionState === 'denied') enabled = false;
  }

  state.copyActionAvailable = enabled;
  if (copyBtn) copyBtn.classList.toggle('hidden', !enabled);
}

async function handleSaveAction() {
  try {
    const status = await exportImage();
    if (status === 'cancelled') {
      showHintMessage('Save cancelled');
      return;
    }
    if (status === 'overlay') {
      showHintMessage('Opened save preview');
      return;
    }
    if (status === 'shared') {
      showHintMessage('Shared image');
      return;
    }
    showHintMessage('Saved image');
  } catch {
    showHintMessage('Save failed');
  }
}

async function handleCopyAction() {
  if (!state.copyActionAvailable) {
    showHintMessage('Copy unavailable on this browser/device.');
    return;
  }
  if (!window.isSecureContext) {
    showHintMessage('Copy requires HTTPS (or localhost).');
    return;
  }
  const permissionState = await getClipboardWritePermissionState();
  if (permissionState === 'denied') {
    showHintMessage('Clipboard access denied by browser settings.');
    return;
  }
  try {
    await copyImageToClipboard();
    showHintMessage('Copied image');
  } catch (err) {
    const isNotAllowed = err?.name === 'NotAllowedError';
    const isIOS = isIOSLikePlatform();
    if (isNotAllowed && isIOS) {
      try {
        const blob = await renderCurrentImageBlob({ mime: 'image/jpeg', quality: 0.93 });
        showRenderedPreviewOverlay(blob, { iosSaveMode: true });
        showHintMessage('Clipboard blocked on iOS; opened save preview.');
        return;
      } catch {
        // Fall through to generic error hint if preview render fails.
      }
    }
    showHintMessage(err?.message || 'Copy failed');
  }
}

function showRenderedPreviewOverlay(blob, opts = {}) {
  const { iosSaveMode = false, title = 'Rendered Preview' } = opts;
  const url     = URL.createObjectURL(blob);
  const existing = document.getElementById('ios-save-overlay');
  if (existing) {
    const oldUrl = existing.dataset.blobUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    existing.remove();
  }
  const overlay = document.createElement('div');
  overlay.id    = 'ios-save-overlay';
  overlay.dataset.blobUrl = url;
  const top = document.createElement('div');
  top.className = 'ios-overlay-top';

  if (iosSaveMode) {
    // "Open Image" opens the blob in iOS Quick Look / Safari viewer, where
    // the user can tap the share icon → "Save Image" in one tap.
    const openLink = document.createElement('a');
    openLink.href   = url;
    openLink.target = '_blank';
    openLink.download = 'subtext.jpg';
    openLink.className = 'ios-open-btn';
    openLink.textContent = 'Open Image';
    top.appendChild(openLink);

    const msg = document.createElement('p');
    msg.textContent = 'Then tap the share icon ↗ and choose "Save Image".';
    top.appendChild(msg);

    const divider = document.createElement('p');
    divider.className = 'ios-overlay-divider';
    divider.textContent = '— or tap and hold the image below —';
    top.appendChild(divider);
  } else {
    const heading = document.createElement('p');
    heading.textContent = title;
    top.appendChild(heading);
  }

  const imageWrap = document.createElement('div');
  imageWrap.className = 'ios-overlay-image-wrap';
  const img = document.createElement('img');
  img.src   = url;
  imageWrap.appendChild(img);

  overlay.addEventListener('click', (e) => {
    if (e.target === img) return;
    closeRenderedPreviewOverlay();
  });

  const actions = document.createElement('div');
  actions.className = 'ios-overlay-actions';
  const btn = document.createElement('button');
  btn.textContent = 'Done';
  btn.addEventListener('click', closeRenderedPreviewOverlay);

  actions.appendChild(btn);
  overlay.appendChild(top);
  overlay.appendChild(imageWrap);
  overlay.appendChild(actions);
  document.body.appendChild(overlay);
}

function closeRenderedPreviewOverlay() {
  const overlay = document.getElementById('ios-save-overlay');
  if (!overlay) return;
  const url = overlay.dataset.blobUrl;
  overlay.remove();
  if (url) URL.revokeObjectURL(url);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

initGuides();
buildFontDropdown();
syncFontSelectDisplay();
syncPaintControls();
syncPaintInteractivity();
initSidebarSectionToggles();
switchPanelTab('typography'); // set initial data-panel attribute
exportBtn.addEventListener('click', handleSaveAction);
copyBtn.addEventListener('click', handleCopyAction);
void refreshCopyActionAvailability();

let _previewKeyTapCount = 0;
let _previewKeyTimer = 0;
const PREVIEW_KEY_DBL_TAP_MS = 800;
let _saveKeyTapCount = 0;
let _saveKeyTimer = 0;
let _copyKeyTapCount = 0;
let _copyKeyTimer = 0;
let _backKeyTapCount = 0;
let _backKeyTimer = 0;
let _addObjectKeyTapCount = 0;
let _addObjectKeyTimer = 0;
let _addTextKeyTapCount = 0;
let _addTextKeyTimer = 0;
let _uploadKeyTapCount = 0;
let _uploadKeyTimer = 0;
let _devKeyTapCount = 0;
let _devKeyTimer = 0;
const ACTION_KEY_DBL_TAP_MS = 800;

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!editorScreen.classList.contains('active')) return;
  if (e.key.toLowerCase() !== 'd') return;
  const active = document.activeElement;
  if (active?.isContentEditable) return;
  _devKeyTapCount += 1;
  if (_devKeyTapCount < 2) {
    if (_devKeyTimer) clearTimeout(_devKeyTimer);
    _devKeyTimer = setTimeout(() => {
      _devKeyTapCount = 0;
      _devKeyTimer = 0;
    }, ACTION_KEY_DBL_TAP_MS);
    return;
  }
  _devKeyTapCount = 0;
  if (_devKeyTimer) {
    clearTimeout(_devKeyTimer);
    _devKeyTimer = 0;
  }
  e.preventDefault();
  setDevMode(!perf.devMode);
});

window.addEventListener('keydown', async (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!editorScreen.classList.contains('active')) return;
  if (!state.imageLoaded) return;
  if (e.key.toLowerCase() !== 'p') return;

  const active = document.activeElement;
  if (active?.isContentEditable) {
    _previewKeyTapCount = 0;
    if (_previewKeyTimer) {
      clearTimeout(_previewKeyTimer);
      _previewKeyTimer = 0;
    }
    return;
  }

  _previewKeyTapCount += 1;
  if (_previewKeyTapCount < 2) {
    if (_previewKeyTimer) clearTimeout(_previewKeyTimer);
    _previewKeyTimer = setTimeout(() => {
      _previewKeyTapCount = 0;
      _previewKeyTimer = 0;
    }, PREVIEW_KEY_DBL_TAP_MS);
    return;
  }

  _previewKeyTapCount = 0;
  if (_previewKeyTimer) {
    clearTimeout(_previewKeyTimer);
    _previewKeyTimer = 0;
  }

  try {
    e.preventDefault();
    const blob = await renderCurrentImageBlob();
    showRenderedPreviewOverlay(blob, { title: 'Rendered JPEG Preview' });
  } catch {
    alert('Could not render preview image.');
  }
});

window.addEventListener('keydown', async (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!editorScreen.classList.contains('active')) return;
  if (!state.imageLoaded) return;
  const k = e.key.toLowerCase();
  if (k !== 's' && k !== 'c' && k !== 'n' && k !== 'o' && k !== 't') return;
  if (k === 'c' && !state.copyActionAvailable) return;

  const active = document.activeElement;
  if (active?.isContentEditable) {
    _saveKeyTapCount = 0;
    _copyKeyTapCount = 0;
    _backKeyTapCount = 0;
    _addObjectKeyTapCount = 0;
    _addTextKeyTapCount = 0;
    if (_saveKeyTimer) { clearTimeout(_saveKeyTimer); _saveKeyTimer = 0; }
    if (_copyKeyTimer) { clearTimeout(_copyKeyTimer); _copyKeyTimer = 0; }
    if (_backKeyTimer) { clearTimeout(_backKeyTimer); _backKeyTimer = 0; }
    if (_addObjectKeyTimer) { clearTimeout(_addObjectKeyTimer); _addObjectKeyTimer = 0; }
    if (_addTextKeyTimer) { clearTimeout(_addTextKeyTimer); _addTextKeyTimer = 0; }
    return;
  }

  if (k === 's') {
    _saveKeyTapCount += 1;
    if (_saveKeyTapCount < 2) {
      if (_saveKeyTimer) clearTimeout(_saveKeyTimer);
      _saveKeyTimer = setTimeout(() => {
        _saveKeyTapCount = 0;
        _saveKeyTimer = 0;
      }, ACTION_KEY_DBL_TAP_MS);
      return;
    }
    _saveKeyTapCount = 0;
    if (_saveKeyTimer) {
      clearTimeout(_saveKeyTimer);
      _saveKeyTimer = 0;
    }
    e.preventDefault();
    await handleSaveAction();
    return;
  }

  if (k === 'n') {
    _backKeyTapCount += 1;
    if (_backKeyTapCount < 2) {
      if (_backKeyTimer) clearTimeout(_backKeyTimer);
      _backKeyTimer = setTimeout(() => {
        _backKeyTapCount = 0;
        _backKeyTimer = 0;
      }, ACTION_KEY_DBL_TAP_MS);
      return;
    }
    _backKeyTapCount = 0;
    if (_backKeyTimer) {
      clearTimeout(_backKeyTimer);
      _backKeyTimer = 0;
    }
    e.preventDefault();
    backBtn?.click();
    return;
  }

  if (k === 'o') {
    _addObjectKeyTapCount += 1;
    if (_addObjectKeyTapCount < 2) {
      if (_addObjectKeyTimer) clearTimeout(_addObjectKeyTimer);
      _addObjectKeyTimer = setTimeout(() => {
        _addObjectKeyTapCount = 0;
        _addObjectKeyTimer = 0;
      }, ACTION_KEY_DBL_TAP_MS);
      return;
    }
    _addObjectKeyTapCount = 0;
    if (_addObjectKeyTimer) {
      clearTimeout(_addObjectKeyTimer);
      _addObjectKeyTimer = 0;
    }
    if (state.uploadBusy) return;
    e.preventDefault();
    addObjectInput?.click();
    return;
  }

  if (k === 't') {
    _addTextKeyTapCount += 1;
    if (_addTextKeyTapCount < 2) {
      if (_addTextKeyTimer) clearTimeout(_addTextKeyTimer);
      _addTextKeyTimer = setTimeout(() => {
        _addTextKeyTapCount = 0;
        _addTextKeyTimer = 0;
      }, ACTION_KEY_DBL_TAP_MS);
      return;
    }
    _addTextKeyTapCount = 0;
    if (_addTextKeyTimer) {
      clearTimeout(_addTextKeyTimer);
      _addTextKeyTimer = 0;
    }
    e.preventDefault();
    dismissHint();
    const tf = addTextField(0.5, 0.5);
    tf?.innerEl?.focus({ preventScroll: true });
    return;
  }

  _copyKeyTapCount += 1;
  if (_copyKeyTapCount < 2) {
    if (_copyKeyTimer) clearTimeout(_copyKeyTimer);
    _copyKeyTimer = setTimeout(() => {
      _copyKeyTapCount = 0;
      _copyKeyTimer = 0;
    }, ACTION_KEY_DBL_TAP_MS);
    return;
  }
  _copyKeyTapCount = 0;
  if (_copyKeyTimer) {
    clearTimeout(_copyKeyTimer);
    _copyKeyTimer = 0;
  }
  e.preventDefault();
  await handleCopyAction();
});

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!uploadScreen.classList.contains('active')) return;
  if (state.uploadBusy) return;
  if (e.key.toLowerCase() !== 'n') return;

  _uploadKeyTapCount += 1;
  if (_uploadKeyTapCount < 2) {
    if (_uploadKeyTimer) clearTimeout(_uploadKeyTimer);
    _uploadKeyTimer = setTimeout(() => {
      _uploadKeyTapCount = 0;
      _uploadKeyTimer = 0;
    }, ACTION_KEY_DBL_TAP_MS);
    return;
  }

  _uploadKeyTapCount = 0;
  if (_uploadKeyTimer) {
    clearTimeout(_uploadKeyTimer);
    _uploadKeyTimer = 0;
  }
  e.preventDefault();
  fileInput?.click();
});

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!editorScreen.classList.contains('active')) return;
  if (!state.selectedObject) return;
  const active = document.activeElement;
  if (active?.isContentEditable) return;

  const stepPx = e.shiftKey ? 5 : 1;
  let dxPx = 0;
  let dyPx = 0;
  if (e.key === 'ArrowLeft') dxPx = -stepPx;
  else if (e.key === 'ArrowRight') dxPx = stepPx;
  else if (e.key === 'ArrowUp') dyPx = -stepPx;
  else if (e.key === 'ArrowDown') dyPx = stepPx;
  else return;

  e.preventDefault();
  const cw = Math.max(1, canvasContainer.offsetWidth);
  const ch = Math.max(1, canvasContainer.offsetHeight);
  const obj = state.selectedObject;
  obj.xPct = Math.max(0, Math.min(1, obj.xPct + (dxPx / cw)));
  obj.yPct = Math.max(0, Math.min(1, obj.yPct + (dyPx / ch)));
  obj.repositionFast?.();
  syncSizeControlBoundsForObject(obj);
  markPreviewSourceDirty();
  scheduleImageFilterRender({ interactive: true });
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!editorScreen.classList.contains('active')) return;
  const active = document.activeElement;
  if (active?.isContentEditable) return;
  if (!state.selectedObject) return;
  e.preventDefault();
  deleteField(state.selectedObject);
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('ios-save-overlay');
  if (overlay) {
    closeRenderedPreviewOverlay();
    return;
  }
  if (state.selectedObject) {
    e.preventDefault();
    deselectAll();
  }
});

// ─── Window resize: reposition all fields ────────────────────────────────────

window.addEventListener('resize', () => {
  if (_resizeRaf) return;
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = 0;
    state.objects.forEach(tf => tf.reposition());
    if (state.imageLoaded) {
      fitImageToWrapper();
      syncPaintInteractivity();
      markPreviewSourceDirty();
      scheduleImageFilterRender({ settle: true });
    }
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    handleAppBecameHidden();
  } else {
    handleAppBecameVisible();
  }
});

window.addEventListener('pagehide', () => {
  handleAppBecameHidden();
});

window.addEventListener('pageshow', () => {
  if (document.visibilityState !== 'hidden') {
    handleAppBecameVisible();
  }
});

// ─── Prevent accidental back/navigation ──────────────────────────────────────

window.addEventListener('beforeunload', (e) => {
  if (state.imageLoaded && state.objects.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

if ('serviceWorker' in navigator) {
  const isLocalhost =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]';
  window.addEventListener('load', async () => {
    if (isLocalhost) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {}
      return;
    }

    if (location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    }
  });
}
