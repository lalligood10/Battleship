import { describe, expect, it } from 'vitest';
import { sonarPresentation } from './sonarPresentation';

describe('sonar presentation', () => {
  it('formats visible result lines and toasts with the sonar location', () => {
    expect(sonarPresentation({ row: 4, col: 4 }, true)).toEqual({
      line: 'Sonar at E5: ship detected',
      toast: 'Sonar: ship detected near E5',
    });
    expect(sonarPresentation({ row: 4, col: 4 }, false)).toEqual({
      line: 'Sonar at E5: clear',
      toast: 'Sonar: all clear near E5',
    });
  });
});
