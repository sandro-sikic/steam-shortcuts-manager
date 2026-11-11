// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtworkSection } from '../../../src/UI/settings/ArtworkSection.js';
import type { SettingsPatch } from '../../../src/ipc.js';
import { settings as base } from '../mockApi.js';
import { installApi, keyStatus } from '../mockApi.js';

afterEach(cleanup);

const withKinds = (kinds: string[], artwork = true) => {
  const s = structuredClone(base);
  (s.artwork as { kinds: string[] }).kinds = kinds;
  s.sync.artwork = artwork;
  return s;
};

const setup = async (opts: { status?: Partial<typeof keyStatus>; update?: (patch: SettingsPatch) => Promise<void>; settings?: typeof base; api?: Parameters<typeof installApi>[0] } = {}) => {
  const mock = installApi({ apiKeyStatus: vi.fn(async () => ({ ...keyStatus, ...opts.status })), ...opts.api });
  const update = opts.update ?? vi.fn(async (_patch: SettingsPatch) => undefined);
  render(<ArtworkSection settings={opts.settings ?? withKinds(['poster', 'hero'])} update={update} />);
  await waitFor(() => expect(mock.apiKeyStatus).toHaveBeenCalled());
  await act0();
  return { mock, update };
};
const act0 = () => new Promise((r) => setTimeout(r, 0));
const keyInput = () => screen.getByLabelText('SteamGridDB API key') as HTMLInputElement;

