import { describe, expect, it } from 'vitest';
import { coverHue, initials } from '../../src/UI/cover.js';

describe('coverHue', () => {
  it('is stable and within the colour wheel', () => {
    expect(coverHue('Hades')).toBe(coverHue('Hades'));
    for (const title of ['', 'Hades', 'Stardew Valley', 'A very long game title that goes on and on', 'Ünïcode ✓']) {
      const hue = coverHue(title);
      expect(Number.isInteger(hue) && hue >= 0 && hue < 360).toBe(true);
    }
  });

  it('gives different games different colours', () => {
    const hues = new Set(['Fortnite', 'Hades', 'Stardew Valley', 'Valorant', 'Portal 2'].map(coverHue));
    expect(hues.size).toBeGreaterThan(3);
  });
});

describe('initials', () => {
  it('takes the first letter of up to two words, capitalised', () => {
    expect(initials('Stardew Valley')).toBe('SV');
    expect(initials('hades')).toBe('H');
    expect(initials('The Witcher 3: Wild Hunt')).toBe('TW');
    expect(initials('Élan vital')).toBe('ÉV');
    expect(initials('  --Half-Life--  ')).toBe('HL');
  });

  it('falls back to a question mark when there are no letters or digits', () => {
    expect(initials('')).toBe('?');
    expect(initials('!!!')).toBe('?');
  });
});
