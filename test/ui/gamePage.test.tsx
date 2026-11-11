// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkEntry, GameInfo } from '../../src/ipc.js';
import { GamePage } from '../../src/UI/GamePage.js';
import { artworkEntry, games, installApi } from './mockApi.js';

afterEach(cleanup);

const fortnite = games[0] as GameInfo; // in Steam, switched on
const rocket = games[1] as GameInfo; // not in Steam yet
const hades = games[2] as GameInfo; // in Steam but switched off
const guess = games[3] as GameInfo; // weak, switched off, not in Steam

const hasKey = { apiKeyStatus: vi.fn(async () => ({ set: true, source: 'saved' as const, secureStorage: true })) };

function renderPage(props: Partial<Parameters<typeof GamePage>[0]> = {}) {
  const callbacks = { onBack: vi.fn(), onToggle: vi.fn(), onOpenSettings: vi.fn(), onArtworkChanged: vi.fn() };
  render(<GamePage game={fortnite} entry={artworkEntry()} {...callbacks} {...props} />);
  return callbacks;
}

describe('GamePage', () => {
  it('shows the game, where it is from and what will happen to it', () => {
    installApi(hasKey);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Fortnite', level: 2 })).toBeTruthy();
    const details = within(screen.getByRole('region', { name: 'Game' }));
    expect(details.getByText('Epic Games')).toBeTruthy();
    expect(details.getByText('In Steam')).toBeTruthy();
    expect(details.getByText('1').tagName).toBe('CODE');
    expect(details.queryByText('Guess')).toBeNull();
  });

  it.each([
    [rocket, 'Will add'],
    [hades, 'Will remove'],
  ])('says what will happen to %#', (game, label) => {
    installApi(hasKey);
    renderPage({ game });
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('shows nothing about Steam for a switched-off game that is not in Steam, and marks weak guesses', () => {
    installApi(hasKey);
    renderPage({ game: guess });
    const details = within(screen.getByRole('region', { name: 'Game' }));
    expect(details.queryByText(/Will|In Steam/)).toBeNull();
    expect(details.getByText('Guess')).toBeTruthy();
  });

  it('goes back, and switches the game on or off for Steam', () => {
    installApi(hasKey);
    const { onBack, onToggle } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    const toggle = screen.getByRole('switch', { name: 'Add to Steam' }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
    cleanup();
    renderPage({ game: hades });
    expect((screen.getByRole('switch', { name: 'Add to Steam' }) as HTMLInputElement).checked).toBe(false);
  });

  it('says that picks are copied into Steam when the game is synced', () => {
    installApi(hasKey);
    renderPage();
    expect(screen.getByText(/copied into Steam’s grid folder the next time the game is synced/)).toBeTruthy();
  });

  it('shows the options of each image type, with the selected one marked', () => {
    installApi(hasKey);
    renderPage();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5);
    expect(screen.getAllByRole('radio', { checked: true }).length).toBeGreaterThanOrEqual(5);
  });
});

describe('GamePage options', () => {
  const loaded = { ...artworkEntry(), optionsReady: true };
  const notReady = (): ArtworkEntry => ({ items: [], choices: {}, pending: true, optionsReady: false });

  it('fetches the options when the game is opened with a key, and hands over what it got', async () => {
    const entry = artworkEntry(3);
    const mock = installApi({ ...hasKey, loadArtworkOptions: vi.fn(async () => ({ outcomes: [], entry })) });
    const { onArtworkChanged } = renderPage({ entry: notReady() });
    await waitFor(() => expect(onArtworkChanged).toHaveBeenCalledWith(1, entry));
    expect(mock.loadArtworkOptions).toHaveBeenCalledWith({ appId: 1, title: 'Fortnite', force: false });
    expect(screen.queryByText('No SteamGridDB key')).toBeNull();
  });

  it('does not fetch them again when they are ready, or when there is no key, or when nothing is known yet', async () => {
    const mock = installApi(hasKey);
    renderPage({ entry: loaded });
    await waitFor(() => expect(mock.apiKeyStatus).toHaveBeenCalled());
    expect(mock.loadArtworkOptions).not.toHaveBeenCalled();
    cleanup();

    const noKey = installApi({ apiKeyStatus: vi.fn(async () => ({ set: false, source: 'none' as const, secureStorage: true })) });
    const { onOpenSettings } = renderPage({ entry: notReady() });
    await screen.findByText('No SteamGridDB key');
    expect(noKey.loadArtworkOptions).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Refresh options' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows a failure to read the key status', async () => {
    installApi({ apiKeyStatus: vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: no keychain"); }) });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('no keychain');
  });

  it('shows a failed fetch and keeps what it has', async () => {
    installApi({ ...hasKey, loadArtworkOptions: vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: offline"); }) });
    const { onArtworkChanged } = renderPage({ entry: notReady() });
    expect((await screen.findByRole('alert')).textContent).toBe('offline');
    expect(onArtworkChanged).not.toHaveBeenCalled();
    expect(screen.queryByText('Fetching options…')).toBeNull();
  });

  it('says it is fetching while it does, and disables the refresh button', async () => {
    let finish: (value: { outcomes: []; entry: ArtworkEntry }) => void = () => undefined;
    installApi({ ...hasKey, loadArtworkOptions: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    renderPage({ entry: notReady() });
    expect((await screen.findByRole('button', { name: 'Fetching…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Fetching options…')).toBeTruthy();
    finish({ outcomes: [], entry: artworkEntry() });
    await screen.findByRole('button', { name: 'Refresh options' });
  });

  it('refreshes on request, reports what happened and says why an image failed', async () => {
    const loadArtworkOptions = vi.fn(async () => ({ outcomes: [{ kind: 'poster' as const, status: 'saved' as const }, { kind: 'hero' as const, status: 'failed' as const, error: 'Download failed with HTTP 404' }], entry: loaded }));
    const mock = installApi({ ...hasKey, loadArtworkOptions });
    const { onArtworkChanged } = renderPage({ entry: loaded });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh options' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh options' }));
    await waitFor(() => expect(screen.getByText('1 downloaded, 0 already cached, 0 not on SteamGridDB, 1 failed. Download failed with HTTP 404')).toBeTruthy());
    expect(mock.loadArtworkOptions).toHaveBeenCalledWith({ appId: 1, title: 'Fortnite', force: true });
    expect(onArtworkChanged).toHaveBeenCalledWith(1, loaded);
  });

  it('reports a refresh without failures with just the counts', async () => {
    installApi({ ...hasKey, loadArtworkOptions: vi.fn(async () => ({ outcomes: [{ kind: 'poster' as const, status: 'exists' as const }], entry: loaded })) });
    renderPage({ entry: loaded });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh options' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh options' }));
    expect(await screen.findByText('0 downloaded, 1 already cached, 0 not on SteamGridDB, 0 failed.')).toBeTruthy();
  });

  it('saves a pick, hands over the new entry and shows nothing wrong', async () => {
    const after = artworkEntry(5);
    const chooseArtwork = vi.fn(async () => ({ entry: after }));
    installApi({ ...hasKey, chooseArtwork });
    const { onArtworkChanged } = renderPage({ entry: loaded });
    const poster = within(screen.getByRole('radiogroup', { name: /Poster/ }));
    fireEvent.click(poster.getAllByRole('radio')[1] as HTMLElement);
    await waitFor(() => expect(onArtworkChanged).toHaveBeenCalledWith(1, after));
    expect(chooseArtwork).toHaveBeenCalledWith({ appId: 1, title: 'Fortnite', kind: 'poster', imageId: 101 });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('can pick none for a type', async () => {
    const chooseArtwork = vi.fn(async () => ({ entry: loaded }));
    installApi({ ...hasKey, chooseArtwork });
    renderPage({ entry: loaded });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: /Hero/ })).getByRole('radio', { name: 'No hero image' }));
    await waitFor(() => expect(chooseArtwork).toHaveBeenCalledWith({ appId: 1, title: 'Fortnite', kind: 'hero', imageId: null }));
  });

  it('shows why a picked image could not be downloaded, and a failed pick', async () => {
    const chooseArtwork = vi.fn()
      .mockResolvedValueOnce({ entry: loaded, downloadError: 'Add a SteamGridDB API key in Settings to download artwork.' })
      .mockRejectedValueOnce(new Error("Error invoking remote method 'x': Error: disk full"));
    installApi({ ...hasKey, chooseArtwork });
    renderPage({ entry: loaded });
    const poster = () => within(screen.getByRole('radiogroup', { name: /Poster/ })).getAllByRole('radio');
    fireEvent.click(poster()[1] as HTMLElement);
    expect((await screen.findByRole('alert')).textContent).toBe('Add a SteamGridDB API key in Settings to download artwork.');
    fireEvent.click(poster()[2] as HTMLElement);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('disk full'));
  });
});
