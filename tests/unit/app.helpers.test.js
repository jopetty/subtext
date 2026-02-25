import { describe, expect, it } from 'vitest';
import { loadAppHelpers } from './load-app-snippets.js';

describe('app.js pure helpers', () => {
  it('percentile returns 0 for empty input', () => {
    const { helpers } = loadAppHelpers();
    expect(helpers.percentile([], 0.5)).toBe(0);
  });

  it('percentile computes the median index selection', () => {
    const { helpers } = loadAppHelpers();
    expect(helpers.percentile([10, 2, 9, 1, 5], 0.5)).toBe(5);
  });

  it('isHeicLikeFile detects HEIC by mime type', () => {
    const { helpers } = loadAppHelpers();
    expect(helpers.isHeicLikeFile({ name: 'photo.bin', type: 'image/heic' })).toBe(true);
  });

  it('isHeicLikeFile detects HEIC by extension', () => {
    const { helpers } = loadAppHelpers();
    expect(helpers.isHeicLikeFile({ name: 'vacation.HEIF', type: '' })).toBe(true);
  });

  it('isLikelyImageFile detects images by mime and extension', () => {
    const { helpers } = loadAppHelpers();
    expect(helpers.isLikelyImageFile({ name: 'x.dat', type: 'image/png' })).toBe(true);
    expect(helpers.isLikelyImageFile({ name: 'x.webp', type: '' })).toBe(true);
    expect(helpers.isLikelyImageFile({ name: 'x.txt', type: 'text/plain' })).toBe(false);
  });

  it('extractFirstImageFile returns first valid transfer.files entry', () => {
    const { helpers } = loadAppHelpers();
    const file = { name: 'x.jpg', type: 'image/jpeg' };
    expect(helpers.extractFirstImageFile({ files: [file] })).toBe(file);
  });

  it('extractFirstImageFile falls back to transfer.items iteration', () => {
    const { helpers } = loadAppHelpers();
    const file = { name: 'fallback.png', type: 'image/png' };
    const transfer = {
      files: [{ name: 'x.txt', type: 'text/plain' }],
      items: [{ getAsFile: () => file }],
    };
    expect(helpers.extractFirstImageFile(transfer)).toBe(file);
  });

  it('clipboard permission and iOS platform helpers handle browser edge cases', async () => {
    const { helpers, context } = loadAppHelpers();

    context.navigator = {};
    await expect(helpers.getClipboardWritePermissionState()).resolves.toBe('unknown');

    context.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' };
    expect(helpers.isIOSLikePlatform()).toBe(true);

    context.navigator = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      platform: 'Linux x86_64',
      maxTouchPoints: 0,
    };
    expect(helpers.isIOSLikePlatform()).toBe(false);
  });
});
