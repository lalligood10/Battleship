import type { Coordinate } from './placement';
import { coordLabel } from './marks';

export function sonarPresentation(center: Coordinate, shipPresent: boolean): { line: string; toast: string } {
  const location = coordLabel(center);
  return shipPresent
    ? {
        line: `Sonar at ${location}: ship detected`,
        toast: `Sonar: ship detected near ${location}`,
      }
    : {
        line: `Sonar at ${location}: clear`,
        toast: `Sonar: all clear near ${location}`,
      };
}
