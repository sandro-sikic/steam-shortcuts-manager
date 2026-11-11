// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkItem, GameInfo } from '../../src/ipc.js';
import { GamePage } from '../../src/UI/GamePage.js';
import { games, installApi } from './mockApi.js';

afterEach(cleanup);

const fortnite = games[0] as GameInfo; // in Steam, switched on
const rocket = games[1] as GameInfo; // not in Steam yet
const hades = games[2] as GameInfo; // in Steam but switched off
const guess = games[3] as GameInfo; // weak, switched off, not in Steam

const item = (kind: ArtworkItem['kind']): ArtworkItem => ({ kind, url: `steam-manager-art://grid/1-${kind}.png` });
const all = (['poster', 'wide', 'hero', 'logo', 'icon'] as const).map(item);
const hasKey = { apiKeyStatus: vi.fn(async () => ({ set: true, source: 'saved' as const, secureStorage: true })) };

function renderPage(props: Partial<Parameters<typeof GamePage>[0]> = {}) {
  const callbacks = { onBack: vi.fn(), onToggle: vi.fn(), onOpenSettings: vi.fn(), onArtworkChanged: vi.fn() };
  render(<GamePage game={fortnite} items={[]} {...callbacks} {...props} />);
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

  it('shows every image with its name and size', () => {
    installApi(hasKey);
    renderPage({ items: all });
    for (const [alt, kind] of [['Hero image', 'hero'], ['Poster image', 'poster'], ['Wide capsule image', 'wide'], ['Logo image', 'logo'], ['Icon image', 'icon']] as const) {
      expect(screen.getByRole('img', { name: alt }).getAttribute('src')).toBe(`steam-manager-art://grid/1-${kind}.png`);
    }
    expect(screen.getByRole('img', { name: 'Logo image' }).style.objectFit).toBe('contain');
    expect(screen.getByRole('img', { name: 'Poster image' }).style.objectFit).toBe('cover');
    expect(screen.getByText('600 × 900')).toBeTruthy();
    expect(screen.getByText('1920 × 620')).toBeTruthy();
    expect(screen.queryByText('Not downloaded')).toBeNull();
  });

  it('shows a placeholder for each image that has not been downloaded', () => {
    installApi(hasKey);
    renderPage({ items: [item('poster')] });
    expect(screen.getAllByText('Not downloaded')).toHaveLength(4);
    expect(screen.getByRole('img', { name: 'Poster image' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Hero image' })).toBeNull();
  });
});

describe('GamePage downloading', () => {
  it('asks for a key when there is none, points to settings, and cannot download', async () => {
    installApi({ apiKeyStatus: vi.fn(async () => ({ set: false, source: 'none' as const, secureStorage: true })) });
    const { onOpenSettings } = renderPage({ items: [item('poster')] });
    await screen.findByText('No SteamGridDB key');
    expect((screen.getByRole('button', { name: 'Download artwork' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Download again' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('can download once there is a key, with no warning', async () => {
    installApi(hasKey);
    renderPage();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download artwork' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText('No SteamGridDB key')).toBeNull();
  });

  it('shows a failure to read the key status', async () => {
    installApi({ apiKeyStatus: vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: no keychain"); }) });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('no keychain');
  });

  it('downloads the artwork, reports what happened and hands over the new images', async () => {
    const downloadArtwork = vi.fn(async () => ({
      outcomes: [
        { kind: 'poster' as const, status: 'saved' as const },
        { kind: 'wide' as const, status: 'exists' as const },
        { kind: 'hero' as const, status: 'missing' as const },
        { kind: 'logo' as const, status: 'saved' as const },
        { kind: 'icon' as const, status: 'saved' as const },
      ],
      items: all,
    }));
    const mock = installApi({ ...hasKey, downloadArtwork });
    const { onArtworkChanged } = renderPage();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download artwork' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Download artwork' }));

    expect((await screen.findByRole('status')).textContent).toBe('3 downloaded, 1 already there, 1 not on SteamGridDB, 0 failed.');
    expect(mock.downloadArtwork).toHaveBeenCalledWith({ appId: 1, title: 'Fortnite', force: false });
    expect(onArtworkChanged).toHaveBeenCalledWith(1, all);
  });

  it('downloads again on request, and says why an image failed', async () => {
    const downloadArtwork = vi.fn(async () => ({ outcomes: [{ kind: 'poster' as const, status: 'failed' as const, error: 'Download failed with HTTP 404' }], items: [] }));
    const mock = installApi({ ...hasKey, downloadArtwork });
    renderPage({ items: [item('poster')] });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download again' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Download again' }));
    expect((await screen.findByRole('status')).textContent).toBe('0 downloaded, 0 already there, 0 not on SteamGridDB, 1 failed. Download failed with HTTP 404');
    expect(mock.downloadArtwork).toHaveBeenCalledWith({ appId: 1, title: 'Fortnite', force: true });
  });

  it('only offers to download again when there are images', async () => {
    installApi(hasKey);
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download artwork' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Download again' })).toBeNull();
  });

  it('shows a failed download and keeps the images', async () => {
    const downloadArtwork = vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: Add a SteamGridDB API key in Settings to download artwork."); });
    installApi({ ...hasKey, downloadArtwork });
    const { onArtworkChanged } = renderPage();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download artwork' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Download artwork' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Add a SteamGridDB API key in Settings to download artwork.');
    expect(onArtworkChanged).not.toHaveBeenCalled();
  });

  it('disables the buttons while downloading', async () => {
    let finish: (value: { outcomes: []; items: [] }) => void = () => undefined;
    installApi({ ...hasKey, downloadArtwork: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    renderPage();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download artwork' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Download artwork' }));
    expect((await screen.findByRole('button', { name: 'Downloading…' }) as HTMLButtonElement).disabled).toBe(true);
    finish({ outcomes: [], items: [] });
    await screen.findByRole('button', { name: 'Download artwork' });
  });
});
