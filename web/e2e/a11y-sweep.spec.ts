import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_ISSUES, isBlocking, partitionFindings, type Finding } from '../src/a11y/findings';
import { INTERACTIVE_SELECTOR, TARGET_SIZE_EXEMPT_SELECTOR, undersizedTargets, type TargetBox } from '../src/a11y/targetSize';

/**
 * axe (WCAG 2.0/2.1 A + AA) and 44×44px target-size sweep over every route and the main game states,
 * at 375 and 1280px, dark and light. Fails on serious/critical axe violations and undersized targets
 * that are not listed in KNOWN_ISSUES; writes every finding (with exact rule ids) to the report dir.
 */
const REPORT_DIR = process.env.A11Y_REPORT_DIR ?? 'test-results/a11y-sweep';
const AUTH = 'http://127.0.0.1:9099';
const PROJECT = 'demo-broadside';
const ADMIN_EMAIL = 'lalligood10@gmail.com';
const ADMIN_PASSWORD = 'broadside-a11y-admin';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const themes = ['dark', 'light'] as const;
const widths = [375, 1280] as const;

function lettersOnly(value: string): string {
  return value.replace(/\d/g, (digit) => 'bcdfghjkmn'[Number(digit)]!);
}

function username(prefix: string): string {
  return `${prefix}${lettersOnly(`${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-9))}`;
}

/** The admin callables require this verified email; create or reset it on the Auth emulator. */
async function ensureVerifiedAdmin(): Promise<void> {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer owner' };
  const admin = `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;
  const lookup = (await (await fetch(`${admin}:lookup`, { method: 'POST', headers, body: JSON.stringify({ email: [ADMIN_EMAIL] }) })).json()) as {
    users?: Array<{ localId: string }>;
  };
  let localId = lookup.users?.[0]?.localId;
  if (!localId) {
    const created = (await (
      await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, returnSecureToken: true }),
      })
    ).json()) as { localId?: string };
    localId = created.localId;
  }
  if (!localId) throw new Error('Could not create the emulator admin account');
  const res = await fetch(`${admin}:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId, password: ADMIN_PASSWORD, emailVerified: true }),
  });
  if (!res.ok) throw new Error(`Could not verify the emulator admin account: ${res.status}`);
}

class Sweep {
  readonly findings: Finding[] = [];
  readonly ruleIds = new Map<string, Set<string>>();
  readonly screens: string[] = [];

  constructor(
    readonly theme: string,
    readonly width: number,
  ) {}

  async audit(page: Page, screen: string): Promise<void> {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    this.screens.push(screen);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    for (const violation of results.violations) {
      const ids = this.ruleIds.get(violation.impact ?? 'unknown') ?? new Set<string>();
      ids.add(violation.id);
      this.ruleIds.set(violation.impact ?? 'unknown', ids);
      if (!isBlocking(violation.impact)) continue;
      for (const node of violation.nodes) {
        this.findings.push({
          kind: 'axe',
          screen,
          rule: violation.id,
          impact: violation.impact ?? 'unknown',
          target: node.target.map(String).join(' '),
          detail: (node.failureSummary ?? violation.help).replace(/\s+/g, ' ').trim(),
          theme: this.theme,
          width: this.width,
        });
      }
    }

    const boxes = await page.evaluate(
      ({ selector, exempt }) => {
        const describe = (el: Element) => {
          const classes = [...el.classList].slice(0, 3).map((c) => `.${c}`).join('');
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
          return `${el.tagName.toLowerCase()}${classes}${name ? ` "${name}"` : ''}`;
        };
        const out: TargetBox[] = [];
        for (const el of document.querySelectorAll(selector)) {
          if (el.closest('[inert], [aria-hidden="true"]')) continue;
          if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
          let box: Element = el;
          if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'range'].includes(el.type)) {
            box = el.closest('label') ?? el;
          }
          const rect = box.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          if (rect.bottom <= 0 || rect.right <= 0 || rect.left >= document.documentElement.clientWidth) continue;
          out.push({ label: describe(el), width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10, exempt: !!el.closest(exempt) });
        }
        return out;
      },
      { selector: INTERACTIVE_SELECTOR, exempt: TARGET_SIZE_EXEMPT_SELECTOR },
    );
    for (const box of undersizedTargets(boxes)) {
      this.findings.push({
        kind: 'target-size',
        screen,
        rule: 'target-size',
        impact: 'serious',
        target: box.label,
        detail: `${box.width}×${box.height}px`,
        theme: this.theme,
        width: this.width,
      });
    }
  }

  report(prefix = ''): Finding[] {
    const { unexpected, recorded } = partitionFindings(this.findings, KNOWN_ISSUES);
    mkdirSync(REPORT_DIR, { recursive: true });
    const tag = `${prefix}${this.theme}-${this.width}`;
    const ruleIds = Object.fromEntries([...this.ruleIds].map(([impact, ids]) => [impact, [...ids].sort()]));
    writeFileSync(path.join(REPORT_DIR, `${tag}.json`), JSON.stringify({ screens: this.screens, ruleIds, unexpected, recorded }, null, 2));
    const line = (f: Finding & { owner?: string }) =>
      `| ${f.screen} | ${f.rule} | ${f.impact} | \`${f.target.replace(/\|/g, '\\|')}\` | ${f.detail.replace(/\|/g, '\\|').slice(0, 160)} | ${f.owner ?? '—'} |`;
    const table = (rows: Array<Finding & { owner?: string }>) =>
      rows.length ? ['| Screen | Rule | Impact | Element | Detail | Owner |', '|---|---|---|---|---|---|', ...rows.map(line)].join('\n') : '_None._';
    writeFileSync(
      path.join(REPORT_DIR, `${tag}.md`),
      [
        `# a11y sweep ${tag}`,
        `Screens: ${this.screens.join(', ')}`,
        `axe rule ids by impact: ${JSON.stringify(ruleIds)}`,
        '## Unexpected (fails the sweep)',
        table(unexpected),
        '## Known, owned elsewhere (recorded only)',
        table(recorded),
        '',
      ].join('\n\n'),
    );
    return unexpected;
  }
}

