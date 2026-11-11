// Build version: the major.minor in package.json plus the number of commits as the patch,
// so every commit on main gets a higher version. Usage: node scripts/version.mjs [--write]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** `0.1.0` and 18 commits make `0.1.18`. */
export function buildVersion(current, commits) {
  const match = /^(\d+)\.(\d+)\./.exec(current);
  if (!match) throw new Error(`Cannot read a major.minor version from "${current}"`);
  if (!Number.isInteger(commits) || commits < 1) throw new Error(`Invalid commit count: ${commits}`);
  return `${match[1]}.${match[2]}.${commits}`;
}

export function run(argv, { read = readFileSync, write = writeFileSync, count = () => execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }) } = {}) {
  const pkg = JSON.parse(read('package.json', 'utf8'));
  const version = buildVersion(pkg.version, Number(count().trim()));
  if (argv.includes('--write')) write('package.json', `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
  return version;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) console.log(run(process.argv.slice(2)));
