import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import BugReportDialog from '../components/BugReportDialog';

// The footer's "Report a problem" form: what gets sent, what a person sees
// once it is, and what stops it going out half-filled.

const type = (input, value) => fireEvent.change(input, { target: { value } });

function mockPost(body) {
  const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('BugReportDialog', () => {
  test('shows which page it was opened from', () => {
    mockPost({ success: true, report: { id: 1 } });
    render(<BugReportDialog pageId="assignments" pageLabel="Serving Schedule" onClose={() => {}} />);
    expect(screen.getByText(/You are on Serving Schedule/)).toBeInTheDocument();
  });

  test('a title and a description are required before it will send', async () => {
    const fetchMock = mockPost({ success: true, report: { id: 1 } });
    render(<BugReportDialog pageId="order" pageLabel="This Sunday" onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /send report/i }));
    expect(await screen.findByText(/short title helps/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    type(screen.getByPlaceholderText(/week dropdown/i), 'Something broke');
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));
    expect(await screen.findByText(/say what happened/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('sends the page, url and browser alongside what was typed', async () => {
    const fetchMock = mockPost({ success: true, report: { id: 42 } });
    render(<BugReportDialog pageId="assignments" pageLabel="Serving Schedule" onClose={() => {}} />);

    type(screen.getByPlaceholderText(/week dropdown/i), 'Week picker is stuck');
    type(screen.getByPlaceholderText(/what you saw/i), 'Picking another week does nothing');
    fireEvent.click(screen.getByRole('radio', { name: /can't get this done/i }));
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/bug-reports');
    expect(options.method).toBe('POST');
    const body = options.body;
    expect(body.get('title')).toBe('Week picker is stuck');
    expect(body.get('description')).toBe('Picking another week does nothing');
    expect(body.get('severity')).toBe('blocking');
    expect(body.get('page')).toBe('assignments');
    expect(body.get('url')).toContain('http');
    expect(body.get('userAgent')).toBeTruthy();
  });

  test('defaults to the middle severity', async () => {
    const fetchMock = mockPost({ success: true, report: { id: 1 } });
    render(<BugReportDialog pageId="order" pageLabel="This Sunday" onClose={() => {}} />);

    type(screen.getByPlaceholderText(/week dropdown/i), 'x');
    type(screen.getByPlaceholderText(/what you saw/i), 'y');
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body.get('severity')).toBe('annoying');
  });

  test('shows a thank-you once it is filed, with the report number', async () => {
    mockPost({ success: true, report: { id: 42 } });
    render(<BugReportDialog pageId="order" pageLabel="This Sunday" onClose={() => {}} />);

    type(screen.getByPlaceholderText(/week dropdown/i), 'x');
    type(screen.getByPlaceholderText(/what you saw/i), 'y');
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText(/Report #42/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  test('a failed submission is shown, not swallowed', async () => {
    mockPost({ success: false, error: 'Something went wrong' });
    render(<BugReportDialog pageId="order" pageLabel="This Sunday" onClose={() => {}} />);

    type(screen.getByPlaceholderText(/week dropdown/i), 'x');
    type(screen.getByPlaceholderText(/what you saw/i), 'y');
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  test('attaching something that is not an image is refused before it is sent', () => {
    mockPost({ success: true, report: { id: 1 } });
    render(<BugReportDialog pageId="order" pageLabel="This Sunday" onClose={() => {}} />);

    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/please attach an image/i)).toBeInTheDocument();
  });

  test('an attached screenshot can be removed before sending', async () => {
    mockPost({ success: true, report: { id: 1 } });
    render(<BugReportDialog pageId="order" pageLabel="This Sunday" onClose={() => {}} />);

    const file = new File(['fake-bytes'], 'shot.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('button', { name: /remove/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  test('cancelling closes without sending anything', () => {
    const fetchMock = mockPost({ success: true, report: { id: 1 } });
    const onClose = vi.fn();
    render(<BugReportDialog pageId="order" pageLabel="This Sunday" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
