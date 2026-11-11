import { describe, expect, it } from 'vitest';
import { availableIntegrations, integrations, selectIntegrations } from '../src/integrations/index.js';
import type { Integration } from '../src/integrations/types.js';

const make = (id: string, platforms: NodeJS.Platform[]): Integration => ({ id, label: id, platforms, scan: async () => [] });
const all = [make('both', ['win32', 'linux']), make('win', ['win32'])];

describe('integration registry', () => {
  it('filters by platform', () => {
    expect(availableIntegrations('linux', all).map((i) => i.id)).toEqual(['both']);
    expect(availableIntegrations('win32', all).map((i) => i.id)).toEqual(['both', 'win']);
    expect(availableIntegrations('darwin', all)).toEqual([]);
  });

  it('selects everything available, or the requested ids in order', () => {
    expect(selectIntegrations('win32', undefined, all).map((i) => i.id)).toEqual(['both', 'win']);
    expect(selectIntegrations('win32', ['win', 'both'], all).map((i) => i.id)).toEqual(['win', 'both']);
  });

  it('rejects unknown or unavailable ids', () => {
    expect(() => selectIntegrations('linux', ['win'], all)).toThrow('Available here: both');
    expect(() => selectIntegrations('darwin', ['x'], all)).toThrow('Available here: none');
  });

  it('exposes the real registry (unique ids, valid platforms)', () => {
    const ids = integrations.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(availableIntegrations('linux').length).toBeLessThanOrEqual(integrations.length);
  });
});
