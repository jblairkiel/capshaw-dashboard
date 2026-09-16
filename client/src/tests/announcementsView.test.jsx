import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import AnnouncementsView from '../components/AnnouncementsView';

const ADMIN  = { id: 1, role: 'admin' };
const MEMBER = { id: 2, role: 'approved' };

const announcement = over => ({
  id: 1, type: 'announcement', title: 'Potluck Sunday', body: 'Bring a dish.',
  event_date: null, event_time: null, location: null, priority: 'normal', active: 1, ...over,
});

function mockApi(items) {
  const fetchMock = vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'DELETE')         return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    if (url.endsWith('/toggle'))     return Promise.resolve({ json: () => Promise.resolve({ success: true, active: 0 }) });
    if (method === 'POST')           return Promise.resolve({ json: () => Promise.resolve({ success: true, item: { id: 9, ...JSON.parse(opts.body) } }) });
    return Promise.resolve({ json: () => Promise.resolve({ success: true, items }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => { vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('AnnouncementsView — list', () => {
  test('shows how many are active out of the total', async () => {
    mockApi([announcement(), announcement({ id: 2, active: 0 })]);
    render(<AnnouncementsView user={MEMBER} />);
    expect(await screen.findByText('1 active · 2 total')).toBeInTheDocument();
  });

  test('inactive items are hidden until asked for', async () => {
    mockApi([announcement(), announcement({ id: 2, title: 'Old notice', active: 0 })]);
    render(<AnnouncementsView user={MEMBER} />);
    await screen.findByText('Potluck Sunday');
    expect(screen.queryByText('Old notice')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Show inactive/i));
    expect(await screen.findByText('Old notice')).toBeInTheDocument();
  });

  test('the type filter narrows the list', async () => {
    mockApi([announcement(), announcement({ id: 2, type: 'event', title: 'Gospel Meeting' })]);
    render(<AnnouncementsView user={MEMBER} />);
    await screen.findByText('Potluck Sunday');

    fireEvent.click(screen.getByRole('button', { name: 'Events' }));
    expect(screen.queryByText('Potluck Sunday')).not.toBeInTheDocument();
    expect(screen.getByText('Gospel Meeting')).toBeInTheDocument();
  });

  test('an empty result invites adding the first item', async () => {
    mockApi([]);
    render(<AnnouncementsView user={ADMIN} />);
    expect(await screen.findByText(/Click "\+ Add Item"/i)).toBeInTheDocument();
  });

  test('a filter that hides everything explains itself differently', async () => {
    mockApi([announcement()]);
    render(<AnnouncementsView user={MEMBER} />);
    await screen.findByText('Potluck Sunday');
    fireEvent.click(screen.getByRole('button', { name: 'Events' }));
    expect(await screen.findByText(/Try changing the filter/i)).toBeInTheDocument();
  });

  test('reports a list that failed to load', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<AnnouncementsView user={MEMBER} />);
    expect(await screen.findByText(/Could not load announcements/i)).toBeInTheDocument();
  });

  test('a member sees no write controls', async () => {
    mockApi([announcement()]);
    render(<AnnouncementsView user={MEMBER} />);
    await screen.findByText('Potluck Sunday');
    expect(screen.queryByRole('button', { name: /Add Item/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument();
  });

  test('fullscreen is disabled with nothing active to show', async () => {
    mockApi([announcement({ active: 0 })]);
    render(<AnnouncementsView user={MEMBER} />);
    await screen.findByText('0 active · 1 total');
    expect(screen.getByRole('button', { name: /Fullscreen Display/i })).toBeDisabled();
  });
});

describe('AnnouncementsView — admin editing', () => {
  test('adding an item opens a blank editor and creates it on save', async () => {
    const fetchMock = mockApi([]);
    render(<AnnouncementsView user={ADMIN} />);
    await screen.findByText(/Click "\+ Add Item"/i);

    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));
    expect(screen.getByText('New Item')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Vacation Bible School/i), { target: { value: 'Fall Festival' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/announcements', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Fall Festival')).toBeInTheDocument();
  });

  test('refuses to save with no title', async () => {
    mockApi([]);
    render(<AnnouncementsView user={ADMIN} />);
    await screen.findByText(/Click "\+ Add Item"/i);
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Title is required/i)).toBeInTheDocument();
  });

  test('switching to an event reveals its date, time and location fields', async () => {
    mockApi([]);
    render(<AnnouncementsView user={ADMIN} />);
    await screen.findByText(/Click "\+ Add Item"/i);
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));

    fireEvent.click(screen.getByText('📅 Event'));
    expect(screen.getByPlaceholderText('e.g. 8:00 AM')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Fellowship Hall')).toBeInTheDocument();
    // Priority is announcement-only
    expect(screen.queryByText('⚠️ Urgent')).not.toBeInTheDocument();
  });

  test('editing an existing item pre-fills the form', async () => {
    mockApi([announcement({ title: 'Potluck Sunday', body: 'Bring a dish.' })]);
    render(<AnnouncementsView user={ADMIN} />);
    await screen.findByText('Potluck Sunday');

    fireEvent.click(screen.getByTitle('Edit'));
    expect(screen.getByText('Edit Item')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Potluck Sunday')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bring a dish.')).toBeInTheDocument();
  });

  test('the editor can be dismissed without saving', async () => {
    mockApi([]);
    render(<AnnouncementsView user={ADMIN} />);
    await screen.findByText(/Click "\+ Add Item"/i);
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('New Item')).not.toBeInTheDocument();
  });

  test('toggling an item off flips it inactive, and it drops out of the default view', async () => {
    const fetchMock = mockApi([announcement()]);
    render(<AnnouncementsView user={ADMIN} />);
    await screen.findByText('Potluck Sunday');

    fireEvent.click(screen.getByTitle('Deactivate'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/announcements/1/toggle', expect.objectContaining({ method: 'PATCH' })
    ));
    // Inactive items are hidden unless "Show inactive" is on
    await waitFor(() => expect(screen.queryByText('Potluck Sunday')).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/Show inactive/i));
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '○ Off' })).toBeInTheDocument();
  });

  test('deleting asks first, then removes the item', async () => {
    const fetchMock = mockApi([announcement()]);
    render(<AnnouncementsView user={ADMIN} />);
    await screen.findByText('Potluck Sunday');

    fireEvent.click(screen.getByTitle('Delete'));
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/announcements/1', expect.objectContaining({ method: 'DELETE' })
    ));
    await waitFor(() => expect(screen.queryByText('Potluck Sunday')).not.toBeInTheDocument());
  });

  test('declining the delete prompt keeps the item', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockApi([announcement()]);
    render(<AnnouncementsView user={ADMIN} />);
    await screen.findByText('Potluck Sunday');
    fireEvent.click(screen.getByTitle('Delete'));
    expect(screen.getByText('Potluck Sunday')).toBeInTheDocument();
  });
});

describe('AnnouncementsView — fullscreen', () => {
  beforeEach(() => {
    Element.prototype.requestFullscreen = vi.fn(() => Promise.resolve());
  });
  afterEach(() => { delete Element.prototype.requestFullscreen; });

  test('opens and can be escaped back to the manage view', async () => {
    mockApi([announcement()]);
    render(<AnnouncementsView user={MEMBER} />);
    await screen.findByText('Potluck Sunday');

    fireEvent.click(screen.getByRole('button', { name: /Fullscreen Display/i }));
    expect(screen.getByText('Capshaw Church of Christ')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText('Announcements & Events')).toBeInTheDocument();
  });

  test('only active items are shown in the slideshow', async () => {
    mockApi([announcement(), announcement({ id: 2, title: 'Retired', active: 0 })]);
    render(<AnnouncementsView user={MEMBER} />);
    await screen.findByText('Potluck Sunday');

    fireEvent.click(screen.getByRole('button', { name: /Fullscreen Display/i }));
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });
});
