export async function getClipboardWritePermissionState(nav = navigator) {
  if (!nav.permissions || typeof nav.permissions.query !== 'function') return 'unknown';
  try {
    const result = await nav.permissions.query({ name: 'clipboard-write' });
    return result?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function isIOSLikePlatform(nav = navigator) {
  return /iP(ad|hone|od)/i.test(nav.userAgent || '') ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}
