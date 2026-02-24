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
  textFields: [],        // array of TextField objects
  selectedField: null,   // currently selected TextField or null
  lastStyle: null,       // style copied from last-edited field (for new field defaults)
  lastPreset: 'classic', // preset name of last-edited field (or null if manually edited)
  dragState: null,       // { field, startX, startY, origLeft, origTop }
  filter: { name: 'none', intensity: 75, params: {} },
};

// Preset styles
const PRESETS = {
  classic: {
    font:         "'Helvetica Neue', Helvetica, sans-serif",
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
    font:         "'Helvetica Neue', Helvetica, sans-serif",
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
    font:         "'Handjet', sans-serif",
    size:         5,
    weight:       '700',
    italic:       true,
    align:        'center',
    fgColor:      '#ffcce6',
    outlineColor: '#9656f0',
    outlineWidth: 4,
    blur:         0,
  },
  darkAcademia: {
    font:         "'Garamond', 'EB Garamond', 'GaramondIO', serif",
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
      `contrast(${1 + 0.1*t}) saturate(${1 - 0.22*t}) sepia(${0.28*t}) brightness(${1 - 0.1*t})`,
    apply(data, w, h, t, params) {
      const cx = w / 2, cy = h / 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let r = data[i], g = data[i+1], b = data[i+2];
          // Warm tone
          r = clamp255(r + 12 * t);
          g = clamp255(g +  3 * t);
          b = clamp255(b - 14 * t);
          // Desaturation
          const lm = 0.299*r + 0.587*g + 0.114*b;
          const s  = 1 - 0.22 * t;
          r = clamp255(lm + (r - lm) * s);
          g = clamp255(lm + (g - lm) * s);
          b = clamp255(lm + (b - lm) * s);
          // Fade / lift blacks
          r = clamp255(r * (1 - 0.09*t) + 20*t);
          g = clamp255(g * (1 - 0.09*t) + 16*t);
          b = clamp255(b * (1 - 0.09*t) + 11*t);
          // Contrast
          const c = 1 + 0.1 * t;
          r = clamp255((r - 128) * c + 128);
          g = clamp255((g - 128) * c + 128);
          b = clamp255((b - 128) * c + 128);
          // Vignette
          const dx = (x - cx) / cx, dy = (y - cy) / cy;
          const vig = Math.max(0, 1 - 0.22 * t * (dx*dx + dy*dy));
          r = clamp255(r * vig); g = clamp255(g * vig); b = clamp255(b * vig);
          // Grain — independent param
          const grainT = (params.grain ?? 50) / 100;
          const noise = (Math.random() - 0.5) * 42 * grainT;
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

  vaporwave: {
    label: 'Vaporwave',
    // CSS preview approximates the color grade; chromatic aberration + scanlines
    // appear only in the exported image (pixel-level apply below).
    cssPreview: (t) =>
      `saturate(${1 + 1.1*t}) hue-rotate(${-28*t}deg) contrast(${1 + 0.3*t}) brightness(${1 - 0.1*t})`,
    apply(data, w, h, t, params) {
      const orig = new Uint8ClampedArray(data);
      const chromaShift = Math.round(30 * (params.chroma ?? 50) / 100); // independent chroma param

      for (let y = 0; y < h; y++) {
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
          const s = 1 + 1.1 * t;
          r = clamp255(lm + (r - lm) * s);
          g = clamp255(lm + (g - lm) * s);
          b = clamp255(lm + (b - lm) * s);

          // Color grade: purple/magenta midtones, deep blue shadows, hot-pink highlights
          const bright = lm / 255;
          r = clamp255(r + (10 + bright * 30) * t);   // more red in highlights → hot pink
          g = clamp255(g - (28 - bright * 8)  * t);   // suppress green throughout
          b = clamp255(b + (42 - bright * 22) * t);   // strong blue in shadows, less in highlights

          // Hard contrast + slight brightness pull-down
          const c = 1 + 0.3 * t;
          r = clamp255((r - 128) * c + 128);
          g = clamp255((g - 128) * c + 128);
          b = clamp255((b - 128) * c + 128);

          // Scanlines — independent param
          const scanlinesT   = (params.scanlines    ?? 60) / 100;
          const scanlineSize = Math.max(1, params.scanlineSize ?? 2);
          const scan = (y % scanlineSize === 0) ? 1 : Math.max(0, 1 - 0.35 * scanlinesT);
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
    cssPreview: (t) =>
      `saturate(${1 + 0.7*t}) hue-rotate(${10*t}deg) brightness(${1 + 0.16*t}) contrast(${1 - 0.05*t})`,
    apply(data, w, h, t) {
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

        // Luminous brightness lift — greens get extra push for lushness
        data[i]   = clamp255(r * (1 + 0.13 * t));
        data[i+1] = clamp255(g * (1 + 0.18 * t));
        data[i+2] = clamp255(b * (1 + 0.04 * t));
      }
    },
  },
};

// Default values for vibe-specific extra params
const FILTER_PARAM_DEFAULTS = {
  film:        { grain: 50 },
  vaporwave:   { scanlines: 60, scanlineSize: 2, chroma: 50 },
  darkAcademia: { grain: 45, vignette: 65 },
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
const baseImage      = document.getElementById('base-image');
const canvasContainer = document.getElementById('canvas-container');
const canvasHint      = document.getElementById('canvas-hint');
const exportCanvas   = document.getElementById('export-canvas');

// True on phones/tablets — used to gate the single-tap-to-select behaviour.
const isMobile = navigator.maxTouchPoints > 0;

const fontControls   = document.getElementById('font-controls');
const bottomPanel    = document.getElementById('bottom-panel');
const panelTabBtns   = document.querySelectorAll('.panel-tab');

const ctrlFont         = document.getElementById('ctrl-font');
const ctrlSize         = document.getElementById('ctrl-size');
const ctrlSizeVal      = document.getElementById('ctrl-size-val');
const ctrlBold         = document.getElementById('ctrl-bold');
const ctrlItalic       = document.getElementById('ctrl-italic');
const ctrlBlur         = document.getElementById('ctrl-blur');
const ctrlFgColor      = document.getElementById('ctrl-fg-color');
const ctrlOutlineColor = document.getElementById('ctrl-outline-color');
const ctrlOutlineWidth = document.getElementById('ctrl-outline-width');
const ctrlOutlineWidthVal = document.getElementById('ctrl-outline-width-val');
const alignBtns        = document.querySelectorAll('.align-btn');
const presetBtns       = document.querySelectorAll('.preset-btn');

// ─── Image loading ─────────────────────────────────────────────────────────────

function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  baseImage.onload = () => {
    state.imageNaturalW = baseImage.naturalWidth;
    state.imageNaturalH = baseImage.naturalHeight;
    state.imageLoaded = true;
    showEditor();
  };
  baseImage.src = url;
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
  // Remove from layout after fade completes so it can't interfere
  canvasHint.addEventListener('transitionend', () => canvasHint.remove(), { once: true });
}

function showEditor() {
  uploadScreen.classList.remove('active');
  editorScreen.classList.add('active');
  setThemeColors('editor');
  // Clear any leftover fields
  state.textFields.forEach(tf => tf.el.remove());
  state.textFields = [];
  state.selectedField = null;
  state.lastStyle = null;
  // Always start on the Typography tab when opening the editor
  switchPanelTab('typography');
  updatePanel();
  // Show the canvas hint and auto-dismiss after 10 s
  if (canvasHint) {
    canvasHint.classList.remove('hidden');
    clearTimeout(_hintTimer);
    _hintTimer = setTimeout(dismissHint, 10000);
  }
}

function showUpload() {
  editorScreen.classList.remove('active');
  uploadScreen.classList.add('active');
  setThemeColors('upload');
  deselectAll();
  // Reset filter
  state.filter = { name: 'none', intensity: 75, params: {} };
  baseImage.style.filter = '';
  if (grainEl) grainEl.style.display = 'none';
  if (scanlineEl) scanlineEl.style.display = 'none';
  if (chromaEl) chromaEl.style.display = 'none';
  if (vignetteEl) vignetteEl.style.display = 'none';
  filterChips.forEach(c => c.classList.toggle('active', c.dataset.filter === 'none'));
  filterIntensityRow.classList.add('hidden');
  filterFilmControls.classList.add('hidden');
  filterVaporControls.classList.add('hidden');
  filterDarkAcadControls.classList.add('hidden');
  ctrlFilterIntensity.value = 75;
}

fileInput.addEventListener('change', (e) => {
  loadImageFile(e.target.files[0]);
});

// Drag-and-drop onto the upload screen
let dragEnterCount = 0;

uploadScreen.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragEnterCount++;
  uploadScreen.classList.add('drag-over');
});

uploadScreen.addEventListener('dragleave', () => {
  dragEnterCount--;
  if (dragEnterCount === 0) uploadScreen.classList.remove('drag-over');
});

uploadScreen.addEventListener('dragover', (e) => {
  e.preventDefault(); // required to allow drop
});

uploadScreen.addEventListener('drop', (e) => {
  e.preventDefault();
  dragEnterCount = 0;
  uploadScreen.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  loadImageFile(file);
});

// Paste from clipboard
window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      loadImageFile(item.getAsFile());
      break;
    }
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
    inner.spellcheck = false;
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
    inner.style.filter = s.blur > 0 ? `blur(${s.blur}px)` : '';

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

