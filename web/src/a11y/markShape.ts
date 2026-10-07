/** Classifies board marks by shape from computed styles, so hit, miss and sunk never rely on colour. */

export interface MarkComputedStyle {
  /** `content` of the cell's `::after` pseudo-element. */
  afterContent: string;
  afterBorderTopWidth: string;
  afterBorderRadius: string;
  /** `background-image` of the cell itself (sunk adds a hatch pattern). */
  cellBackgroundImage: string;
}

export interface MarkShape {
  kind: 'ring' | 'glyph' | 'none';
  glyph: string | null;
  hatched: boolean;
}

function glyphOf(content: string): string | null {
  if (!content || content === 'none' || content === 'normal') return null;
  const text = content.replace(/^["']|["']$/g, '');
  return text.trim() ? text : null;
}

function isRound(radius: string): boolean {
  if (radius.includes('%')) return parseFloat(radius) >= 50;
  return parseFloat(radius) > 0;
}

export function classifyMark(style: MarkComputedStyle): MarkShape {
  const glyph = glyphOf(style.afterContent);
  const hatched = /repeating-(linear|radial|conic)-gradient/.test(style.cellBackgroundImage);
  if (glyph) return { kind: 'glyph', glyph, hatched };
  const ring = style.afterContent !== 'none' && parseFloat(style.afterBorderTopWidth) > 0 && isRound(style.afterBorderRadius);
  return { kind: ring ? 'ring' : 'none', glyph: null, hatched };
}

export function markSignature(shape: MarkShape): string {
  const base = shape.kind === 'glyph' ? `glyph:${shape.glyph}` : shape.kind;
  return shape.hatched ? `${base}+hatch` : base;
}

/** Every mark has a shape, and no two marks share one. */
export function marksDifferByShape(shapes: Record<string, MarkShape>): boolean {
  const values = Object.values(shapes);
  if (values.some((shape) => shape.kind === 'none')) return false;
  return new Set(values.map(markSignature)).size === values.length;
}
