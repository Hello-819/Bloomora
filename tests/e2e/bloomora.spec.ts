import { expect, test, type Page } from '@playwright/test';

async function goTo(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
}

test('local-first flow can create a label, log minutes, and show insights', async ({ page }) => {
  await page.goto('/');
  await goTo(page, 'Tasks');
  await page.getByPlaceholder('Label name').fill('Maths');
  await page.getByRole('button', { name: 'Create label' }).click();
  await expect(page.locator('.labelRow strong', { hasText: 'Maths' })).toBeVisible();

  await goTo(page, 'Focus');
  await page.getByRole('spinbutton', { name: 'Manual session minutes' }).fill('25');
  await page.getByRole('button', { name: 'Log session' }).click();

  await goTo(page, 'Insights');
  await expect(page.locator('.metricCard', { hasText: 'Total study' }).getByText('25m')).toBeVisible();
});

test('gamified pages are gone and the overview shows study metrics', async ({ page }) => {
  await page.goto('/#/worlds');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good');
  await expect(page.getByText(/Island|Garden|Harvest|Achievements/)).toHaveCount(0);
  await expect(page.locator('.metricCard', { hasText: 'Active days' })).toBeVisible();
});

test('sign in lives behind the profile menu, not on the page', async ({ page }) => {
  await page.goto('/#/settings/account');
  await expect(page.getByPlaceholder('Email')).toHaveCount(0);
  await expect(page.getByText('Saved on this device only')).toBeVisible();

  await page.getByRole('button', { name: 'Open profile menu' }).click();
  await expect(page.getByRole('menu', { name: 'Profile menu' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Sign in' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in to Bloomora' })).toBeVisible();
  await expect(page.getByText('Accounts are not set up on this deployment')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('profile details and avatar appear in the top-right profile button', async ({ page }) => {
  await page.goto('/#/settings/profile');
  await page.getByLabel('Display name').fill('Sam Taylor');
  await page.getByLabel('Stage of study').selectOption('university');
  await expect(page.getByRole('button', { name: 'Open profile menu' })).toContainText('ST');

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: 'Open profile menu' }).locator('img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
});

test('deadlines, grades and flashcard review work end to end', async ({ page }) => {
  await page.goto('/#/deadlines');
  await page.getByRole('button', { name: 'Add deadline' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a deadline' });
  await dialog.getByLabel('Title').fill('Lab report');
  await dialog.getByLabel('Due date').fill('2030-01-15');
  await dialog.getByRole('button', { name: 'Save deadline' }).click();
  await expect(page.locator('.deadlineRow', { hasText: 'Lab report' })).toBeVisible();

  await goTo(page, 'Grades');
  await page.getByRole('button', { name: 'Record result' }).click();
  const result = page.getByRole('dialog', { name: 'Record a result' });
  await result.getByLabel('Assessment').fill('Mock 1');
  await result.getByLabel('Score').fill('45');
  await result.getByLabel('Out of').fill('60');
  await result.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.resultRow', { hasText: 'Mock 1' })).toContainText('75.0%');

  await goTo(page, 'Flashcards');
  await page.getByRole('button', { name: 'New card' }).click();
  const card = page.getByRole('dialog', { name: 'New flashcard' });
  await card.getByLabel('Front').fill('Capital of France?');
  await card.getByLabel('Back').fill('Paris');
  await card.getByRole('button', { name: 'Add card' }).click();
  await card.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByText('Paris')).toBeVisible();
  await page.getByRole('button', { name: /^Good/ }).click();
  await expect(page.getByText('All caught up')).toBeVisible();
});

test('command palette jumps to pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Search or jump to/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Search' }).getByLabel('Search').fill('timetable');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Timetable', level: 1 })).toBeVisible();
});
