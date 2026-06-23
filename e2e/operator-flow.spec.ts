import { expect, test } from '@playwright/test';

test('operator can start the cell and inject a safety fault', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dual-Arm Assembly Cell' })).toBeVisible();
  await expect(page.getByText('CONNECTED', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '↺ RESET', exact: true }).click();
  await page.getByRole('button', { name: 'START' }).click();
  await expect(page.getByText('RUNNING', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'INJECT ERROR' }).click();
  await expect(page.locator('.alert-banner').getByText('ERROR · VERIFICATION_FAILED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'RESET CELL' })).toBeVisible();
});
