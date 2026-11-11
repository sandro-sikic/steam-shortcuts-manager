import path from 'node:path';
import type { Game } from '../types.js';
import type { Integration } from './types.js';
import { listDir, readJsonIfExists } from './shared/fs.js';
import { queryRegistry } from './shared/registry.js';

// Unverified: the Amazon Games app keeps its real install database in SQLite (not read here). We rely on
// the uninstall registry entries named `AmazonGames/<Title>` (values DisplayName, InstallLocation) and on
// each game's `fuel.json` ("FuelPump" manifest: Main.Command, Main.Args, Main.WorkingSubdirOverride),
// plus the default library folder. Registry hive/view placement and the exact fuel.json fields are from memory.

const UNINSTALL = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const KEY_PREFIX = 'AmazonGames/';

interface Candidate {
  id: string;
  title: string;
  dir: string;
}

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';
const quote = (arg: string): string => (/\s/.test(arg) ? `"${arg}"` : arg);

async function fromRegistry(ctx: Parameters<Integration['scan']>[0]): Promise<Candidate[]> {
  const queries = [
    queryRegistry(ctx.run, `HKCU\\${UNINSTALL}`),
    queryRegistry(ctx.run, `HKLM\\${UNINSTALL}`),
    queryRegistry(ctx.run, `HKLM\\${UNINSTALL}`, { view: 32 }),
  ];
  const found: Candidate[] = [];
  for (const key of (await Promise.all(queries)).flat()) {
    const name = key.path.slice(key.path.lastIndexOf('\\') + 1);
    const dir = key.values.get('InstallLocation');
    if (!name.startsWith(KEY_PREFIX) || !isString(dir)) continue;
    const id = name.slice(KEY_PREFIX.length);
    found.push({ id, title: key.values.get('DisplayName') || id, dir });
  }
  return found;
}

async function fromLibrary(ctx: Parameters<Integration['scan']>[0]): Promise<Candidate[]> {
  const root = ctx.env['AMAZON_GAMES_LIBRARY'] ?? 'C:\\Amazon Games\\Library';
  return (await listDir(root)).map((name) => ({ id: name, title: name, dir: path.join(root, name) }));
}

async function toGame(candidate: Candidate, store: string): Promise<Game | undefined> {
  const manifest = await readJsonIfExists(path.join(candidate.dir, 'fuel.json'));
  const main = (manifest as { Main?: { Command?: unknown; Args?: unknown; WorkingSubdirOverride?: unknown } } | undefined)?.Main;
  if (!main || !isString(main.Command)) return undefined;
  const args = Array.isArray(main.Args) ? main.Args.filter(isString).map(quote).join(' ') : '';
  const startDir = isString(main.WorkingSubdirOverride) ? path.join(candidate.dir, main.WorkingSubdirOverride) : candidate.dir;
  return {
    store,
    id: candidate.id,
    title: candidate.title,
    installed: true,
    launch: { kind: 'exe', exe: path.join(candidate.dir, main.Command), startDir, ...(args && { args }) },
  };
}

export const amazonIntegration: Integration = {
  id: 'amazon',
  label: 'Amazon Games',
  platforms: ['win32'],
  async scan(ctx) {
    if (ctx.platform !== 'win32') return [];
    const byId = new Map<string, Candidate>();
    for (const candidate of [...(await fromRegistry(ctx)), ...(await fromLibrary(ctx))]) {
      if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }
    const games = await Promise.all([...byId.values()].map((candidate) => toGame(candidate, this.label)));
    return games
      .filter((game): game is Game => game !== undefined)
      .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
