// Unverified: install locations and the receipt layout (`<game>/.itch/receipt.json.gz` with `game.id`,
// `game.title` and an optional `files` list of relative paths) are from memory of the itch app / butler.
// Receipt fields are optional; missing ones fall back to the folder name and a scan for an executable.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Game } from '../types.js';
import type { Integration, ScanContext } from './types.js';
import { listDir } from './shared/fs.js';

const HELPER = /^(crashpad_handler|UnityCrashHandler|unins|uninstall|vc_?redist|dxsetup|dotnet)/i;

function appsDir(ctx: ScanContext): string {
  if (ctx.platform === 'win32') return path.join(ctx.env['APPDATA'] ?? path.join(ctx.home, 'AppData', 'Roaming'), 'itch', 'apps');
  if (ctx.platform === 'darwin') return path.join(ctx.home, 'Library', 'Application Support', 'itch', 'apps');
  return path.join(ctx.env['XDG_CONFIG_HOME'] ?? path.join(ctx.home, '.config'), 'itch', 'apps');
}

type Receipt = { game?: { id?: unknown; title?: unknown }; files?: unknown };

async function readReceipt(dir: string): Promise<Receipt> {
  try {
    const parsed: unknown = JSON.parse(gunzipSync(await readFile(path.join(dir, '.itch', 'receipt.json.gz'))).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Receipt) : {};
  } catch {
    return {};
  }
}

/** Absolute path of the launchable file for `file` on this platform, or undefined. */
async function launchable(platform: NodeJS.Platform, file: string): Promise<string | undefined> {
  const name = path.basename(file);
  if (HELPER.test(name)) return undefined;
  const info = await stat(file).catch(() => undefined);
  if (!info) return undefined;
  if (platform === 'darwin') {
    if (!info.isDirectory() || !name.endsWith('.app')) return undefined;
    const macos = path.join(file, 'Contents', 'MacOS');
    const bins = (await listDir(macos)).sort();
    const bin = bins.find((b) => b === name.slice(0, -4)) ?? bins[0];
    return bin === undefined ? undefined : path.join(macos, bin);
  }
  if (!info.isFile()) return undefined;
  if (platform === 'win32') return name.toLowerCase().endsWith('.exe') ? file : undefined;
  return !/\.so(\.|$)/.test(name) && (info.mode & 0o111) !== 0 ? file : undefined;
}

async function findIn(platform: NodeJS.Platform, dir: string, names: string[]): Promise<string[]> {
  const found = await Promise.all(names.map((n) => launchable(platform, path.join(dir, n))));
  return found.filter((f): f is string => f !== undefined);
}

async function findExecutable(platform: NodeJS.Platform, dir: string, receipt: Receipt, title: string): Promise<string | undefined> {
  const listed = Array.isArray(receipt.files) ? receipt.files.filter((f): f is string => typeof f === 'string') : [];
  let candidates = platform === 'darwin' ? [] : await findIn(platform, dir, listed.map((f) => path.join(...f.split(/[\\/]/))));
  const top = (await listDir(dir)).filter((n) => !n.startsWith('.')).sort();
  if (candidates.length === 0) candidates = await findIn(platform, dir, top);
  for (const sub of top) {
    if (candidates.length > 0) break;
    candidates = await findIn(platform, path.join(dir, sub), (await listDir(path.join(dir, sub))).sort());
  }
  const wanted = [title, path.basename(dir)].map((n) => n.toLowerCase());
  const stem = (file: string): string => {
    const parts = file.split(path.sep);
    const base = platform === 'darwin' ? parts[parts.length - 4]! : parts[parts.length - 1]!;
    return base.replace(/\.(exe|app)$/i, '').toLowerCase();
  };
  return candidates.find((c) => wanted.includes(stem(c))) ?? candidates[0];
}

export const itchIntegration: Integration = {
  id: 'itch',
  label: 'itch.io',
  platforms: ['win32', 'linux', 'darwin'],
  async scan(ctx) {
    const root = appsDir(ctx);
    const games = new Map<string, Game>();
    for (const folder of (await listDir(root)).sort()) {
      const dir = path.join(root, folder);
      if (!(await stat(dir)).isDirectory()) continue;
      const receipt = await readReceipt(dir);
      const rawId = receipt.game?.id;
      const id = typeof rawId === 'number' || (typeof rawId === 'string' && rawId !== '') ? String(rawId) : folder;
      if (games.has(id)) continue;
      const rawTitle = receipt.game?.title;
      const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : folder;
      const exe = await findExecutable(ctx.platform, dir, receipt, title);
      if (exe === undefined) continue;
      games.set(id, { store: itchIntegration.label, id, title, installed: true, launch: { kind: 'exe', exe, startDir: path.dirname(exe) } });
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
