import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SIMULATION_NAMES, filterId, simulationSvgMarkup } from '../src/a11y/colorVision';
import { classifyMark, markSignature, marksDifferByShape, type MarkComputedStyle, type MarkShape } from '../src/a11y/markShape';

/**
 * Plays a friend game until both boards show hit, miss and sunk marks, then
 * - asserts the three marks differ by shape (ring / glyph / hatched glyph) on both boards, from computed styles;
 * - saves full-page screenshots under grayscale and protanopia, deuteranopia and tritanopia colour matrices.
 */
const OUTPUT_DIR = process.env.COLORBLIND_OUTPUT_DIR ?? 'test-results/colorblind';
const FIRESTORE = 'http://127.0.0.1:8080/v1/projects/demo-broadside/databases/(default)/documents';
const SHIP_LENGTHS: Record<string, number> = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };
const MARKS = ['miss', 'hit', 'sunk'] as const;

type Cell = { row: number; col: number };
type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

async function readDoc(docPath: string): Promise<Record<string, FirestoreValue>> {
  const res = await fetch(`${FIRESTORE}/${docPath}`, { headers: { authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`Firestore emulator read failed for ${docPath}: ${res.status}`);
  return ((await res.json()) as { fields: Record<string, FirestoreValue> }).fields;
}

function shipCells(ship: Record<string, FirestoreValue>): Cell[] {
  const row = Number(ship.row?.integerValue);
  const col = Number(ship.col?.integerValue);
  const length = SHIP_LENGTHS[ship.type?.stringValue ?? ''] ?? 0;
  return Array.from({ length }, (_, i) => (ship.horizontal?.booleanValue ? { row, col: col + i } : { row: row + i, col }));
}

/** Two cells sink the destroyer, one hits the cruiser, one misses. */
async function shotPlan(gameId: string, targetUid: string): Promise<Cell[]> {
  const fields = await readDoc(`games/${gameId}/private/${targetUid}`);
  const fleet = (fields.fleet?.arrayValue?.values ?? []).map((value) => value.mapValue?.fields ?? {});
  const byType = (type: string) => fleet.find((ship) => ship.type?.stringValue === type);
  const occupied = new Set(fleet.flatMap(shipCells).map((cell) => `${cell.row},${cell.col}`));
  const water = Array.from({ length: 100 }, (_, i) => ({ row: Math.floor(i / 10), col: i % 10 })).find(
    (cell) => !occupied.has(`${cell.row},${cell.col}`),
  )!;
  return [...shipCells(byType('destroyer')!), shipCells(byType('cruiser')!)[0]!, water];
}

async function newPage(browser: Browser, theme: 'dark' | 'light'): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript((value) => localStorage.setItem('broadside.theme', value), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  return page;
}

function lettersOnly(value: string): string {
  return value.replace(/\d/g, (digit) => 'bcdfghjmnv'[Number(digit)]!);
}

async function pickUsername(page: Page, prefix: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
  await page.getByLabel('Username').fill(`${prefix}${lettersOnly(`${Date.now()}`.slice(-8))}`);
  await expect(page.getByText('Available')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

async function lockIn(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Place your fleet' })).toBeVisible();
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await page.getByRole('button', { name: 'Lock in fleet' }).click();
}

function yourTurn(page: Page) {
  return page.getByText('Your turn — pick a target');
}

async function whoseTurn(host: Page, guest: Page): Promise<Page> {
  for (let i = 0; i < 80; i++) {
    for (const page of [host, guest]) if (await yourTurn(page).isVisible()) return page;
    await host.waitForTimeout(250);
  }
  throw new Error('Neither player got the turn');
}

async function markStyles(page: Page): Promise<Array<Record<string, MarkComputedStyle | null>>> {
  return page.locator('.board').evaluateAll((boards, marks) =>
    boards.map((board) =>
      Object.fromEntries(
        marks.map((mark) => {
          const cell = board.querySelector(`.cell--${mark}`);
          if (!cell) return [mark, null];
          const after = getComputedStyle(cell, '::after');
          return [
            mark,
            {
              afterContent: after.content,
              afterBorderTopWidth: after.borderTopWidth,
              afterBorderRadius: after.borderTopLeftRadius,
              cellBackgroundImage: getComputedStyle(cell).backgroundImage,
            },
          ];
        }),
      ),
    ),
  [...MARKS]);
}

for (const theme of ['dark', 'light'] as const) {
  test(`hit, miss and sunk marks differ by shape and survive colour-vision filters (${theme})`, async ({ browser }) => {
    test.setTimeout(240_000);
    const host = await newPage(browser, theme);
    await host.goto('/');
    await host.getByRole('tab', { name: 'Create account' }).click();
    await host.getByLabel('Email').fill(`colorblind-${Date.now()}-${theme}@example.test`);
    await host.getByLabel('Password').fill('broadside-colorblind');
    await host.getByRole('button', { name: 'Create account', exact: true }).click();
    await pickUsername(host, 'cbhost');
    await host.getByRole('button', { name: 'Start a game with a friend' }).click();
    await expect(host.getByRole('button', { name: 'Share invite link' })).toBeVisible();
    const code = ((await host.getByRole('button', { name: /^Join code/ }).textContent()) ?? '').trim();
    const gameId = new URL(host.url()).pathname.split('/').pop()!;

    const guest = await newPage(browser, theme);
    await guest.goto(`/join/${code}`);
    await guest.getByRole('button', { name: 'Play as guest' }).click();
    await pickUsername(guest, 'cbguest');
    await lockIn(guest);
    await lockIn(host);
    await expect(host.getByText(/Your turn — pick a target|Waiting for/).first()).toBeVisible();

    const game = await readDoc(`games/${gameId}`);
    const hostUid = game.hostUid!.stringValue!;
    const guestUid = (game.playerUids?.arrayValue?.values ?? []).map((v) => v.stringValue!).find((uid) => uid !== hostUid)!;
    const plans = new Map<Page, Cell[]>([
      [host, await shotPlan(gameId, guestUid)],
      [guest, await shotPlan(gameId, hostUid)],
    ]);

    while ([...plans.values()].some((plan) => plan.length)) {
      const shooter = await whoseTurn(host, guest);
      const cell = plans.get(shooter)!.shift();
      if (!cell) throw new Error('Turn order left a player without a planned shot');
      const grid = shooter.getByRole('grid', { name: "Opponent's board" });
      await grid.locator(`[data-row="${cell.row}"][data-col="${cell.col}"]`).click();
      await shooter.getByRole('button', { name: /^Fire at / }).click();
      await expect(grid.locator(`[data-row="${cell.row}"][data-col="${cell.col}"]`)).toHaveAttribute('aria-disabled', 'true');
      await expect(yourTurn(shooter)).toBeHidden({ timeout: 20_000 });
    }
    await whoseTurn(host, guest);

    // Both board renderings (targeting grid and own fleet) show all three marks, each with its own shape.
    const boards = await markStyles(host);
    expect(boards.length).toBeGreaterThanOrEqual(2);
    for (const [index, board] of boards.entries()) {
      const shapes: Record<string, MarkShape> = {};
      for (const mark of MARKS) {
        const style = board[mark];
        expect(style, `board ${index} has a ${mark} mark`).toBeTruthy();
        shapes[mark] = classifyMark(style!);
      }
      const signatures = Object.fromEntries(MARKS.map((mark) => [mark, markSignature(shapes[mark]!)]));
      expect(marksDifferByShape(shapes), `board ${index}: ${JSON.stringify(signatures)}`).toBe(true);
      expect(signatures.miss).toBe('ring');
    }

    mkdirSync(OUTPUT_DIR, { recursive: true });
    await host.evaluate(() => window.scrollTo(0, 0));
    await host.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), simulationSvgMarkup());
    await host.screenshot({ path: path.join(OUTPUT_DIR, `${theme}-normal.png`), fullPage: true });
    for (const simulation of SIMULATION_NAMES) {
      await host.evaluate((id) => {
        document.documentElement.style.filter = `url(#${id})`;
      }, filterId(simulation));
      await host.screenshot({ path: path.join(OUTPUT_DIR, `${theme}-${simulation}.png`), fullPage: true });
    }
    await host.evaluate(() => {
      document.documentElement.style.filter = '';
    });

    for (const page of [host, guest]) await page.context().close();
  });
}
