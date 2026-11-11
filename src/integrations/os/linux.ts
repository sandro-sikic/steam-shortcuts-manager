import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { listDir, readTextIfExists } from '../shared/fs.js';
import type { ScanContext } from '../types.js';
import type { InstalledApp } from './types.js';

// Unverified on a variety of distros: desktop-entry handling follows the freedesktop Desktop Entry
// spec; Flatpak and Snap export directories are the usual system locations.

/** Used only when XDG_DATA_DIRS is unset; distros that ship Flatpak/Snap normally add them to it. */
const DEFAULT_DATA_DIRS = ['/usr/local/share', '/usr/share', '/var/lib/flatpak/exports/share', '/var/lib/snapd/desktop'];
const FIELD_CODES = new Set(['f', 'F', 'u', 'U', 'd', 'D', 'n', 'N', 'i', 'c', 'k', 'v', 'm']);

/** Directories (in precedence order) that hold `applications/*.desktop`. */
function applicationDirs({ home, env }: ScanContext): string[] {
  const dataHome = env['XDG_DATA_HOME'] || path.join(home, '.local', 'share');
  const explicit = env['XDG_DATA_DIRS'];
  const dataDirs = explicit ? explicit.split(':').filter(Boolean) : DEFAULT_DATA_DIRS;
  const all = [dataHome, path.join(dataHome, 'flatpak', 'exports', 'share'), ...dataDirs];
  return [...new Set(all)].map((dir) => path.join(dir, 'applications'));
}

/** Parses the `[Desktop Entry]` group; localized keys like `Name[de]` are ignored. */
export function parseDesktopEntry(text: string): Map<string, string> {
  const entry = new Map<string, string>();
  let inGroup = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inGroup = line === '[Desktop Entry]';
      continue;
    }
    const match = /^([A-Za-z0-9-]+)=(.*)$/.exec(line);
    if (inGroup && match && !entry.has(match[1] as string)) entry.set(match[1] as string, match[2] as string);
  }
  return entry;
}

/** Splits an `Exec` value into arguments (honoring quotes) and drops the `%f`-style field codes. */
export function parseExec(exec: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  for (let i = 0; i < exec.length; i += 1) {
    const ch = exec[i] as string;
    if (quoted && ch === '\\' && i + 1 < exec.length) {
      i += 1;
      current += exec[i] as string;
    } else if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(ch)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) args.push(current);
  return args
    .map((arg) => arg.replace(/%(.)/g, (_all, code: string) => (code === '%' ? '%' : FIELD_CODES.has(code) ? '' : `%${code}`)))
    .filter((arg) => arg !== '');
}

function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommand(command: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (path.isAbsolute(command)) return (await isExecutable(command)) ? command : undefined;
  for (const dir of (env['PATH'] ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

/** Lists the visible desktop applications, flagging those in the freedesktop `Game` category. */
export async function scanLinuxApps(ctx: ScanContext): Promise<InstalledApp[]> {
  const apps = new Map<string, InstalledApp>();
  for (const dir of applicationDirs(ctx)) {
    for (const file of (await listDir(dir)).filter((name) => name.endsWith('.desktop')).sort()) {
      const id = file.slice(0, -'.desktop'.length);
      if (apps.has(id)) continue;
      const text = await readTextIfExists(path.join(dir, file));
      const entry = text === undefined ? undefined : parseDesktopEntry(text);
      if (!entry || entry.get('Type') !== 'Application') continue;
      if (entry.get('NoDisplay') === 'true' || entry.get('Hidden') === 'true') continue;
      const name = entry.get('Name');
      const [command, ...args] = parseExec(entry.get('Exec') ?? '');
      if (!name || command === undefined) continue;
      const exe = await resolveCommand(command, ctx.env);
      if (exe === undefined) continue;

      const categories = (entry.get('Categories') ?? '').split(';').filter(Boolean);
      apps.set(id, {
        id,
        name,
        categories,
        signals: categories.includes('Game') ? ['freedesktop-game'] : [],
        launch: { kind: 'exe', exe, args: args.length > 0 ? args.map(shellQuote).join(' ') : undefined, startDir: entry.get('Path') || undefined },
      });
    }
  }
  return [...apps.values()];
}
