// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../../src/UI/SettingsPage.js';
import { DEFAULT_SETTINGS } from '../../src/settingsModel.js';
import { gamesReport, installApi, integrations } from './mockApi.js';

afterEach(cleanup);

function renderPage(props: Partial<Parameters<typeof SettingsPage>[0]> = {}) {
  const callbacks = { update: vi.fn(async () => undefined), reset: vi.fn(async () => undefined), onLibraryChanged: vi.fn(), onBack: vi.fn() };
  render(<SettingsPage settings={DEFAULT_SETTINGS} integrations={integrations} games={gamesReport.games} {...callbacks} {...props} />);
  return callbacks;
}

const nav = (name: string) => within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name });

describe('SettingsPage', () => {
  it('lists the sections and starts with Artwork', () => {
    installApi();
    renderPage();
    const navigation = screen.getByRole('navigation', { name: 'Settings sections' });
    expect([...navigation.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Artwork', 'Steam', 'Sync', 'Launchers', 'Library', 'Appearance', 'About']);
    expect(nav('Artwork').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('region', { name: 'Artwork' })).toBeTruthy();
  });

  it.each([
    ['Steam', 'Steam'],
    ['Sync', 'Sync defaults'],
    ['Launchers', 'Launchers'],
    ['Library', 'Library'],
    ['Appearance', 'Appearance'],
    ['About', 'About'],
    ['Artwork', 'Artwork'],
  ])('shows the %s section', (button, region) => {
    installApi();
    renderPage();
    fireEvent.click(nav(button));
    expect(screen.getByRole('region', { name: region })).toBeTruthy();
    expect(nav(button).getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('goes back to the library', () => {
    installApi();
    const { onBack } = renderPage();
    fireEvent.click(nav('Library'));
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Library', { selector: 'button.button' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('passes saving, resetting and library changes to the sections', async () => {
    installApi();
    const { update, reset } = renderPage();
    fireEvent.click(nav('Appearance'));
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(update).toHaveBeenCalledWith({ ui: { theme: 'dark' } });

    fireEvent.click(nav('About'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await screen.findByText('Settings reset.');
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
