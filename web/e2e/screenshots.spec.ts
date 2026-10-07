import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outputDir = process.env.VISUAL_QA_OUTPUT_DIR
  ? path.resolve(process.env.VISUAL_QA_OUTPUT_DIR)
  : fileURLToPath(new URL('./baselines/', import.meta.url));
const colorScheme = process.env.VISUAL_QA_COLOR_SCHEME;
const viewports = [
  { label: '375', width: 375, height: 812 },
  { label: '1280', width: 1280, height: 800 },
] as const;

function visualUsername(viewport: string): string {
  const suffix = Date.now()
    .toString()
    .slice(-8)
    .replace(/\d/g, (digit) => 'bcdfghjmnpqrstvwxz'[Number(digit)] ?? 'z');
  return `bq_${suffix}_${viewport === '375' ? 'm' : 'w'}`;
}

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
  await mkdir(outputDir, { recursive: true });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({
    path: path.join(outputDir, `${name}-${width}.png`),
    animations: 'disabled',
  });
}

async function opponentCells(page: Page): Promise<Array<{ row: number; col: number; className: string }>> {
  return page
    .getByRole('grid', { name: "Opponent's board" })
    .locator('[data-row][data-col]')
    .evaluateAll((cells) =>
      cells.map((cell) => {
        const element = cell as HTMLElement;
        return {
          row: Number(element.dataset.row),
          col: Number(element.dataset.col),
          className: element.className,
        };
      }),
    );
}

for (const viewport of viewports) {
  test(`captures the full game flow at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({
      reducedMotion: 'reduce',
      ...(colorScheme === 'dark' || colorScheme === 'light' ? { colorScheme } : {}),
    });
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
    await page.getByLabel('Username').fill(visualUsername(viewport.label));
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

if (process.env.VISUAL_QA_CAPTURE_MARKERS === '1') {
  test('captures gameplay with hit, miss, and sunk markers', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({
      reducedMotion: 'reduce',
      ...(colorScheme === 'dark' || colorScheme === 'light' ? { colorScheme } : {}),
    });
    await page.goto('/');

    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel('Email').fill(`visual-${Date.now()}-markers@example.test`);
    await page.getByLabel('Password').fill('broadside-visual-qa');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
    await page.getByLabel('Username').fill(visualUsername('markers'));
    await expect(page.getByText('Available')).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    await page.getByRole('button', { name: 'Play vs Computer' }).first().click();
    await page.getByRole('button', { name: 'Play vs computer on easy' }).click();
    await expect(page.getByRole('heading', { name: 'Place your fleet' })).toBeVisible();
    await page.getByRole('button', { name: 'Shuffle' }).click();
    await page.getByRole('button', { name: 'Lock in fleet' }).click();
    await expect(page.getByRole('grid', { name: "Opponent's board" })).toBeVisible();
    await expect(page.getByText('Your turn — pick a target')).toBeVisible();

    for (let shot = 0; shot < 60; shot++) {
      const cells = await opponentCells(page);
      const hasMark = (mark: string) => cells.some((cell) => cell.className.includes(`cell--${mark}`));
      if (hasMark('hit') && hasMark('miss') && hasMark('sunk')) {
        await capture(page, 'gameplay-hit-miss-sunk', '1280');
        return;
      }

      const cellAt = (row: number, col: number) => cells.find((cell) => cell.row === row && cell.col === col);
      let target = cells
        .filter((cell) => cell.className.includes('cell--hit'))
        .flatMap(({ row, col }) => [
          cellAt(row - 1, col),
          cellAt(row + 1, col),
          cellAt(row, col - 1),
          cellAt(row, col + 1),
        ])
        .find((cell) => cell?.className.includes('cell--water') && !cell.className.includes('cell--disabled'));
      target ??= cells.find(
        (cell) => cell.className.includes('cell--water') && !cell.className.includes('cell--disabled'),
      );
      if (!target) throw new Error('No valid opponent target remains');

      await page
        .getByRole('grid', { name: "Opponent's board" })
        .locator(`[data-row="${target.row}"][data-col="${target.col}"]`)
        .click();
      await page.getByRole('button', { name: /^Fire at / }).click();
      await expect(page.getByText('Incoming fire…')).toBeVisible();
      await expect(page.getByText('Your turn — pick a target')).toBeVisible({ timeout: 10_000 });
    }

    throw new Error('Did not observe hit, miss, and sunk markers before the shot limit');
  });
}
