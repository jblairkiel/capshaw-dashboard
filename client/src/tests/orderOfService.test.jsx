import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import OrderOfService from '../components/OrderOfService';

vi.mock('axios');

const ADMIN  = { id: 1, role: 'admin' };
const MEMBER = { id: 2, role: 'approved' };

const CURRENT = {
  filename: '1700000001-order_of_service.docx',
  displayName: 'order_of_service.docx',
  html: '<p>Call to worship</p>',
};

function mockCurrent(current = null) {
  axios.get.mockImplementation(url => {
    if (url === '/api/documents/current') return Promise.resolve({ data: { success: true, current } });
    return Promise.resolve({ data: { success: false } });
  });
}

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  axios.get.mockReset();
  axios.post?.mockReset?.();
  axios.delete?.mockReset?.();
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OrderOfService — showing whatever is current', () => {
  test('the current document loads and shows on its own, with nothing to click first', async () => {
    mockCurrent(CURRENT);
    render(<OrderOfService user={MEMBER} />);

    expect(await screen.findByText('Call to worship')).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith('/api/documents/current');
    expect(screen.getByText('order of service')).toBeInTheDocument();
  });

  test('nothing uploaded yet says so, worded for whether you can fix that', async () => {
    mockCurrent(null);
    render(<OrderOfService user={MEMBER} />);
    expect(await screen.findByText(/Nothing has been uploaded yet/i)).toBeInTheDocument();
  });

  test('a member who can fix it is invited to upload', async () => {
    mockCurrent(null);
    render(<OrderOfService user={ADMIN} />);
    expect(await screen.findByText(/Upload a Word document/i)).toBeInTheDocument();
  });

  test('a failed load is reported, not an empty page pretending there is nothing', async () => {
    axios.get.mockRejectedValue(new Error('network error'));
    render(<OrderOfService user={ADMIN} />);
    expect(await screen.findByText(/Could not load the order of service/i)).toBeInTheDocument();
  });

  test('only whoever holds Worship Order sees the upload form or Remove', async () => {
    mockCurrent(CURRENT);
    render(<OrderOfService user={MEMBER} />);
    await screen.findByText('Call to worship');
    expect(screen.queryByText('Upload Document')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  test('whoever holds Worship Order sees the upload form and Remove', async () => {
    mockCurrent(CURRENT);
    render(<OrderOfService user={ADMIN} />);
    expect(await screen.findByText('Upload Document')).toBeInTheDocument();
    await screen.findByText('Call to worship');
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

describe('OrderOfService — uploading replaces what was there', () => {
  test('uploading the first one displays it', async () => {
    mockCurrent(null);
    axios.post = vi.fn().mockResolvedValue({
      data: { success: true, filename: 'new.docx', html: '<p>New order</p>' },
    });
    render(<OrderOfService user={ADMIN} />);
    await screen.findByText('Upload Document');

    const file = new File(['docx bytes'], 'new.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(await screen.findByText('New order')).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith('/api/documents/upload', expect.any(FormData));
  });

  test('once one exists, the upload card offers to replace it rather than upload a first one', async () => {
    mockCurrent(CURRENT);
    render(<OrderOfService user={ADMIN} />);
    expect(await screen.findByText('Replace Document')).toBeInTheDocument();
    expect(screen.getByText(/replaces the one below/i)).toBeInTheDocument();
  });

  test('uploading a second document shows the second, not both', async () => {
    mockCurrent(CURRENT);
    axios.post = vi.fn().mockResolvedValue({
      data: { success: true, filename: 'second.docx', html: '<p>Second order</p>' },
    });
    render(<OrderOfService user={ADMIN} />);
    await screen.findByText('Call to worship');

    const file = new File(['docx bytes'], 'second.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(await screen.findByText('Second order')).toBeInTheDocument();
    expect(screen.queryByText('Call to worship')).not.toBeInTheDocument();
  });

  test('an upload the server refuses is reported', async () => {
    mockCurrent(null);
    axios.post = vi.fn().mockResolvedValue({ data: { success: false, error: 'Only .docx and .doc files are allowed' } });
    render(<OrderOfService user={ADMIN} />);
    await screen.findByText('Upload Document');

    const file = new File(['not a docx'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(await screen.findByText('Only .docx and .doc files are allowed')).toBeInTheDocument();
  });
});

describe('OrderOfService — removing it', () => {
  test('removing the document clears the viewer for everyone', async () => {
    mockCurrent(CURRENT);
    axios.delete = vi.fn().mockResolvedValue({ data: { success: true } });

    render(<OrderOfService user={ADMIN} />);
    await screen.findByText('Call to worship');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith('/api/documents/current'));
    // Rendered as an admin here, so the empty state is the invitation to
    // upload rather than the plain "nothing yet" a member would see.
    expect(await screen.findByText(/Upload a Word document/i)).toBeInTheDocument();
  });

  test('declining the prompt leaves the document in place', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockCurrent(CURRENT);
    axios.delete = vi.fn();

    render(<OrderOfService user={ADMIN} />);
    await screen.findByText('Call to worship');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(axios.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Call to worship')).toBeInTheDocument();
  });

  test('a failed removal is reported and the document stays visible', async () => {
    mockCurrent(CURRENT);
    axios.delete = vi.fn().mockRejectedValue(new Error('network error'));

    render(<OrderOfService user={ADMIN} />);
    await screen.findByText('Call to worship');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Delete failed')).toBeInTheDocument();
    expect(screen.getByText('Call to worship')).toBeInTheDocument();
  });
});

describe('OrderOfService — assigning jobs', () => {
  const HTML = '<p>Song Leading</p><p>Lord\'s Supper</p><p>Sermon</p>';

  function mockWithAssignments(current) {
    axios.get.mockImplementation(url => {
      if (url === '/api/documents/current') return Promise.resolve({ data: { success: true, current } });
      if (url === '/api/members/data') return Promise.resolve({
        data: {
          data: {
            jobAssignments: {
              month: 'April 2025',
              assignments: [
                { date: 'April 6', service: 'Sunday Worship', job: 'Song Leader', name: 'Tom Nelson' },
                { date: 'April 6', service: 'Sunday Worship', job: 'Communion', name: 'Ray Harris' },
              ],
            },
          },
        },
      });
      return Promise.resolve({ data: { success: false } });
    });
  }

  test('an approved member sees no "Assign Jobs" control', async () => {
    mockWithAssignments({ ...CURRENT, html: HTML });
    render(<OrderOfService user={MEMBER} />);
    await screen.findByText('Sermon');
    expect(screen.queryByRole('button', { name: /Assign Jobs/i })).not.toBeInTheDocument();
  });

  test('whoever holds Worship Order can annotate the document with the nearest roster', async () => {
    // Anchor "today" near April 6, 2025 so it is picked as the nearest Sunday.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2025-04-06T12:00:00Z'));

    mockWithAssignments({ ...CURRENT, html: HTML });
    render(<OrderOfService user={ADMIN} />);
    await screen.findByText('Sermon');

    fireEvent.click(screen.getByRole('button', { name: /Assign Jobs/i }));
    await waitFor(() => expect(screen.getByText(/matched/)).toBeInTheDocument());
    expect(screen.getByText(/Tom Nelson/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));
    expect(screen.queryByText(/Tom Nelson/)).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  test('with no Sunday roster to draw from, the document is left unannotated', async () => {
    axios.get.mockImplementation(url => {
      if (url === '/api/documents/current') return Promise.resolve({ data: { success: true, current: { ...CURRENT, html: HTML } } });
      if (url === '/api/members/data') return Promise.resolve({ data: { data: { jobAssignments: { month: '', assignments: [] } } } });
      return Promise.resolve({ data: { success: false } });
    });

    render(<OrderOfService user={ADMIN} />);
    await screen.findByText('Sermon');

    fireEvent.click(screen.getByRole('button', { name: /Assign Jobs/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Assigning/i })).not.toBeInTheDocument());

    // No names were appended to the document
    expect(screen.queryByText(/Tom Nelson|Ray Harris/)).not.toBeInTheDocument();
    // The control reverts to "Assign Jobs" rather than switching to "Clear"
    expect(screen.getByRole('button', { name: /Assign Jobs/i })).toBeInTheDocument();
  });
});

describe('OrderOfService — presenting', () => {
  beforeEach(() => {
    Element.prototype.requestFullscreen = vi.fn(() => Promise.resolve());
  });
  afterEach(() => { delete Element.prototype.requestFullscreen; });

  test('opens a fullscreen view of the document and can be closed', async () => {
    mockCurrent(CURRENT);
    render(<OrderOfService user={MEMBER} />);
    await screen.findByText('Call to worship');

    fireEvent.click(screen.getByRole('button', { name: /Present/i }));
    expect(screen.getByTitle('Close (Esc)')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTitle('Close (Esc)')).not.toBeInTheDocument();
  });
});
