import { Command } from 'commander';
import {
  runAdd,
  runIntegrations,
  runList,
  runSync,
  type AddCommandOptions,
  type AppContext,
  type GlobalOptions,
  type SyncCommandOptions,
} from './app.js';

export function createProgram(ctx: AppContext): Command {
  const program = new Command('steam-manager')
    .description('Add games from other launchers to Steam as non-Steam shortcuts, with tags and artwork')
    .option('--steam-dir <dir>', 'Steam installation directory (auto-detected by default)')
    .option('--user <id>', 'Steam account ID (defaults to the most recent user)')
    .option('--api-key <key>', 'SteamGridDB API key (or set STEAMGRIDDB_API_KEY)')
    .option('--allow-steam-running', 'do not refuse to write while Steam is running')
    .exitOverride();

  program
    .command('list')
    .description('list the non-Steam shortcuts')
    .action(async (_options, command: Command) => {
      await runList(ctx, command.optsWithGlobals<GlobalOptions>());
    });

  program
    .command('integrations')
    .description('list the launcher integrations available on this platform')
    .action(async () => {
      await runIntegrations(ctx);
    });

  program
    .command('sync')
    .description('sync installed games from the launcher integrations into Steam')
    .option('--only <ids>', 'comma-separated integration ids to sync (see "integrations")', (value) => value.split(','))
    .option('--prune', 'remove managed shortcuts for games that are no longer installed')
    .option('--dry-run', 'show what would change without writing anything')
    .option('--no-artwork', 'do not download artwork')
    .option('--force-artwork', 're-download artwork that already exists')
    .action(async (_options, command: Command) => {
      await runSync(ctx, command.optsWithGlobals<GlobalOptions & SyncCommandOptions>());
    });

  program
    .command('add')
    .description('add a single game by hand')
    .requiredOption('--title <title>', 'game title')
    .requiredOption('--exe <path>', 'path of the executable')
    .option('--store <name>', 'tag/collection to put the game in', 'Other')
    .option('--start-dir <dir>', 'working directory')
    .option('--launch-options <options>', 'launch options')
    .option('--dry-run', 'show what would change without writing anything')
    .option('--no-artwork', 'do not download artwork')
    .option('--force-artwork', 're-download artwork that already exists')
    .action(async (_options, command: Command) => {
      await runAdd(ctx, command.optsWithGlobals<GlobalOptions & AddCommandOptions>());
    });

  return program;
}