function updatePanel() {}

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

function syncFontSelectDisplay() {
  ctrlFont.style.fontFamily = ctrlFont.value;
}

// ─── Mobile panel tabs ────────────────────────────────────────────────────────

function switchPanelTab(tabName) {
  bottomPanel.dataset.panel = tabName;
  panelTabBtns.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
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
const ctrlFilterIntensity  = document.getElementById('ctrl-filter-intensity');
const filterFilmControls   = document.getElementById('filter-film-controls');
const filterVaporControls  = document.getElementById('filter-vaporwave-controls');
const filterDarkAcadControls = document.getElementById('filter-darkacademia-controls');
const ctrlGrain            = document.getElementById('ctrl-grain');
const ctrlScanlines        = document.getElementById('ctrl-scanlines');
const ctrlScanlineSize     = document.getElementById('ctrl-scanline-size');
const ctrlChroma           = document.getElementById('ctrl-chroma');
const ctrlDaGrain          = document.getElementById('ctrl-da-grain');
const ctrlVignette         = document.getElementById('ctrl-vignette');

// ── Vibe preview overlays ──────────────────────────────────────────────────────
// Film: random grain canvas  (mix-blend-mode: overlay)
// Vaporwave: scanline canvas (semi-transparent dark rows)
// These effects can't be replicated with CSS filters alone.

let grainEl    = null;
let scanlineEl = null;
let chromaEl   = null;
let vignetteEl = null;

function makeOverlayCanvas() {
  const el = document.createElement('canvas');
  el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
  baseImage.insertAdjacentElement('afterend', el);
  return el;
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
  const grainT   = (state.filter.params.grain ?? (isDark ? 45 : 50)) / 100;
  const maxAlpha = isDark ? 0.28 : 0.35;
  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  grainEl.width         = w;
  grainEl.height        = h;
  grainEl.style.display = '';
  grainEl.style.opacity = (maxAlpha * grainT).toFixed(3);
  const gc = grainEl.getContext('2d');
  const id = gc.createImageData(w, h);
  const d  = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
  }
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
  if (state.filter.name !== 'vaporwave') {
    if (scanlineEl) scanlineEl.style.display = 'none';
    return;
  }
  if (!scanlineEl) scanlineEl = makeOverlayCanvas();
  const scanlinesT    = (state.filter.params.scanlines    ?? 60) / 100;
  const scanlineSize  = Math.max(1, state.filter.params.scanlineSize ?? 2);
  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  scanlineEl.width         = w;
  scanlineEl.height        = h;
  scanlineEl.style.display = '';
  const sc = scanlineEl.getContext('2d');
  sc.clearRect(0, 0, w, h);
  sc.fillStyle = `rgba(0,0,0,${(0.35 * scanlinesT).toFixed(3)})`;
  for (let y = 0; y < h; y += scanlineSize) sc.fillRect(0, y, w, Math.max(1, scanlineSize - 1));
}

