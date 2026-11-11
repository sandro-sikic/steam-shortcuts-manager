import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listDir, pathExists, readBytesIfExists, readJsonIfExists, readTextIfExists } from '../../src/integrations/shared/fs.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

describe('integration fs helpers', () => {
  it('reads text, and returns undefined for missing files, directories and non-directories', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'a.txt'), 'hi');
    expect(await readTextIfExists(path.join(dir, 'a.txt'))).toBe('hi');
    expect(await readTextIfExists(path.join(dir, 'missing'))).toBeUndefined();
    expect(await readTextIfExists(dir)).toBeUndefined();
    expect(await readTextIfExists(path.join(dir, 'a.txt', 'child'))).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('propagates unexpected read errors', async () => {
    if (process.getuid?.() === 0) return; // root ignores file modes
    const dir = await makeTempDir();
    const file = path.join(dir, 'secret');
    await writeFile(file, 'x');
    await chmod(file, 0o000);
    await expect(readTextIfExists(file)).rejects.toThrow();
  });

  it('parses JSON (tolerating a BOM) and returns undefined for missing or invalid files', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'ok.json'), '﻿{"a":1}');
    await writeFile(path.join(dir, 'bad.json'), '{nope');
    expect(await readJsonIfExists(path.join(dir, 'ok.json'))).toEqual({ a: 1 });
    expect(await readJsonIfExists(path.join(dir, 'bad.json'))).toBeUndefined();
    expect(await readJsonIfExists(path.join(dir, 'missing.json'))).toBeUndefined();
  });

  it('lists directories, treating missing ones and files as empty', async () => {
    const dir = await makeTempDir();
    await mkdir(path.join(dir, 'sub'));
    await writeFile(path.join(dir, 'f'), '');
    expect((await listDir(dir)).sort()).toEqual(['f', 'sub']);
    expect(await listDir(path.join(dir, 'missing'))).toEqual([]);
    expect(await listDir(path.join(dir, 'f'))).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('propagates unexpected directory errors', async () => {
    if (process.getuid?.() === 0) return;
    const dir = await makeTempDir();
    const locked = path.join(dir, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o000);
    await expect(listDir(locked)).rejects.toThrow();
    await chmod(locked, 0o700);
  });

  it('checks existence', async () => {
    const dir = await makeTempDir();
    expect(await pathExists(dir)).toBe(true);
    expect(await pathExists(path.join(dir, 'nope'))).toBe(false);
  });
});

describe('readBytesIfExists', () => {
  it('reads a file as bytes, and is undefined when it is missing or not a file', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'a.bin'), Buffer.from([1, 2, 3]));
    expect(await readBytesIfExists(path.join(dir, 'a.bin'))).toEqual(Buffer.from([1, 2, 3]));
    expect(await readBytesIfExists(path.join(dir, 'missing'))).toBeUndefined();
    expect(await readBytesIfExists(dir)).toBeUndefined();
    expect(await readBytesIfExists(path.join(dir, 'a.bin', 'child'))).toBeUndefined();
  });

  it('passes on errors that are not about a missing file', async () => {
    await expect(readBytesIfExists('bad\0name')).rejects.toThrow();
  });
});
