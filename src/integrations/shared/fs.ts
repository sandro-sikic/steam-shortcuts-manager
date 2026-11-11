import { readdir, readFile, stat } from 'node:fs/promises';

/** Reads a text file; undefined when it does not exist (or is not a regular file). */
export async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return undefined;
    throw error;
  }
}

/** Reads and parses a JSON file; undefined when it is missing or not valid JSON. */
export async function readJsonIfExists(file: string): Promise<unknown> {
  const text = await readTextIfExists(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
}

/** Names of a directory's entries; [] when it does not exist. */
export async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw error;
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Reads a file's bytes; undefined when it does not exist (or is not a regular file). */
export async function readBytesIfExists(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return undefined;
    throw error;
  }
}