function updateChromaOverlay() {
  if (state.filter.name !== 'vaporwave') {
    if (chromaEl) chromaEl.style.display = 'none';
    return;
  }
  const chromaT = (state.filter.params.chroma ?? 50) / 100;
  if (chromaT === 0) {
    if (chromaEl) chromaEl.style.display = 'none';
    return;
  }
  if (!chromaEl) {
    chromaEl = makeOverlayCanvas();
    chromaEl.style.mixBlendMode = 'screen';
  }
  const shift = Math.round(chromaT * 12); // up to 12px display-space shift
  const w = baseImage.offsetWidth  || 1;
  const h = baseImage.offsetHeight || 1;
  chromaEl.width         = w;
  chromaEl.height        = h;
  chromaEl.style.display = '';
  chromaEl.style.opacity = (0.55 + 0.3 * chromaT).toFixed(3);
  const cc = chromaEl.getContext('2d');
  cc.clearRect(0, 0, w, h);
  // Red fringe on the right edge
  const rg = cc.createLinearGradient(0, 0, shift * 3, 0);
  rg.addColorStop(0, `rgba(255,0,0,${(0.18 * chromaT).toFixed(3)})`);
  rg.addColorStop(1, 'rgba(255,0,0,0)');
  cc.fillStyle = rg;
  cc.fillRect(0, 0, Math.min(shift * 3, w), h);
  // Blue fringe on the left edge
  const bg = cc.createLinearGradient(w, 0, w - shift * 3, 0);
  bg.addColorStop(0, `rgba(0,100,255,${(0.18 * chromaT).toFixed(3)})`);
  bg.addColorStop(1, 'rgba(0,100,255,0)');
  cc.fillStyle = bg;
  cc.fillRect(Math.max(0, w - shift * 3), 0, Math.min(shift * 3, w), h);
}

