// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, errorMessage } from '../../src/UI/api.js';
import { Header } from '../../src/UI/Header.js';
import { Library } from '../../src/UI/Library.js';
import { SyncPanel } from '../../src/UI/SyncPanel.js';
import { emptyReport, installApi, integrations, okStatus, shortcuts } from './mockApi.js';

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
  const renderHeader = (status: Parameters<typeof Header>[0]['status'], loading = false) => {
    const onRefresh = vi.fn();
    render(<Header status={status} loading={loading} onRefresh={onRefresh} />);
    return onRefresh;
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
    const onRefresh = renderHeader(okStatus);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('Library', () => {
  it('shows a game card per shortcut with its tags and origin', () => {
    render(<Library shortcuts={shortcuts} loading={false} />);
    expect(screen.getByRole('heading', { name: /Library/ }).textContent).toContain('2');
    expect(screen.getByText('Fortnite')).toBeTruthy();
    expect(screen.getByText('Epic Games')).toBeTruthy();
    expect(screen.getByText('Synced').getAttribute('title')).toBe('Created by Steam Manager');
    expect(screen.getByText('Yours').getAttribute('title')).toBe('Added by you');
    expect(screen.getByText('My Own Game')).toBeTruthy();
  });

  it('shows placeholders while loading, without a count', () => {
    render(<Library shortcuts={[]} loading />);
    expect(screen.getByLabelText('Loading library').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { name: /Library/ }).textContent?.trim()).toBe('Library');
  });

  it('shows an empty state when there are no shortcuts', () => {
    render(<Library shortcuts={[]} loading={false} />);
    expect(screen.getByText('No games yet')).toBeTruthy();
  });

  it('filters by search, ignoring case, and says when nothing matches', () => {
    render(<Library shortcuts={shortcuts} loading={false} />);
    const search = screen.getByRole('searchbox', { name: 'Search games' });
    fireEvent.change(search, { target: { value: '  FORT ' } });
    expect(screen.getByText('Fortnite')).toBeTruthy();
    expect(screen.queryByText('My Own Game')).toBeNull();

    fireEvent.change(search, { target: { value: 'zelda' } });
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(screen.getByText('Nothing in your library matches “zelda”.')).toBeTruthy();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('My Own Game')).toBeTruthy();
  });
});

describe('SyncPanel', () => {
  const renderPanel = (props: Partial<Parameters<typeof SyncPanel>[0]> = {}) => {
    const onChanged = vi.fn();
    render(<SyncPanel integrations={integrations} disabled={false} onChanged={onChanged} {...props} />);
    return onChanged;
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
    const onChanged = renderPanel();
    fireEvent.click(toggle(/Remove shortcuts/));
    fireEvent.click(toggle(/Download artwork/));
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));

    await screen.findByLabelText('1 added');
    expect(screen.getByLabelText('0 updated')).toBeTruthy();
    expect(mock.sync).toHaveBeenCalledWith({ dryRun: true, prune: true, includeMaybe: false, artwork: false });
    expect(screen.getByText('Preview only. Nothing was changed.')).toBeTruthy();
    expect(screen.getByLabelText('Log').textContent).toContain('Fortnite [Epic Games]');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('applies for real, then asks the app to refresh', async () => {
    const mock = installApi();
    const onChanged = renderPanel();
    fireEvent.click(mode('Apply'));
    fireEvent.click(toggle(/weak guesses/));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Steam' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mock.sync).toHaveBeenCalledWith({ dryRun: false, prune: false, includeMaybe: true, artwork: true });
    expect(screen.queryByText('Preview only. Nothing was changed.')).toBeNull();
    expect(screen.queryByLabelText('Log')).toBeNull();
  });

  it('shows the error in the report and does not refresh', async () => {
    installApi({ sync: vi.fn(async () => ({ ...emptyReport, error: 'Steam is running' })) });
    const onChanged = renderPanel();
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
