import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { listDir } from '../integrations/shared/fs.js';
import { parseArtworkFile } from './files.js';
import { isTagged } from './tag.js';

/**
 * Deletes the artwork we put in Steam's grid folder for one shortcut: files named for its ID that carry
 * our tag. Anything else with that name (an image the user added) is left alone and counted as kept.
 */
export async function removeTaggedArtwork(gridDir: string, appId: number): Promise<{ removed: number; kept: number }> {
  let removed = 0;
  let kept = 0;
  for (const name of await listDir(gridDir)) {
    if (parseArtworkFile(name)?.appId !== appId) continue;
    const file = path.join(gridDir, name);
    if (isTagged(await readFile(file))) {
      await unlink(file);
      removed += 1;
    } else {
      kept += 1;
    }
  }
  return { removed, kept };
}
