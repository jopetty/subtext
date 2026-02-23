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
  dragState: null,       // { field, startX, startY, origLeft, origTop }
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
  },
  lemon: {
    font:         "'Helvetica Neue', Helvetica, sans-serif",
    size:         5,   // percent of image width
    weight:       '400',
    italic:       true,
    align:        'center',
    fgColor:      '#faf0a0',
    outlineColor: '#000000',
    outlineWidth: 0,
  },
};

function defaultStyle() {
  return state.lastStyle ? { ...state.lastStyle } : { ...PRESETS.classic };
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const uploadScreen   = document.getElementById('upload-screen');
const editorScreen   = document.getElementById('editor-screen');
const fileInput      = document.getElementById('file-input');
const backBtn        = document.getElementById('back-btn');
const exportBtn      = document.getElementById('export-btn');
const baseImage      = document.getElementById('base-image');
const canvasContainer = document.getElementById('canvas-container');
const exportCanvas   = document.getElementById('export-canvas');

const noSelectionHint = document.getElementById('no-selection-hint');
const fontControls   = document.getElementById('font-controls');

const ctrlFont         = document.getElementById('ctrl-font');
const ctrlSize         = document.getElementById('ctrl-size');
const ctrlSizeVal      = document.getElementById('ctrl-size-val');
const ctrlWeight       = document.getElementById('ctrl-weight');
const ctrlItalic       = document.getElementById('ctrl-italic');
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

function showEditor() {
  uploadScreen.classList.remove('active');
  editorScreen.classList.add('active');
  // Clear any leftover fields
  state.textFields.forEach(tf => tf.el.remove());
  state.textFields = [];
  state.selectedField = null;
  state.lastStyle = null;
  updatePanel();
}

function showUpload() {
  editorScreen.classList.remove('active');
  uploadScreen.classList.add('active');
  deselectAll();
}

fileInput.addEventListener('change', (e) => {
  loadImageFile(e.target.files[0]);
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
    del.innerHTML = '&times;';
    del.title = 'Delete';

    const drag = document.createElement('div');
    drag.className = 'text-field-drag';
    drag.innerHTML = '&#x2B0C;'; // ⬌ four-way arrow
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

    // POINTER on wrapper: stop propagation to canvas listeners, forward
    // focus to innerEl if the click landed on the wrapper border area,
    // and start drag tracking.
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.delEl || e.target === this.dragEl) return;
      // Stop propagation so the canvas double-tap detector doesn't see this.
      e.stopPropagation();

      if (e.target !== this.innerEl) {
        // Clicked the wrapper (not the text itself) — focus the editable.
        // preventDefault here only so the wrapper div doesn't steal the
        // focus in a way that skips innerEl.
        e.preventDefault();
        this.innerEl.focus();
      }

      startDrag(e, this);
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
    state.lastStyle = { ...state.selectedField.style };
  }
  state.selectedField = tf;
  tf.select();
  loadFieldStyle(tf);
  updatePanel();
}

function deselectAll() {
  if (state.selectedField) {
    state.lastStyle = { ...state.selectedField.style };
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
  const hasSel = !!state.selectedField;
  noSelectionHint.classList.toggle('hidden', hasSel);
  fontControls.classList.toggle('hidden', !hasSel);
}

function loadFieldStyle(tf) {
  const s = tf.style;
  ctrlFont.value         = s.font;
  ctrlSize.value          = s.size;
  ctrlSizeVal.textContent = s.size + '%';
  ctrlWeight.value       = s.weight;
  ctrlItalic.classList.toggle('active', s.italic);
  ctrlFgColor.value      = s.fgColor;
  ctrlOutlineColor.value = s.outlineColor;
  ctrlOutlineWidth.value = s.outlineWidth;
  ctrlOutlineWidthVal.textContent = s.outlineWidth;
  alignBtns.forEach(b => b.classList.toggle('active', b.dataset.align === s.align));
}

function applyControlsToSelected(patch) {
  if (!state.selectedField) return;
  state.selectedField.updateStyle(patch);
  state.lastStyle = { ...state.selectedField.style };
}

// Control listeners
ctrlFont.addEventListener('change', () => applyControlsToSelected({ font: ctrlFont.value }));

ctrlSize.addEventListener('input', () => {
  const v = parseFloat(ctrlSize.value);
  ctrlSizeVal.textContent = v + '%';
  applyControlsToSelected({ size: v });
});

ctrlWeight.addEventListener('change', () => applyControlsToSelected({ weight: ctrlWeight.value }));

ctrlItalic.addEventListener('click', () => {
  const isNowItalic = !ctrlItalic.classList.contains('active');
  ctrlItalic.classList.toggle('active', isNowItalic);
  applyControlsToSelected({ italic: isNowItalic });
});

ctrlFgColor.addEventListener('input', () => applyControlsToSelected({ fgColor: ctrlFgColor.value }));
ctrlOutlineColor.addEventListener('input', () => applyControlsToSelected({ outlineColor: ctrlOutlineColor.value }));

ctrlOutlineWidth.addEventListener('input', () => {
  const v = parseFloat(ctrlOutlineWidth.value);
  ctrlOutlineWidthVal.textContent = v;
  applyControlsToSelected({ outlineWidth: v });
});

alignBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    alignBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyControlsToSelected({ align: btn.dataset.align });
  });
});

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    // Preserve the current font size — only swap style attributes
    const { size: _ignored, ...presetWithoutSize } = preset;
    applyControlsToSelected(presetWithoutSize);
    if (state.selectedField) {
      loadFieldStyle(state.selectedField);
    }
  });
});

// ─── Export / Render ──────────────────────────────────────────────────────────

exportBtn.addEventListener('click', exportImage);

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

    lines.forEach((line, i) => {
      const ly = startY + i * lineHeight;

      if (s.outlineWidth > 0) {
        ctx.lineWidth   = s.outlineWidth * scale * 2;
        ctx.strokeStyle = s.outlineColor;
        ctx.lineJoin    = 'round';
        ctx.strokeText(line, lx, ly);
      }

      ctx.fillStyle = s.fgColor;
      ctx.fillText(line, lx, ly);
    });
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
