import { test, expect } from '@playwright/test';

// A visitor who accepted analytics can take that back from the footer.

test('cookie: the footer link forgets the choice and shows the notice again', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('dad-consent', 'accepted'); sessionStorage.setItem('seeded', '1'); } });
  await page.goto('/');
  await expect(page.locator('#cookie')).toHaveCount(0);

  await page.getByRole('button', { name: 'Cookie settings' }).click();
  await expect(page.locator('#cookie')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => localStorage.getItem('dad-consent'))).toBeNull();
});

test('cookie: the privacy page says analytics load only after Accept', async ({ page }) => {
  await page.goto('/privacy/');
  await expect(page.getByText('only after you press Accept in the cookie notice')).toBeAttached();
});
