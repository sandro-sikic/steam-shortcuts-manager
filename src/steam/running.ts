import { execFile } from 'node:child_process';

/** Runs a command and resolves with its stdout; a failing or missing command yields ''. */
export type Runner = (command: string, args: string[]) => Promise<string>;

export const defaultRunner: Runner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, (_error, stdout) => resolve(stdout));
  });

/** Steam rewrites its config on exit, so we must not edit files while it is running. */
export async function isSteamRunning(platform: NodeJS.Platform, run: Runner): Promise<boolean> {
  if (platform === 'win32') {
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH']);
    return out.toLowerCase().includes('steam.exe');
  }
  const out = await run('pgrep', ['-x', platform === 'darwin' ? 'steam_osx' : 'steam']);
  return out.trim().length > 0;
}
