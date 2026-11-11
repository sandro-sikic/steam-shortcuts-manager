import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const workflow = await readFile('.github/workflows/release.yml', 'utf8');

describe('packaging', () => {
  it('has scripts that build the sources and the UI before packaging, and never publish by themselves', () => {
    for (const name of ['pack', 'dist', 'dist:win', 'dist:linux']) {
      expect(pkg.scripts[name]).toMatch(/^npm run build && npm run ui:build && electron-builder /);
    }
    for (const name of ['dist', 'dist:win', 'dist:linux']) expect(pkg.scripts[name]).toContain('--publish never');
    expect(pkg.scripts['dist:win']).toContain('--win');
    expect(pkg.scripts['dist:linux']).toContain('--linux');
    expect(pkg.scripts['dist']).toMatch(/--win --linux/);
  });

  it('packages only the compiled app and its UI, into the release folder', () => {
    expect(pkg.build.directories.output).toBe('release');
    expect(pkg.build.files).toEqual(['dist/electron/**', 'dist/src/**', 'dist-ui/**', 'package.json']);
    expect(pkg.main).toBe('dist/electron/main.js');
  });

  it('has a homepage, which the deb package requires', () => {
    expect(pkg.homepage).toMatch(/^https?:\/\//);
  });

  it('targets an installer and a portable build for Windows, and an AppImage and a deb for Linux', () => {
    expect(pkg.build.win.target.map((t: { target: string }) => t.target)).toEqual(['nsis', 'portable']);
    expect(pkg.build.linux.target).toEqual(['AppImage', 'deb']);
    expect(pkg.build.linux.maintainer).toContain('@');
    expect(pkg.build.nsis.artifactName).not.toBe(pkg.build.portable.artifactName); // both are .exe files
  });

  it('builds on both systems and publishes a release when main is pushed, after the tests pass', () => {
    expect(workflow).toMatch(/on:\s+push:\s+branches: \[main\]/);
    expect(workflow).toContain('npm run coverage');
    expect(workflow).toContain('script: dist:linux');
    expect(workflow).toContain('script: dist:win');
    expect(workflow).toMatch(/needs: test/);
    expect(workflow).toMatch(/needs: package/);
    expect(workflow).toMatch(/permissions:\s+contents: write/);
    expect(workflow).toContain('gh release create');
    expect(workflow).toContain('node scripts/version.mjs --write'); // before packaging
    expect(workflow).toContain('fetch-depth: 0'); // all commits, to count them
  });
});
