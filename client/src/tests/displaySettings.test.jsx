import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import DisplaySettings from '../components/DisplaySettings';
import { applyDisplay, currentDisplay, normalizeDisplay, STORAGE_KEY } from '../lib/displayPrefs';

const root = document.documentElement;

function mockSave(response) {
  const fetchMock = vi.fn((_url, opts) => {
    const change = JSON.parse(opts.body);
    const body = typeof response === 'function' ? response(change) : response;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  applyDisplay({});
  localStorage.clear();
});

describe('lib/displayPrefs', () => {
  test('the defaults leave <html> untouched', () => {
    applyDisplay({ textSize: 'standard', theme: 'standard', motion: 'standard' });
    expect(root.hasAttribute('data-text-size')).toBe(false);
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(root.hasAttribute('data-motion')).toBe(false);
  });

  test('sets the attributes and remembers them on this device', () => {
    applyDisplay({ textSize: 'large', theme: 'dark', motion: 'reduce' });
    expect(root.getAttribute('data-text-size')).toBe('large');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-motion')).toBe('reduce');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).theme).toBe('dark');
    expect(currentDisplay()).toEqual({ textSize: 'large', theme: 'dark', motion: 'reduce' });
  });

  test('ignores values it does not know', () => {
    expect(normalizeDisplay({ theme: 'neon', textSize: 'largest' }))
      .toEqual({ textSize: 'largest', theme: 'standard', motion: 'standard' });
  });
});

describe('DisplaySettings', () => {
  test('starts on Standard for everything', () => {
    render(<DisplaySettings />);
    for (const radio of screen.getAllByRole('radio', { checked: true })) {
      expect(radio.value).toBe('standard');
    }
  });

  test('a choice applies at once and is saved to the account', async () => {
    const fetchMock = mockSave(change => ({ success: true, display: { textSize: 'standard', theme: 'standard', motion: 'standard', ...change } }));
    render(<DisplaySettings />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/profile/display', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: 'dark' }) }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  test('puts the look back when saving fails', async () => {
    mockSave({ success: false, error: 'Server is down' });
    render(<DisplaySettings />);
    fireEvent.click(screen.getByRole('radio', { name: 'Largest' }));
    expect(await screen.findByText('Server is down')).toBeInTheDocument();
    await waitFor(() => expect(root.hasAttribute('data-text-size')).toBe(false));
    expect(screen.getAllByRole('radio', { checked: true }).map(r => r.value))
      .toEqual(['standard', 'standard', 'standard']);
  });
});
