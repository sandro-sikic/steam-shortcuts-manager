// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppearanceSection } from '../../../src/UI/settings/AppearanceSection.js';
import { settings } from '../mockApi.js';

afterEach(cleanup);

describe('AppearanceSection', () => {
  it('shows the current values and saves changes', async () => {
    const update = vi.fn(async () => undefined);
    render(<AppearanceSection settings={settings} update={update} />);
    expect(screen.getByText("System follows your computer's light or dark setting.")).toBeTruthy();
    expect(screen.getByText('How big the game cards are in the library.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ui: { theme: 'dark' } }));
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ui: { cardSize: 'large' } }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failed save, and clears it on the next try', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error("Error invoking remote method 'x': Error: nope")).mockResolvedValueOnce(undefined);
    render(<AppearanceSection settings={settings} update={update} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
