// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, errorMessage } from '../../src/UI/api.js';
import { Check } from '../../src/UI/Check.js';
import { Header } from '../../src/UI/Header.js';
import { Library } from '../../src/UI/Library.js';
import { SyncPanel } from '../../src/UI/SyncPanel.js';
import { DEFAULT_SETTINGS } from '../../src/settingsModel.js';
import { emptyReport, gamesReport, installApi, integrations, okStatus, shortcuts } from './mockApi.js';

afterEach(cleanup);

describe('api helpers', () => {
  it('returns the bridge the preload script exposes', () => {
    const mock = installApi();
    expect(api()).toBe(window.steamManager);
    expect(api()).toBe(mock);
  });

  it('strips the prefix Electron adds to errors thrown in the main process', () => {
    expect(errorMessage(new Error("Error invoking remote method 'steam-manager:sync': Error: Steam is running"))).toBe('Steam is running');
    expect(errorMessage(new Error("Error invoking remote method 'x': Plain message"))).toBe('Plain message');
    expect(errorMessage(new Error('Ordinary'))).toBe('Ordinary');
    expect(errorMessage('just text')).toBe('just text');
  });
});

describe('Header', () => {
  const renderHeader = (status: Parameters<typeof Header>[0]['status'], loading = false, settingsOpen = false) => {
    const onRefresh = vi.fn();
    const onToggleSettings = vi.fn();
    render(<Header status={status} loading={loading} settingsOpen={settingsOpen} onRefresh={onRefresh} onToggleSettings={onToggleSettings} />);
    return { onRefresh, onToggleSettings };
  };

  it('shows the app name and that Steam is closed', () => {
    renderHeader(okStatus);
    expect(screen.getByRole('heading', { name: 'Steam Manager' })).toBeTruthy();
    expect(screen.getByText('Steam is closed')).toBeTruthy();
  });

  it('warns when Steam is running', () => {
    renderHeader({ ...okStatus, steamRunning: true });
    expect(screen.getByText('Steam is running')).toBeTruthy();
  });

  it('says when Steam cannot be found, when nothing could be loaded, and while checking', () => {
    renderHeader({ platform: 'linux', steamRunning: false, error: 'nope' });
    expect(screen.getByText('Steam not found')).toBeTruthy();
    cleanup();
    renderHeader(undefined);
    expect(screen.getByText('Not connected')).toBeTruthy();
    cleanup();
    renderHeader(undefined, true);
    expect(screen.getByLabelText('Checking Steam')).toBeTruthy();
  });

  it('refreshes on demand', () => {
    const { onRefresh } = renderHeader(okStatus);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('has a settings button that shows whether settings are open', () => {
    const { onToggleSettings } = renderHeader(okStatus);
    const gear = screen.getByRole('button', { name: 'Settings' });
    expect(gear.getAttribute('aria-pressed')).toBe('false');
    expect(gear.className).toBe('icon-button');
    fireEvent.click(gear);
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
    cleanup();
    renderHeader(okStatus, false, true);
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Settings' }).className).toContain('active');
  });
});

describe('Check', () => {
  it('shows a mixed state as indeterminate and reports the next value', () => {
    const onChange = vi.fn();
    render(<Check checked={false} indeterminate label="Some" onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Some' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is a plain checkbox otherwise', () => {
    render(<Check checked label="All" onChange={() => undefined} />);
    const box = screen.getByRole('checkbox', { name: 'All' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });
});

describe('Library', () => {
  const renderLibrary = (props: Partial<Parameters<typeof Library>[0]> = {}) => {
    const onToggle = vi.fn();
    render(<Library report={gamesReport} shortcuts={shortcuts} art={{}} loading={false} onToggle={onToggle} onOpen={vi.fn()} {...props} />);
    return onToggle;
  };
  const box = (name: string | RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

  it('groups the games by launcher with how many are selected, and no store tags on the cards', () => {
    renderLibrary();
    const epic = within(screen.getByRole('region', { name: 'Epic Games' }));
    const gog = within(screen.getByRole('region', { name: 'GOG Galaxy' }));
    expect(epic.getByText('2/2')).toBeTruthy();
    expect(epic.getByText('Fortnite')).toBeTruthy();
    expect(epic.getByText('Rocket League')).toBeTruthy();
    expect(gog.getByText('0/2')).toBeTruthy();
    expect(gog.getByText('Hades')).toBeTruthy();
    expect(screen.getAllByText('Epic Games')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: /Library/ }).textContent).toContain('4');
  });

  it('sorts the groups and the games in them by name', () => {
    const game = (store: string, id: string, title: string) => ({ key: `${store}:${id}`, store, id, title, appId: Math.random(), weak: false, inSteam: false, excluded: false });
    const report = { ...gamesReport, games: [game('Zeta Launcher', 'z', 'Zed'), game('Alpha Launcher', 'b', 'Bee'), game('Alpha Launcher', 'a', 'Ant')] };
    renderLibrary({ report, shortcuts: [] });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Alpha Launcher', 'Zeta Launcher']);
    const alpha = within(screen.getByRole('region', { name: 'Alpha Launcher' }));
    expect(alpha.getAllByText(/^(Ant|Bee)$/).map((el) => el.textContent)).toEqual(['Ant', 'Bee']);
  });

  it('shows the groups in order: launchers, your shortcuts, no longer found', () => {
    renderLibrary();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Epic Games', 'GOG Galaxy', 'Your shortcuts', 'No longer found']);
  });

  it('opens a game when its card is clicked, but not when only its checkbox is', () => {
    const onOpen = vi.fn();
    const onToggle = renderLibrary({ onOpen });
    fireEvent.click(screen.getByRole('button', { name: 'Open Rocket League' }));
    expect(onOpen).toHaveBeenCalledWith('Epic Games:rl');
    fireEvent.click(box(/Fortnite/));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  describe('posters', () => {
    const poster = (url: string) => ({ items: [{ kind: 'poster' as const, url }], pending: false });
    const imageOf = (name: string) => (screen.getByText(name).closest('li') as HTMLElement).querySelector('img');

    it('shows the downloaded poster of a game, and the generated cover for games without one', () => {
      renderLibrary({ art: { 1: { items: [...poster('steam-manager-art://grid/1p.png?v=1').items, { kind: 'hero', url: 'x://hero' }], pending: false }, 5: { items: [{ kind: 'hero', url: 'x://only-hero' }], pending: false } } });
      expect(imageOf('Fortnite')?.getAttribute('src')).toBe('steam-manager-art://grid/1p.png?v=1');
      expect(imageOf('Fortnite')?.getAttribute('loading')).toBe('lazy');
      expect(imageOf('Rocket League')).toBeNull();
      expect(imageOf('Hades')).toBeNull();
      expect(screen.getAllByText('RL').length).toBeGreaterThan(0);
    });

    it('shows posters on the cards for your own shortcuts and for ones no longer found too', () => {
      renderLibrary({ art: { 2: poster('x://mine'), 3: poster('x://old') } });
      expect(imageOf('My Own Game')?.getAttribute('src')).toBe('x://mine');
      expect(imageOf('Old Game')?.getAttribute('src')).toBe('x://old');
    });

    it('falls back to the cover when the image cannot be loaded, and tries a new image again', () => {
      const props = { report: gamesReport, shortcuts, loading: false, onToggle: vi.fn(), onOpen: vi.fn() };
      const { rerender } = render(<Library {...props} art={{ 1: poster('x://broken') }} />);
      fireEvent.error(imageOf('Fortnite') as HTMLImageElement);
      expect(imageOf('Fortnite')).toBeNull();
      expect(screen.getAllByText('F').length).toBeGreaterThan(0);
      rerender(<Library {...props} art={{ 1: poster('x://fixed') }} />);
      expect(imageOf('Fortnite')?.getAttribute('src')).toBe('x://fixed');
    });
  });

  describe('artwork download progress', () => {
    it('shows which game is being downloaded and how far along it is', () => {
      renderLibrary({ artProgress: { done: 2, total: 5 } });
      expect(screen.getByRole('status').textContent).toContain('Downloading artwork: 3 of 5');
      const bar = screen.getByLabelText('Artwork download progress') as HTMLProgressElement;
      expect([bar.value, bar.max]).toEqual([2, 5]);
    });

    it('never counts past the total, and shows nothing when no download is running', () => {
      renderLibrary({ artProgress: { done: 5, total: 5 } });
      expect(screen.getByRole('status').textContent).toContain('5 of 5');
      cleanup();
      renderLibrary();
      expect(screen.queryByLabelText('Artwork download progress')).toBeNull();
    });
  });

  it('shows what will happen to each game and marks weak guesses', () => {
    renderLibrary();
    expect(screen.getByText('In Steam')).toBeTruthy();
    expect(screen.getByText('Will add')).toBeTruthy();
    expect(screen.getByText('Will remove')).toBeTruthy();
    expect(screen.getByText('Guess')).toBeTruthy();
    // Tiny Guess is switched off and not in Steam: nothing will happen to it
    expect(within(screen.getByText('Tiny Guess').closest('li') as HTMLElement).queryByText(/Will|In Steam/)).toBeNull();
  });

  it('switches one game on or off by clicking its checkbox', () => {
    const onToggle = renderLibrary();
    fireEvent.click(box(/Fortnite/));
    expect(onToggle).toHaveBeenLastCalledWith(['Epic Games:fn'], false);
    fireEvent.click(box(/Hades/));
    expect(onToggle).toHaveBeenLastCalledWith(['GOG Galaxy:hades'], true);
  });

  it('switches a whole launcher on or off, and shows a partly selected one as mixed', () => {
    const onToggle = renderLibrary();
    expect(box('Select all Epic Games').checked).toBe(true);
    expect(box('Select all GOG Galaxy').checked).toBe(false);
    fireEvent.click(box('Select all Epic Games'));
    expect(onToggle).toHaveBeenLastCalledWith(['Epic Games:fn', 'Epic Games:rl'], false);
    fireEvent.click(box('Select all GOG Galaxy'));
    expect(onToggle).toHaveBeenLastCalledWith(['GOG Galaxy:hades', 'GOG Galaxy:guess'], true);

    cleanup();
    const mixed = { ...gamesReport, games: gamesReport.games.map((g) => (g.key === 'Epic Games:rl' ? { ...g, excluded: true } : g)) };
    const again = renderLibrary({ report: mixed });
    expect(box('Select all Epic Games').indeterminate).toBe(true);
    fireEvent.click(box('Select all Epic Games'));
    expect(again).toHaveBeenLastCalledWith(['Epic Games:fn', 'Epic Games:rl'], true);
  });

  it('has a select all for everything, mixed unless all or none are on', () => {
    const onToggle = renderLibrary();
    expect(screen.getByText('2 of 4 selected for Steam')).toBeTruthy();
    expect(box('Select all games').indeterminate).toBe(true);
    expect(box('Select all games').checked).toBe(false);
    fireEvent.click(box('Select all games'));
    expect(onToggle).toHaveBeenLastCalledWith(['Epic Games:fn', 'Epic Games:rl', 'GOG Galaxy:hades', 'GOG Galaxy:guess'], true);
  });

  it('turns everything off when everything is on', () => {
    const everything = { ...gamesReport, games: gamesReport.games.map((g) => ({ ...g, excluded: false })) };
    const onToggle = renderLibrary({ report: everything });
    expect(box('Select all games').checked).toBe(true);
    fireEvent.click(box('Select all games'));
    expect(onToggle).toHaveBeenLastCalledWith(['Epic Games:fn', 'Epic Games:rl', 'GOG Galaxy:hades', 'GOG Galaxy:guess'], false);
  });

  it('shows your own shortcuts and ones whose game is gone, without checkboxes', () => {
    renderLibrary();
    const yours = within(screen.getByRole('region', { name: 'Your shortcuts' }));
    expect(yours.getByText('My Own Game')).toBeTruthy();
    expect(yours.getByText('Yours').getAttribute('title')).toBe('Added by you');
    expect(yours.queryByRole('checkbox')).toBeNull();
    const gone = within(screen.getByRole('region', { name: 'No longer found' }));
    expect(gone.getByText('Old Game')).toBeTruthy();
    expect(gone.getByText('Not found').getAttribute('title')).toBe('Created by Steam Manager');
    expect(gone.queryByRole('checkbox')).toBeNull();
  });

  it('does not list a game under "no longer found" while it is still found', () => {
    renderLibrary();
    expect(within(screen.getByRole('region', { name: 'No longer found' })).queryByText('Fortnite')).toBeNull();
  });

  it('filters everything by search, and select all then acts only on what is shown', () => {
    const onToggle = renderLibrary();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search games' }), { target: { value: '  FORT ' } });
    expect(screen.getByText('Fortnite')).toBeTruthy();
    expect(screen.queryByText('Rocket League')).toBeNull();
    expect(screen.queryByRole('region', { name: 'GOG Galaxy' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Your shortcuts' })).toBeNull();
    fireEvent.click(box('Select all games'));
    expect(onToggle).toHaveBeenLastCalledWith(['Epic Games:fn'], false);
  });

  it('finds shortcuts by search too, and says when nothing matches', () => {
    renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'Search games' });
    fireEvent.change(search, { target: { value: 'old' } });
    expect(screen.getByText('Old Game')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Select all games' })).toBeNull();
    fireEvent.change(search, { target: { value: 'zelda' } });
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(screen.getByText('Nothing in your library matches “zelda”.')).toBeTruthy();
  });

  it('lists skipped duplicates, singular and plural', () => {
    renderLibrary();
    expect(screen.getByText('1 duplicate skipped')).toBeTruthy();
    expect(screen.getByText(/is the same as Control \[Heroic \(Epic Games\)\]/)).toBeTruthy();
    cleanup();
    const two = { ...gamesReport, duplicates: [...gamesReport.duplicates, { title: 'Hades', store: 'Installed Apps', of: 'Hades [GOG Galaxy]' }] };
    renderLibrary({ report: two });
    expect(screen.getByText('2 duplicates skipped')).toBeTruthy();
  });

  it('shows placeholders while loading, without a count, selection bar or duplicates', () => {
    renderLibrary({ report: { games: [], duplicates: gamesReport.duplicates, warnings: [] }, shortcuts: [], loading: true });
    expect(screen.getByLabelText('Loading library').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { name: /Library/ }).textContent?.trim()).toBe('Library');
    expect(screen.queryByText('Select all')).toBeNull();
    expect(screen.queryByText(/duplicate/)).toBeNull();
  });

  it('shows an empty state when there is nothing at all, and still shows shortcuts when there are no games', () => {
    renderLibrary({ report: { games: [], duplicates: [], warnings: [] }, shortcuts: [] });
    expect(screen.getByText('No games found')).toBeTruthy();
    cleanup();
    renderLibrary({ report: { games: [], duplicates: [], warnings: [] } });
    expect(screen.getByText('My Own Game')).toBeTruthy();
    expect(screen.queryByText('No games found')).toBeNull();
    expect(screen.queryByText('Select all')).toBeNull();
  });
});

describe('SyncPanel', () => {
  const renderPanel = (props: Partial<Parameters<typeof SyncPanel>[0]> = {}) => {
    const onChanged = vi.fn();
    const onIncludeMaybe = vi.fn();
    render(
      <SyncPanel
        integrations={integrations}
        defaults={DEFAULT_SETTINGS.sync}
        disabled={false}
        includeMaybe={false}
        onIncludeMaybe={onIncludeMaybe}
        pending={{ add: 0, remove: 0 }}
        onChanged={onChanged}
        {...props}
      />,
    );
    return { onChanged, onIncludeMaybe };
  };
  const toggle = (label: RegExp) => screen.getByRole('switch', { name: label }) as HTMLInputElement;
  const mode = (name: string) => screen.getByRole('radio', { name }) as HTMLButtonElement;

  it('lists the launchers it scans, or says there are none', () => {
    installApi();
    renderPanel();
    const launchers = within(screen.getByLabelText('Launchers scanned'));
    expect(launchers.getByText('Epic Games')).toBeTruthy();
    expect(launchers.getByText('GOG Galaxy')).toBeTruthy();
    cleanup();
    renderPanel({ integrations: [] });
    expect(screen.getByText('No launchers on this platform')).toBeTruthy();
  });

  it('starts in preview mode with artwork on and the rest off', () => {
    installApi();
    renderPanel();
    expect(mode('Preview').getAttribute('aria-checked')).toBe('true');
    expect(mode('Apply').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Shows what would change. Nothing is written.')).toBeTruthy();
    expect(toggle(/Download artwork/).checked).toBe(true);
    expect(toggle(/Remove shortcuts/).checked).toBe(false);
    expect(toggle(/weak guesses/).checked).toBe(false);
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeTruthy();
  });

  it('starts from the defaults in settings', () => {
    installApi();
    renderPanel({ defaults: { ...DEFAULT_SETTINGS.sync, mode: 'apply', prune: true, artwork: false } });
    expect(mode('Apply').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Apply to Steam' })).toBeTruthy();
    expect(toggle(/Remove shortcuts/).checked).toBe(true);
    expect(toggle(/Download artwork/).checked).toBe(false);
  });

  it('lists only the launchers that are turned on', () => {
    installApi();
    renderPanel({ integrations: [{ id: 'epic', label: 'Epic Games', enabled: true }, { id: 'gog', label: 'GOG Galaxy', enabled: false }] });
    const launchers = within(screen.getByLabelText('Launchers scanned'));
    expect(launchers.getByText('Epic Games')).toBeTruthy();
    expect(launchers.queryByText('GOG Galaxy')).toBeNull();
    cleanup();
    renderPanel({ integrations: [{ id: 'gog', label: 'GOG Galaxy', enabled: false }] });
    expect(screen.getByText('No launchers on this platform')).toBeTruthy();
  });

  it('says what the selection will change in Steam', () => {
    installApi();
    renderPanel();
    expect(screen.getByText('Steam already matches your selection.')).toBeTruthy();
    cleanup();
    renderPanel({ pending: { add: 3, remove: 1 } });
    expect(screen.getByText('3 to add · 1 to remove')).toBeTruthy();
    cleanup();
    renderPanel({ pending: { add: 0, remove: 2 } });
    expect(screen.getByText('0 to add · 2 to remove')).toBeTruthy();
  });

  it('lets the app decide whether weak guesses are listed', () => {
    installApi();
    const { onIncludeMaybe } = renderPanel({ includeMaybe: true });
    expect(toggle(/weak guesses/).checked).toBe(true);
    fireEvent.click(toggle(/weak guesses/));
    expect(onIncludeMaybe).toHaveBeenCalledWith(false);
  });

  it('switches to apply mode and says it writes to Steam', () => {
    installApi();
    renderPanel();
    fireEvent.click(mode('Apply'));
    expect(mode('Apply').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Writes to Steam. Close Steam first.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply to Steam' })).toBeTruthy();
    fireEvent.click(mode('Preview'));
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeTruthy();
  });

  it('previews with the chosen switches, showing counts, a note and the log, without refreshing', async () => {
    const mock = installApi({
      sync: vi.fn(async () => ({ ...emptyReport, log: ['[dry run] Added:', '  Fortnite [Epic Games]'], added: [{ appId: 1, title: 'Fortnite', store: 'Epic Games' }] })),
    });
    const { onChanged } = renderPanel({ includeMaybe: true });
    fireEvent.click(toggle(/Remove shortcuts/));
    fireEvent.click(toggle(/Download artwork/));
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));

    await screen.findByLabelText('1 added');
    expect(screen.getByLabelText('0 updated')).toBeTruthy();
    expect(mock.sync).toHaveBeenCalledWith({ dryRun: true, prune: true, includeMaybe: true, artwork: false });
    expect(screen.getByText('Preview only. Nothing was changed.')).toBeTruthy();
    expect(screen.getByLabelText('Log').textContent).toContain('Fortnite [Epic Games]');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('applies for real, then asks the app to refresh', async () => {
    const mock = installApi();
    const { onChanged } = renderPanel();
    fireEvent.click(mode('Apply'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Steam' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mock.sync).toHaveBeenCalledWith({ dryRun: false, prune: false, includeMaybe: false, artwork: true });
    expect(screen.queryByText('Preview only. Nothing was changed.')).toBeNull();
    expect(screen.queryByLabelText('Log')).toBeNull();
  });

  it('shows the error in the report and does not refresh', async () => {
    installApi({ sync: vi.fn(async () => ({ ...emptyReport, error: 'Steam is running' })) });
    const { onChanged } = renderPanel();
    fireEvent.click(mode('Apply'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Steam' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Steam is running');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows a failure thrown by the bridge', async () => {
    installApi({ sync: vi.fn(async () => { throw new Error("Error invoking remote method 'steam-manager:sync': Error: boom"); }) });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect((await screen.findByRole('alert')).textContent).toBe('boom');
  });

  it('disables the button while working', async () => {
    let finish: (value: typeof emptyReport) => void = () => undefined;
    installApi({ sync: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    const working = (await screen.findByRole('button', { name: 'Working…' })) as HTMLButtonElement;
    expect(working.disabled).toBe(true);
    finish(emptyReport);
    await screen.findByRole('button', { name: 'Preview changes' });
  });

  it('is disabled when told to be (no Steam found)', () => {
    installApi();
    renderPanel({ disabled: true });
    expect((screen.getByRole('button', { name: 'Preview changes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
