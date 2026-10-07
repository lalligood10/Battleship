import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement ? (active.getAttribute('aria-label') ?? active.textContent ?? '').trim() : '';
  });
}

async function tabUntil(page: Page, match: (name: string) => boolean, max = 40): Promise<void> {
  for (let index = 0; index < max; index++) {
    await page.keyboard.press('Tab');
    if (match(await focusedName(page))) return;
  }
  throw new Error('Focus never reached the expected element');
}

function lettersOnlyUsername(): string {
  const suffix = Date.now()
    .toString()
    .slice(-8)
    .replace(/\d/g, (digit) => 'bcdfghjmnpqrstvwxz'[Number(digit)] ?? 'z');
  return `bq${suffix}`;
}

for (const viewport of viewports) {
  test(`keyboard placement, focus return and control sizing at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel('Email').fill(`gameplay-${Date.now()}-${viewport.width}@example.test`);
    await page.getByLabel('Password').fill('broadside-gameplay-qa');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
    await page.getByLabel('Username').fill(lettersOnlyUsername());
    await expect(page.getByText('Available')).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const play = page.getByRole('button', { name: 'Play vs Computer' }).first();
    await expect(play).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await play.click();
    await page.getByRole('button', { name: /^Easy\b/ }).click();

    await expect(page.getByRole('heading', { name: 'Place your fleet' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const ownGrid = page.getByRole('grid', { name: 'Your board' });
    expect(await ownGrid.locator('[data-row="0"][data-col="0"]').getAttribute('class')).toContain('cell--ship');
    expect(await ownGrid.locator('[data-row="0"][data-col="4"]').getAttribute('class')).toContain('cell--ship');
    expect(await ownGrid.locator('[data-row="2"][data-col="0"]').getAttribute('class')).toContain('cell--ship');
    expect(await ownGrid.locator('[data-row="2"][data-col="3"]').getAttribute('class')).toContain('cell--ship');
    expect(await ownGrid.locator('[data-row="2"][data-col="4"]').getAttribute('class')).toContain('cell--water');

    await page.locator('body').focus();
    await tabUntil(page, (name) => name.startsWith('A1 ship'));
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('r');
    await expect(page.locator('#placement-issues')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#placement-issues')).toContainText('Overlaps Battleship');
    await expectNoHorizontalOverflow(page);

    for (let index = 0; index < 4; index++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('#placement-issues')).toContainText('Fleet ready');
    await expect(page.locator('.placement-live')).toContainText(/placed/i);
    await expectNoHorizontalOverflow(page);
    await tabUntil(page, (name) => name === 'Lock in fleet');
    await page.keyboard.press('Enter');

    const grid = page.getByRole('grid', { name: "Opponent's board" });
    await expect(grid).toBeVisible();
    await expect(page.getByText('Your turn — pick a target')).toBeVisible();
    const controls = page.locator('.page button:visible, button[aria-label*="mute" i]:visible');
    for (const button of await controls.all()) {
      const box = await button.boundingBox();
      expect(box, 'visible gameplay button should have a bounding box').not.toBeNull();
      expect(box!.width, 'visible gameplay button width').toBeGreaterThanOrEqual(44);
      expect(box!.height, 'visible gameplay button height').toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);

    await page.locator('body').focus();
    await tabUntil(page, (name) => /^[A-J]\d+ /.test(name));
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await tabUntil(page, (name) => name === 'Fire at B2', 10);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Incoming fire…')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Your turn — pick a target')).toBeVisible({ timeout: 15_000 });
    await expect(grid.locator('[data-row="1"][data-col="1"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(grid.locator('[data-row="1"][data-col="2"]')).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });
}
