#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

function read(rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

function write(rel, content) {
  writeFileSync(resolve(root, rel), content);
}

const hash = createHash('sha256');
for (const rel of ['app.js', 'style.css', 'manifest.webmanifest']) {
  hash.update(read(rel));
}
const rev = hash.digest('hex').slice(0, 10);

function replaceOrThrow(content, regex, replacer, label) {
  if (!regex.test(content)) {
    throw new Error(`Could not update ${label}`);
  }
  return content.replace(regex, replacer);
}

let indexHtml = read('index.html');
indexHtml = replaceOrThrow(
  indexHtml,
  /href="manifest\.webmanifest(?:\?v=[^"]*)?"/,
  `href="manifest.webmanifest?v=${rev}"`,
  'index manifest url'
);
indexHtml = replaceOrThrow(
  indexHtml,
  /href="style\.css(?:\?v=[^"]*)?"/,
  `href="style.css?v=${rev}"`,
  'index stylesheet url'
);
indexHtml = replaceOrThrow(
  indexHtml,
  /src="app\.js(?:\?v=[^"]*)?"/,
  `src="app.js?v=${rev}"`,
  'index app script url'
);
write('index.html', indexHtml);

let sw = read('sw.js');
sw = replaceOrThrow(
  sw,
  /const CACHE_VERSION = 'subtext-v[^']*';/,
  `const CACHE_VERSION = 'subtext-v${rev}';`,
  'service worker cache version'
);
sw = replaceOrThrow(
  sw,
  /'\/style\.css(?:\?v=[^']*)?'/,
  `'/style.css?v=${rev}'`,
  'service worker style asset'
);
sw = replaceOrThrow(
  sw,
  /'\/app\.js(?:\?v=[^']*)?'/,
  `'/app.js?v=${rev}'`,
  'service worker app asset'
);
sw = replaceOrThrow(
  sw,
  /'\/manifest\.webmanifest(?:\?v=[^']*)?'/,
  `'/manifest.webmanifest?v=${rev}'`,
  'service worker manifest asset'
);
write('sw.js', sw);

console.log(`Updated cache-busting asset revision: ${rev}`);
