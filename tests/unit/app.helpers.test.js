import { describe, expect, it } from 'vitest';
import {
  extractFirstImageFile,
  isHeicLikeFile,
  isLikelyImageFile,
  isSvgLikeFile,
} from '../../core/image-files.js';
import { getClipboardWritePermissionState, isIOSLikePlatform } from '../../core/clipboard.js';
import { createHistory, historySnapshotDigest } from '../../core/history.js';
import {
  getRotationSnapAxis,
  snapAxis,
  snapRotationDeg,
} from '../../core/snapping.js';
import { percentile } from '../../core/stats.js';

describe('core helpers', () => {
  it('percentile returns 0 for empty input', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('percentile computes the median index selection', () => {
    expect(percentile([10, 2, 9, 1, 5], 0.5)).toBe(5);
    expect(percentile([10, 2, 9, 1, 5], 2)).toBe(10);
  });

  it('isHeicLikeFile detects HEIC by mime type', () => {
    expect(isHeicLikeFile({ name: 'photo.bin', type: 'image/heic' })).toBe(true);
  });

  it('isHeicLikeFile detects HEIC by extension', () => {
    expect(isHeicLikeFile({ name: 'vacation.HEIF', type: '' })).toBe(true);
  });

  it('isLikelyImageFile detects images by mime and extension', () => {
    expect(isLikelyImageFile({ name: 'x.dat', type: 'image/png' })).toBe(true);
    expect(isLikelyImageFile({ name: 'x.webp', type: '' })).toBe(true);
    expect(isLikelyImageFile({ name: 'x.txt', type: 'text/plain' })).toBe(false);
    expect(isSvgLikeFile({ name: 'vector.svg', type: '' })).toBe(true);
  });

  it('extractFirstImageFile returns first valid transfer.files entry', () => {
    const file = { name: 'x.jpg', type: 'image/jpeg' };
    expect(extractFirstImageFile({ files: [file] })).toBe(file);
  });

  it('extractFirstImageFile falls back to transfer.items iteration', () => {
    const file = { name: 'fallback.png', type: 'image/png' };
    const transfer = {
      files: [{ name: 'x.txt', type: 'text/plain' }],
      items: [{ getAsFile: () => file }],
    };
    expect(extractFirstImageFile(transfer)).toBe(file);
  });

  it('clipboard permission and iOS platform helpers handle browser edge cases', async () => {
    await expect(getClipboardWritePermissionState({})).resolves.toBe('unknown');
    await expect(getClipboardWritePermissionState({
      permissions: { query: async () => ({ state: 'granted' }) },
    })).resolves.toBe('granted');

    expect(isIOSLikePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
    expect(isIOSLikePlatform({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      platform: 'Linux x86_64',
      maxTouchPoints: 0,
    })).toBe(false);
  });

  it('keeps position snaps sticky until the snap-out threshold', () => {
    const entered = snapAxis(0.5 + 0.01, null);
    expect(entered).toEqual({ pos: 0.5, snap: 0.5 });
    expect(snapAxis(0.5 + 0.03, entered.snap)).toEqual({ pos: 0.5, snap: 0.5 });
    expect(snapAxis(0.5 + 0.04, entered.snap)).toEqual({ pos: 0.54, snap: null });
  });

  it('snaps rotations across full turns and classifies their guide axis', () => {
    expect(snapRotationDeg(358, null)).toEqual({ deg: 360, snap: 360 });
    expect(snapRotationDeg(370, 360)).toEqual({ deg: 370, snap: null });
    expect(getRotationSnapAxis(-45)).toBe('d2');
    expect(getRotationSnapAxis(90)).toBe('y');
  });

  it('records meaningful history entries, clears redo, and respects its limit', () => {
    const history = createHistory({ limit: 2 });
    const first = { value: 1, selectedIndex: 0 };
    const second = { value: 2, selectedIndex: 4 };
    expect(history.push('No-op selection', first, { value: 1, selectedIndex: 3 })).toBe(false);
    expect(history.push('First', first, second)).toBe(true);
    history.redoStack.push({ label: 'stale' });
    history.push('Second', second, { value: 3 });
    history.push('Third', { value: 3 }, { value: 4 });
    expect(history.undoStack.map((entry) => entry.label)).toEqual(['Second', 'Third']);
    expect(history.redoStack).toEqual([]);
  });

  it('groups a pending history action into one entry', () => {
    const history = createHistory();
    expect(history.begin('Adjust', { value: 1 })).toBe(true);
    expect(history.commit(() => ({ value: 2 }))).toBe(true);
    expect(history.undoStack).toHaveLength(1);
    expect(historySnapshotDigest({ value: 1, selectedIndex: 1 })).toBe(historySnapshotDigest({ value: 1, selectedIndex: 8 }));
  });
});
