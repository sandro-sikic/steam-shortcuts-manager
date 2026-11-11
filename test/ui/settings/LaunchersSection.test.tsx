// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchersSection } from '../../../src/UI/settings/LaunchersSection.js';
import type { IntegrationInfo, Settings } from '../../../src/ipc.js';
import { integrations, settings } from '../mockApi.js';

afterEach(cleanup);

const withDisabled = (disabled: string[]): Settings => ({ ...settings, launchers: { disabled } });
const setup = (s = settings, list: IntegrationInfo[] = integrations, update = vi.fn(async () => undefined)) => {
  render(<LaunchersSection settings={s} update={update} integrations={list} />);
  return update;
};
const sw = (name: string) => screen.getByRole('switch', { name }) as HTMLInputElement;

describe('LaunchersSection', () => {
  it('shows a switch per launcher driven by the disabled list', () => {
    setup(withDisabled(['gog']), integrations.map((i) => ({ ...i, enabled: true })));
    expect(sw('Epic Games').checked).toBe(true);
    expect(sw('GOG Galaxy').checked).toBe(false);
    expect(screen.getByText('Launchers that are turned off are skipped when scanning for games.')).toBeTruthy();
    expect(screen.queryByText('No launchers on this platform.')).toBeNull();
  });

  it('turns a launcher off and on', async () => {
    const update = setup(withDisabled(['gog']));
    fireEvent.click(sw('Epic Games'));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ launchers: { disabled: ['gog', 'epic'] } }));
    fireEvent.click(sw('GOG Galaxy'));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ launchers: { disabled: [] } }));
  });

  it('says when there are no launchers', () => {
    setup(settings, []);
    expect(screen.getByText('No launchers on this platform.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows a failed save and clears it on the next try', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('Cannot save')).mockResolvedValue(undefined);
    setup(settings, integrations, update);
    fireEvent.click(sw('Epic Games'));
    expect((await screen.findByRole('alert')).textContent).toBe('Cannot save');
    fireEvent.click(sw('Epic Games'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
