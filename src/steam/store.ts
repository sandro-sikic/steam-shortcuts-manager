import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { VdfMap } from '../vdf/types.js';
import { parseShortcuts, serializeShortcuts } from './shortcuts.js';

export function shortcutsPath(configDir: string): string {
  return path.join(configDir, 'shortcuts.vdf');
}

async function readIfExists(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function loadShortcuts(configDir: string): Promise<VdfMap[]> {
  return parseShortcuts(await readIfExists(shortcutsPath(configDir)));
}

/**
 * Writes `shortcuts.vdf` atomically. An existing file is first copied to a timestamped
 * backup. Returns the backup path, or undefined if there was nothing to back up.
 */
export async function saveShortcuts(configDir: string, entries: VdfMap[], now = new Date()): Promise<string | undefined> {
  const file = shortcutsPath(configDir);
  await mkdir(configDir, { recursive: true });
  let backup: string | undefined;
  if ((await readIfExists(file)) !== undefined) {
    backup = `${file}.${now.toISOString().replace(/[:.]/g, '-')}.bak`;
    await copyFile(file, backup);
  }
  const tmp = `${file}.tmp`;
  await writeFile(tmp, serializeShortcuts(entries));
  await rename(tmp, file);
  return backup;
}
