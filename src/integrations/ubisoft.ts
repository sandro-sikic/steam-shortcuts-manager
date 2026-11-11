import path from 'node:path';
import type { Game } from '../types.js';
import { pathExists } from './shared/fs.js';
import { queryRegistry } from './shared/registry.js';
import type { Integration } from './types.js';

// Unverified: installs are read from HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\<uplayId>
// (value InstallDir); the plain key without WOW6432Node is tried as well. The registry has no title, so
// it is derived from the install folder name. `uplay://launch/<id>/0` is the commonly used launch URI.
const INSTALL_KEYS = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Ubisoft\\Launcher\\Installs',
];

const LABEL = 'Ubisoft Connect';

export const ubisoftIntegration: Integration = {
  id: 'ubisoft',
  label: LABEL,
  platforms: ['win32'],

  async scan(ctx) {
    const games = new Map<string, Game>();
    for (const key of INSTALL_KEYS) {
      for (const entry of await queryRegistry(ctx.run, key, { view: 32 })) {
        const segments = entry.path.split('\\');
        const id = segments.pop() as string;
        // Only direct children of ...\Installs are games; deeper keys and the root are not.
        if (id === '' || segments.pop()?.toLowerCase() !== 'installs') continue;
        const installDir = entry.values.get('InstallDir')?.trim();
        if (!installDir || games.has(id) || !(await pathExists(installDir))) continue;
        games.set(id, {
          store: LABEL,
          id,
          title: titleFromFolder(installDir) || id,
          installed: true,
          launch: { kind: 'uri', uri: `uplay://launch/${id}/0` },
        });
      }
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};

function titleFromFolder(installDir: string): string {
  return path.win32.basename(installDir).replace(/[_\s]+/g, ' ').trim();
}