describe('ArtworkSection key', () => {
  it('shows the none status with a link, and Save is disabled while empty; no Remove', async () => {
    await setup();
    expect(screen.getByText(/No key set/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get a key' }).getAttribute('href')).toContain('steamgriddb.com');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('shows the environment status', async () => {
    await setup({ status: { source: 'environment', set: true } });
    expect(screen.getByText('Using the STEAMGRIDDB_API_KEY environment variable.')).toBeTruthy();
  });

  it('saves a key, clears the input and refreshes', async () => {
    const { mock } = await setup();
    fireEvent.change(keyInput(), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('status')).textContent).toBe('Saved.');
    expect(mock.setApiKey).toHaveBeenCalledWith('abc');
    expect(keyInput().value).toBe('');
    expect(mock.apiKeyStatus).toHaveBeenCalledTimes(2);
  });

  it('shows a saved key and removes it', async () => {
    const { mock } = await setup({ status: { source: 'saved', set: true } });
    expect(screen.getByText('A key is saved in this app.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect((await screen.findByRole('status')).textContent).toBe('Key removed.');
    expect(mock.setApiKey).toHaveBeenCalledWith('');
  });

  it('tests the typed key (trimmed) and shows success', async () => {
    const { mock } = await setup();
    fireEvent.change(keyInput(), { target: { value: ' k ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect((await screen.findByRole('status')).textContent).toBe('The key works.');
    expect(mock.testApiKey).toHaveBeenCalledWith('k');
  });

  it('tests the stored key when the input is empty and shows a failed test as an error', async () => {
    const { mock } = await setup({ api: { testApiKey: vi.fn(async () => ({ ok: false, message: 'Bad key.' })) } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Bad key.');
    expect(mock.testApiKey).toHaveBeenCalledWith(undefined);
  });

  it('shows api failures', async () => {
    await setup({ api: { setApiKey: vi.fn(async () => { throw new Error("Error invoking remote method 'x': Error: nope"); }) } });
    fireEvent.change(keyInput(), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
  });

  it('shows a failure to load the status', async () => {
    installApi({ apiKeyStatus: vi.fn(async () => { throw new Error('down'); }) });
    render(<ArtworkSection settings={withKinds([])} update={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('down');
  });

  it('warns without secure storage and disables Save only', async () => {
    await setup({ status: { secureStorage: false } });
    expect(screen.getByRole('status').textContent).toContain('Secure storage is not available');
    fireEvent.change(keyInput(), { target: { value: 'abc' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ArtworkSection images', () => {
  it('reflects the chosen kinds and adds one in canonical order', async () => {
    const { update } = await setup();
    expect((screen.getByLabelText('Poster') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Logo') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText('Wide capsule'));
    expect(update).toHaveBeenCalledWith({ artwork: { kinds: ['poster', 'wide', 'hero'] } });
  });

  it('removes a kind and shows help when none remain', async () => {
    const { update } = await setup({ settings: withKinds(['icon']) });
    fireEvent.click(screen.getByLabelText('Icon'));
    expect(update).toHaveBeenCalledWith({ artwork: { kinds: [] } });
    cleanup();
    render(<ArtworkSection settings={withKinds([])} update={vi.fn()} />);
    expect(screen.getByText('No images will be copied into Steam.')).toBeTruthy();
  });

  it('shows a failed kinds save', async () => {
    await setup({ update: vi.fn(async () => { throw new Error('kinds failed'); }) });
    fireEvent.click(screen.getByLabelText('Logo'));
    expect((await screen.findByRole('alert')).textContent).toBe('kinds failed');
  });

  it('toggles syncing artwork and shows a failure', async () => {
    const update = vi.fn(async (_patch: SettingsPatch) => undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("sync failed"));
    await setup({ update });
    const sw = screen.getByRole('switch', { name: 'Copy artwork into Steam when syncing' });
    fireEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ sync: { artwork: false } });
    fireEvent.click(sw);
    expect((await screen.findByRole('alert')).textContent).toBe('sync failed');
  });

  it('toggles the automatic download of artwork and shows a failure', async () => {
    const update = vi.fn(async (_patch: SettingsPatch) => undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('auto failed'));
    await setup({ update });
    const sw = screen.getByRole('switch', { name: 'Download artwork for my games automatically' }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect(screen.getByText(/downloads the images of every game it finds into its own cache/)).toBeTruthy();
    fireEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ artwork: { auto: false } });
    fireEvent.click(sw);
    expect((await screen.findByRole('alert')).textContent).toBe('auto failed');
  });
});

describe('ArtworkSection options and adult images', () => {
  const withArt = (over: { options?: number; nsfw?: boolean }) => {
    const s = withKinds(['poster']);
    Object.assign(s.artwork, over);
    return s;
  };
  const optionsInput = () => screen.getByLabelText('Options per image type') as HTMLInputElement;
  const type = (value: string) => fireEvent.change(optionsInput(), { target: { value } });

  it('shows the saved value and its help', async () => {
    await setup({ settings: withArt({ options: 7 }) });
    expect(optionsInput().value).toBe('7');
    expect(optionsInput().min).toBe('1');
    expect(optionsInput().max).toBe('20');
    expect(screen.getByText(/How many SteamGridDB images to offer/)).toBeTruthy();
  });

  it('commits a valid draft on blur', async () => {
    const { update } = await setup({ settings: withArt({ options: 5 }) });
    type('12');
    expect(update).not.toHaveBeenCalled();
    fireEvent.blur(optionsInput());
    expect(update).toHaveBeenCalledWith({ artwork: { options: 12 } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('commits a valid draft on Enter and ignores other keys', async () => {
    const { update } = await setup({ settings: withArt({ options: 5 }) });
    type('3');
    fireEvent.keyDown(optionsInput(), { key: 'a' });
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(optionsInput(), { key: 'Enter' });
    expect(update).toHaveBeenCalledWith({ artwork: { options: 3 } });
  });

  it('does not save an unchanged draft', async () => {
    const { update } = await setup({ settings: withArt({ options: 5 }) });
    type('5');
    fireEvent.blur(optionsInput());
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['', '0', '21', '3.5', 'abc'])('rejects the draft %j and resets it on blur', async (value) => {
    const { update } = await setup({ settings: withArt({ options: 5 }) });
    type(value);
    fireEvent.keyDown(optionsInput(), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a whole number from 1 to 20.');
    fireEvent.blur(optionsInput());
    expect(optionsInput().value).toBe('5');
    expect(update).not.toHaveBeenCalled();
  });

  it('clears the error when typing again', async () => {
    await setup({ settings: withArt({ options: 5 }) });
    type('99');
    fireEvent.keyDown(optionsInput(), { key: 'Enter' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    type('4');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('follows a change of the saved value from outside', async () => {
    const update = vi.fn(async (_patch: SettingsPatch) => undefined);
    installApi();
    const { rerender } = render(<ArtworkSection settings={withArt({ options: 5 })} update={update} />);
    type('99');
    fireEvent.keyDown(optionsInput(), { key: 'Enter' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    rerender(<ArtworkSection settings={withArt({ options: 9 })} update={update} />);
    expect(optionsInput().value).toBe('9');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failed options save', async () => {
    await setup({ settings: withArt({ options: 5 }), update: vi.fn(async () => { throw new Error('options failed'); }) });
    type('6');
    fireEvent.blur(optionsInput());
    expect((await screen.findByRole('alert')).textContent).toBe('options failed');
  });

  it('toggles adult artwork and shows a failure', async () => {
    const update = vi.fn(async (_patch: SettingsPatch) => undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('nsfw failed'));
    await setup({ update, settings: withArt({ nsfw: false }) });
    const sw = screen.getByRole('switch', { name: 'Show adult (NSFW) artwork' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(screen.getByText(/asked to leave adult images out/)).toBeTruthy();
    fireEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ artwork: { nsfw: true } });
    fireEvent.click(sw);
    expect((await screen.findByRole('alert')).textContent).toBe('nsfw failed');
  });
});
