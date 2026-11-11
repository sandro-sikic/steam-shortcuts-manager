import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJsonIfExists } from './integrations/shared/fs.js';

/** Encryption by the operating system (Electron's safeStorage in the desktop app). */
export interface Encryptor {
  isAvailable(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<string>;
}

/** Keeps small secrets (the SteamGridDB key) encrypted on disk. */
export interface SecretStore {
  available(): Promise<boolean>;
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export const SECURE_STORAGE_UNAVAILABLE =
  'Secure storage is not available on this system. Set the STEAMGRIDDB_API_KEY environment variable instead.';

async function readStored(file: string): Promise<Record<string, string>> {
  const data = await readJsonIfExists(file);
  const stored: Record<string, string> = {};
  if (typeof data === 'object' && data !== null) {
    for (const [name, value] of Object.entries(data)) if (typeof value === 'string') stored[name] = value;
  }
  return stored;
}

/** Stores each secret base64-encoded after encryption, in `<dir>/secrets.json`. */
export function createSecretStore(dir: string, encryptor: Encryptor): SecretStore {
  const file = path.join(dir, 'secrets.json');

  async function save(stored: Record<string, string>): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  }

  return {
    available: () => encryptor.isAvailable(),

    async get(name) {
      const encrypted = (await readStored(file))[name];
      if (encrypted === undefined || !(await encryptor.isAvailable())) return undefined;
      try {
        return await encryptor.decrypt(Buffer.from(encrypted, 'base64'));
      } catch {
        return undefined; // e.g. encrypted under another user or keychain
      }
    },

    async set(name, value) {
      if (!(await encryptor.isAvailable())) throw new Error(SECURE_STORAGE_UNAVAILABLE);
      const stored = await readStored(file);
      stored[name] = (await encryptor.encrypt(value)).toString('base64');
      await save(stored);
    },

    async remove(name) {
      const stored = await readStored(file);
      if (!(name in stored)) return;
      delete stored[name];
      await save(stored);
    },
  };
}
