// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SteamSection } from '../../../src/UI/settings/SteamSection.js';
import type { Settings } from '../../../src/ipc.js';
import { accounts, installApi, settings } from '../mockApi.js';

afterEach(cleanup);

const withSteam = (steam: Partial<Settings['steam']>): Settings => ({ ...settings, steam: { ...settings.steam, ...steam } });
const setup = (s: Settings = settings, update = vi.fn(async () => undefined), api = {}) => {
  installApi(api);
  const view = render(<SteamSection settings={s} update={update} />);
  return { update, view };
};
const folder = () => screen.getByLabelText('Steam folder') as HTMLInputElement;

describe('SteamSection', () => {
  it('renders defaults', async () => {
    setup();
    expect(folder().value).toBe('');
    expect(folder().placeholder).toBe('Detected automatically');
    expect(screen.queryByText('Use auto-detect')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await screen.findByText('player_one (42)');
    expect(screen.getByText('Account 7 (7)')).toBeTruthy();
    expect(screen.getByText('Most recent user')).toBeTruthy();
  });

  it('saves the folder on blur only when it changed', async () => {
    const { update } = setup();
    fireEvent.blur(folder());
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(folder(), { target: { value: '/games/steam' } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.blur(folder());
    await waitFor(() => expect(update).toHaveBeenCalledWith({ steam: { dir: '/games/steam' } }));
  });

  it('saves the folder on Enter and ignores other keys', async () => {
    const { update } = setup();
    fireEvent.change(folder(), { target: { value: '/x' } });
    fireEvent.keyDown(folder(), { key: 'a' });
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(folder(), { key: 'Enter' });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ steam: { dir: '/x' } }));
  });

  it('reverts the draft and shows the error when saving the folder fails', async () => {
    const { update } = setup(settings, vi.fn(async () => Promise.reject(new Error('Bad folder'))));
    fireEvent.change(folder(), { target: { value: '/x' } });
    fireEvent.blur(folder());
    expect((await screen.findByRole('alert')).textContent).toBe('Bad folder');
    expect(update).toHaveBeenCalled();
    expect(folder().value).toBe('');
  });

  it('offers auto-detect when a folder is set and keeps the draft in sync', async () => {
    const { update, view } = setup(withSteam({ dir: '/a' }));
    expect(folder().value).toBe('/a');
    view.rerender(<SteamSection settings={withSteam({ dir: '/b' })} update={update} />);
    expect(folder().value).toBe('/b');
    fireEvent.click(screen.getByText('Use auto-detect'));
    expect(folder().value).toBe('');
    await waitFor(() => expect(update).toHaveBeenCalledWith({ steam: { dir: '' } }));
  });

  it('changes the account', async () => {
    const { update } = setup();
    await screen.findByText('player_one (42)');
    fireEvent.change(screen.getByLabelText('Steam account'), { target: { value: '7' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ steam: { user: '7' } }));
  });

  it('keeps an account that is not in the list', async () => {
    setup(withSteam({ user: '99' }));
    await screen.findByText('player_one (42)');
    expect((screen.getByLabelText('Steam account') as HTMLSelectElement).value).toBe('99');
    expect(screen.getByText('Account 99 (not found)')).toBeTruthy();
  });

  it('does not add a missing option for a listed account', async () => {
    setup(withSteam({ user: '42' }));
    await screen.findByText('player_one (42)');
    expect(screen.queryByText(/not found/)).toBeNull();
  });

  it('toggles allow running and warns while on', async () => {
    const { update } = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'Allow changes while Steam is running' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ steam: { allowRunning: true } }));
    cleanup();
    setup(withSteam({ allowRunning: true }));
    expect(screen.getByRole('status').textContent).toContain('Steam rewrites its files');
  });

  it('shows errors from loading accounts and from saving', async () => {
    setup(settings, vi.fn(async () => Promise.reject(new Error('Nope'))), { steamAccounts: vi.fn(async () => Promise.reject(new Error("Error invoking remote method 'x': Error: No Steam"))) });
    expect((await screen.findByRole('alert')).textContent).toBe('No Steam');
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Nope'));
  });

  it('ignores results that arrive after unmount', async () => {
    let resolve!: (v: typeof accounts) => void;
    let reject!: (e: Error) => void;
    const a = new Promise<typeof accounts>((r) => (resolve = r));
    installApi({ steamAccounts: vi.fn(() => a) });
    const one = render(<SteamSection settings={settings} update={vi.fn()} />);
    one.unmount();
    resolve(accounts);
    const b = new Promise<typeof accounts>((_, r) => (reject = r));
    installApi({ steamAccounts: vi.fn(() => b) });
    const two = render(<SteamSection settings={settings} update={vi.fn()} />);
    two.unmount();
    reject(new Error('late'));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
