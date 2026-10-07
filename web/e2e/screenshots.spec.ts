import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const baselineDir = fileURLToPath(new URL('./baselines/', import.meta.url));
const viewports = [
  { label: '375', width: 375, height: 812 },
  { label: '1280', width: 1280, height: 800 },
] as const;

async function waitForIdle(page: Page): Promise<void> {
  const chatPanel = page.locator('#game-chat-panel');
  if (await chatPanel.count()) {
    if ((await chatPanel.getAttribute('aria-hidden')) !== 'true') {
      await chatPanel.getByRole('button', { name: 'Close chat' }).click();
    }
    await expect(chatPanel).toHaveAttribute('aria-hidden', 'true');
    await expect(chatPanel).not.toHaveClass(/game-chat--open/);
  }
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.locator('.strike-result, .sink-ship, .strike-jet-path, .carrier-run')).toHaveCount(0);
}

async function capture(page: Page, name: string, width: string): Promise<void> {
  await waitForIdle(page);
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({
    path: path.join(baselineDir, `${name}-${width}.png`),
    animations: 'disabled',
  });
}

for (const viewport of viewports) {
  test(`captures the full game flow at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.addStyleTag({
      content:
        '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}',
    });

    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel('Email').fill(`visual-${Date.now()}-${viewport.label}@example.test`);
    await page.getByLabel('Password').fill('broadside-visual-qa');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
    await page.getByLabel('Username').fill(`qa_${Date.now().toString().slice(-8)}_${viewport.label}`);
    await expect(page.getByText('Available')).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play vs Computer' }).first()).toBeVisible();
    await expect(page.getByText('No games yet')).toBeVisible();
    await capture(page, 'home', viewport.label);

    await page.getByRole('button', { name: 'Play vs Computer' }).first().click();
    await page.getByRole('button', { name: 'Play vs computer on easy' }).click();
    await expect(page.getByRole('heading', { name: 'Place your fleet' })).toBeVisible();
    await capture(page, 'placement', viewport.label);

    await page.getByRole('button', { name: 'Shuffle' }).click();
    await page.getByRole('button', { name: 'Lock in fleet' }).click();
    await expect(page.getByRole('grid', { name: "Opponent's board" })).toBeVisible();
    await expect(page.getByText('Your turn — pick a target')).toBeVisible();

    for (let shot = 0; shot < 3; shot++) {
      const grid = page.getByRole('grid', { name: "Opponent's board" });
      let targetFound = false;
      for (let row = 0; row < 10 && !targetFound; row++) {
        for (let col = 0; col < 10 && !targetFound; col++) {
          const cell = grid.locator(`[data-row="${row}"][data-col="${col}"]`);
          const classes = (await cell.getAttribute('class')) ?? '';
          if (classes.includes('cell--water') && !classes.includes('cell--disabled')) {
            await cell.click();
            targetFound = true;
          }
        }
      }
      expect(targetFound).toBe(true);
      await page.getByRole('button', { name: /^Fire at / }).click();
      await expect(page.getByText('Incoming fire…')).toBeVisible();
      await expect(page.getByText('Your turn — pick a target')).toBeVisible({ timeout: 10_000 });
    }
    await capture(page, 'gameplay', viewport.label);

    await page.getByRole('button', { name: 'Resign' }).click();
    await page.getByRole('button', { name: 'Yes, resign' }).click();
    await expect(page.getByRole('heading', { name: 'Game over' })).toBeVisible();
    await capture(page, 'game-over', viewport.label);
  });
}
