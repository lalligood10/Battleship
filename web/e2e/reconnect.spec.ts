import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __audioNodes: number;
    __sunkLogs: unknown[];
  }
}

const effectSelectors = '.strike-result, .sink-ship, .strike-jet-path, .carrier-run';

async function waitForQuietBoard(page: Page) {
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.locator(effectSelectors)).toHaveCount(0);
}

async function boardSnapshot(page: Page) {
  return page.evaluate(() => {
    const classes = (label: string) => {
      const grid = [...document.querySelectorAll<HTMLElement>('[role="grid"]')].find(
        (node) => node.getAttribute('aria-label') === label,
      );
      return [...(grid?.querySelectorAll<HTMLElement>('[data-row][data-col]') ?? [])].map((cell) =>
        cell.className.split(/\s+/).filter(Boolean).sort(),
      );
    };
    return {
      opponent: classes("Opponent's board"),
      own: classes('Your board'),
      turn: document.querySelector('[role="status"]')?.textContent?.trim() ?? '',
      mode: document.querySelector('.topbar .mode-badge')?.textContent?.trim() ?? '',
    };
  });
}

async function fireAtWater(page: Page) {
  const opponentGrid = page.getByRole('grid', { name: "Opponent's board" });
  const target = opponentGrid.locator('.cell--water:not(.cell--disabled)').first();
  await expect(target).toBeVisible();
  await target.click();
  await page.getByRole('button', { name: /^Fire at / }).click();
  await expect(page.getByText('Incoming fire…')).toBeVisible();
  await expect(page.getByText('Your turn — pick a target')).toBeVisible();
}

test('game reconnect restores the board without replaying transient effects', async ({ page, context }) => {
  test.setTimeout(180_000);
  const installInstrumentation = `(() => {
    window.__audioNodes = 0;
    window.__sunkLogs = [];
    const patch = (Ctor) => {
      if (!Ctor || !Ctor.prototype) return;
      for (const method of ['createOscillator', 'createBufferSource']) {
        const original = Ctor.prototype[method];
        if (!original) continue;
        Ctor.prototype[method] = function(...args) {
          window.__audioNodes += 1;
          return original.apply(this, args);
        };
      }
    };
    patch(window.AudioContext);
    patch(window.webkitAudioContext);
    const info = console.info;
    console.info = function(...args) {
      if (args[0] && args[0].type === 'shipSunk') window.__sunkLogs.push(args[0]);
      return info.apply(this, args);
    };
  })();`;
  await page.addInitScript(installInstrumentation);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill(`reconnect-${Date.now()}@example.test`);
  await page.getByLabel('Password').fill('broadside-reconnect');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
  await page.getByLabel('Username').fill(`rec${Date.now().toString().slice(-10)}`);
  await expect(page.getByText('Available')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Play vs Computer' }).first().click();
  await page.getByRole('button', { name: 'Play vs computer on easy' }).click();
  await expect(page.getByRole('heading', { name: 'Place your fleet' })).toBeVisible();
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await page.getByRole('button', { name: 'Lock in fleet' }).click();
  await expect(page.getByText('Your turn — pick a target')).toBeVisible();

  await fireAtWater(page);
  await fireAtWater(page);
  await waitForQuietBoard(page);
  const gameUrl = page.url();
  const beforeReload = await boardSnapshot(page);

  await page.reload();
  await expect(page.getByText('Your turn — pick a target')).toBeVisible();
  await waitForQuietBoard(page);
  expect(await boardSnapshot(page)).toEqual(beforeReload);

  const reopened = await context.newPage();
  await reopened.addInitScript(installInstrumentation);
  await page.close();
  await reopened.goto(gameUrl);
  await expect(reopened.getByText('Your turn — pick a target')).toBeVisible();
  await waitForQuietBoard(reopened);
  expect(await boardSnapshot(reopened)).toEqual(beforeReload);

  await reopened.getByRole('button', { name: 'Resign' }).click();
  await reopened.getByRole('button', { name: 'Yes, resign' }).click();
  await expect(reopened.getByRole('heading', { name: 'Game over' })).toBeVisible();
  await expect(reopened.locator('.result-hero')).toContainText(/Victory!|Defeat/);
  await reopened.reload();
  await expect(reopened.getByRole('heading', { name: 'Game over' })).toBeVisible();
  await expect(reopened.locator('.result-hero')).toContainText(/Victory!|Defeat/);
  const resultFxOnReopen = (await reopened.locator('.result-hero .fx').count()) > 0;

  await reopened.getByRole('heading', { name: 'Game over' }).click();
  await reopened.waitForTimeout(3_000);
  const fxState = await reopened.evaluate(() => ({
    audioNodes: window.__audioNodes,
    sunkLogs: window.__sunkLogs.length,
    sinkBanners: document.querySelectorAll('.fx-banner').length,
  }));
  expect(fxState.audioNodes).toBe(0);
  expect(fxState.sunkLogs).toBe(0);
  expect(fxState.sinkBanners).toBe(0);
  console.info(`ResultsView reopen .result-hero .fx: ${resultFxOnReopen}`);
});
