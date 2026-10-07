/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function blockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedSelector}\\s*\\{`).exec(css);
  if (!match) throw new Error(`Missing CSS block for ${selector}`);

  const start = match.index + match[0].length;
  let depth = 1;
  let end = start;
  while (depth > 0 && end < css.length) {
    if (css[end] === '{') depth += 1;
    if (css[end] === '}') depth -= 1;
    end += 1;
  }
  if (depth !== 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(start, end - 1);
}

function parseTokens(block: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/((?:--)?[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) tokens.set(name, value.trim());
  }
  return tokens;
}

function themeTokens(selector: string): Map<string, string> {
  const tokens = parseTokens(blockFor(':root'));
  for (const [name, value] of parseTokens(blockFor(selector))) {
    tokens.set(name, value);
  }
  return tokens;
}

function color(tokens: Map<string, string>, token: string): [number, number, number] {
  const value = tokens.get(token);
  if (!value) throw new Error(`Missing ${token}`);
  const match = /^#([\da-f]{6})$/i.exec(value);
  if (!match) throw new Error(`Expected ${token} to be a six-digit hex color, got ${value}`);
  const hex = match[1];
  if (!hex) throw new Error(`Invalid hex color for ${token}: ${value}`);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function luminance(tokens: Map<string, string>, token: string): number {
  const [red, green, blue] = color(tokens, token);
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(tokens: Map<string, string>, foreground: string, background: string): number {
  const first = luminance(tokens, foreground);
  const second = luminance(tokens, background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const themes = [
  ['dark', ':root'],
  ['light', "[data-theme='light']"],
] as const;

describe('naval-command theme tokens', () => {
  it('sets the expected color scheme for both explicit themes', () => {
    expect(parseTokens(blockFor(':root')).get('color-scheme')).toBe('dark');
    expect(parseTokens(blockFor("[data-theme='light']")).get('color-scheme')).toBe('light');
  });

  for (const [theme, selector] of themes) {
    it(`meets the text contrast floors in the ${theme} theme`, () => {
      const tokens = themeTokens(selector);
      const foregrounds = ['--text', '--muted', '--accent', '--amber', '--danger', '--success'];
      const backgrounds = ['--bg', '--card', '--card-2'];

      for (const foreground of foregrounds) {
        for (const background of backgrounds) {
          expect(contrast(tokens, foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }

      expect(contrast(tokens, '--accent-text', '--accent-fill')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens, '--on-danger', '--danger-fill')).toBeGreaterThanOrEqual(4.5);
    });

    it(`meets the board contrast floors in the ${theme} theme`, () => {
      const tokens = themeTokens(selector);

      expect(contrast(tokens, '--sea-label', '--sea')).toBeGreaterThanOrEqual(4.5);
      for (const foreground of [
        '--ship',
        '--mark-miss',
        '--mark-hit-fill',
        '--mark-sunk-glyph',
        '--radar',
      ]) {
        expect(contrast(tokens, foreground, '--sea'), `${foreground} on --sea`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(tokens, '--mark-hit-glyph', '--mark-hit-fill')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens, '--mark-sunk-glyph', '--mark-sunk-fill')).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('uses the explicit light palette for the operating-system light preference', () => {
    const light = themeTokens("[data-theme='light']");
    const systemLight = themeTokens(":root:not([data-theme='dark'])");
    for (const token of [
      '--bg',
      '--card',
      '--card-2',
      '--text',
      '--muted',
      '--border',
      '--accent',
      '--accent-fill',
      '--accent-text',
      '--amber',
      '--danger',
      '--danger-fill',
      '--on-danger',
      '--success',
      '--warning',
    ]) {
      expect(systemLight.get(token), token).toBe(light.get(token));
    }
    expect(systemLight.get('color-scheme')).toBe('light');
  });
});
