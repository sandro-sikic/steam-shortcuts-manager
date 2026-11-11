import type { Integration } from './types.js';

/** Every known integration, one per file. */
export const integrations: Integration[] = [];

/** The integrations that make sense on a platform. */
export function availableIntegrations(platform: NodeJS.Platform, all: Integration[] = integrations): Integration[] {
  return all.filter((integration) => integration.platforms.includes(platform));
}

/** Resolves a `--only` selection; throws on ids that are unknown or unavailable on this platform. */
export function selectIntegrations(
  platform: NodeJS.Platform,
  only: string[] | undefined,
  all: Integration[] = integrations,
): Integration[] {
  const available = availableIntegrations(platform, all);
  if (only === undefined) return available;
  return only.map((id) => {
    const found = available.find((integration) => integration.id === id);
    if (found === undefined) {
      throw new Error(`Unknown or unavailable integration "${id}". Available here: ${available.map((i) => i.id).join(', ') || 'none'}`);
    }
    return found;
  });
}
