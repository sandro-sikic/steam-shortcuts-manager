import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSecretStore, SECURE_STORAGE_UNAVAILABLE, type Encryptor } from '../src/secrets.js';
import { cleanupTempDirs, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

/** A reversible fake: "encrypts" by reversing the text. */
const fakeEncryptor = (available = true): Encryptor => ({
  isAvailable: async () => available,
  encrypt: async (plain) => Buffer.from([...plain].reverse().join('')),
  decrypt: async (data) => [...data.toString()].reverse().join(''),
});

describe('secret store', () => {
  it('saves and returns a secret, without keeping the plain text on disk', async () => {
    const dir = await makeTempDir();
    const store = createSecretStore(dir, fakeEncryptor());
    await store.set('steamgriddb', 'my-secret-key');
    expect(await store.get('steamgriddb')).toBe('my-secret-key');
    const file = await readFile(path.join(dir, 'secrets.json'), 'utf8');
    expect(file).not.toContain('my-secret-key');
    expect(JSON.parse(file).steamgriddb).toBe(Buffer.from('yek-terces-ym').toString('base64'));
  });

  it.skipIf(process.platform === 'win32')('keeps the file private to the user', async () => {
    const dir = await makeTempDir();
    await createSecretStore(dir, fakeEncryptor()).set('a', 'b');
    expect((await stat(path.join(dir, 'secrets.json'))).mode & 0o077).toBe(0);
  });

  it('keeps other secrets when one changes or is removed', async () => {
    const store = createSecretStore(await makeTempDir(), fakeEncryptor());
    await store.set('a', '1');
    await store.set('b', '2');
    await store.set('a', '3');
    expect(await store.get('a')).toBe('3');
    await store.remove('a');
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toBe('2');
  });

  it('removing something that is not there does nothing, not even create a file', async () => {
    const dir = await makeTempDir();
    await createSecretStore(dir, fakeEncryptor()).remove('missing');
    await expect(stat(path.join(dir, 'secrets.json'))).rejects.toThrow();
  });

  it('returns nothing for an unknown secret', async () => {
    expect(await createSecretStore(await makeTempDir(), fakeEncryptor()).get('nope')).toBeUndefined();
  });

  it('refuses to store, and returns nothing, when encryption is not available', async () => {
    const dir = await makeTempDir();
    const unavailable = createSecretStore(dir, fakeEncryptor(false));
    expect(await unavailable.available()).toBe(false);
    await expect(unavailable.set('a', 'b')).rejects.toThrow(SECURE_STORAGE_UNAVAILABLE);
    await createSecretStore(dir, fakeEncryptor()).set('a', 'b');
    expect(await unavailable.get('a')).toBeUndefined();
    expect(await createSecretStore(dir, fakeEncryptor()).available()).toBe(true);
  });

  it('returns nothing when a stored secret can no longer be decrypted', async () => {
    const dir = await makeTempDir();
    await createSecretStore(dir, fakeEncryptor()).set('a', 'b');
    const broken: Encryptor = { ...fakeEncryptor(), decrypt: async () => { throw new Error('wrong keychain'); } };
    expect(await createSecretStore(dir, broken).get('a')).toBeUndefined();
  });

  it('ignores junk in the file', async () => {
    const dir = await makeTempDir();
    const store = createSecretStore(dir, fakeEncryptor());
    await writeFile(path.join(dir, 'secrets.json'), '[1,2]');
    expect(await store.get('a')).toBeUndefined();
    await writeFile(path.join(dir, 'secrets.json'), '{"a":5,"b":"c"}');
    expect(await store.get('a')).toBeUndefined();
    await store.set('x', 'y');
    expect(JSON.parse(await readFile(path.join(dir, 'secrets.json'), 'utf8'))).toEqual({ b: 'c', x: Buffer.from('y').toString('base64') });
    await writeFile(path.join(dir, 'secrets.json'), 'null');
    expect(await store.get('a')).toBeUndefined();
  });
});
