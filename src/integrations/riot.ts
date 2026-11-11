import path from 'node:path';
import type { Game } from '../types.js';
import type { Integration } from './types.js';
import { listDir, pathExists, readJsonIfExists, readTextIfExists } from './shared/fs.js';

// Unverified: layout is from memory of a Windows Riot Client install. RiotClientInstalls.json keys
// (rc_default, rc_live, associated_client) and the product_settings.yaml keys (product_install_full_path,
// product_install_root) are tolerated in several spellings; the YAML is read with a simple regex.

const LABEL = 'Riot Games';
const KNOWN_TITLES: Record<string, string> = {
  league_of_legends: 'League of Legends',
  valorant: 'VALORANT',
  bacon: 'Legends of Runeterra',
};

function titleFor(product: string): string {
  return (
    KNOWN_TITLES[product] ??
    product
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

/** Finds the first existing RiotClientServices.exe listed in RiotClientInstalls.json. */
async function findClient(file: string): Promise<string | undefined> {
  const json = await readJsonIfExists(file);
  if (typeof json !== 'object' || json === null) return undefined;
  const data = json as Record<string, unknown>;
  const associated = data['associated_client'];
  const candidates = [
    data['rc_default'],
    data['rc_live'],
    ...(typeof associated === 'object' && associated !== null ? Object.keys(associated) : []),
    ...(typeof associated === 'object' && associated !== null ? Object.values(associated) : []),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /RiotClientServices\.exe$/i.test(candidate) && (await pathExists(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

function yamlValue(text: string, key: string): string | undefined {
  const raw = new RegExp(`^\\s*${key}:[ \\t]*(.*?)\\s*$`, 'm').exec(text)?.[1];
  if (raw === undefined) return undefined;
  const quoted = /^(["'])(.*)\1$/.exec(raw);
  const value = quoted ? (quoted[1] === '"' ? quoted[2]!.replace(/\\\\/g, '\\') : quoted[2]!) : raw;
  return value === '' ? undefined : value;
}

export const riotIntegration: Integration = {
  id: 'riot',
  label: LABEL,
  platforms: ['win32'],
  async scan(ctx) {
    const root = path.join(ctx.env['ProgramData'] ?? 'C:\\ProgramData', 'Riot Games');
    const client = await findClient(path.join(root, 'RiotClientInstalls.json'));
    if (client === undefined) return [];

    const games = new Map<string, Game>();
    for (const folder of await listDir(path.join(root, 'Metadata'))) {
      const [product = '', patchline = 'live'] = folder.split('.', 2);
      const settings = await readTextIfExists(path.join(root, 'Metadata', folder, `${folder}.product_settings.yaml`));
      if (product === '' || settings === undefined) continue;
      const installPath = yamlValue(settings, 'product_install_full_path') ?? yamlValue(settings, 'product_install_root');
      if (installPath === undefined || !(await pathExists(installPath))) continue;
      const id = `${product}.${patchline || 'live'}`;
      if (games.has(id)) continue;
      games.set(id, {
        store: LABEL,
        id,
        title: titleFor(product),
        installed: true,
        launch: {
          kind: 'exe',
          exe: client,
          startDir: path.dirname(client),
          args: `--launch-product=${product} --launch-patchline=${patchline || 'live'}`,
        },
      });
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
