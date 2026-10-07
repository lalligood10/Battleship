export function shouldPlayResultFx(finishedAtMs: number | null, nowMs: number): boolean {
  return finishedAtMs === null || nowMs - finishedAtMs < 5_000;
}
