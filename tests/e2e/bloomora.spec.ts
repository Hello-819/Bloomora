import { expect, test } from '@playwright/test';

test('local-first flow can create a label, add minutes, and show stats', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Plan' }).first().click();
  await page.getByPlaceholder('Label name').fill('Maths');
  await page.getByRole('button', { name: 'Create label' }).click();
  await expect(page.locator('.labelCard strong', { hasText: 'Maths' })).toBeVisible();

  await page.getByRole('button', { name: 'Timer' }).first().click();
  await page.getByRole('spinbutton', { name: 'Manual session minutes' }).fill('25');
  await page.getByRole('button', { name: 'Add minutes' }).click();

  await page.getByRole('button', { name: 'Stats' }).first().click();
  await expect(page.getByText('Total study')).toBeVisible();
  await expect(page.locator('.metricCard', { hasText: 'Total study' }).getByText('25m')).toBeVisible();
});

test('settings shows Supabase sync as configured', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByText('Not configured')).toHaveCount(0);
  await expect(page.getByText('Local data stays on this browser.')).toBeVisible();
});
