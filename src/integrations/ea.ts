import path from 'node:path';
import type { Game } from '../types.js';
import { listDir, pathExists, readTextIfExists } from './shared/fs.js';
import { queryRegistry } from './shared/registry.js';
import type { Integration, ScanContext } from './types.js';

// Unverified (least certain integration): the registry keys below (EA Games / Origin Games with
// `Install Dir`/`InstallDir` and `DisplayName`) and the `__Installer\installerdata.xml` layout
// (<gameTitle locale>, <launcher><filePath>) come from memory, not from a real EA app install. Newer EA
// app installs may not register in the registry at all, so the default `%ProgramFiles%\EA Games`
// folder is scanned too. The XML is read with regexes and every part of it is optional.

const REGISTRY_KEYS: { key: string; view?: 32 | 64 }[] = [
  { key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\EA Games' },
  { key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\EA Games', view: 64 },
  { key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Origin Games' },
];
const NOT_THE_GAME = /unins|setup|install|crash|report|redist|cleanup/i;

interface Candidate {
  id: string;
  dir: string;
  title?: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name] as string)
    .trim();
}

function parseInstallerData(xml: string): { title?: string; launcherPath?: string } {
  const titles = [...xml.matchAll(/<gameTitle\b([^>]*)>([^<]*)<\/gameTitle>/g)];
  const preferred = titles.find((m) => /locale="en_US"/i.test(m[1] as string)) ?? titles[0];
  const title = preferred ? decodeEntities(preferred[2] as string) : '';
  const filePath = /<launcher>[\s\S]*?<filePath>([^<]*)<\/filePath>/.exec(xml)?.[1];
  return { title: title || undefined, launcherPath: filePath ? decodeEntities(filePath) : undefined };
}

/** The launcher exe from installerdata.xml, if it is a real file inside the install dir. */
async function resolveLauncherExe(dir: string, launcherPath: string | undefined): Promise<string | undefined> {
  if (!launcherPath) return undefined;
  // The path usually starts with a bracketed registry reference to the install dir.
  const relative = launcherPath.replace(/^\[[^\]]*\]/, '').replace(/[\\/]+/g, path.sep).replace(/^[\\/]+/, '');
  const exe = path.resolve(dir, relative);
  return exe.startsWith(dir + path.sep) && exe.toLowerCase().endsWith('.exe') && (await pathExists(exe)) ? exe : undefined;
}

async function findTopLevelExe(dir: string): Promise<string | undefined> {
  const exes = (await listDir(dir)).filter((name) => /\.exe$/i.test(name) && !NOT_THE_GAME.test(name));
  return exes.length === 1 ? path.join(dir, exes[0] as string) : undefined;
}

async function registryCandidates(ctx: ScanContext): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (const { key, view } of REGISTRY_KEYS) {
    for (const entry of await queryRegistry(ctx.run, key, { view })) {
      const dir = entry.values.get('Install Dir') || entry.values.get('InstallDir');
      const id = entry.path.split('\\').pop();
      if (dir && id) found.push({ id, dir, title: entry.values.get('DisplayName') || undefined });
    }
  }
  return found;
}

async function defaultRootCandidates(ctx: ScanContext): Promise<Candidate[]> {
  const root = path.join(ctx.env['ProgramFiles'] ?? 'C:\\Program Files', 'EA Games');
  return (await listDir(root)).map((name) => ({ id: name, dir: path.join(root, name) }));
}

export const eaIntegration: Integration = {
  id: 'ea',
  label: 'EA app',
  platforms: ['win32'],

  async scan(ctx) {
    const candidates = [...(await registryCandidates(ctx)), ...(await defaultRootCandidates(ctx))];
    const games = new Map<string, Game>();
    const seenDirs = new Set<string>();
    for (const candidate of candidates) {
      const dir = path.resolve(candidate.dir);
      if (games.has(candidate.id) || seenDirs.has(dir.toLowerCase())) continue;
      const xml = await readTextIfExists(path.join(dir, '__Installer', 'installerdata.xml'));
      const data = xml === undefined ? {} : parseInstallerData(xml);
      const exe = (await resolveLauncherExe(dir, data.launcherPath)) ?? (await findTopLevelExe(dir));
      if (!exe) continue;
      seenDirs.add(dir.toLowerCase());
      games.set(candidate.id, {
        store: this.label,
        id: candidate.id,
        title: candidate.title ?? data.title ?? path.basename(dir),
        installed: true,
        launch: { kind: 'exe', exe, startDir: dir },
      });
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
