// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSection } from '../../../src/UI/settings/SyncSection.js';
import type { Settings } from '../../../src/ipc.js';
import { settings } from '../mockApi.js';

afterEach(cleanup);

const withSync = (sync: Partial<Settings['sync']>): Settings => ({ ...settings, sync: { ...settings.sync, ...sync } });
const setup = (s = settings, update = vi.fn(async () => undefined)) => {
  render(<SyncSection settings={s} update={update} />);
  return update;
};
const sw = (name: string) => screen.getByRole('switch', { name }) as HTMLInputElement;

describe('SyncSection', () => {
  it('renders from settings', () => {
    setup(withSync({ mode: 'apply', prune: true, includeMaybe: true, autoApply: true }));
    expect(screen.getByRole('heading', { name: 'Sync defaults' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Apply' }).getAttribute('aria-checked')).toBe('true');
    expect(sw('Remove shortcuts for games that are gone').checked).toBe(true);
    expect(sw('List weak guesses (Unity/Unreal installs)').checked).toBe(true);
    expect(sw('Apply to Steam as soon as I tick or untick a game').checked).toBe(true);
    expect(screen.getByText('Changes reach Steam immediately, so Steam must be closed.')).toBeTruthy();
  });

  it('saves each change', async () => {
    const update = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Apply' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ sync: { mode: 'apply' } }));
    fireEvent.click(sw('Remove shortcuts for games that are gone'));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ sync: { prune: true } }));
    fireEvent.click(sw('List weak guesses (Unity/Unreal installs)'));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ sync: { includeMaybe: true } }));
    fireEvent.click(sw('Apply to Steam as soon as I tick or untick a game'));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ sync: { autoApply: true } }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failed save and clears it on the next try', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
    setup(settings, update);
    fireEvent.click(sw('Remove shortcuts for games that are gone'));
    expect((await screen.findByRole('alert')).textContent).toBe('Disk full');
    fireEvent.click(sw('Remove shortcuts for games that are gone'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
