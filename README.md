# steam-manager

CLI that adds games from other launchers (Epic, GOG, Ubisoft, ...) to Steam as non-Steam shortcuts,
tagged with their store (shown as a collection in Big Picture) and with SteamGridDB artwork
(poster, wide capsule, hero, logo, icon), so every game can be launched from Steam.

Status: the core pipeline is done (shortcut writing, tags, artwork, CLI). Store providers
(login + library) are not implemented yet; use `add` to add games by hand.

## Usage

```
npm install && npm run build
export STEAMGRIDDB_API_KEY=...        # https://www.steamgriddb.com/profile/preferences/api

steam-manager add --title "Fortnite" --exe /path/to/exe --store "Epic Games"
steam-manager list
steam-manager sync --dry-run          # needs providers
```

Global options: `--steam-dir`, `--user`, `--api-key`, `--allow-steam-running`.
Close Steam before writing: it rewrites its config on exit. Every write backs up `shortcuts.vdf` first.
Only shortcuts tagged `steam-manager` are ever modified or removed.

## Layout

- `src/vdf` binary (`shortcuts.vdf`) and text (`loginusers.vdf`) VDF parsers
- `src/steam` Steam location, running check, shortcut model, store, sync planner
- `src/artwork` SteamGridDB client and grid-folder installer
- `src/app.ts`, `src/cli.ts` commands; `src/types.ts` the `Provider`/`Game` interfaces

## Development

`npm test`, `npm run coverage` (100% threshold), `npm run typecheck`.
