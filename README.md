# steam-manager

CLI that adds games from other launchers (Epic, GOG, Ubisoft, ...) to Steam as non-Steam shortcuts,
tagged with their store (shown as a collection in Big Picture) and with SteamGridDB artwork
(poster, wide capsule, hero, logo, icon), so every game can be launched from Steam.

Status: the core pipeline, 12 launcher integrations, an installed-apps scan and a first Electron + React UI are implemented. The integrations read local
files only (no logins, no network) and were written from knowledge of each launcher's on-disk format.
**None has been verified on a real machine yet** (see below).

## Desktop app (Electron + React)

```
npm run dev      # Vite dev server + Electron with hot reload
npm run start    # production build, then launch Electron
```

- `src/UI` is the React UI (Vite). It has no Node access: it talks to the core only through `window.steamManager`.
- `electron/main.ts` creates the window (context isolation and sandbox on, no node integration, navigation locked)
  and `electron/preload.cts` exposes the bridge. The CommonJS preload repeats the channel names from `src/ipc.ts`;
  a test keeps them in sync.
- `src/ipc.ts` is the typed contract (status, shortcuts, integrations, apps, games, setExcluded, sync, settings, updateSettings, resetSettings, lists, setLists, apiKeyStatus, setApiKey, testApiKey, steamAccounts, about, openConfigFolder) and `src/api.ts` implements it on
  top of the same code the CLI uses, returning data instead of printing. To add a feature: add the method to
  `SteamManagerApi` and `CHANNELS`, implement it in `api.ts`, repeat the channel in the preload, and call it from the UI.
- The UI defaults to a dry run. Syncing writes only while Steam is closed.
- Not done yet: packaging (electron-builder), a settings screen for the SteamGridDB key (set `STEAMGRIDDB_API_KEY` for now),
  and the `apps`/`add` screens (the `apps` call exists in the API).

## Usage

```
npm install && npm run build   # CLI at dist/src/bin.js
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

## Choosing what goes to Steam

The library in the desktop app lists every installed game found on this computer, grouped by launcher
(Epic Games, GOG Galaxy, Heroic (Epic Games), Installed Apps, ...). Each game, each group and a global
"Select all" has a checkbox: checked means "add to Steam". Each card shows what Apply will do
(In Steam, Will add, Will remove). **Apply makes Steam match the checkboxes**: checked games are added, and
unchecked games that we added earlier are removed (only ours, never your own shortcuts).

Unchecking saves the game's key (`store:id`) to the `exclude` list in `config.json`, so the CLI `sync` respects it too:

```json
{ "allow": ["Some Game"], "deny": ["Some Tool"], "exclude": ["Epic Games:fn"] }
```

## Settings

The gear in the header opens the settings page. Changes save as you make them.

| Section | What it controls |
|---|---|
| Artwork | the SteamGridDB API key (with a Test button), which images to download, and whether sync downloads artwork |
| Steam | the Steam folder (empty = auto-detect), the account, and whether changes may be written while Steam is running |
| Sync | the sync panel's starting choices (Preview or Apply, remove games that are gone, weak guesses) and **auto-apply**, which applies to Steam as soon as you tick or untick a game |
| Launchers | turn individual launchers on or off |
| Library | games that are switched off, and the allow and deny lists for the installed-apps scan |
| Appearance | theme (system, light, dark) and card size |
| About | version, config file, Steam folder, open the config folder, reset settings |

Settings live under `settings` in `config.json` (next to `allow`, `deny` and `exclude`), and the command line uses the
Steam, artwork-kind and launcher settings too. The sync defaults, theme and card size only affect the desktop app.

**The API key is stored encrypted** with the operating system's keychain (Electron `safeStorage`) in `secrets.json`,
never as plain text, and is never sent back to the page (it only learns "set" or "not set"). If the system has no keychain
the app says so and does not store the key; the `STEAMGRIDDB_API_KEY` environment variable still works, and the command line
can only use that variable or `--api-key`. A key saved in the app wins over the environment variable.

## Installed apps (OS scan)

The `os` integration ("Installed Apps" tag) scans the operating system's installed applications for games
that no launcher integration covers. It is **strict**: only apps the OS or you marked as games are added.

- **Linux:** `.desktop` files with the freedesktop `Game` category, minus emulators, utilities, launchers and Steam's own entries.
- **Windows:** games Game Bar recognizes (`MatchedExeFullPath`). Unity/Unreal installs are only "maybe" and need `--include-maybe`.
- `steam-manager apps [--all]` shows the verdict and reason per app. Override it in
  `<config>/steam-manager/config.json` (`~/.config/...` on Linux, `%APPDATA%` on Windows):
  `{ "allow": ["Some Game"], "deny": ["Some Tool"] }` (matched by title or id; `exclude` is described above).

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
- `src/UI` React UI, `electron/` main process and preload, `src/api.ts` + `src/ipc.ts` the bridge between them
- `src/app.ts`, `src/cli.ts` commands; `src/types.ts` the `Game`/`LaunchSpec` types

## Development

`npm test`, `npm run coverage` (100% threshold, UI included; `electron/main.ts`, the preload and `src/UI/main.tsx` are thin
bootstrap code verified by launching the app), `npm run typecheck`.
