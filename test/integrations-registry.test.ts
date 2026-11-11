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

  it('registers every launcher with unique ids, labels and the platforms we support', () => {
    expect(integrations.map((i) => i.id).sort()).toEqual([
      'amazon', 'battlenet', 'ea', 'epic', 'gog', 'heroic', 'itch', 'minecraft', 'riot', 'rockstar', 'ubisoft', 'xbox',
    ]);
    expect(new Set(integrations.map((i) => i.label)).size).toBe(integrations.length);
    for (const integration of integrations) {
      expect(integration.id).toMatch(/^[a-z]+$/);
      expect(integration.label).not.toBe('');
      expect(integration.platforms.length).toBeGreaterThan(0);
    }
  });

  it('offers the expected launchers per platform', () => {
    const ids = (platform: NodeJS.Platform) => availableIntegrations(platform).map((i) => i.id).sort();
    expect(ids('linux')).toEqual(['heroic', 'itch', 'minecraft']);
    expect(ids('darwin')).toEqual(['epic', 'heroic', 'itch']);
    expect(ids('win32')).toEqual([
      'amazon', 'battlenet', 'ea', 'epic', 'gog', 'heroic', 'itch', 'minecraft', 'riot', 'rockstar', 'ubisoft', 'xbox',
    ]);
  });
});
