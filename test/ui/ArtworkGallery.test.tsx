// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ArtworkGallery } from '../../src/UI/ArtworkGallery.js';
import { artworkEntry, choice, option } from './mockApi.js';

afterEach(cleanup);

describe('ArtworkGallery', () => {
  it('renders groups in order with summaries', () => {
    render(<ArtworkGallery entry={artworkEntry(5)} loading={false} onPick={vi.fn()} />);
    const names = screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'));
    expect(names).toEqual(['Hero', 'Poster', 'Wide capsule', 'Logo', 'Icon']);
    const poster = screen.getByRole('region', { name: 'Poster' });
    expect(within(poster).getByText('Option 1 of 5')).toBeTruthy();
    expect(within(poster).getAllByText('600 × 900').length).toBeGreaterThan(0);
    const group = within(poster).getByRole('radiogroup', { name: 'Poster image' });
    expect(within(group).getAllByRole('radio')).toHaveLength(6);
    expect(within(group).getByRole('radio', { name: 'No poster image' }).getAttribute('aria-checked')).toBe('false');
    const first = within(group).getAllByRole('radio')[0] as HTMLElement;
    expect(first.className).toContain('selected');
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(first.tabIndex).toBe(0);
    expect((within(group).getAllByRole('radio')[1] as HTMLElement).tabIndex).toBe(-1);
    expect(screen.getByAltText(/Poster option 2, /)).toBeTruthy();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5);
  });

  it('shows the hero preview with full image and falls back to the thumbnail', () => {
    const { rerender } = render(<ArtworkGallery entry={artworkEntry(2)} loading={false} onPick={vi.fn()} />);
    expect((screen.getByAltText('Hero preview') as HTMLImageElement).src).toContain('full-hero-100');
    const entry = artworkEntry(2, { choices: { hero: { options: [option('hero', 1, { fullUrl: undefined })], selected: 1 } } });
    rerender(<ArtworkGallery entry={entry} loading={false} onPick={vi.fn()} />);
    expect((screen.getByAltText('Hero preview') as HTMLImageElement).src).toContain('thumb-hero-1');
  });

  it('handles hero placeholders', () => {
    const { rerender } = render(<ArtworkGallery entry={artworkEntry(2, { choices: { hero: choice('hero', 2, null) } })} loading={false} onPick={vi.fn()} />);
    expect(screen.getByText('No hero image will be added to Steam.')).toBeTruthy();
    expect(screen.getAllByText('None').length).toBe(2);
    rerender(<ArtworkGallery entry={artworkEntry(2, { choices: { hero: { ...choice('hero', 2), selected: undefined } } })} loading={false} onPick={vi.fn()} />);
    expect(screen.getByText('Not downloaded')).toBeTruthy();
    const noUrls = { options: [option('hero', 1, { fullUrl: undefined, thumbUrl: undefined })], selected: 1 };
    rerender(<ArtworkGallery entry={artworkEntry(2, { choices: { hero: noUrls } })} loading={false} onPick={vi.fn()} />);
    expect(screen.getByText('Not downloaded')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
    // unknown selected id: no summary, first option tabbable
    rerender(<ArtworkGallery entry={artworkEntry(2, { choices: { hero: choice('hero', 2, 999) } })} loading={false} onPick={vi.fn()} />);
    expect(within(screen.getByRole('region', { name: 'Hero' })).queryByText(/Option \d/)).toBeNull();
    expect((within(screen.getByRole('radiogroup', { name: 'Hero image' })).getAllByRole('radio')[0] as HTMLElement).tabIndex).toBe(0);
  });

  it('shows captions with style, adult chip and size, and image fallback to fullUrl', () => {
    const choices = {
      poster: { options: [option('poster', 1, { nsfw: true }), option('poster', 2, { thumbUrl: undefined, width: 0, height: 0 })], selected: 1 },
    };
    render(<ArtworkGallery entry={artworkEntry(1, { choices })} loading={false} onPick={vi.fn()} />);
    const poster = screen.getByRole('region', { name: 'Poster' });
    expect(within(poster).getByText('Adult')).toBeTruthy();
    expect(within(poster).getAllByText('600 × 900').length).toBe(2);
    expect((within(poster).getByAltText(/option 2/) as HTMLImageElement).src).toContain('full-poster-2');
  });

  it('picks on click except the selected option', () => {
    const onPick = vi.fn();
    render(<ArtworkGallery entry={artworkEntry(3)} loading={false} onPick={onPick} />);
    const group = screen.getByRole('radiogroup', { name: 'Logo image' });
    const radios = within(group).getAllByRole('radio');
    fireEvent.click(radios[0] as HTMLElement);
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(radios[2] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith('logo', 102);
    fireEvent.click(radios[3] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith('logo', null);
  });

  it('does not call onPick when None is already selected', () => {
    const onPick = vi.fn();
    render(<ArtworkGallery entry={artworkEntry(2, { choices: { icon: choice('icon', 2, null) } })} loading={false} onPick={onPick} />);
    const none = screen.getByRole('radio', { name: 'No icon image' });
    expect(none.getAttribute('aria-checked')).toBe('true');
    expect(none.tabIndex).toBe(0);
    fireEvent.click(none);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('supports arrow keys with wrapping and focus', () => {
    const onPick = vi.fn();
    render(<ArtworkGallery entry={artworkEntry(2)} loading={false} onPick={onPick} />);
    const radios = within(screen.getByRole('radiogroup', { name: 'Wide capsule image' })).getAllByRole('radio');
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowRight' });
    expect(onPick).toHaveBeenLastCalledWith('wide', 101);
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowDown' });
    expect(onPick).toHaveBeenLastCalledWith('wide', 101);
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(onPick).toHaveBeenLastCalledWith('wide', null);
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(radios[2] as HTMLElement, { key: 'ArrowUp' });
    expect(onPick).toHaveBeenLastCalledWith('wide', 101);
    fireEvent.keyDown(radios[2] as HTMLElement, { key: 'ArrowRight' });
    expect(onPick).toHaveBeenCalledTimes(4);
    expect(document.activeElement).toBe(radios[0]);
    const calls = onPick.mock.calls.length;
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'a' });
    expect(onPick.mock.calls.length).toBe(calls);
  });

  it('shows states for missing, loading and empty lists', () => {
    const { rerender } = render(<ArtworkGallery loading={false} onPick={vi.fn()} />);
    expect(screen.getAllByText('Options load when the game page opens.')).toHaveLength(5);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    rerender(<ArtworkGallery loading onPick={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Fetching options…');
    expect(document.querySelectorAll('.skeleton[aria-hidden="true"]')).toHaveLength(15);
    rerender(<ArtworkGallery entry={artworkEntry(1, { choices: { logo: { options: [], selected: undefined } } })} loading={false} onPick={vi.fn()} />);
    expect(screen.getByText('SteamGridDB has no logo for this game.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Logo' })).queryByText(/Option|None/)).toBeNull();
  });

  it('marks the picking group busy with a spinner on the selection', () => {
    const { rerender, container } = render(<ArtworkGallery entry={artworkEntry(2)} loading={false} picking="poster" onPick={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Poster' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('region', { name: 'Icon' }).getAttribute('aria-busy')).toBeNull();
    expect(container.querySelectorAll('.gallery-spinner')).toHaveLength(1);
    rerender(<ArtworkGallery entry={artworkEntry(2, { choices: { poster: choice('poster', 2, null) } })} loading={false} picking="poster" onPick={vi.fn()} />);
    expect(container.querySelectorAll('.gallery-spinner')).toHaveLength(1);
    expect(within(screen.getByRole('radio', { name: 'No poster image' })).queryByText('None')).toBeTruthy();
  });
});
