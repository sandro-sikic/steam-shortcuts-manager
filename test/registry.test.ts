import { describe, expect, it } from 'vitest';
import { queryRegistry } from '../src/integrations/shared/registry.js';

const OUTPUT = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\720
    InstallDir    REG_SZ    C:\\Games\\Anno 1800\\
    Flags    REG_DWORD    0x1
    (Default)    REG_SZ    

HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\720\\Sub
    Empty    REG_SZ
    Some Name With Spaces    REG_SZ    value  with  spaces

End of search: 3 match(es) found.
`.replace(/\n/g, '\r\n');

describe('queryRegistry', () => {
  it('parses keys and values from reg query output', async () => {
    const calls: string[][] = [];
    const keys = await queryRegistry(async (command, args) => {
      calls.push([command, ...args]);
      return OUTPUT;
    }, 'HKLM\\SOFTWARE\\Ubisoft', { view: 32 });

    expect(calls).toEqual([['reg', 'query', 'HKLM\\SOFTWARE\\Ubisoft', '/s', '/reg:32']]);
    expect(keys).toHaveLength(2);
    expect(keys[0]?.path).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\720');
    expect([...(keys[0]?.values ?? [])]).toEqual([['InstallDir', 'C:\\Games\\Anno 1800\\'], ['Flags', '0x1'], ['(Default)', '']]);
    expect([...(keys[1]?.values ?? [])]).toEqual([['Empty', ''], ['Some Name With Spaces', 'value  with  spaces']]);
  });

  it('omits the view flag by default and returns nothing for a missing key', async () => {
    const calls: string[][] = [];
    const keys = await queryRegistry(async (command, args) => {
      calls.push([command, ...args]);
      return '';
    }, 'HKCU\\Missing');
    expect(keys).toEqual([]);
    expect(calls[0]).toEqual(['reg', 'query', 'HKCU\\Missing', '/s']);
  });

  it('ignores value lines that appear before any key', async () => {
    expect(await queryRegistry(async () => '    Orphan    REG_SZ    x\n', 'HKCU\\X')).toEqual([]);
  });
});
