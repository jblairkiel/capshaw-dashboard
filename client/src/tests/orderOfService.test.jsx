import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import OrderOfService from '../components/OrderOfService';

vi.mock('axios');

const ADMIN  = { id: 1, role: 'admin' };
const MEMBER = { id: 2, role: 'approved' };

const DOC_LIST = [
  { filename: '1700000000-bulletin.docx', displayName: 'bulletin.docx' },
  { filename: '1700000001-order_of_service.docx', displayName: 'order_of_service.docx' },
];

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  axios.get.mockReset();
  axios.post?.mockReset?.();
  axios.delete?.mockReset?.();
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OrderOfService — document list', () => {
  test('the list is not fetched until asked to load', () => {
    render(<OrderOfService user={MEMBER} />);
    expect(screen.getByText(/Click "Load" to see saved documents/i)).toBeInTheDocument();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('loading lists the saved documents by their display name', async () => {
    axios.get.mockResolvedValue({ data: { files: DOC_LIST } });
    render(<OrderOfService user={MEMBER} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByText('bulletin.docx')).toBeInTheDocument();
    expect(screen.getByText('order_of_service.docx')).toBeInTheDocument();
    // The button now offers to refresh rather than load for the first time
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  test('an empty library says so once loaded', async () => {
    axios.get.mockResolvedValue({ data: { files: [] } });
    render(<OrderOfService user={MEMBER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByText(/No documents uploaded yet/i)).toBeInTheDocument();
  });

  test('a failed list request is reported', async () => {
    // Note: the error line lives in the upload card, which only an admin sees.
    axios.get.mockRejectedValue(new Error('network error'));
    render(<OrderOfService user={ADMIN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByText(/Could not load document list/i)).toBeInTheDocument();
  });

  test('only an admin sees the upload form or delete buttons', async () => {
    axios.get.mockResolvedValue({ data: { files: DOC_LIST } });
    render(<OrderOfService user={MEMBER} />);
    expect(screen.queryByText('Upload Document')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    await screen.findByText('bulletin.docx');
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  test('an admin sees the upload form and delete buttons', async () => {
    axios.get.mockResolvedValue({ data: { files: DOC_LIST } });
    render(<OrderOfService user={ADMIN} />);
    expect(screen.getByText('Upload Document')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    await screen.findByText('bulletin.docx');
    expect(screen.getAllByTitle('Delete')).toHaveLength(2);
  });
});

describe('OrderOfService — viewing a document', () => {
  test('nothing is shown before a document is opened', () => {
    render(<OrderOfService user={MEMBER} />);
    expect(screen.getByText(/Upload or select a Word document/i)).toBeInTheDocument();
  });

  test('opening a saved document renders its HTML', async () => {
    axios.get.mockImplementation(url => {
      if (url === '/api/documents') return Promise.resolve({ data: { files: DOC_LIST } });
      return Promise.resolve({ data: { success: true, filename: DOC_LIST[0].filename, html: '<p>Call to worship</p>' } });
    });
    render(<OrderOfService user={MEMBER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(await screen.findByText('bulletin.docx'));

    expect(await screen.findByText('Call to worship')).toBeInTheDocument();
    expect(screen.getByText('bulletin')).toBeInTheDocument();
  });

  test('a document that fails to open is reported', async () => {
    // The error line lives in the upload card, which only an admin sees.
    axios.get.mockImplementation(url => {
      if (url === '/api/documents') return Promise.resolve({ data: { files: DOC_LIST } });
      return Promise.resolve({ data: { success: false, error: 'File not found' } });
    });
    render(<OrderOfService user={ADMIN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(await screen.findByText('bulletin.docx'));

    expect(await screen.findByText('File not found')).toBeInTheDocument();
  });

  test('uploading a document displays it and refreshes the list', async () => {
    axios.get.mockResolvedValue({ data: { files: [] } });
    axios.post = vi.fn().mockResolvedValue({
      data: { success: true, filename: 'new.docx', html: '<p>New order</p>' },
    });
    render(<OrderOfService user={ADMIN} />);

    const file = new File(['docx bytes'], 'new.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('New order')).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith('/api/documents/upload', expect.any(FormData));
  });

  test('an upload the server refuses is reported', async () => {
    axios.get.mockResolvedValue({ data: { files: [] } });
    axios.post = vi.fn().mockResolvedValue({ data: { success: false, error: 'Only .docx and .doc files are allowed' } });
    render(<OrderOfService user={ADMIN} />);

    const file = new File(['not a docx'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(await screen.findByText('Only .docx and .doc files are allowed')).toBeInTheDocument();
  });

  test('deleting the open document clears the viewer', async () => {
    axios.get.mockImplementation(url => {
      if (url === '/api/documents') return Promise.resolve({ data: { files: DOC_LIST } });
      return Promise.resolve({ data: { success: true, filename: DOC_LIST[0].filename, html: '<p>Call to worship</p>' } });
    });
    axios.delete = vi.fn().mockResolvedValue({ data: { success: true } });

    render(<OrderOfService user={ADMIN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(await screen.findByText('bulletin.docx'));
    await screen.findByText('Call to worship');

    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith(`/api/documents/${DOC_LIST[0].filename}`));
    expect(await screen.findByText(/Upload or select a Word document/i)).toBeInTheDocument();
  });

  test('declining the delete prompt leaves the document open', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    axios.get.mockImplementation(url => {
      if (url === '/api/documents') return Promise.resolve({ data: { files: DOC_LIST } });
      return Promise.resolve({ data: { success: true, filename: DOC_LIST[0].filename, html: '<p>Call to worship</p>' } });
    });
    axios.delete = vi.fn();

    render(<OrderOfService user={ADMIN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(await screen.findByText('bulletin.docx'));
    await screen.findByText('Call to worship');

    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(axios.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Call to worship')).toBeInTheDocument();
  });
});

describe('OrderOfService — assigning jobs', () => {
  const HTML = '<p>Song Leading</p><p>Lord\'s Supper</p><p>Sermon</p>';

  function openDocAs() {
    axios.get.mockImplementation(url => {
      if (url === '/api/documents') return Promise.resolve({ data: { files: DOC_LIST } });
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
      return Promise.resolve({ data: { success: true, filename: DOC_LIST[0].filename, html: HTML } });
    });
  }

  test('an approved member sees no "Assign Jobs" control', async () => {
    openDocAs();
    render(<OrderOfService user={MEMBER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(await screen.findByText('bulletin.docx'));
    await screen.findByText('Sermon');
    expect(screen.queryByRole('button', { name: /Assign Jobs/i })).not.toBeInTheDocument();
  });

  test('an admin can annotate the document with the nearest roster', async () => {
    // Anchor "today" near April 6, 2025 so it is picked as the nearest Sunday.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2025-04-06T12:00:00Z'));

    openDocAs();
    render(<OrderOfService user={ADMIN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(await screen.findByText('bulletin.docx'));
    await screen.findByText('Sermon');

    fireEvent.click(screen.getByRole('button', { name: /Assign Jobs/i }));
    await waitFor(() => expect(screen.getByText(/matched/)).toBeInTheDocument());
    expect(screen.getByText(/Tom Nelson/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));
    expect(screen.queryByText(/Tom Nelson/)).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  test('with no Sunday roster to draw from, the document is left unannotated', async () => {
    // Note: the component sets an explanatory annotateInfo message here, but
    // that message only renders in the branch reached once annotated is set —
    // which this path never reaches — so today nothing is shown to the user
    // beyond the button returning to its normal state. This test pins the
    // observable behavior; surfacing that message is a follow-up worth doing.
    axios.get.mockImplementation(url => {
      if (url === '/api/documents') return Promise.resolve({ data: { files: DOC_LIST } });
      if (url === '/api/members/data') return Promise.resolve({ data: { data: { jobAssignments: { month: '', assignments: [] } } } });
      return Promise.resolve({ data: { success: true, filename: DOC_LIST[0].filename, html: HTML } });
    });

    render(<OrderOfService user={ADMIN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(await screen.findByText('bulletin.docx'));
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
    axios.get.mockImplementation(url => {
      if (url === '/api/documents') return Promise.resolve({ data: { files: DOC_LIST } });
      return Promise.resolve({ data: { success: true, filename: DOC_LIST[0].filename, html: '<p>Call to worship</p>' } });
    });
    render(<OrderOfService user={MEMBER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(await screen.findByText('bulletin.docx'));
    await screen.findByText('Call to worship');

    fireEvent.click(screen.getByRole('button', { name: /Present/i }));
    expect(screen.getByTitle('Close (Esc)')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTitle('Close (Esc)')).not.toBeInTheDocument();
  });
});
