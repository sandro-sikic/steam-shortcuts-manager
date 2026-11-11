// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutSection } from '../../../src/UI/settings/AboutSection.js';
import { about, installApi } from '../mockApi.js';

afterEach(cleanup);

describe('AboutSection', () => {
  it('shows loading, then the details', async () => {
    installApi();
    render(<AboutSection onReset={vi.fn()} />);
    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(await screen.findByText('1.2.3')).toBeTruthy();
    expect(screen.getByText(about.configFile)).toBeTruthy();
    expect(screen.getByText(about.artworkCache)).toBeTruthy();
    expect(screen.getByText('Artwork cache')).toBeTruthy();
    expect(screen.getByText(about.steamRoot as string)).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('shows missing Steam folder and unavailable storage', async () => {
    installApi({ about: vi.fn(async () => ({ ...about, steamRoot: undefined, secureStorage: false })) });
    render(<AboutSection onReset={vi.fn()} />);
    expect(await screen.findByText('Not found')).toBeTruthy();
    expect(screen.getByText('Not available')).toBeTruthy();
  });

  it('shows a load failure', async () => {
    installApi({ about: vi.fn(async () => { throw new Error('no info'); }) });
    render(<AboutSection onReset={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('no info');
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('opens the config folder and reports failure', async () => {
    const open = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('cannot open'));
    installApi({ openConfigFolder: open });
    render(<AboutSection onReset={vi.fn()} />);
    await screen.findByText('1.2.3');
    fireEvent.click(screen.getByRole('button', { name: 'Open config folder' }));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open config folder' }));
    expect((await screen.findByRole('alert')).textContent).toBe('cannot open');
  });

  it('confirms before resetting, then reports success', async () => {
    installApi();
    const onReset = vi.fn(async () => undefined);
    render(<AboutSection onReset={onReset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset settings' }));
    expect(screen.getByText('Reset every setting to its default? Your game choices are kept.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect((await screen.findByRole('status')).textContent).toBe('Settings reset.');
    expect(onReset).toHaveBeenCalled();
    expect(screen.queryByText(/Reset every setting/)).toBeNull();
  });

  it('cancels the confirmation', () => {
    installApi();
    const onReset = vi.fn();
    render(<AboutSection onReset={onReset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Reset every setting/)).toBeNull();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('shows a reset failure and keeps the confirmation', async () => {
    installApi();
    render(<AboutSection onReset={vi.fn(async () => { throw new Error('reset failed'); })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect((await screen.findByRole('alert')).textContent).toBe('reset failed');
    expect(screen.getByText(/Reset every setting/)).toBeTruthy();
  });
});
