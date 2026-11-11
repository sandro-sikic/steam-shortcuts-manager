import type { GameInfo } from '../ipc.js';

/** What will happen to a game on the next Apply, given its checkbox and whether it is in Steam. */
export function stateOf(game: GameInfo): { label: string; tone: 'in' | 'add' | 'remove' } | undefined {
  if (game.excluded) return game.inSteam ? { label: 'Will remove', tone: 'remove' } : undefined;
  return game.inSteam ? { label: 'In Steam', tone: 'in' } : { label: 'Will add', tone: 'add' };
}