function applyImageFilter() {
  if (state.filter.name === 'none') {
    baseImage.style.filter = '';
  } else {
    const t = state.filter.intensity / 100;
    baseImage.style.filter = FILTERS[state.filter.name].cssPreview(t);
  }
  updateGrainOverlay();
  updateScanlineOverlay();
  updateChromaOverlay();
  updateVignetteOverlay();
}

function updateVibeExtraControls() {
  const name = state.filter.name;
  const isNone = name === 'none';
  filterIntensityRow.classList.toggle('hidden', isNone);
  filterFilmControls.classList.toggle('hidden', name !== 'film');
  filterVaporControls.classList.toggle('hidden', name !== 'vaporwave');
  filterDarkAcadControls.classList.toggle('hidden', name !== 'darkAcademia');
}

filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
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
    }
    updateVibeExtraControls();
    applyImageFilter();
  });
});

ctrlFilterIntensity.addEventListener('input', () => {
  state.filter.intensity = parseInt(ctrlFilterIntensity.value);
  applyImageFilter();
});

ctrlGrain.addEventListener('input', () => {
  state.filter.params.grain = parseInt(ctrlGrain.value);
  applyImageFilter();
});

ctrlScanlines.addEventListener('input', () => {
  state.filter.params.scanlines = parseInt(ctrlScanlines.value);
  applyImageFilter();
});

ctrlScanlineSize.addEventListener('input', () => {
  state.filter.params.scanlineSize = parseInt(ctrlScanlineSize.value);
  applyImageFilter();
});

ctrlChroma.addEventListener('input', () => {
  state.filter.params.chroma = parseInt(ctrlChroma.value);
  applyImageFilter();
});

ctrlDaGrain.addEventListener('input', () => {
  state.filter.params.grain = parseInt(ctrlDaGrain.value);
  applyImageFilter();
});

