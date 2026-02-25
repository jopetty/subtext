import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const APP_JS_PATH = path.resolve(process.cwd(), 'app.js');

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Token not found: ${startToken}`);
  const end = source.indexOf(endToken, start);
  if (end === -1) throw new Error(`Token not found: ${endToken}`);
  return source.slice(start, end);
}

export function loadAppHelpers() {
  const source = fs.readFileSync(APP_JS_PATH, 'utf8');

  const percentileBlock = sliceBetween(
    source,
    'function percentile(values, p) {',
    'function calcPreviewFps() {',
  );
  const imageFileBlock = sliceBetween(
    source,
    'const HEIC_MIME_RE',
    'function setUploadBusy(',
  );
  const clipboardBlock = sliceBetween(
    source,
    'async function getClipboardWritePermissionState() {',
    'async function refreshCopyActionAvailability() {',
  );

  const script = `
${percentileBlock}
${imageFileBlock}
${clipboardBlock}
module.exports = {
  percentile,
  isHeicLikeFile,
  isLikelyImageFile,
  extractFirstImageFile,
  getClipboardWritePermissionState,
  isIOSLikePlatform,
};
`;

  const context = {
    module: { exports: {} },
    navigator: {},
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'app-snippets.vm.js' });
  return { helpers: context.module.exports, context };
}