async function newPage(browser: Browser, theme: string, width: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 812 : 900 },
    colorScheme: theme as 'dark' | 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript((value) => localStorage.setItem('broadside.theme', value), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}

async function pickUsername(page: Page, prefix: string): Promise<string> {
  const name = username(prefix);
  await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
  const input = page.getByLabel('Username');
  await input.fill(name);
  await expect(page.getByText('Available')).toBeVisible();
  // The field caps length, so read back what was actually kept.
  return input.inputValue();
}

async function lockIn(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Place your fleet' })).toBeVisible();
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await page.getByRole('button', { name: 'Lock in fleet' }).click();
}

test.beforeAll(async () => {
  await ensureVerifiedAdmin();
});

/** A second dev server with no Firebase config renders the setup screen. */
const SETUP_PORT = 5175;
let setupServer: ChildProcess | undefined;

async function startSetupServer(): Promise<string> {
  const url = `http://127.0.0.1:${SETUP_PORT}/`;
  setupServer = spawn(
    process.execPath,
    [
      path.join(WEB_DIR, 'node_modules/vite/bin/vite.js'),
      '--port',
      String(SETUP_PORT),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    {
      detached: true,
      env: { ...process.env, VITE_USE_EMULATORS: 'false', VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_APP_ID: '' },
      stdio: 'ignore',
      cwd: WEB_DIR,
    },
  );
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return url;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Setup dev server did not start');
}

test.afterAll(async () => {
  const server = setupServer;
  if (!server || server.pid === undefined || server.exitCode !== null || server.signalCode !== null) return;

  const exited = once(server, 'exit').then(
    () => true,
    () => true,
  );
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stopped = await Promise.race([
    exited,
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), 5000);
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  if (!stopped) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
    await exited;
  }
});

test('axe + target size sweep, setup screen (no Firebase config)', async ({ browser }) => {
  test.setTimeout(120_000);
  const url = await startSetupServer();
  const unexpected: Finding[] = [];
  for (const theme of themes) {
    for (const width of widths) {
      const sweep = new Sweep(theme, width);
      const page = await newPage(browser, theme, width);
      await page.goto(url);
      await expect(page.getByRole('heading', { name: 'Broadside needs its Firebase settings' })).toBeVisible();
      await sweep.audit(page, 'setup');
      await page.context().close();
      unexpected.push(...sweep.report('setup-'));
    }
  }
  expect(unexpected, unexpected.map((f) => `${f.screen} | ${f.rule} | ${f.target} | ${f.detail}`).join('\n')).toEqual([]);
});

