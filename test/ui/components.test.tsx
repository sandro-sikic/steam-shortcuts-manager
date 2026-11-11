// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, errorMessage } from '../../src/UI/api.js';
import { ShortcutList } from '../../src/UI/ShortcutList.js';
import { StatusCard } from '../../src/UI/StatusCard.js';
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

describe('StatusCard', () => {
  it('shows the installation, account and that Steam is closed', () => {
    render(<StatusCard status={okStatus} />);
    expect(screen.getByText('/home/me/.steam/steam')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Steam is closed')).toBeTruthy();
    expect(screen.getByText('linux')).toBeTruthy();
  });

  it('warns when Steam is running', () => {
    render(<StatusCard status={{ ...okStatus, steamRunning: true }} />);
    expect(screen.getByText('Steam is running: close it before syncing')).toBeTruthy();
  });

  it('shows why Steam could not be found', () => {
    render(<StatusCard status={{ platform: 'win32', steamRunning: false, error: 'Steam installation not found' }} />);
    expect(screen.getByText('Steam installation not found')).toBeTruthy();
    expect(screen.queryByText('Installation')).toBeNull();
  });
});

describe('ShortcutList', () => {
  it('lists shortcuts with their tags and a managed badge', () => {
    render(<ShortcutList shortcuts={shortcuts} />);
    expect(screen.getByText('Non-Steam shortcuts (2)')).toBeTruthy();
    expect(screen.getByText('Fortnite')).toBeTruthy();
    expect(screen.getByText('Epic Games')).toBeTruthy();
    expect(screen.getAllByText('managed')).toHaveLength(1);
    expect(screen.getByText('My Own Game')).toBeTruthy();
  });

  it('shows an empty state', () => {
    render(<ShortcutList shortcuts={[]} />);
    expect(screen.getByText('No shortcuts yet.')).toBeTruthy();
  });
});

describe('SyncPanel', () => {
  const renderPanel = (props: Partial<Parameters<typeof SyncPanel>[0]> = {}) => {
    const onChanged = vi.fn();
    render(<SyncPanel integrations={integrations} disabled={false} onChanged={onChanged} {...props} />);
    return onChanged;
  };
  const checkbox = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

  it('lists the launchers it scans, or says there are none', () => {
    installApi();
    renderPanel();
    expect(screen.getByText('Scans: Epic Games, GOG Galaxy')).toBeTruthy();
    cleanup();
    renderPanel({ integrations: [] });
    expect(screen.getByText('Scans: nothing on this platform')).toBeTruthy();
  });

  it('starts with the safe defaults: dry run and artwork on, the rest off', () => {
    installApi();
    renderPanel();
    expect(checkbox(/Dry run/).checked).toBe(true);
    expect(checkbox(/Download artwork/).checked).toBe(true);
    expect(checkbox(/Remove shortcuts/).checked).toBe(false);
    expect(checkbox(/weak guesses/).checked).toBe(false);
    expect(screen.getByRole('button', { name: 'Preview sync' })).toBeTruthy();
  });

  it('previews with the chosen options and shows counts and the log without refreshing', async () => {
    const mock = installApi({
      sync: vi.fn(async () => ({ ...emptyReport, log: ['[dry run] Added:', '  Fortnite [Epic Games]'], added: [{ appId: 1, title: 'Fortnite', store: 'Epic Games' }] })),
    });
    const onChanged = renderPanel();
    fireEvent.click(checkbox(/Remove shortcuts/));
    fireEvent.click(checkbox(/Download artwork/));
    fireEvent.click(screen.getByRole('button', { name: 'Preview sync' }));

    await screen.findByText('1 added · 0 updated · 0 removed · 0 unchanged · 0 skipped');
    expect(mock.sync).toHaveBeenCalledWith({ dryRun: true, prune: true, includeMaybe: false, artwork: false });
    expect(screen.getByText(/Fortnite \[Epic Games\]/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('syncs for real after unchecking dry run, then asks the app to refresh', async () => {
    const mock = installApi();
    const onChanged = renderPanel();
    fireEvent.click(checkbox(/Dry run/));
    fireEvent.click(checkbox(/weak guesses/));
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mock.sync).toHaveBeenCalledWith({ dryRun: false, prune: false, includeMaybe: true, artwork: true });
  });

  it('shows the error in the report and does not refresh', async () => {
    installApi({ sync: vi.fn(async () => ({ ...emptyReport, error: 'Steam is running' })) });
    const onChanged = renderPanel();
    fireEvent.click(checkbox(/Dry run/));
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await screen.findByText('Steam is running');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows a failure thrown by the bridge', async () => {
    installApi({ sync: vi.fn(async () => { throw new Error("Error invoking remote method 'steam-manager:sync': Error: boom"); }) });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Preview sync' }));
    await screen.findByText('boom');
  });

  it('disables the button while working', async () => {
    let finish: (value: typeof emptyReport) => void = () => undefined;
    installApi({ sync: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Preview sync' }));
    const working = (await screen.findByRole('button', { name: 'Working…' })) as HTMLButtonElement;
    expect(working.disabled).toBe(true);
    finish(emptyReport);
    await screen.findByRole('button', { name: 'Preview sync' });
  });

  it('is disabled when told to be (no Steam found)', () => {
    installApi();
    renderPanel({ disabled: true });
    expect((screen.getByRole('button', { name: 'Preview sync' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
