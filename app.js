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
  textFields: [],        // array of TextField objects
  selectedField: null,   // currently selected TextField or null
  lastStyle: null,       // style copied from last-edited field (for new field defaults)
  lastPreset: 'classic', // preset name of last-edited field (or null if manually edited)
  dragState: null,       // { field, startX, startY, origLeft, origTop }
  filter: { name: 'none', intensity: 75, params: {}, applyOnTop: false },
  copyActionAvailable: true,
};

// Preset styles
const PRESETS = {
  classic: {
    font:         "var(--font-helvetica)",
    size:         5,   // percent of image width
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
    weight:       '400',
    italic:       false,
    align:        'center',
    fgColor:      '#f0e2c0',
    outlineColor: '#1a1008',
    outlineWidth: 3,
    blur:         0,
  },
};

// ─── Image vibes ───────────────────────────────────────────────────────────────

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// Each vibe has:
//   cssPreview(t)         → CSS filter string for instant live preview (t = 0–1)
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

  twilight: {
    label: 'Twilight',
    cssPreview: (t) =>
      `saturate(${1 - 0.04*t}) hue-rotate(${-12*t}deg) brightness(${1 - 0.12*t}) contrast(${1 + 0.1*t})`,
    apply(data, w, h, t) {
      for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i+1], b = data[i+2];
        const lm = 0.299*r + 0.587*g + 0.114*b;
        const bright = lm / 255;

        // Aggressive cool cast with added green for cyan/teal balance.
        r = clamp255(r - (32 + 14 * bright) * t);
        g = clamp255(g + (20 + 14 * (1 - bright)) * t);
        b = clamp255(b + (50 + 24 * (1 - bright)) * t);

        // Keep it moody while preserving strong chroma in blues.
        const s = 1 - 0.03 * t;
        r = clamp255(lm + (r - lm) * s);
        g = clamp255(lm + (g - lm) * s);
        b = clamp255(lm + (b - lm) * s);

        // Stronger contrast + darker exposure.
        const c = 1 + 0.1 * t;
        const br = 1 - 0.12 * t;
        data[i]   = clamp255(((r - 128) * c + 128) * br);
        data[i+1] = clamp255(((g - 128) * c + 128) * br);
        data[i+2] = clamp255(((b - 128) * c + 128) * br);
      }
    },
  },

  mexico: {
    label: 'Mexico',
    cssPreview: (t) =>
      `sepia(${0.8*t}) saturate(${1 + 0.2*t}) hue-rotate(${-20*t}deg) brightness(${1 - 0.1*t}) contrast(1)`,
    apply(data, w, h, t) {
      // Polynomial LUT-like transform fitted to the approved Mexico reference.
      // Features: [1, r, g, b, r^2, g^2, b^2, rg, rb, gb, r^3, g^3, b^3]
      // Output is blended with source by intensity t so the slider remains smooth.
      const C = [
        [-0.03113131,  0.00791518,  0.00020257],
        [ 1.6186612,   0.12332164, -0.29436573],
        [ 0.30831575,  0.11437935,  0.40113863],
        [-0.07751509,  0.08578058,  0.04193583],
        [ 1.3786694,  -0.927459,    0.8342466],
        [ 0.66139346,  0.7589711,  -0.5263351],
        [ 0.00356758, -0.11500254, -0.19840924],
        [-1.5515617,   1.399745,   -0.7633836],
        [ 0.65784,    -0.35091248,  0.19579142],
        [-0.7448524,   0.34371102, -0.3687974],
        [-1.7140733,   0.30859822, -0.32110405],
        [ 0.22647619, -0.7518108,   0.823262],
        [ 0.18237661,  0.01828179,  0.87928236],
      ];
      const blend = Math.max(0, Math.min(1, t));
      const invBlend = 1 - blend;

      for (let i = 0; i < data.length; i += 4) {
        const sr = data[i] / 255;
        const sg = data[i + 1] / 255;
        const sb = data[i + 2] / 255;
        const rr = sr * sr;
        const gg = sg * sg;
        const bb = sb * sb;
        const rrr = rr * sr;
        const ggg = gg * sg;
        const bbb = bb * sb;
        const rg = sr * sg;
        const rb = sr * sb;
        const gb = sg * sb;

        const f = [1, sr, sg, sb, rr, gg, bb, rg, rb, gb, rrr, ggg, bbb];
        let tr = 0;
        let tg = 0;
        let tb = 0;
        for (let k = 0; k < 13; k++) {
          tr += f[k] * C[k][0];
          tg += f[k] * C[k][1];
          tb += f[k] * C[k][2];
        }
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
    apply(data, w, h, t, params, pixelScale = 1) {
      const orig = new Uint8ClampedArray(data);
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
    apply(data, w, h, t, params = {}, pixelScale = 1) {
      const orig = new Uint8ClampedArray(data);
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

      for (let y = 0; y < h; y++) {
        const wobble = Math.round(Math.sin(y * 0.08) * wobbleAmp);
        const yBase = y * w * 4;
        const g1y = y + dy1 < 0 ? 0 : y + dy1 >= h ? h - 1 : y + dy1;
        const g2y = y - dy2 < 0 ? 0 : y - dy2 >= h ? h - 1 : y - dy2;
        const g1BaseY = g1y * w * 4;
        const g2BaseY = g2y * w * 4;
        const dx1 = Math.round(dirX * shift1) + wobble;
        const dx2 = Math.round(dirX * shift2) + Math.round(wobble * 0.5);

        for (let x = 0; x < w; x++) {
          const xm1 = x > 0 ? x - 1 : 0;
          const xp1 = x < w - 1 ? x + 1 : w - 1;
          const g1x = x + dx1 < 0 ? 0 : x + dx1 >= w ? w - 1 : x + dx1;
          const g1x1 = g1x < w - 1 ? g1x + 1 : w - 1;
          const g2x = x - dx2 < 0 ? 0 : x - dx2 >= w ? w - 1 : x - dx2;
          const g2x1 = g2x > 0 ? g2x - 1 : 0;
          const i = yBase + x * 4;

          for (let c = 0; c < 3; c++) {
            // In-place smear + two directional ghost copies.
            const base = (orig[yBase + xm1 * 4 + c] + orig[yBase + x * 4 + c] + orig[yBase + xp1 * 4 + c]) / 3;
            const g1 = (orig[g1BaseY + g1x * 4 + c] + orig[g1BaseY + g1x1 * 4 + c]) / 2;
            const g2 = (orig[g2BaseY + g2x * 4 + c] + orig[g2BaseY + g2x1 * 4 + c]) / 2;
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
  vaporwave:   { scanlines: 60, scanlineSize: 2, chroma: 20 },
  twilight:    {},
  mexico:      {},
  darkAcademia: { grain: 45, vignette: 65 },
  solarpunk:   { bloom: 35, haze: 25 },
  hegseth:     { angle: 0, ghostDistance: 50 },
};

function defaultStyle() {
  return state.lastStyle ? { ...state.lastStyle } : { ...PRESETS.classic, blur: 0 };
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const uploadScreen   = document.getElementById('upload-screen');
const editorScreen   = document.getElementById('editor-screen');
const fileInput      = document.getElementById('file-input');
const backBtn        = document.getElementById('back-btn');
const exportBtn      = document.getElementById('export-btn');
const copyBtn        = document.getElementById('copy-btn');
const baseImage      = document.getElementById('base-image');
const canvasWrapper   = document.getElementById('canvas-wrapper');
const canvasContainer = document.getElementById('canvas-container');
const canvasHint      = document.getElementById('canvas-hint');
const exportCanvas   = document.getElementById('export-canvas');

// True on phones/tablets — used to gate the single-tap-to-select behaviour.
const isMobile = navigator.maxTouchPoints > 0;

const fontControls   = document.getElementById('font-controls');
const bottomPanel    = document.getElementById('bottom-panel');
const panelTabBtns   = document.querySelectorAll('.panel-tab');

const ctrlFont         = document.getElementById('ctrl-font');
const ctrlFontWrap     = document.getElementById('ctrl-font-wrap');
const ctrlFontTrigger  = document.getElementById('ctrl-font-trigger');
const ctrlFontLabel    = document.getElementById('ctrl-font-label');
const ctrlFontMenu     = document.getElementById('ctrl-font-menu');
const ctrlSize         = document.getElementById('ctrl-size');
const ctrlSizeVal      = document.getElementById('ctrl-size-val');
const ctrlBold         = document.getElementById('ctrl-bold');
const ctrlItalic       = document.getElementById('ctrl-italic');
const ctrlBlur         = document.getElementById('ctrl-blur');
const ctrlFgColor      = document.getElementById('ctrl-fg-color');
const ctrlOutlineColor = document.getElementById('ctrl-outline-color');
const ctrlOutlineWidth = document.getElementById('ctrl-outline-width');
const ctrlOutlineWidthVal = document.getElementById('ctrl-outline-width-val');
const ctrlAutoContrast = document.getElementById('ctrl-auto-contrast');
const alignBtns        = document.querySelectorAll('.align-btn');
const presetBtns       = document.querySelectorAll('.preset-btn');
const uploadStatus     = document.getElementById('upload-status');
const uploadStatusText = document.getElementById('upload-status-text');

// ─── Image loading ─────────────────────────────────────────────────────────────

const HEIC_MIME_RE = /^image\/hei(c|f|x|s)$/i;
const HEIC_EXT_RE  = /\.(hei(c|f|x|s))$/i;
const IMAGE_EXT_RE = /\.(avif|bmp|gif|heic|heif|heix|heis|jpg|jpeg|jpe|jfif|png|tif|tiff|webp)$/i;

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

function isMobileViewport() {
  return window.matchMedia('(max-width: 769px)').matches;
}

function updateMobileTrayHeight() {
  if (!bottomPanel) return;
  if (!isMobileViewport()) {
    bottomPanel.style.height = '';
    return;
  }

  const prevTab = bottomPanel.dataset.panel || 'typography';
  const prevHeight = bottomPanel.style.height;
  const prevFontFlex = fontControls?.style.flex || '';
  bottomPanel.dataset.panel = 'typography';
  bottomPanel.style.height = 'auto';
  if (fontControls) fontControls.style.flex = 'none';

  const tabsEl = document.getElementById('panel-tabs');
  const tabsH = tabsEl ? Math.ceil(tabsEl.getBoundingClientRect().height) : 0;
  const controlsH = fontControls ? Math.ceil(fontControls.scrollHeight) : 0;
  const computed = getComputedStyle(bottomPanel);
  const borderTop = parseFloat(computed.borderTopWidth || '0') || 0;
  const padTop = parseFloat(computed.paddingTop || '0') || 0;
  const padBottom = parseFloat(computed.paddingBottom || '0') || 0;
  const total = Math.ceil(
    borderTop +
    padTop +
    tabsH +
    controlsH +
    padBottom
  );
  bottomPanel.style.height = `${total}px`;

  if (fontControls) fontControls.style.flex = prevFontFlex;
  bottomPanel.dataset.panel = prevTab;
  if (!total) bottomPanel.style.height = prevHeight;
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
  state.textFields.forEach(tf => tf.el.remove());
  state.textFields = [];
  state.selectedField = null;
  state.lastStyle = null;
  // Always start on the Typography tab when opening the editor
  switchPanelTab('typography');
  updatePanel();
  // Size image to fill available space after layout is committed
  requestAnimationFrame(() => {
    updateMobileTrayHeight();
    fitImageToWrapper();
    // Force fresh preview render so pixel-overlay vibes don't show stale image data.
    scheduleImageFilterRender();
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
  deselectAll();
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
  filterChips.forEach(c => c.classList.toggle('active', c.dataset.filter === 'none'));
  filterIntensityRow.classList.add('hidden');
  filterLayerRow.classList.add('hidden');
  filterFilmControls.classList.add('hidden');
  filterVaporControls.classList.add('hidden');
  filterDarkAcadControls.classList.add('hidden');
  filterSolarpunkControls.classList.add('hidden');
  filterHegsethControls.classList.add('hidden');
  ctrlFilterIntensity.value = 75;
  ctrlFilterOnTop.checked = false;
  if (_filterRenderRaf) {
    cancelAnimationFrame(_filterRenderRaf);
    _filterRenderRaf = 0;
  }
  setUploadBusy(false);
}

fileInput.addEventListener('change', (e) => {
  loadImageFile(e.target.files[0]);
});

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

// Drag-and-drop onto the editor to replace current image and reset session.
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
  loadImageFile(file, { resetSession: true });
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
  if (confirm('Start over? Your captions will be lost.')) {
    showUpload();
  }
});

// ─── TextField class ───────────────────────────────────────────────────────────

let _fieldId = 0;

class TextField {
  constructor(xPct, yPct, style) {
    this.id = _fieldId++;
    this.xPct = xPct;   // center-x as fraction of container width
    this.yPct = yPct;   // center-y as fraction of container height
    this.style = { ...style };
    this.text = '';
    this.autoContrastStep = 0;
    this.el = null;
    this.innerEl = null;
    this._build();
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'text-field';
    wrap.dataset.id = this.id;

    const del = document.createElement('div');
    del.className = 'text-field-delete';
    del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor" aria-hidden="true"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
    del.title = 'Delete';

    const drag = document.createElement('div');
    drag.className = 'text-field-drag';
    drag.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor" aria-hidden="true"><path d="M360-160q-33 0-56.5-23.5T280-240q0-33 23.5-56.5T360-320q33 0 56.5 23.5T440-240q0 33-23.5 56.5T360-160Zm240 0q-33 0-56.5-23.5T520-240q0-33 23.5-56.5T600-320q33 0 56.5 23.5T680-240q0 33-23.5 56.5T600-160ZM360-400q-33 0-56.5-23.5T280-480q0-33 23.5-56.5T360-560q33 0 56.5 23.5T440-480q0 33-23.5 56.5T360-400Zm240 0q-33 0-56.5-23.5T520-480q0-33 23.5-56.5T600-560q33 0 56.5 23.5T680-480q0 33-23.5 56.5T600-400ZM360-640q-33 0-56.5-23.5T280-720q0-33 23.5-56.5T360-800q33 0 56.5 23.5T440-720q0 33-23.5 56.5T360-640Zm240 0q-33 0-56.5-23.5T520-720q0-33 23.5-56.5T600-800q33 0 56.5 23.5T680-720q0 33-23.5 56.5T600-640Z"/></svg>';
    drag.title = 'Move';

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
    wrap.appendChild(drag);
    wrap.appendChild(inner);
    canvasContainer.appendChild(wrap);

    this.el = wrap;
    this.innerEl = inner;
    this.delEl = del;
    this.dragEl = drag;

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
    inner.style.fontWeight    = s.weight;
    inner.style.fontStyle     = s.italic ? 'italic' : 'normal';
    inner.style.textAlign     = s.align;
    inner.style.color         = s.fgColor;

    // Blur (defocus) effect
    const previewBlur = getPreviewTextBlurPx(s.blur, previewScale, { forDom: true });
    inner.style.filter = previewBlur > 0 ? `blur(${previewBlur.toFixed(3)}px)` : '';

    // Text outline using -webkit-text-stroke
    if (s.outlineWidth > 0) {
      inner.style.webkitTextStroke = `${s.outlineWidth}px ${s.outlineColor}`;
      inner.style.paintOrder = 'stroke fill';
    } else {
      inner.style.webkitTextStroke = '0px transparent';
    }

    // Min-width so small text is still tappable
    inner.style.minWidth = Math.max(60, px * 3) + 'px';
  }

  _positionEl() {
    const cw = canvasContainer.offsetWidth;
    const ch = canvasContainer.offsetHeight;
    const x  = this.xPct * cw;
    const y  = this.yPct * ch;

    // Center the element on (x, y)
    this.el.style.left      = x + 'px';
    this.el.style.top       = y + 'px';
    this.el.style.transform = 'translate(-50%, -50%)';
  }

  _attachEvents() {
    // PRIMARY SELECTION: rely on the browser's native focus event.
    // This fires whenever the user clicks or tabs into the contenteditable,
    // which is far more reliable than intercepting pointerdown ourselves.
    this.innerEl.addEventListener('focus', () => {
      selectField(this);
    });

    // MOBILE: intercept taps on the inner element so that a first tap only
    // selects the field (no keyboard), and a second tap on an already-selected
    // field allows focus through normally (keyboard appears).
    // On desktop, let the browser handle focus natively with no intervention.
    this.innerEl.addEventListener('pointerdown', (e) => {
      if (!isMobile) return;
      if (state.selectedField !== this) {
        e.preventDefault(); // blocks focus → no keyboard on first tap
        selectField(this);
      }
      // already selected → fall through → browser focuses → keyboard appears
    });

    // POINTER on wrapper: stop propagation to canvas listeners and forward
    // focus to innerEl if the click landed on the wrapper border area.
    // Dragging is handled exclusively by the drag handle.
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.delEl || e.target === this.dragEl) return;
      // Stop propagation so the canvas double-tap detector doesn't see this.
      e.stopPropagation();

      if (e.target !== this.innerEl) {
        e.preventDefault();
        // Mobile: only focus (open keyboard) if the field is already selected.
        if (!isMobile || state.selectedField === this) {
          this.innerEl.focus();
        } else {
          selectField(this);
        }
      }
    });

    // Dedicated drag handle — preventDefault here is safe because this element
    // is not a contenteditable, so it won't suppress focus elsewhere.
    this.dragEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault(); // prevents text selection / ghost image on desktop
      selectField(this);
      startDrag(e, this);
    });

    // Delete button
    this.delEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.delEl.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteField(this);
    });

    // Keep text in sync
    this.innerEl.addEventListener('input', () => {
      this.text = this.innerEl.textContent;
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
    Object.assign(this.style, patch);
    this._applyStyle();
    // Reposition in case font-size changed and element grew
    this._positionEl();
  }

  reposition() {
    this._applyStyle(); // pixel size depends on container width; recompute on resize
    this._positionEl();
  }

  select() {
    this.el.classList.add('selected');
  }

  deselect() {
    this.el.classList.remove('selected');
    this.innerEl.blur();
  }
}

// ─── Field management ─────────────────────────────────────────────────────────

function addTextField(xPct, yPct) {
  const style = defaultStyle();
  const tf = new TextField(xPct, yPct, style);
  tf.activePreset = state.lastPreset; // inherit last-used preset (null = manually edited)
  state.textFields.push(tf);
  // Don't call selectField() here — the focus event on innerEl will do it.
  // Use a short timeout so the element is fully laid out before focus.
  tf.el.classList.add('selected'); // show as selected immediately
  updatePanel();                   // show controls immediately
  loadFieldStyle(tf);
  // Ensure layer-mode filter preview is applied to newly created text fields.
  applyImageFilter();
  setTimeout(() => tf.innerEl.focus(), 30);
  return tf;
}

function deleteField(tf) {
  tf.el.remove();
  state.textFields = state.textFields.filter(f => f !== tf);
  if (state.selectedField === tf) {
    state.selectedField = null;
  }
  updatePanel();
}

function selectField(tf) {
  if (state.selectedField === tf) {
    // Already selected — let the browser handle click/cursor natively
    return;
  }
  if (state.selectedField) {
    state.selectedField.deselect();
    state.lastStyle  = { ...state.selectedField.style };
    state.lastPreset = state.selectedField.activePreset ?? null;
  }
  state.selectedField = tf;
  tf.select();
  syncTextFieldLayering();
  scheduleImageFilterRender();
  loadFieldStyle(tf);
  updatePanel();
}

function deselectAll() {
  if (state.selectedField) {
    state.lastStyle  = { ...state.selectedField.style };
    state.lastPreset = state.selectedField.activePreset ?? null;
    state.selectedField.deselect();
    state.selectedField = null;
  }
  syncTextFieldLayering();
  scheduleImageFilterRender();
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
    addTextField(xPct, yPct);
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

const guideVEls = []; // vertical lines (x positions)
const guideHEls = []; // horizontal lines (y positions)

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

// ─── Drag to move ─────────────────────────────────────────────────────────────

function startDrag(e, tf) {
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

    tf.reposition();
    showGuides(true, snapX, snapY);
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    showGuides(false);
    snapX = null;
    snapY = null;
    if (dragging) {
      tf.innerEl.blur();
    }
  }

  // { passive: false } is required to allow preventDefault() inside onMove;
  // browsers mark touch listeners passive by default which blocks preventDefault.
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
}

// ─── Panel / controls ─────────────────────────────────────────────────────────

function updatePanel() {
  if (ctrlAutoContrast) {
    const hasSelectedField = !!state.selectedField;
    ctrlAutoContrast.disabled = !hasSelectedField;
    ctrlAutoContrast.title = hasSelectedField
      ? 'Automatically optimize text contrast for the selected field'
      : 'Select a text field first';
  }
}

function syncControlsToStyle(s, activePreset) {
  ctrlFont.value                  = s.font;
  syncFontSelectDisplay();
  ctrlSize.value                  = s.size;
  ctrlSizeVal.textContent         = s.size + '%';
  ctrlBold.classList.toggle('active', parseInt(s.weight) >= 700);
  ctrlItalic.classList.toggle('active', s.italic);
  ctrlFgColor.value               = s.fgColor;
  ctrlOutlineColor.value          = s.outlineColor;
  ctrlOutlineWidth.value          = s.outlineWidth;
  ctrlOutlineWidthVal.textContent = s.outlineWidth;
  ctrlBlur.value                  = s.blur ?? 0;
  alignBtns.forEach(b => b.classList.toggle('active', b.dataset.align === s.align));
  presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === activePreset));
}

function loadFieldStyle(tf) {
  syncControlsToStyle(tf.style, tf.activePreset);
}

function applyControlsToSelected(patch) {
  if (!state.selectedField) {
    // No field selected — accumulate changes into lastStyle so the next
    // new field picks them up instead of reverting to Classic defaults.
    const base = state.lastStyle ?? { ...PRESETS.classic, blur: 0 };
    state.lastStyle = { ...base, ...patch };
    return;
  }
  state.selectedField.updateStyle(patch);
  state.lastStyle = { ...state.selectedField.style };
}

// Clear the active preset indicator when the user manually edits any control.
function clearPreset() {
  if (state.selectedField) state.selectedField.activePreset = null;
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
  ctx.drawImage(baseImage, 0, 0, w, h);
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
  const tf = state.selectedField;
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
  requestAnimationFrame(() => {
    updateMobileTrayHeight();
    if (state.imageLoaded) {
      fitImageToWrapper();
    }
  });
}

panelTabBtns.forEach(tab => {
  tab.addEventListener('click', () => switchPanelTab(tab.dataset.tab));
});

// ─── Control listeners ────────────────────────────────────────────────────────

ctrlFont.addEventListener('change', () => {
  applyControlsToSelected({ font: ctrlFont.value });
  syncFontSelectDisplay();
  clearPreset();
});

ctrlSize.addEventListener('input', () => {
  const v = parseFloat(ctrlSize.value);
  ctrlSizeVal.textContent = v + '%';
  applyControlsToSelected({ size: v });
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
  applyControlsToSelected({ blur: parseFloat(ctrlBlur.value) });
  clearPreset();
});

// ─── Image filter controls ─────────────────────────────────────────────────────

const filterChips          = document.querySelectorAll('.filter-chip');
const filterIntensityRow   = document.getElementById('filter-intensity-row');
const filterIntensityLabel = document.getElementById('filter-intensity-label');
const filterLayerRow       = document.getElementById('filter-layer-row');
const ctrlFilterIntensity  = document.getElementById('ctrl-filter-intensity');
const ctrlFilterOnTop      = document.getElementById('ctrl-filter-on-top');
const filterFilmControls   = document.getElementById('filter-film-controls');
const filterVaporControls  = document.getElementById('filter-vaporwave-controls');
const filterDarkAcadControls = document.getElementById('filter-darkacademia-controls');
const filterSolarpunkControls = document.getElementById('filter-solarpunk-controls');
const filterHegsethControls = document.getElementById('filter-hegseth-controls');
const ctrlGrain            = document.getElementById('ctrl-grain');
const ctrlScanlines        = document.getElementById('ctrl-scanlines');
const ctrlScanlineSize     = document.getElementById('ctrl-scanline-size');
const ctrlChroma           = document.getElementById('ctrl-chroma');
const ctrlDaGrain          = document.getElementById('ctrl-da-grain');
const ctrlVignette         = document.getElementById('ctrl-vignette');
const ctrlBloom            = document.getElementById('ctrl-bloom');
const ctrlHaze             = document.getElementById('ctrl-haze');
const ctrlHegsethAngle     = document.getElementById('ctrl-hegseth-angle');
const ctrlHegsethGhostDistance = document.getElementById('ctrl-hegseth-ghost-distance');

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
let vaporSrcCanvas = null;
let vaporSrcCtx    = null;
let grainBuffer    = null;
let grainBufferW   = 0;
let grainBufferH   = 0;
let grainNoiseTs   = 0;

function makeOverlayCanvas() {
  const el = document.createElement('canvas');
  el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
  baseImage.insertAdjacentElement('afterend', el);
  return el;
}

function updateOverlayLayering(el) {
  if (!el) return;
  el.style.zIndex = state.filter.applyOnTop ? '30' : 'auto';
}

function isPixelPreviewFilter(name) {
  return name !== 'none';
}

function syncTextFieldLayering() {
  const onTopPixelFilter = state.filter.applyOnTop && isPixelPreviewFilter(state.filter.name);
  for (const tf of state.textFields) {
    tf.el.style.zIndex = (onTopPixelFilter && state.selectedField === tf) ? '40' : 'auto';
  }
}

function isTextFilterBypassed(tf) {
  return state.filter.applyOnTop && state.selectedField === tf;
}

function drawPreviewTextLayers(ctx, w, h) {
  const previewScale = (baseImage.offsetWidth > 0)
    ? (state.imageNaturalW / baseImage.offsetWidth)
    : 1;
  const containerRect = canvasContainer.getBoundingClientRect();
  const imgRect = baseImage.getBoundingClientRect();
  const imgOffsetX = imgRect.left - containerRect.left;
  const imgOffsetY = imgRect.top  - containerRect.top;

  for (const tf of state.textFields) {
    if (isTextFilterBypassed(tf)) continue;
    const s = tf.style;
    const cx = tf.xPct * canvasContainer.offsetWidth  - imgOffsetX;
    const cy = tf.yPct * canvasContainer.offsetHeight - imgOffsetY;
    const fontSize = s.size / 100 * w;
    const lines = tf.innerEl.innerText.split('\n');
    const lineHeight = fontSize * 1.2;
    const totalH = lines.length * lineHeight;
    const startY = cy - totalH / 2 + lineHeight / 2;
    const elHalfW = tf.innerEl.offsetWidth / 2;
    const lx = s.align === 'left'  ? cx - elHalfW :
               s.align === 'right' ? cx + elHalfW :
               cx;

    const resolvedFontFamily = resolveFontFamilyStack(s.font);
    ctx.font = `${s.italic ? 'italic ' : ''}${s.weight} ${fontSize}px ${resolvedFontFamily}`;
    ctx.textAlign = s.align;
    ctx.textBaseline = 'middle';
    const previewBlur = getPreviewTextBlurPx(s.blur, previewScale);
    ctx.filter = previewBlur > 0 ? `blur(${previewBlur.toFixed(3)}px)` : 'none';

    lines.forEach((line, i) => {
      const ly = startY + i * lineHeight;
      if (s.outlineWidth > 0) {
        ctx.lineWidth = s.outlineWidth;
        ctx.strokeStyle = s.outlineColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, lx, ly);
      }
      ctx.fillStyle = s.fgColor;
      ctx.fillText(line, lx, ly);
    });
    ctx.filter = 'none';
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
  if (!vaporSrcCanvas) {
    vaporSrcCanvas = document.createElement('canvas');
    vaporSrcCtx = vaporSrcCanvas.getContext('2d');
  }
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  vaporSrcCtx.drawImage(baseImage, 0, 0, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewTextLayers(vaporSrcCtx, w, h);
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

  if (!vaporSrcCanvas) {
    vaporSrcCanvas = document.createElement('canvas');
    vaporSrcCtx = vaporSrcCanvas.getContext('2d');
  }
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  vaporSrcCtx.drawImage(baseImage, 0, 0, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewTextLayers(vaporSrcCtx, w, h);
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

  if (!vaporSrcCanvas) {
    vaporSrcCanvas = document.createElement('canvas');
    vaporSrcCtx = vaporSrcCanvas.getContext('2d');
  }
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  vaporSrcCtx.drawImage(baseImage, 0, 0, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewTextLayers(vaporSrcCtx, w, h);
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

  if (!vaporSrcCanvas) {
    vaporSrcCanvas = document.createElement('canvas');
    vaporSrcCtx = vaporSrcCanvas.getContext('2d');
  }
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  vaporSrcCtx.drawImage(baseImage, 0, 0, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewTextLayers(vaporSrcCtx, w, h);
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

function updateFinalFilterPreviewOverlay() {
  const name = state.filter.name;
  if (name === 'none') {
    if (finalPreviewEl) finalPreviewEl.style.display = 'none';
    return;
  }
  if (!finalPreviewEl) finalPreviewEl = makeOverlayCanvas();
  updateOverlayLayering(finalPreviewEl);
  finalPreviewEl.style.mixBlendMode = 'normal';

  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  const t = state.filter.intensity / 100;

  finalPreviewEl.width = w;
  finalPreviewEl.height = h;
  finalPreviewEl.style.display = '';
  finalPreviewEl.style.opacity = '1';

  if (!vaporSrcCanvas) {
    vaporSrcCanvas = document.createElement('canvas');
    vaporSrcCtx = vaporSrcCanvas.getContext('2d');
  }
  if (vaporSrcCanvas.width !== w || vaporSrcCanvas.height !== h) {
    vaporSrcCanvas.width = w;
    vaporSrcCanvas.height = h;
  }
  vaporSrcCtx.clearRect(0, 0, w, h);
  vaporSrcCtx.drawImage(baseImage, 0, 0, w, h);
  if (state.filter.applyOnTop) {
    drawPreviewTextLayers(vaporSrcCtx, w, h);
  }
  const previewData = vaporSrcCtx.getImageData(0, 0, w, h);
  FILTERS[name].apply(
    previewData.data,
    w,
    h,
    t,
    state.filter.params
  );
  const pc = finalPreviewEl.getContext('2d');
  pc.putImageData(previewData, 0, 0);
}

function applyImageFilter() {
  const name = state.filter.name;
  canvasContainer.style.filter = '';
  baseImage.style.filter = '';

  // Unified preview pipeline: never CSS-filter text fields directly.
  const textFilter = '';
  for (const tf of state.textFields) {
    tf.el.style.filter = isTextFilterBypassed(tf) ? '' : textFilter;
  }
  syncTextFieldLayering();
  hideLegacyFilterOverlays();
  updateFinalFilterPreviewOverlay();
}

let _filterRenderRaf = 0;
let _resizeRaf = 0;
function scheduleImageFilterRender() {
  if (_filterRenderRaf) return;
  _filterRenderRaf = requestAnimationFrame(() => {
    _filterRenderRaf = 0;
    applyImageFilter();
  });
}

function updateVibeExtraControls() {
  const name = state.filter.name;
  const isNone = name === 'none';
  filterIntensityRow.classList.toggle('hidden', isNone);
  if (filterIntensityLabel) {
    filterIntensityLabel.textContent = name === 'hegseth' ? 'Beers' : 'Intensity';
  }
  filterLayerRow.classList.toggle('hidden', isNone);
  filterFilmControls.classList.toggle('hidden', name !== 'film');
  filterVaporControls.classList.toggle('hidden', name !== 'vaporwave');
  filterDarkAcadControls.classList.toggle('hidden', name !== 'darkAcademia');
  filterSolarpunkControls.classList.toggle('hidden', name !== 'solarpunk');
  filterHegsethControls.classList.toggle('hidden', name !== 'hegseth');
  ctrlFilterOnTop.checked = !!state.filter.applyOnTop;
}

filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    // Avoid deferred stale render when switching filters quickly.
    if (_filterRenderRaf) {
      cancelAnimationFrame(_filterRenderRaf);
      _filterRenderRaf = 0;
    }
    hideLegacyFilterOverlays();
    if (finalPreviewEl) finalPreviewEl.style.display = 'none';

    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.filter.name = chip.dataset.filter;
    // Reset to defaults for this vibe
    state.filter.params = { ...(FILTER_PARAM_DEFAULTS[state.filter.name] || {}) };
    // Sync extra slider values to defaults
    if (state.filter.name === 'film') {
      ctrlGrain.value = state.filter.params.grain;
    } else if (state.filter.name === 'vaporwave') {
      ctrlScanlines.value    = state.filter.params.scanlines;
      ctrlScanlineSize.value = state.filter.params.scanlineSize;
      ctrlChroma.value       = state.filter.params.chroma;
    } else if (state.filter.name === 'darkAcademia') {
      ctrlDaGrain.value  = state.filter.params.grain;
      ctrlVignette.value = state.filter.params.vignette;
    } else if (state.filter.name === 'solarpunk') {
      ctrlBloom.value = state.filter.params.bloom;
      ctrlHaze.value  = state.filter.params.haze;
    } else if (state.filter.name === 'hegseth') {
      ctrlHegsethAngle.value = state.filter.params.angle;
      ctrlHegsethGhostDistance.value = state.filter.params.ghostDistance;
    }
    updateVibeExtraControls();
    applyImageFilter();
  });
});

ctrlFilterIntensity.addEventListener('input', () => {
  state.filter.intensity = parseInt(ctrlFilterIntensity.value);
  scheduleImageFilterRender();
});

ctrlFilterOnTop.addEventListener('change', () => {
  state.filter.applyOnTop = ctrlFilterOnTop.checked;
  scheduleImageFilterRender();
});

ctrlGrain.addEventListener('input', () => {
  state.filter.params.grain = parseInt(ctrlGrain.value);
  scheduleImageFilterRender();
});

ctrlScanlines.addEventListener('input', () => {
  state.filter.params.scanlines = parseInt(ctrlScanlines.value);
  scheduleImageFilterRender();
});

ctrlScanlineSize.addEventListener('input', () => {
  state.filter.params.scanlineSize = parseInt(ctrlScanlineSize.value);
  scheduleImageFilterRender();
});

ctrlChroma.addEventListener('input', () => {
  state.filter.params.chroma = parseInt(ctrlChroma.value);
  scheduleImageFilterRender();
});

ctrlDaGrain.addEventListener('input', () => {
  state.filter.params.grain = parseInt(ctrlDaGrain.value);
  scheduleImageFilterRender();
});

ctrlVignette.addEventListener('input', () => {
  state.filter.params.vignette = parseInt(ctrlVignette.value);
  scheduleImageFilterRender();
});

ctrlBloom.addEventListener('input', () => {
  state.filter.params.bloom = parseInt(ctrlBloom.value);
  scheduleImageFilterRender();
});

ctrlHaze.addEventListener('input', () => {
  state.filter.params.haze = parseInt(ctrlHaze.value);
  scheduleImageFilterRender();
});

ctrlHegsethAngle.addEventListener('input', () => {
  state.filter.params.angle = parseInt(ctrlHegsethAngle.value);
  scheduleImageFilterRender();
});

ctrlHegsethGhostDistance.addEventListener('input', () => {
  state.filter.params.ghostDistance = parseInt(ctrlHegsethGhostDistance.value);
  scheduleImageFilterRender();
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
    // Preserve the current font size — only swap style attributes
    const { size: _ignored, ...presetWithoutSize } = preset;
    applyControlsToSelected(presetWithoutSize);
    state.lastPreset = btn.dataset.preset;
    if (state.selectedField) {
      state.selectedField.activePreset = btn.dataset.preset;
      loadFieldStyle(state.selectedField);
    } else {
      syncControlsToStyle(state.lastStyle, btn.dataset.preset);
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
  const tmp = new Uint8ClampedArray(d.length);
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

function applyActiveFilterToContext(ctx, w, h, pixelScale) {
  if (state.filter.name === 'none') return;
  const imgData = ctx.getImageData(0, 0, w, h);
  const scaleForFilter = (state.filter.name === 'vaporwave' || state.filter.name === 'hegseth') ? pixelScale : 1;
  FILTERS[state.filter.name].apply(
    imgData.data,
    w,
    h,
    state.filter.intensity / 100,
    state.filter.params,
    scaleForFilter
  );
  ctx.putImageData(imgData, 0, 0);
}

function drawTextLayersForExport(ctx, nw, nh, scale) {
  const containerRect = canvasContainer.getBoundingClientRect();
  const imgRect = baseImage.getBoundingClientRect();
  const imgOffsetX = imgRect.left - containerRect.left;
  const imgOffsetY = imgRect.top  - containerRect.top;

  // Reuse one scratch canvas for all text layers.
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width  = nw;
  tempCanvas.height = nh;
  const tc = tempCanvas.getContext('2d');

  for (const tf of state.textFields) {
    const s = tf.style;

    // Compute center position in natural image coords
    const cxRendered = tf.xPct * canvasContainer.offsetWidth  - imgOffsetX;
    const cyRendered = tf.yPct * canvasContainer.offsetHeight - imgOffsetY;
    const cx = cxRendered * scale;
    const cy = cyRendered * scale;

    // size is % of image width; apply directly against natural image width
    const fontSize = s.size / 100 * nw;
    const resolvedFontFamily = resolveFontFamilyStack(s.font);
    ctx.font = `${s.italic ? 'italic ' : ''}${s.weight} ${fontSize}px ${resolvedFontFamily}`;
    ctx.textAlign = s.align;
    ctx.textBaseline = 'middle';

    const lines = tf.innerEl.innerText.split('\n');
    const lineHeight = fontSize * 1.2;
    const totalH = lines.length * lineHeight;
    const startY = cy - totalH / 2 + lineHeight / 2;

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

    if (s.blur > 0) {
      softBlur(tc, nw, nh, s.blur * scale);
    }
    ctx.drawImage(tempCanvas, 0, 0);
  }
}

async function renderCurrentImageBlob(options = {}) {
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
  const ctx = exportCanvas.getContext('2d');

  // Draw base image
  ctx.drawImage(img, 0, 0, nw, nh);

  // Apply filter before text (default behavior) or after text (on-top mode).
  if (!state.filter.applyOnTop) {
    applyActiveFilterToContext(ctx, nw, nh, scale);
  }

  drawTextLayersForExport(ctx, nw, nh, scale);

  if (state.filter.applyOnTop) {
    applyActiveFilterToContext(ctx, nw, nh, scale);
  }

  const blob = await new Promise(resolve =>
    exportCanvas.toBlob(resolve, mime, quality)
  );
  if (!blob) throw new Error(`Failed to render ${mime} image`);
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
const ACTION_KEY_DBL_TAP_MS = 800;

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
  if (k !== 's' && k !== 'c') return;
  if (k === 'c' && !state.copyActionAvailable) return;

  const active = document.activeElement;
  if (active?.isContentEditable) {
    _saveKeyTapCount = 0;
    _copyKeyTapCount = 0;
    if (_saveKeyTimer) { clearTimeout(_saveKeyTimer); _saveKeyTimer = 0; }
    if (_copyKeyTimer) { clearTimeout(_copyKeyTimer); _copyKeyTimer = 0; }
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
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('ios-save-overlay');
  if (overlay) {
    closeRenderedPreviewOverlay();
    return;
  }
  if (state.selectedField) {
    e.preventDefault();
    deselectAll();
  }
});

// ─── Window resize: reposition all fields ────────────────────────────────────

window.addEventListener('resize', () => {
  if (_resizeRaf) return;
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = 0;
    updateMobileTrayHeight();
    state.textFields.forEach(tf => tf.reposition());
    if (state.imageLoaded) {
      fitImageToWrapper();
      scheduleImageFilterRender();
    }
  });
});

if (window.visualViewport) {
  let _vvResizeRaf = 0;
  const onVisualViewportChange = () => {
    if (_vvResizeRaf) return;
    _vvResizeRaf = requestAnimationFrame(() => {
      _vvResizeRaf = 0;
      updateMobileTrayHeight();
      if (state.imageLoaded) fitImageToWrapper();
    });
  };
  window.visualViewport.addEventListener('resize', onVisualViewportChange);
  window.visualViewport.addEventListener('scroll', onVisualViewportChange);
}

// ─── Prevent accidental back/navigation ──────────────────────────────────────

window.addEventListener('beforeunload', (e) => {
  if (state.imageLoaded && state.textFields.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

if ('serviceWorker' in navigator) {
  const isLocalhost =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]';
  if (location.protocol === 'https:' || isLocalhost) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}
