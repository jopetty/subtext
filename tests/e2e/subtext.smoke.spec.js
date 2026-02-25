import path from 'node:path';
import { test, expect } from '@playwright/test';

const SAMPLE_IMAGE = path.resolve(process.cwd(), 'icon-192.png');

async function uploadImage(page) {
  await page.goto('/');
  await page.setInputFiles('#file-input', SAMPLE_IMAGE);
  await expect(page.locator('#editor-screen')).toHaveClass(/active/);
  await expect(page.locator('#base-image')).toBeVisible();
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
