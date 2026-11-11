// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibrarySection } from '../../../src/UI/settings/LibrarySection.js';
import { games, installApi, lists } from '../mockApi.js';

afterEach(cleanup);

describe('LibrarySection', () => {
  it('shows loading, then switched-off games with titles or raw keys', async () => {
    installApi();
    render(<LibrarySection games={games.filter((g) => g.id !== 'rl')} onChanged={() => undefined} />);
    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(await screen.findByText('Hades')).toBeTruthy();
    expect(screen.getByText('Epic Games:rl')).toBeTruthy();
    expect(screen.getByText('Some Game')).toBeTruthy();
  });

  it('shows an error when loading fails', async () => {
    installApi({ lists: vi.fn(async () => { throw new Error('boom'); }) });
    render(<LibrarySection games={games} onChanged={() => undefined} />);
    expect((await screen.findByRole('alert')).textContent).toBe('boom');
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('turns one game or all games back on', async () => {
    const onChanged = vi.fn();
    const mock = installApi();
    render(<LibrarySection games={games} onChanged={onChanged} />);
    await screen.findByText('Hades');
    fireEvent.click(screen.getAllByRole('button', { name: 'Turn on' })[0]!);
    await waitFor(() => expect(mock.setLists).toHaveBeenCalledWith({ exclude: ['GOG Galaxy:hades'] }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Epic Games:rl')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Turn all back on' }));
    await waitFor(() => expect(mock.setLists).toHaveBeenCalledWith({ exclude: [] }));
    expect(await screen.findByText('No games are switched off.')).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('keeps state and shows an error when turning on fails', async () => {
    const onChanged = vi.fn();
    installApi({ setLists: vi.fn(async () => { throw new Error('no'); }) });
    render(<LibrarySection games={games} onChanged={onChanged} />);
    await screen.findByText('Hades');
    fireEvent.click(screen.getAllByRole('button', { name: 'Turn on' })[0]!);
    expect((await screen.findByRole('alert')).textContent).toBe('no');
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText('Hades')).toBeTruthy();
  });

  it('adds and removes list entries', async () => {
    const onChanged = vi.fn();
    const mock = installApi();
    render(<LibrarySection games={games} onChanged={onChanged} />);
    await screen.findByText('Some Game');
    const input = screen.getByLabelText('Add to Always treat as games');
    fireEvent.change(input, { target: { value: '  Newer  ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    await waitFor(() => expect(mock.setLists).toHaveBeenCalledWith({ allow: ['Some Game', 'Newer'] }));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));

    const deny = screen.getByLabelText('Add to Never treat as games');
    fireEvent.change(deny, { target: { value: 'Tool 2' } });
    fireEvent.keyDown(deny, { key: 'Enter' });
    await waitFor(() => expect(mock.setLists).toHaveBeenCalledWith({ deny: ['Some Tool', 'Tool 2'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Some Tool' }));
    await waitFor(() => expect(mock.setLists).toHaveBeenCalledWith({ deny: ['Tool 2'] }));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('ignores empty, duplicate and other keys', async () => {
    const mock = installApi();
    render(<LibrarySection games={games} onChanged={() => undefined} />);
    await screen.findByText('Some Game');
    const input = screen.getByLabelText('Add to Always treat as games');
    fireEvent.keyDown(input, { key: 'a' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    fireEvent.change(input, { target: { value: 'some game' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    expect(mock.setLists).not.toHaveBeenCalled();
  });

  it('keeps the draft when adding fails', async () => {
    installApi({ setLists: vi.fn(async () => { throw new Error('bad'); }) });
    render(<LibrarySection games={games} onChanged={() => undefined} />);
    await screen.findByText('Some Game');
    const input = screen.getByLabelText('Add to Always treat as games') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    expect((await screen.findByRole('alert')).textContent).toBe('bad');
    expect(input.value).toBe('X');
    expect(lists.allow).toEqual(['Some Game']);
  });
});
