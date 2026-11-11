import type { Runner } from '../../steam/running.js';

export interface RegistryKey {
  /** Full key path as printed by `reg query`, e.g. `HKEY_LOCAL_MACHINE\SOFTWARE\...`. */
  path: string;
  values: Map<string, string>;
}

export interface QueryOptions {
  /** Which registry view to read; Windows launchers often register under the 32-bit view. */
  view?: 32 | 64;
}

const VALUE_LINE = /^ {4}(.+?) {4}REG_\w+(?: {4}(.*))?$/;

/**
 * Reads a registry key and all of its sub-keys via `reg query /s`. Windows only; returns []
 * when the key does not exist. Value types are dropped; every value is returned as text.
 */
export async function queryRegistry(run: Runner, key: string, options: QueryOptions = {}): Promise<RegistryKey[]> {
  const args = ['query', key, '/s'];
  if (options.view !== undefined) args.push(`/reg:${options.view}`);
  const output = await run('reg', args);

  const keys: RegistryKey[] = [];
  let current: RegistryKey | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      current = { path: line.trim(), values: new Map() };
      keys.push(current);
      continue;
    }
    const match = VALUE_LINE.exec(line);
    if (match && current) current.values.set(match[1] as string, match[2] ?? '');
  }
  return keys;
}
