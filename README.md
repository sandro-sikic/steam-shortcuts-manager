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
- `src/ipc.ts` is the typed contract (status, shortcuts, integrations, apps, games, setExcluded, sync, settings, updateSettings, resetSettings, lists, setLists, apiKeyStatus, setApiKey, testApiKey, steamAccounts, about, openConfigFolder, artwork, downloadArtwork, loadArtworkOptions, chooseArtwork) and `src/api.ts` implements it on
  top of the same code the CLI uses, returning data instead of printing. To add a feature: add the method to
  `SteamManagerApi` and `CHANNELS`, implement it in `api.ts`, repeat the channel in the preload, and call it from the UI.
- The UI defaults to a dry run. Syncing writes only while Steam is closed.
- Not done yet: code signing and an app icon (packages use the default Electron icon),
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

## Game pages and artwork

Tap a game card in the library to open its page: title, a back button, the store and what Apply will do, an
"Add to Steam" switch, and every image the game has (hero, poster, wide capsule, logo, icon) with a
"Not downloaded" placeholder for any that are missing. The checkbox in a card's corner still ticks the game on or off
without opening it.

**Picking images.** SteamGridDB has several images of each type for most games, so the gallery groups them by type
(hero, poster, wide capsule, logo, icon) and shows the options of each type in a row. The first option is selected by
default; click another to select it (it gets a border), or choose **None** to leave that type out. The hero is large, so it
has a big preview with a strip of small clickable thumbnails underneath. Arrow keys move the selection inside a row.
Opening a game fetches all its options (their previews are small thumbnails); **Refresh options** asks again.
Your picks are remembered by SteamGridDB image id in `config.json` (`artworkChoices`), so they survive clearing the cache,
and they are copied into Steam's grid folder the next time the game is synced. A game that is already in Steam is not
changed until then. Picking again replaces the image we copied earlier; an image you put there yourself is never replaced.

**The app keeps its own copy of the artwork.** Once the library is ready, and a SteamGridDB key is set, the app downloads
the selected image of every game that has none cached yet, one game at a time, with a progress line in the library; posters appear
on the cards as they arrive. Quit at any point and it resumes next time, fetching only what is missing.

- **Where:** `<config folder>/artwork-cache/<title>-<hash>/` (shown in Settings > About), one folder per game keyed by its
  title, so the same game from two launchers shares its art. Each folder holds the full image of every selected option
  (`full-<type>-<id>`), small previews of the options the game page has shown (`thumb-<type>-<id>`), and a `meta.json` with the
  lists SteamGridDB returned. Only the selected images are downloaded in full, so the cost is about one image per type, plus previews.
- **What is not asked twice:** an image SteamGridDB does not have is remembered (as "missing") for a week before it is asked for
  again, so an obscure game does not cost a request on every launch. Failed downloads are not remembered and are retried.
- **Matching:** a game is matched on SteamGridDB by exact title (ignoring case, punctuation, symbols and Roman numerals II to IX).
  Its search is fuzzy, so a near miss would show another game's art; no exact match means placeholders.
- **Sync copies from the cache** into Steam's grid folder (`userdata/<id>/config/grid`, named by the shortcut ID), so adding a
  game needs no second download. An image already in Steam's folder is kept; the library and game page prefer it over the cache.
- **Every image is tagged as ours.** The moment an image is downloaded, "Steam Manager (steam-manager:artwork)" is written into the
  file: a standard text chunk in PNGs, a standard comment in JPEGs (after the JFIF/Exif headers), and a short footer after
  the image data for ICO and WebP, which have no safe metadata place and whose decoders ignore trailing bytes. The tag also
  records the SteamGridDB image id (`id=<n>`), which is how a changed pick is told apart from the one already in Steam.
  Pixels and other metadata are unchanged. Images cached before tagging existed are tagged when they are copied into Steam.
- **Removing a game takes only our images with it.** When a shortcut is removed (unchecked, pruned, or replaced), sync deletes the
  files in Steam's grid folder that are named for that shortcut's ID **and** carry our tag. Anything else with that name, such as
  an image you made, stays, and the log says how many were kept. Images copied before tagging existed have no tag and are left in place.
- **Controls:** Settings > Artwork can turn the automatic download off, chooses which types are copied into Steam, sets how
  many options to offer per type (5 by default, from 1 to 20) and has the **Show adult (NSFW) artwork** switch. It is off by
  default; turned on, it asks SteamGridDB for adult images too (`nsfw=any`), and they are marked "Adult" in the gallery.
- **The page never touches files:** the desktop app serves images through a `steam-manager-art://` scheme
  (`grid/<file>` for Steam's folder, `cache/<game>/<file>` for the cache) that only accepts image names, no paths, and the page's
  security policy allows images from it and nothing else.

## Settings

The gear in the header opens the settings page. Changes save as you make them.

| Section | What it controls |
|---|---|
| Artwork | the SteamGridDB API key (with a Test button), automatic artwork download, which images are copied into Steam, how many options to offer per type (1 to 20), adult artwork on or off, and whether sync copies artwork |
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
- `src/artwork` SteamGridDB client, the artwork cache (options, picks, copy into the grid folder) and image tagging
- `src/integrations` one file per launcher, plus the registry (`index.ts`) and shared helpers
- `src/launcher` wrapper scripts for URI launches
- `src/UI` React UI, `electron/` main process and preload, `src/api.ts` + `src/ipc.ts` the bridge between them
- `src/app.ts`, `src/cli.ts` commands; `src/types.ts` the `Game`/`LaunchSpec` types

## Development

`npm test`, `npm run coverage` (100% threshold, UI included; `electron/main.ts`, the preload and `src/UI/main.tsx` are thin
bootstrap code verified by launching the app), `npm run typecheck`.

## Packaging and releases

- `npm run pack` builds an unpacked app in `release/`; `npm run dist:linux` makes an AppImage and a deb,
  `npm run dist:win` an installer and a portable `.exe`, and `npm run dist` both. Nothing is published by these scripts.
  Building the Windows packages on Linux needs Wine, so build them on Windows or let CI do it. The deb needs a project
  homepage: set `homepage` in `package.json` (CI sets it to the repository).
- `.github/workflows/release.yml` runs on every push to `main`: typecheck and tests with 100% coverage, then the Linux and
  Windows packages on their own runners, then a GitHub release named `v<commits>` with the files attached.
  **Versions:** the version is the number of commits on `main`, set by CI. Installers need a semver, so files are named
  `0.0.<commits>`, while Settings > About and the release name show just the number (release `v19` is the 19th commit).
  Local runs show `dev`. `node scripts/version.mjs` prints the number-based version and `--write` puts it into
  `package.json`, which CI does before packaging; do not edit the version by hand.
  The apps are not code-signed, so Windows SmartScreen may warn on first run.
