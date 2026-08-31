export function historySnapshotDigest(snapshot) {
  if (!snapshot) return '';
  return JSON.stringify(snapshot, (key, value) => {
    if (key === 'selectedIndex') return undefined;
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return { __blob: true, size: value.size, type: value.type };
    }
    return value;
  });
}

export function createHistory({ limit = 100, digest = historySnapshotDigest } = {}) {
  return {
    undoStack: [],
    redoStack: [],
    applying: false,
    pending: null,

    reset() {
      this.undoStack = [];
      this.redoStack = [];
      this.pending = null;
    },

    push(label, before, after) {
      if (this.applying || !before || !after || digest(before) === digest(after)) return false;
      this.undoStack.push({ label, before, after });
      if (this.undoStack.length > limit) this.undoStack.shift();
      this.redoStack = [];
      this.pending = null;
      return true;
    },

    begin(label, before) {
      if (this.applying || this.pending || !before) return false;
      this.pending = { label, before };
      return true;
    },

    commit(capture, label = this.pending?.label) {
      if (this.applying || !this.pending) return false;
      const before = this.pending.before;
      this.pending = null;
      return this.push(label || 'Edit', before, capture());
    },

    cancel() {
      this.pending = null;
    },
  };
}
