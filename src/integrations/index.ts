import { amazonIntegration } from './amazon.js';
import { battlenetIntegration } from './battlenet.js';
import { eaIntegration } from './ea.js';
import { epicIntegration } from './epic.js';
import { gogIntegration } from './gog.js';
import { heroicIntegration } from './heroic.js';
import { itchIntegration } from './itch.js';
import { minecraftIntegration } from './minecraft.js';
import { riotIntegration } from './riot.js';
import { rockstarIntegration } from './rockstar.js';
import { ubisoftIntegration } from './ubisoft.js';
import { xboxIntegration } from './xbox.js';
import type { Integration } from './types.js';

/** Every known integration, one per file. */
export const integrations: Integration[] = [
  amazonIntegration,
  battlenetIntegration,
  eaIntegration,
  epicIntegration,
  gogIntegration,
  heroicIntegration,
  itchIntegration,
  minecraftIntegration,
  riotIntegration,
  rockstarIntegration,
  ubisoftIntegration,
  xboxIntegration,
];

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
