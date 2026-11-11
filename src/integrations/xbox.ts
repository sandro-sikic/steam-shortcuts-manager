import path from 'node:path';
import type { Game } from '../types.js';
import type { Integration, ScanContext } from './types.js';
import { readTextIfExists } from './shared/fs.js';

// Unverified (written without access to a Windows machine with the Xbox app):
// - Installed Game Pass / Xbox PC games are MSIX packages; we ask Windows via PowerShell
//   `Get-AppxPackage` for packages whose InstallLocation holds a MicrosoftGame.config (medium confidence).
// - Display name: <ShellVisuals DefaultDisplayName="..."> in MicrosoftGame.config; `ms-resource:` values
//   cannot be resolved here, so we fall back to the package name (medium). Application Id comes from
//   appxmanifest.xml, defaulting to "Game" (medium).
// - Launch: `shell:AppsFolder\<PackageFamilyName>!<AppId>` as a URI through the generated wrapper
//   (`start "" "<uri>"`); low-to-medium confidence that this works from a .cmd. The wrapper waits for the
//   first <Executable Name> of MicrosoftGame.config; if that name differs from the real process
//   (e.g. a launch helper), Steam will see the game as stopped almost immediately. Starting via
//   explorer.exe directly was rejected because explorer exits at once, which has the same effect.
// - Regex-based XML parsing: unusual attribute quoting (single quotes) is not handled.

const LIST_PACKAGES =
  'Get-AppxPackage | Where-Object { $_.InstallLocation -and (Test-Path (Join-Path $_.InstallLocation "MicrosoftGame.config")) } | Select-Object Name,PackageFamilyName,InstallLocation | ConvertTo-Json -Compress';

interface Package {
  name: string;
  familyName: string;
  location: string;
}

function parsePackages(output: string): Package[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.replace(/^﻿/, '').trim());
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const packages: Package[] = [];
  for (const entry of entries) {
    const { Name, PackageFamilyName, InstallLocation } = (entry ?? {}) as Record<string, unknown>;
    if (typeof Name === 'string' && typeof PackageFamilyName === 'string' && typeof InstallLocation === 'string' && Name && PackageFamilyName && InstallLocation) {
      packages.push({ name: Name, familyName: PackageFamilyName, location: InstallLocation });
    }
  }
  return packages;
}

function attribute(xml: string, element: string, name: string): string | undefined {
  const tag = new RegExp(`<${element}\\b[^>]*?\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return tag?.[1]?.trim() || undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** `Contoso.SpaceGame` -> `Space Game`. */
function cleanName(packageName: string): string {
  const last = packageName.slice(packageName.lastIndexOf('.') + 1) || packageName;
  return last.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

async function toGame(label: string, pkg: Package): Promise<Game | undefined> {
  const config = await readTextIfExists(path.join(pkg.location, 'MicrosoftGame.config'));
  if (config === undefined) return undefined;
  const manifest = (await readTextIfExists(path.join(pkg.location, 'appxmanifest.xml'))) ?? '';

  const displayName = attribute(config, 'ShellVisuals', 'DefaultDisplayName');
  const title = displayName && !/^ms-resource:/i.test(displayName) ? decodeXml(displayName) : cleanName(pkg.name);
  const appId = attribute(manifest, 'Application', 'Id') ?? 'Game';
  const executable = attribute(config, 'Executable', 'Name')?.split(/[\\/]/).pop();
  const waitFor = executable && /^[\w .()-]+$/.test(executable) ? executable : undefined;

  return {
    store: label,
    id: pkg.familyName,
    title,
    installed: true,
    launch: { kind: 'uri', uri: `shell:AppsFolder\\${pkg.familyName}!${appId}`, ...(waitFor ? { waitFor } : {}) },
  };
}

export const xboxIntegration: Integration = {
  id: 'xbox',
  label: 'Xbox',
  platforms: ['win32'],

  async scan(ctx: ScanContext): Promise<Game[]> {
    const output = await ctx.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', LIST_PACKAGES]);
    const games = new Map<string, Game>();
    for (const pkg of parsePackages(output)) {
      if (games.has(pkg.familyName)) continue;
      const game = await toGame(this.label, pkg);
      if (game) games.set(game.id, game);
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
