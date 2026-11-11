/**
 * The version to show for the app. Release builds are versioned `0.0.<commits on main>` by CI
 * (see `scripts/version.mjs`) and show the commit count; anything else, such as a local run, shows "dev".
 */
export function displayVersion(packageVersion: string): string {
  return /^0\.0\.([1-9]\d*)$/.exec(packageVersion)?.[1] ?? 'dev';
}
