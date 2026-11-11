// Build version: the number of commits, written as 0.0.<commits> because installers need a semver.
// The app shows just the number (see src/version.ts). Usage: node scripts/version.mjs [--write]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 18 commits make `0.0.18`. */
export function buildVersion(commits) {
  if (!Number.isInteger(commits) || commits < 1) throw new Error(`Invalid commit count: ${commits}`);
  return `0.0.${commits}`;
}

export function run(argv, { read = readFileSync, write = writeFileSync, count = () => execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }) } = {}) {
  const version = buildVersion(Number(count().trim()));
  if (argv.includes('--write')) write('package.json', `${JSON.stringify({ ...JSON.parse(read('package.json', 'utf8')), version }, null, 2)}\n`);
  return version;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) console.log(run(process.argv.slice(2)));
