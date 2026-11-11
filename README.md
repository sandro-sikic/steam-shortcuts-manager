# steam-manager

CLI that adds games from other launchers (Epic, GOG, Ubisoft, ...) to Steam as non-Steam shortcuts,
tagged with their store (shown as a collection in Big Picture) and with SteamGridDB artwork
(poster, wide capsule, hero, logo, icon), so every game can be launched from Steam.

Status: the core pipeline and 12 launcher integrations are implemented. The integrations read local
files only (no logins, no network) and were written from knowledge of each launcher's on-disk format.
**None has been verified on a real machine yet** (see below).

## Usage

```
npm install && npm run build
export STEAMGRIDDB_API_KEY=...        # https://www.steamgriddb.com/profile/preferences/api

steam-manager add --title "Fortnite" --exe /path/to/exe --store "Epic Games"
steam-manager list
steam-manager integrations            # launchers available on this OS
steam-manager sync --dry-run          # preview what would be added
steam-manager sync --only epic,gog    # limit to some launchers
```

Global options: `--steam-dir`, `--user`, `--api-key`, `--allow-steam-running`.
Close Steam before writing: it rewrites its config on exit. Every write backs up `shortcuts.vdf` first.
Only shortcuts tagged `steam-manager` are ever modified or removed.

## Launchers

| id | Launcher | Platforms | Started by |
|---|---|---|---|
| `epic` | Epic Games Launcher | Windows, macOS | launcher URI |
| `gog` | GOG Galaxy | Windows | game exe |
| `ubisoft` | Ubisoft Connect | Windows | launcher URI |
| `ea` | EA app | Windows | game exe |
| `battlenet` | Battle.net | Windows | launcher URI, else exe |
| `riot` | Riot Client | Windows | Riot client with args |
| `rockstar` | Rockstar Games Launcher | Windows | game exe |
| `xbox` | Xbox app / Game Pass | Windows | `shell:AppsFolder` URI |
| `amazon` | Amazon Games | Windows | game exe |
| `itch` | itch.io app | Windows, Linux, macOS | game exe |
| `minecraft` | Minecraft Launcher | Windows, Linux | launcher exe |
| `heroic` | Heroic (Epic, GOG, Amazon) | Linux, Windows, macOS | `heroic://` URI |

Launchers that must start the game themselves are started through a generated wrapper script
(`.cmd` / `.sh` in the `steam-manager/launchers` config folder) that opens the launcher URI and waits
for the game process, so Steam keeps showing the game as running.

### Not verified on real machines
The tests use fixture files and fake registry output. Each integration file starts with an
`// Unverified:` note listing its assumptions. Least certain: EA app (registry layout), Battle.net
(game names and process names), Xbox (`shell:AppsFolder` launch), Heroic (`heroic://launch/...` URI),
and the Windows `.cmd` wrapper itself. Run `steam-manager sync --dry-run` on each platform first.

## Layout

- `src/vdf` binary (`shortcuts.vdf`) and text (`loginusers.vdf`) VDF parsers
- `src/steam` Steam location, running check, shortcut model, store, sync planner
- `src/artwork` SteamGridDB client and grid-folder installer
- `src/integrations` one file per launcher, plus the registry (`index.ts`) and shared helpers
- `src/launcher` wrapper scripts for URI launches
- `src/app.ts`, `src/cli.ts` commands; `src/types.ts` the `Game`/`LaunchSpec` types

## Development

`npm test`, `npm run coverage` (100% threshold), `npm run typecheck`.
