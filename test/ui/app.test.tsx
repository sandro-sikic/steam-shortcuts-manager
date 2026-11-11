// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/UI/App.js';
import { applySettings, DEFAULT_SETTINGS } from '../../src/settingsModel.js';
import { emptyReport, gamesReport, installApi, okStatus, settings } from './mockApi.js';

const poster = (appId: number) => ({ [appId]: [{ kind: 'poster' as const, url: `steam-manager-art://grid/${appId}p.png?v=1` }] });

afterEach(cleanup);

const preview = () => screen.getByRole('button', { name: 'Preview changes' }) as HTMLButtonElement;
const box = (name: string | RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('App', () => {
  it('shows placeholders first, then Steam status, the launchers and the grouped library', async () => {
    const mock = installApi();
    render(<App />);
    expect(screen.getByLabelText('Loading library')).toBeTruthy();
    expect(screen.getByLabelText('Checking Steam')).toBeTruthy();

    await screen.findByText('Fortnite');
    expect(screen.getByText('/home/me/.steam/steam')).toBeTruthy();
    expect(screen.getByText('account 42')).toBeTruthy();
    expect(screen.getByText('Steam is closed')).toBeTruthy();
    expect(within(screen.getByLabelText('Launchers scanned')).getByText('GOG Galaxy')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Epic Games' })).toBeTruthy();
    expect(screen.queryByLabelText('Loading library')).toBeNull();
    expect(mock.games).toHaveBeenCalledWith({ includeMaybe: false });
    expect(mock.shortcuts).toHaveBeenCalledTimes(1);
  });

  it('counts what the selection will add and remove', async () => {
    installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    expect(screen.getByText('1 to add · 1 to remove')).toBeTruthy();
  });

  it('switches a game off at once, saves it, and updates what will happen', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(box(/Fortnite/));

    await waitFor(() => expect(mock.setExcluded).toHaveBeenCalledWith(['Epic Games:fn'], true));
    expect(box(/Fortnite/).checked).toBe(false);
    expect(screen.getByText('2 to remove', { exact: false }).textContent).toContain('1 to add · 2 to remove');
  });

  it('switches a whole launcher back on', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(box('Select all GOG Galaxy'));
    await waitFor(() => expect(mock.setExcluded).toHaveBeenCalledWith(['GOG Galaxy:hades', 'GOG Galaxy:guess'], false));
    expect(box(/Hades/).checked).toBe(true);
    expect(screen.getByText('2 to add · 0 to remove')).toBeTruthy();
  });

  it('shows an error and reloads when saving a choice fails', async () => {
    const setExcluded = vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: disk full"); });
    const mock = installApi({ setExcluded });
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(box(/Fortnite/));
    expect((await screen.findByRole('alert')).textContent).toBe('disk full');
    await waitFor(() => expect(mock.games).toHaveBeenCalledTimes(2));
  });

  it('lists weak guesses only when asked, which reloads the library', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('switch', { name: /weak guesses/ }));
    await waitFor(() => expect(mock.games).toHaveBeenLastCalledWith({ includeMaybe: true }));
  });

  it('shows launchers that could not be scanned', async () => {
    installApi({ games: vi.fn(async () => ({ ...gamesReport, warnings: ['Could not scan Epic Games: boom'] })) });
    render(<App />);
    expect((await screen.findByText('Could not scan Epic Games: boom')).getAttribute('role')).toBe('status');
  });

  it('explains when Steam is running and keeps the library visible', async () => {
    installApi({ status: vi.fn(async () => ({ ...okStatus, steamRunning: true })) });
    render(<App />);
    await screen.findByText('Fortnite');
    expect(screen.getByText(/Close it before applying changes/)).toBeTruthy();
    expect(screen.getAllByText('Steam is running')).toHaveLength(2);
  });

  it('does not read shortcuts when Steam cannot be found, and disables syncing', async () => {
    const mock = installApi({ status: vi.fn(async () => ({ platform: 'linux', steamRunning: false, error: 'Steam installation not found' })) });
    render(<App />);
    await screen.findByText('Can’t reach Steam');
    expect(screen.getByText('Steam installation not found')).toBeTruthy();
    expect(screen.getByText('Steam not found')).toBeTruthy();
    expect(mock.shortcuts).not.toHaveBeenCalled();
    expect(screen.getByText('Fortnite')).toBeTruthy();
    expect(preview().disabled).toBe(true);
  });

  it('shows an error when loading fails', async () => {
    installApi({ status: vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: no bridge"); }) });
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('no bridge');
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(preview().disabled).toBe(true);
  });

  it('refreshes on demand and clears an earlier error', async () => {
    const status = vi.fn().mockRejectedValueOnce(new Error('first try failed')).mockResolvedValue(okStatus);
    installApi({ status });
    render(<App />);
    await screen.findByText('first try failed');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('/home/me/.steam/steam');
    expect(screen.queryByText('first try failed')).toBeNull();
  });

  it('reloads the library after a real sync', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('radio', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Steam' }));
    await waitFor(() => expect(mock.shortcuts).toHaveBeenCalledTimes(2));
    expect(mock.sync).toHaveBeenCalledTimes(1);
    expect(mock.games).toHaveBeenCalledTimes(2);
  });

  it('opens settings from the gear, and the library comes back and reloads', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('region', { name: 'Artwork' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Library' })).toBeNull();
    expect(screen.queryByText('Preview changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByText('Fortnite');
    expect(mock.games).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('region', { name: 'Library' })).toBeTruthy();
  });

  it('goes back with the settings page back button too', async () => {
    installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByText('Library', { selector: 'button.button' }));
    await screen.findByText('Fortnite');
  });

  it('saves a setting and applies the theme to the whole page at once', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(document.documentElement.dataset['card']).toBe('medium');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('dark'));
    expect(mock.updateSettings).toHaveBeenCalledWith({ ui: { theme: 'dark' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
    await waitFor(() => expect(document.documentElement.dataset['card']).toBe('large'));
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBeUndefined());
  });

  it('resets all settings from About', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await screen.findByText('Settings reset.');
    expect(mock.resetSettings).toHaveBeenCalledTimes(1);
  });

  it('reloads the library after games are switched back on in settings', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByText('Library', { selector: '.settings-nav button' }));
    const [first] = await screen.findAllByRole('button', { name: 'Turn on' });
    fireEvent.click(first as HTMLElement);
    await waitFor(() => expect(mock.setLists).toHaveBeenCalled());
    await waitFor(() => expect(mock.games).toHaveBeenCalledTimes(2));
  });

  it('starts from the saved sync defaults', async () => {
    const saved = applySettings(settings, { sync: { mode: 'apply', prune: true, includeMaybe: true, artwork: false } });
    const mock = installApi({ settings: vi.fn(async () => saved) });
    render(<App />);
    await screen.findByText('Fortnite');
    expect(mock.games).toHaveBeenCalledWith({ includeMaybe: true });
    expect(mock.games).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('radio', { name: 'Apply' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('switch', { name: /weak guesses/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('switch', { name: /Remove shortcuts/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('switch', { name: /Download artwork/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('shows an error when the settings cannot be read', async () => {
    installApi({ settings: vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: Invalid settings in config file: ui.theme must be one of"); }) });
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid settings in config file');
    expect((screen.getByRole('button', { name: 'Preview changes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('App auto-apply', () => {
  const auto = applySettings(settings, { sync: { autoApply: true, prune: true, includeMaybe: false, artwork: false } });

  it('applies to Steam as soon as a game is ticked, then reloads', async () => {
    const mock = installApi({ settings: vi.fn(async () => auto) });
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(box(/Fortnite/));
    await waitFor(() => expect(mock.sync).toHaveBeenCalledTimes(1));
    expect(mock.setExcluded).toHaveBeenCalledWith(['Epic Games:fn'], true);
    expect(mock.sync).toHaveBeenCalledWith({ dryRun: false, prune: true, includeMaybe: false, artwork: false });
    await waitFor(() => expect(mock.games).toHaveBeenCalledTimes(2));
  });

  it('keeps the weak-guess choice made in the sync panel when applying', async () => {
    const mock = installApi({ settings: vi.fn(async () => auto) });
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('switch', { name: /weak guesses/ }));
    await waitFor(() => expect(mock.games).toHaveBeenLastCalledWith({ includeMaybe: true }));
    fireEvent.click(box(/Fortnite/));
    await waitFor(() => expect(mock.sync).toHaveBeenCalledWith({ dryRun: false, prune: true, includeMaybe: true, artwork: false }));
  });

  it('shows why applying failed, after reloading', async () => {
    const mock = installApi({ settings: vi.fn(async () => auto), sync: vi.fn(async () => ({ ...emptyReport, error: 'Steam is running' })) });
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(box(/Fortnite/));
    expect((await screen.findByRole('alert')).textContent).toBe('Steam is running');
    expect(mock.games).toHaveBeenCalledTimes(2);
  });

  it('does not apply when Steam cannot be found, or when auto-apply is off', async () => {
    const noSteam = installApi({ settings: vi.fn(async () => auto), status: vi.fn(async () => ({ platform: 'linux', steamRunning: false, error: 'Steam installation not found' })) });
    render(<App />);
    await screen.findByText('Can’t reach Steam');
    fireEvent.click(box(/Fortnite/));
    await waitFor(() => expect(noSteam.setExcluded).toHaveBeenCalled());
    expect(noSteam.sync).not.toHaveBeenCalled();
    cleanup();

    const off = installApi({ settings: vi.fn(async () => DEFAULT_SETTINGS) });
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(box(/Fortnite/));
    await waitFor(() => expect(off.setExcluded).toHaveBeenCalled());
    expect(off.sync).not.toHaveBeenCalled();
  });
});

describe('App game page', () => {
  it('loads the artwork of every game and shortcut, and shows posters in the library', async () => {
    const mock = installApi({ artwork: vi.fn(async () => poster(1)) });
    render(<App />);
    await screen.findByText('Fortnite');
    expect(mock.artwork).toHaveBeenCalledWith([1, 4, 5, 6, 2, 3]);
    await waitFor(() => expect((screen.getByText('Fortnite').closest('li') as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('steam-manager-art://grid/1p.png?v=1'));
  });

  it('opens a game when its card is tapped, and goes back to the library', async () => {
    installApi({ artwork: vi.fn(async () => ({ 1: [{ kind: 'hero' as const, url: 'steam-manager-art://grid/1_hero.png' }] })) });
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Open Fortnite' }));

    expect(screen.getByRole('heading', { name: 'Fortnite', level: 2 })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Artwork' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Hero image' }).getAttribute('src')).toBe('steam-manager-art://grid/1_hero.png');
    expect(screen.queryByRole('region', { name: 'Library' })).toBeNull();
    expect(screen.queryByText('Preview changes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.getByRole('region', { name: 'Library' })).toBeTruthy();
  });

  it('switches the game on or off from its page', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Open Fortnite' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Add to Steam' }));
    await waitFor(() => expect(mock.setExcluded).toHaveBeenCalledWith(['Epic Games:fn'], true));
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Add to Steam' }) as HTMLInputElement).checked).toBe(false));
  });

  it('shows downloaded images straight away, on the page and in the library', async () => {
    const mock = installApi({
      apiKeyStatus: vi.fn(async () => ({ set: true, source: 'saved' as const, secureStorage: true })),
      downloadArtwork: vi.fn(async () => ({ outcomes: [], items: [{ kind: 'poster' as const, url: 'steam-manager-art://grid/4p.png?v=2' }] })),
    });
    render(<App />);
    await screen.findByText('Rocket League');
    fireEvent.click(screen.getByRole('button', { name: 'Open Rocket League' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download artwork' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Download artwork' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Poster image' }).getAttribute('src')).toBe('steam-manager-art://grid/4p.png?v=2'));
    expect(mock.downloadArtwork).toHaveBeenCalledWith({ appId: 4, title: 'Rocket League', force: false });

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect((screen.getByText('Rocket League').closest('li') as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('steam-manager-art://grid/4p.png?v=2');
  });

  it('opens settings from the game page, from the missing-key notice and from the gear', async () => {
    installApi({ apiKeyStatus: vi.fn(async () => ({ set: false, source: 'none' as const, secureStorage: true })) });
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Open Fortnite' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open settings' }));
    expect(screen.getByRole('region', { name: 'Artwork' }).textContent).toContain('SteamGridDB API key');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Open Fortnite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeTruthy();
  });

  it('shows the library again when the open game is gone after a refresh', async () => {
    const games = vi.fn().mockResolvedValueOnce(gamesReport).mockResolvedValue({ ...gamesReport, games: [] });
    installApi({ games });
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByRole('button', { name: 'Open Fortnite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('region', { name: 'Library' });
    expect(screen.queryByRole('heading', { name: 'Fortnite', level: 2 })).toBeNull();
    expect(screen.getByRole('region', { name: 'No longer found' })).toBeTruthy();
  });

  it('shows an error when the artwork cannot be listed, and still shows the library', async () => {
    installApi({ artwork: vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: Invalid app IDs"); }) });
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid app IDs');
    expect(screen.getByText('Fortnite')).toBeTruthy();
  });
});