for (const theme of themes) {
  for (const width of widths) {
    test(`axe + target size sweep, ${theme} ${width}px`, async ({ browser }) => {
      test.setTimeout(360_000);
      const sweep = new Sweep(theme, width);

      // Signed out, enlistment and home.
      const host = await newPage(browser, theme, width);
      await host.goto('/');
      await expect(host.getByRole('tab', { name: 'Sign in' })).toBeVisible();
      await sweep.audit(host, 'sign-in');

      // R11: the skip link is the first tab stop and moves focus to main.
      await host.keyboard.press('Tab');
      await expect(host.getByRole('link', { name: 'Skip to content' })).toBeFocused();
      await host.keyboard.press('Enter');
      await expect(host.locator('main#main-content')).toBeFocused();

      await host.getByRole('tab', { name: 'Create account' }).click();
      await host.getByLabel('Email').fill(`sweep-${Date.now()}-${theme}-${width}@example.test`);
      await host.getByLabel('Password').fill('broadside-a11y-sweep');
      await host.getByRole('button', { name: 'Create account', exact: true }).click();
      await pickUsername(host, 'sweephost');
      await sweep.audit(host, 'username');
      await host.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(host.getByRole('button', { name: 'Play vs Computer' }).first()).toBeVisible();
      await sweep.audit(host, 'home');
      await host.getByRole('button', { name: 'Play vs Computer' }).first().click();
      await expect(host.getByRole('dialog')).toBeVisible();
      await sweep.audit(host, 'home: play vs computer dialog');
      await host.keyboard.press('Escape');

      // Friend game: waiting room, guest join, placement.
      await host.getByRole('button', { name: 'Start a game with a friend' }).click();
      await expect(host.getByRole('button', { name: 'Share invite link' })).toBeVisible();
      const code = ((await host.getByRole('button', { name: /^Join code/ }).textContent()) ?? '').trim();
      await sweep.audit(host, 'game: waiting');

      const guest = await newPage(browser, theme, width);
      await guest.goto(`/join/${code}`);
      await expect(guest.getByRole('button', { name: 'Play as guest' })).toBeVisible();
      await sweep.audit(guest, 'join (signed out)');
      await guest.getByRole('button', { name: 'Play as guest' }).click();
      const guestName = await pickUsername(guest, 'sweepguest');
      await guest.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(guest.getByRole('heading', { name: 'Place your fleet' })).toBeVisible();
      await sweep.audit(guest, 'game: placement');
      await lockIn(guest);
      await lockIn(host);
      await expect(host.getByRole('status').filter({ hasText: /Your turn|Waiting for/ })).toBeVisible();
      await sweep.audit(host, 'game: active');

      // R15: chat takes focus on open; Escape closes it and returns focus to the toggle.
      const toggle = host.getByRole('button', { name: 'Chat', exact: true });
      await toggle.click();
      await expect(host.getByRole('textbox', { name: /^Message / })).toBeFocused();
      await sweep.audit(host, 'game: chat open');
      await host.keyboard.press('Escape');
      await expect(host.locator('#game-chat-panel')).toHaveAttribute('aria-hidden', 'true');
      await expect(toggle).toBeFocused();

      // R9: with a dialog open the chat toggle is hidden and cannot be hit.
      await host.getByRole('button', { name: 'Resign' }).click();
      await expect(host.getByRole('dialog')).toBeVisible();
      await expect(host.locator('.game-chat-toggle')).toBeHidden();
      await sweep.audit(host, 'game: resign dialog');
      await host.getByRole('button', { name: 'Keep playing' }).click();
      await expect(host.locator('.game-chat-toggle')).toBeVisible();

      await guest.goto('/profile');
      await expect(guest.getByRole('heading', { name: 'Save your account' })).toBeVisible();
      await sweep.audit(guest, 'profile (guest)');

      // Results: the host resigns.
      await host.getByRole('button', { name: 'Resign' }).click();
      await host.getByRole('button', { name: 'Yes, resign' }).click();
      await expect(host.getByRole('heading', { name: 'Game over' })).toBeVisible();
      await sweep.audit(host, 'game: results');

      await host.goto('/leaderboards');
      await expect(host.locator('.list-item, .empty').first()).toBeVisible();
      await sweep.audit(host, 'leaderboards');
      await host.goto('/profile');
      await expect(host.locator('.list-item, .empty').first()).toBeVisible();
      await sweep.audit(host, 'profile');
      const replay = host.getByRole('link', { name: /^Watch replay/ }).first();
      if (await replay.count()) {
        await replay.click();
        await expect(host.getByRole('grid').first()).toBeVisible();
        await sweep.audit(host, 'game: replay');
      }
      await host.goto('/dev/playtest');
      await expect(host.locator('main h1, main h2').first()).toBeVisible();
      await sweep.audit(host, 'dev playtest');

      // Admin, then suspend the guest to reach the suspended screen.
      const admin = await newPage(browser, theme, width);
      await admin.goto('/');
      await admin.getByLabel('Email').fill(ADMIN_EMAIL);
      await admin.getByLabel('Password').fill(ADMIN_PASSWORD);
      await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(admin.getByRole('heading', { name: 'Pick a username' }).or(admin.getByRole('button', { name: 'Play vs Computer' }).first())).toBeVisible();
      if (await admin.getByRole('heading', { name: 'Pick a username' }).isVisible()) {
        await pickUsername(admin, 'sweepadmin');
        await admin.getByRole('button', { name: 'Continue', exact: true }).click();
      }
      await expect(admin.getByRole('button', { name: 'Play vs Computer' }).first()).toBeVisible();
      await admin.goto('/admin');
      await expect(admin.locator('article.card').first()).toBeVisible();
      await sweep.audit(admin, 'admin');
      await admin.getByRole('searchbox', { name: 'Search players' }).fill(guestName);
      const guestCard = admin.locator('.admin-user').filter({ hasText: guestName });
      await expect(guestCard).toBeVisible();
      await guestCard.getByRole('button', { name: 'Suspend access' }).click();
      await expect(guestCard.getByRole('button', { name: 'Restore access' })).toBeVisible();
      // Suspension also disables the Auth user, so stay on the live page rather than reloading.
      await expect(guest.getByRole('heading', { name: 'Account suspended' })).toBeVisible();
      await sweep.audit(guest, 'suspended');

      for (const page of [host, guest, admin]) await page.context().close();

      const unexpected = sweep.report();
      expect(unexpected, unexpected.map((f) => `${f.screen} | ${f.rule} | ${f.target} | ${f.detail}`).join('\n')).toEqual([]);
    });
  }
}
