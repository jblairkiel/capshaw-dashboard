import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import Dialog from '../components/Dialog';
import WorkflowDialogButton from '../components/WorkflowDialogButton';
import { toCsv } from '../lib/csv';

// ─── Dialog ───────────────────────────────────────────────────────────────────

describe('Dialog', () => {
  test('is labelled by its title, so it reads as one thing', () => {
    render(<Dialog title="Guest follow-ups" onClose={() => {}}>inside</Dialog>);
    expect(screen.getByRole('dialog', { name: 'Guest follow-ups' })).toBeInTheDocument();
    expect(screen.getByText('inside')).toBeInTheDocument();
  });

  test('closes on the close button, on the backdrop and on Escape', () => {
    const onClose = vi.fn();
    const { container } = render(<Dialog title="Guest follow-ups" onClose={onClose}>inside</Dialog>);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(container.firstChild);                       // the backdrop
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test('a click inside the panel is not a click on the backdrop', () => {
    const onClose = vi.fn();
    render(<Dialog title="Guest follow-ups" onClose={onClose}>inside</Dialog>);

    fireEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─── WorkflowDialogButton ─────────────────────────────────────────────────────

describe('WorkflowDialogButton', () => {
  const MEMBER = { id: 1, role: 'approved' };

  function mockApi() {
    const fetchMock = vi.fn(url => Promise.resolve({
      json: () => Promise.resolve(
        url.includes('/definitions')
          ? { success: true, definitions: [{ id: 'visitor-follow-up', title: 'Guest Follow-Up', description: 'Follow up with a guest.', fields: [] }] }
          : { success: true, instances: [] }
      ),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  test('shows nothing to a signed-out visitor', () => {
    const { container } = render(<WorkflowDialogButton page="visitors" user={null} label="Guest follow-ups" title="Guest follow-ups" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('keeps the requests behind a button until they are asked for', async () => {
    mockApi();
    render(<WorkflowDialogButton page="visitors" user={MEMBER} label="Guest follow-ups" title="Guest follow-ups" />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guest follow-ups' }));

    const dialog = await screen.findByRole('dialog', { name: 'Guest follow-ups' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guest Follow-Up' })).toBeInTheDocument());
  });

  test('the dialog heading is not repeated inside it', async () => {
    mockApi();
    render(<WorkflowDialogButton page="visitors" user={MEMBER} label="Guest follow-ups" title="Guest follow-ups" />);
    fireEvent.click(screen.getByRole('button', { name: 'Guest follow-ups' }));

    await screen.findByRole('dialog');
    // The dialog carries the title; the panel inside it does not repeat it.
    expect(screen.getAllByRole('heading', { name: 'Guest follow-ups' })).toHaveLength(1);
  });

  test('an embedded panel with nothing in it says so rather than vanishing', async () => {
    const fetchMock = vi.fn(url => Promise.resolve({
      json: () => Promise.resolve(url.includes('/definitions')
        ? { success: true, definitions: [] }
        : { success: true, instances: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<WorkflowDialogButton page="visitors" user={MEMBER} label="Guest follow-ups" title="Guest follow-ups" />);
    fireEvent.click(screen.getByRole('button', { name: 'Guest follow-ups' }));

    expect(await screen.findByText(/Nothing in progress here/i)).toBeInTheDocument();
  });
});

// ─── CSV ──────────────────────────────────────────────────────────────────────

describe('toCsv', () => {
  test('quotes every cell, so a comma in a name is not a new column', () => {
    expect(toCsv(['Name', 'Note'], [['Harris, Ray', 'Away']]))
      .toBe('"Name","Note"\r\n"Harris, Ray","Away"');
  });

  test('doubles a quote inside a cell, the way a spreadsheet expects', () => {
    expect(toCsv(['Note'], [['He said "yes"']])).toBe('"Note"\r\n"He said ""yes"""');
  });

  test('an empty cell is empty rather than "null"', () => {
    expect(toCsv(['A', 'B'], [[null, undefined]])).toBe('"A","B"\r\n"",""');
  });
});
