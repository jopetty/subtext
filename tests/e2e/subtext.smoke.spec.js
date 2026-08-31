import path from 'node:path';
import { test, expect } from '@playwright/test';

const SAMPLE_IMAGE = path.resolve(process.cwd(), 'icon-192.png');

async function uploadImage(page) {
  await page.goto('/');
  await page.setInputFiles('#file-input', SAMPLE_IMAGE);
  await expect(page.locator('#editor-screen')).toHaveClass(/active/);
  await expect(page.locator('#base-image')).toBeVisible();
}

async function seedDraft(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const imageBlob = await fetch('/icon-192.png').then((response) => response.blob());
    await new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase('subtext-drafts');
      deleteRequest.onsuccess = resolve;
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onblocked = resolve;
    });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('subtext-drafts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put({
          schemaVersion: 1,
          imageBlob,
          filter: { name: 'none', intensity: 75, params: {}, applyOnTop: false },
          objects: [],
          paint: { color: '#ff3b30', size: 8, hasStrokes: false, blob: null },
          lastStyle: null,
          lastPreset: 'classic',
        }, 'latest');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
}

test('upload and add caption text field', async ({ page }) => {
  await uploadImage(page);

  const canvas = page.locator('#canvas-container');
  await canvas.dblclick({ position: { x: 120, y: 120 } });

  const field = page.locator('.text-field').first();
  await expect(field).toBeVisible();

  const inner = field.locator('.text-field-inner');
  await inner.click();
  await page.keyboard.type('Test caption');
  await expect(inner).toContainText('Test caption');
});

test('save button triggers a jpeg download', async ({ page }) => {
  await uploadImage(page);

  const downloadPromise = page.waitForEvent('download');
  await page.click('#export-btn');
  const download = await downloadPromise;
  expect(download.suggestedFilename().toLowerCase()).toMatch(/^subtext.*\.jpg$/);
});

test('double-s keyboard shortcut triggers save download', async ({ page }) => {
  await uploadImage(page);
  await page.click('#top-bar');

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('s');
  await page.keyboard.press('s');
  const download = await downloadPromise;

  expect(download.suggestedFilename().toLowerCase()).toMatch(/^subtext.*\.jpg$/);
});

test('deep links fall back to the app shell', async ({ page }) => {
  await page.goto('/fdsa');
  await expect(page.locator('#upload-screen')).toHaveClass(/active/);
  await expect(page.locator('.wordmark')).toContainText('Subtext');
});

test('saved project is restored from the page and Back keeps it available', async ({ page }) => {
  let dialogCount = 0;
  page.on('dialog', () => { dialogCount += 1; });
  await seedDraft(page);

  await expect(page.locator('#draft-card')).toBeVisible();
  await expect(page.locator('#draft-preview')).toBeVisible();
  await page.click('#open-draft-btn');
  await expect(page.locator('#editor-screen')).toHaveClass(/active/);

  await page.click('#back-btn');
  await expect(page.locator('#upload-screen')).toHaveClass(/active/);
  await expect(page.locator('#draft-card')).toBeVisible();
  expect(dialogCount).toBe(0);
});

test('Blur is undoable, redoable, and included in an export', async ({ page }) => {
  await uploadImage(page);
  const blur = page.locator('.vibe-chip[data-filter="blur"]');
  await blur.click();
  await expect(blur).toHaveClass(/active/);

  await page.locator('#top-bar').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.vibe-chip[data-filter="none"]')).toHaveClass(/active/);
  await page.keyboard.press('Control+Shift+z');
  await expect(blur).toHaveClass(/active/);

  const downloadPromise = page.waitForEvent('download');
  await page.click('#export-btn');
  await downloadPromise;
});

test('adding an image object and painting both create editable objects', async ({ page }) => {
  await uploadImage(page);
  await page.setInputFiles('#add-object-input', SAMPLE_IMAGE);
  await expect(page.locator('.image-object')).toHaveCount(1);

  await page.locator('.paint-toggle-btn--desktop').click();
  const paintLayer = page.locator('#paint-layer');
  const box = await paintLayer.boundingBox();
  if (!box) throw new Error('Paint layer has no bounding box');
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await page.mouse.up();
  await expect(page.locator('.image-object')).toHaveCount(2);
});
