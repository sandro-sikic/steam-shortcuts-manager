# steam-manager

CLI that adds games from other launchers (Epic, GOG, Ubisoft, ...) to Steam as non-Steam shortcuts,
tagged with their store (shown as a collection in Big Picture) and with SteamGridDB artwork
(poster, wide capsule, hero, logo, icon), so every game can be launched from Steam.

Status: the core pipeline, 12 launcher integrations and an installed-apps scan are implemented. The integrations read local
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
steam-manager apps                    # which installed apps look like games, and why
steam-manager sync --include-maybe    # also add weak guesses (Unity/Unreal installs)
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
(game names and process names), the Windows Game Bar and Unity/Unreal detection, Xbox (`shell:AppsFolder` launch), Heroic (`heroic://launch/...` URI),
and the Windows `.cmd` wrapper itself. Run `steam-manager sync --dry-run` on each platform first.

## Installed apps (OS scan)

The `os` integration ("Installed Apps" tag) scans the operating system's installed applications for games
that no launcher integration covers. It is **strict**: only apps the OS or you marked as games are added.

- **Linux:** `.desktop` files with the freedesktop `Game` category, minus emulators, utilities, launchers and Steam's own entries.
- **Windows:** games Game Bar recognizes (`MatchedExeFullPath`). Unity/Unreal installs are only "maybe" and need `--include-maybe`.
- `steam-manager apps [--all]` shows the verdict and reason per app. Override it in
  `<config>/steam-manager/config.json` (`~/.config/...` on Linux, `%APPDATA%` on Windows):
  `{ "allow": ["Some Game"], "deny": ["Some Tool"] }` (matched by title or id).

## Duplicates

A game is never added twice. Skipped duplicates are listed with what they duplicate (first match wins; the
OS scan always loses against a specific launcher):
1. within one run, the same launch target (exe plus arguments, or URI) or the same normalized title;
2. a shortcut you added yourself (same exe or title);
3. a game installed through Steam itself (matched by title from its `appmanifest` files);
4. one of our own shortcuts for that title with a different launch target is replaced, not duplicated.

Titles are compared ignoring case, punctuation, accents and symbols like ™. `add` bypasses checks 1 to 3, since
you asked for that game explicitly.

## Layout

- `src/vdf` binary (`shortcuts.vdf`) and text (`loginusers.vdf`) VDF parsers
- `src/steam` Steam location, running check, shortcut model, store, sync planner
- `src/artwork` SteamGridDB client and grid-folder installer
- `src/integrations` one file per launcher, plus the registry (`index.ts`) and shared helpers
- `src/launcher` wrapper scripts for URI launches
- `src/app.ts`, `src/cli.ts` commands; `src/types.ts` the `Game`/`LaunchSpec` types

## Development

`npm test`, `npm run coverage` (100% threshold), `npm run typecheck`.
