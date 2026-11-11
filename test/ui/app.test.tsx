// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/UI/App.js';
import { gamesReport, installApi, okStatus } from './mockApi.js';

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
});
