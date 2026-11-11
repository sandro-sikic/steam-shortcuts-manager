// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/UI/App.js';
import { installApi, okStatus } from './mockApi.js';

afterEach(cleanup);

describe('App', () => {
  it('loads and shows Steam status, the launchers and the shortcuts', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('/home/me/.steam/steam');
    expect(screen.getByText('Scans: Epic Games, GOG Galaxy')).toBeTruthy();
    expect(screen.getByText('Fortnite')).toBeTruthy();
    expect(mock.shortcuts).toHaveBeenCalledTimes(1);
  });

  it('does not read shortcuts when Steam cannot be found, and disables syncing', async () => {
    const mock = installApi({ status: vi.fn(async () => ({ platform: 'linux', steamRunning: false, error: 'Steam installation not found' })) });
    render(<App />);
    await screen.findByText('Steam installation not found');
    expect(mock.shortcuts).not.toHaveBeenCalled();
    expect(screen.getByText('No shortcuts yet.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Preview sync' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an error when loading fails', async () => {
    installApi({ status: vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: no bridge"); }) });
    render(<App />);
    await screen.findByText('no bridge');
    expect((screen.getByRole('button', { name: 'Preview sync' }) as HTMLButtonElement).disabled).toBe(true);
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

  it('reloads the shortcuts after a real sync', async () => {
    const mock = installApi();
    render(<App />);
    await screen.findByText('Fortnite');
    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(mock.shortcuts).toHaveBeenCalledTimes(2));
    expect(mock.sync).toHaveBeenCalledTimes(1);
  });
});
