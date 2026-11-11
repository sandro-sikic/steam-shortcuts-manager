import { amazonIntegration } from './amazon.js';
import { battlenetIntegration } from './battlenet.js';
import { eaIntegration } from './ea.js';
import { epicIntegration } from './epic.js';
import { gogIntegration } from './gog.js';
import { heroicIntegration } from './heroic.js';
import { itchIntegration } from './itch.js';
import { minecraftIntegration } from './minecraft.js';
import { osIntegration } from './os/index.js';
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
  // Last: its guesses must lose against the specific launchers when de-duplicating.
  osIntegration,
];

/** The integrations that make sense on a platform. */
export function availableIntegrations(platform: NodeJS.Platform, all: Integration[] = integrations): Integration[] {
  return all.filter((integration) => integration.platforms.includes(platform));
}

/** Resolves a `--only` selection (returned in registry order); throws on ids that are unknown or unavailable on this platform. */
export function selectIntegrations(
  platform: NodeJS.Platform,
  only: string[] | undefined,
  all: Integration[] = integrations,
): Integration[] {
  const available = availableIntegrations(platform, all);
  if (only === undefined) return available;
  for (const id of only) {
    if (!available.some((integration) => integration.id === id)) {
      throw new Error(`Unknown or unavailable integration "${id}". Available here: ${available.map((i) => i.id).join(', ') || 'none'}`);
    }
  }
  // Keep registry order whatever order --only lists them in: it decides which duplicate wins.
  return available.filter((integration) => only.includes(integration.id));
}
