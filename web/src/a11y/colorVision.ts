/** Colour-vision simulation matrices for the colour-blind review screenshots, plus contrast helpers. */

export type Rgb = readonly [number, number, number];
type Row = readonly [number, number, number];
export type Matrix3 = readonly [Row, Row, Row];

export type Simulation = 'grayscale' | 'protanopia' | 'deuteranopia' | 'tritanopia';

/** Widely used approximations (Viénot/Brettel style, as published for SVG `feColorMatrix`). */
export const SIMULATIONS: Record<Simulation, Matrix3> = {
  grayscale: [
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
  ],
  protanopia: [
    [0.567, 0.433, 0],
    [0.558, 0.442, 0],
    [0, 0.242, 0.758],
  ],
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7],
  ],
  tritanopia: [
    [0.95, 0.05, 0],
    [0, 0.433, 0.567],
    [0, 0.475, 0.525],
  ],
};

export const SIMULATION_NAMES = Object.keys(SIMULATIONS) as Simulation[];

export function filterId(simulation: Simulation): string {
  return `a11y-cv-${simulation}`;
}

/** `values` for an SVG `feColorMatrix type="matrix"` (4×5, alpha untouched). */
export function feColorMatrixValues(matrix: Matrix3): string {
  return [...matrix.map((row) => [...row, 0, 0].join(' ')), '0 0 0 1 0'].join(' ');
}

/** A hidden SVG holding one filter per simulation; reference with `filter: url(#id)`. */
export function simulationSvgMarkup(): string {
  const filters = SIMULATION_NAMES.map(
    (name) =>
      `<filter id="${filterId(name)}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${feColorMatrixValues(SIMULATIONS[name])}"/></filter>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${filters}</svg>`;
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toSrgb(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

/** Applies a simulation in linear RGB, matching `color-interpolation-filters="linearRGB"`. */
export function simulate(rgb: Rgb, matrix: Matrix3): Rgb {
  const lin = rgb.map(toLinear);
  const out = matrix.map((row) => row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!);
  return [toSrgb(out[0]!), toSrgb(out[1]!), toSrgb(out[2]!)];
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