ctrlVignette.addEventListener('input', () => {
  state.filter.params.vignette = parseInt(ctrlVignette.value);
  applyImageFilter();
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

exportBtn.addEventListener('click', exportImage);

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

async function exportImage() {
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

  // Apply image filter (pixel-level, fully cross-browser)
  if (state.filter.name !== 'none') {
    const imgData = ctx.getImageData(0, 0, nw, nh);
    FILTERS[state.filter.name].apply(imgData.data, nw, nh, state.filter.intensity / 100, state.filter.params);
    ctx.putImageData(imgData, 0, 0);
  }

  // Draw each text field
  const containerRect = canvasContainer.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  const imgOffsetX = imgRect.left - containerRect.left;
  const imgOffsetY = imgRect.top  - containerRect.top;

  for (const tf of state.textFields) {
    const s = tf.style;

    // Compute center position in natural image coords
    const cxRendered = tf.xPct * canvasContainer.offsetWidth  - imgOffsetX;
    const cyRendered = tf.yPct * canvasContainer.offsetHeight - imgOffsetY;
    const cx = cxRendered * scale;
    const cy = cyRendered * scale;

    // size is % of image width; apply directly against natural image width
    const fontSize = s.size / 100 * nw;
    ctx.font = `${s.italic ? 'italic ' : ''}${s.weight} ${fontSize}px ${s.font}`;
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
    // Using a software blur avoids ctx.filter which isn't supported in Safari < 18.
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width  = nw;
    tempCanvas.height = nh;
    const tc = tempCanvas.getContext('2d');
    tc.font         = ctx.font;
    tc.textAlign    = s.align;
    tc.textBaseline = 'middle';

    lines.forEach((line, i) => {
      const ly = startY + i * lineHeight;

      if (s.outlineWidth > 0) {
        tc.lineWidth   = s.outlineWidth * scale * 2;
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

  const blob = await new Promise(resolve =>
    exportCanvas.toBlob(resolve, 'image/jpeg', 0.93)
  );

  // Platform detection.
  // maxTouchPoints > 0 would catch Mac trackpads on newer macOS too, so be specific.
  const isIOS     = /iP(ad|hone|od)/i.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);

  if (isIOS) {
    // iOS: Web Share API is the one-tap path to Photos (iOS 15+, requires HTTPS).
    const file = new File([blob], 'subtext.jpg', { type: 'image/jpeg' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user dismissed
        // Share failed for another reason — fall through to overlay
      }
    }
    // Older iOS / non-Safari fallback: show the image so the user can save it.
    showIOSSaveOverlay(blob);
    return;
  }

  // Android + Desktop: standard download link (<a download> works on both).
  // On Android this saves to the gallery/downloads folder directly.
  // On desktop we append a short hash so repeated exports have unique filenames.
  let filename = 'subtext.jpg';
  if (!isAndroid) {
    const buffer    = await blob.arrayBuffer();
    const hashBytes = await crypto.subtle.digest('SHA-256', buffer);
    const hex       = Array.from(new Uint8Array(hashBytes))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
    filename = `subtext-${hex.slice(0, 6)}.jpg`;
  }

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function showIOSSaveOverlay(blob) {
  const url     = URL.createObjectURL(blob);
  const overlay = document.createElement('div');
  overlay.id    = 'ios-save-overlay';

  // "Open Image" opens the blob in iOS Quick Look / Safari viewer, where
  // the user can tap the share icon → "Save Image" in one tap.
  const openLink = document.createElement('a');
  openLink.href   = url;
  openLink.target = '_blank';
  openLink.download = 'subtext.jpg';
  openLink.className = 'ios-open-btn';
  openLink.textContent = 'Open Image';

  const msg = document.createElement('p');
  msg.textContent = 'Then tap the share icon ↗ and choose "Save Image".';

  const divider = document.createElement('p');
  divider.className = 'ios-overlay-divider';
  divider.textContent = '— or tap and hold the image below —';

  const img = document.createElement('img');
  img.src   = url;

  const btn = document.createElement('button');
  btn.textContent = 'Done';
  btn.addEventListener('click', () => {
    overlay.remove();
    URL.revokeObjectURL(url);
  });

  overlay.appendChild(openLink);
  overlay.appendChild(msg);
  overlay.appendChild(divider);
  overlay.appendChild(img);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

initGuides();
syncFontSelectDisplay();
switchPanelTab('typography'); // set initial data-panel attribute

// ─── Window resize: reposition all fields ────────────────────────────────────

window.addEventListener('resize', () => {
  state.textFields.forEach(tf => tf.reposition());
});

// ─── Prevent accidental back/navigation ──────────────────────────────────────

window.addEventListener('beforeunload', (e) => {
  if (state.imageLoaded && state.textFields.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});
