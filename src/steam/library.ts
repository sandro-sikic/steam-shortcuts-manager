import path from 'node:path';
import { listDir, readTextIfExists } from '../integrations/shared/fs.js';
import { parseTextVdf } from '../vdf/text.js';

async function libraryPaths(root: string): Promise<string[]> {
  const paths = [root];
  const text = await readTextIfExists(path.join(root, 'steamapps', 'libraryfolders.vdf'));
  const folders = text === undefined ? undefined : safeParse(text)?.get('libraryfolders');
  if (folders instanceof Map) {
    for (const folder of folders.values()) {
      const libraryPath = folder instanceof Map ? folder.get('path') : undefined;
      if (typeof libraryPath === 'string' && libraryPath !== root) paths.push(libraryPath);
    }
  }
  return paths;
}

function safeParse(text: string) {
  try {
    return parseTextVdf(text);
  } catch {
    return undefined;
  }
}

/** Names of the games installed through Steam itself (from `appmanifest_*.acf` in every library folder). */
export async function listInstalledSteamTitles(root: string): Promise<string[]> {
  const titles: string[] = [];
  for (const library of await libraryPaths(root)) {
    const apps = path.join(library, 'steamapps');
    for (const file of await listDir(apps)) {
      if (!/^appmanifest_\d+\.acf$/.test(file)) continue;
      const text = await readTextIfExists(path.join(apps, file));
      const state = text === undefined ? undefined : safeParse(text)?.get('AppState');
      const name = state instanceof Map ? state.get('name') : undefined;
      if (typeof name === 'string' && name !== '') titles.push(name);
    }
  }
  return titles;
}
