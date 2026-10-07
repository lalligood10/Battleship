import { expect, test, type Page } from '@playwright/test';

/** Keyboard, focus and 375px layout checks against the emulators. Writes no screenshots. */
const viewports = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
] as const;

function testUsername(viewportWidth: number): string {
  const digits = `${Date.now().toString().slice(-6)}${viewportWidth % 1000}`;
  const suffix = digits.replace(/\d/g, (digit) => 'bcdfghjkmn'[Number(digit)]!);
  return `a11y_${suffix}`;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement;
    return a instanceof HTMLElement ? (a.getAttribute('aria-label') ?? a.textContent ?? '').trim() : '';
  });
}

async function tabUntil(page: Page, match: (name: string) => boolean, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (match(await focusedName(page))) return;
  }
  throw new Error('Focus never reached the expected element');
}

for (const viewport of viewports) {
  test(`keyboard play, focus and layout at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    await expect(page.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Create account' }).click();
    await expect(page.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
    await expectNoHorizontalOverflow(page);
    await page.getByLabel('Email').fill(`a11y-${Date.now()}-${viewport.width}@example.test`);
    await page.getByLabel('Password').fill('broadside-a11y-qa');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByLabel('Username').fill(testUsername(viewport.width));
    await expect(page.getByText('Available')).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play vs Computer' }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Dialog: focus starts inside, Tab and Shift+Tab stay inside, Escape restores the opener.
    const opener = page.getByRole('button', { name: 'Play vs Computer' }).first();
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const insideDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    expect(await insideDialog()).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await insideDialog()).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await insideDialog()).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await page.getByRole('button', { name: /^Easy\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Place your fleet' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Shuffle' }).click();
    await page.getByRole('button', { name: 'Lock in fleet' }).click();
    const grid = page.getByRole('grid', { name: "Opponent's board" });
    await expect(page.getByText('Your turn — pick a target')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Keyboard-only shot: Tab into the opponent grid, arrow to a cell, Enter selects, Tab to Fire.
    await page.locator('body').focus();
    await tabUntil(page, (name) => /^[A-J]\d+ /.test(name));
    await expect(grid.locator('[tabindex="0"]')).toBeFocused();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(grid.locator('[data-row="1"][data-col="1"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(grid.locator('[data-row="1"][data-col="1"]')).toHaveClass(/cell--selected/);
    await tabUntil(page, (name) => name === 'Fire at B2', 10);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Your turn — pick a target')).toBeVisible({ timeout: 15_000 });
    await expect(grid.locator('[data-row="1"][data-col="1"]')).toHaveAttribute('aria-label', /^B2 (hit|miss|sunk)$/);
    await expect(grid.locator('[data-row="1"][data-col="1"]')).toHaveAttribute('aria-disabled', 'true');

    const toastRegions = page.locator('.toast-region');
    await expect(toastRegions.first()).toBeAttached();
    expect(
      await toastRegions.evaluateAll((regions) =>
        regions.every(
          (region) =>
            region.getAttribute('role') === 'status' &&
            region.getAttribute('aria-live') === 'polite' &&
            region.getAttribute('aria-atomic') === 'true',
        ),
      ),
    ).toBe(true);
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Resign' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await insideDialog()).toBe(true);
    }
    await page.getByRole('button', { name: 'Yes, resign' }).click();
    await expect(page.getByRole('heading', { name: 'Game over' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
