const HEIC_MIME_RE = /^image\/hei(c|f|x|s)$/i;
const HEIC_EXT_RE = /\.(hei(c|f|x|s))$/i;
const SVG_MIME_RE = /^image\/svg\+xml$/i;
const SVG_EXT_RE = /\.svg$/i;
const IMAGE_EXT_RE = /\.(avif|bmp|gif|heic|heif|heix|heis|jpg|jpeg|jpe|jfif|png|svg|tif|tiff|webp)$/i;

export function isHeicLikeFile(file) {
  const name = file?.name || '';
  const type = file?.type || '';
  return HEIC_MIME_RE.test(type) || HEIC_EXT_RE.test(name);
}

export function isLikelyImageFile(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  const name = file.name || '';
  return type.startsWith('image/') || IMAGE_EXT_RE.test(name);
}

export function isSvgLikeFile(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  const name = file.name || '';
  return SVG_MIME_RE.test(type) || SVG_EXT_RE.test(name);
}

export function extractFirstImageFile(transfer) {
  const firstFile = transfer?.files?.[0] || null;
  if (firstFile && isLikelyImageFile(firstFile)) return firstFile;
  if (!transfer?.items) return null;
  for (const item of transfer.items) {
    const candidate = item.getAsFile?.();
    if (candidate && isLikelyImageFile(candidate)) return candidate;
  }
  return null;
}
