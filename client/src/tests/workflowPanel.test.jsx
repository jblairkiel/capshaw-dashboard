import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import WorkflowPanel from '../components/workflow/WorkflowPanel';

// WorkflowPanel is the composed surface — starting a workflow, seeing a list of
// instances, acting on a task and drilling into the detail view — so it is
// what exercises ActionBar, StartForm and Detail from components/workflow/parts.

const MEMBER = { id: 1, role: 'approved' };
const ADMIN  = { id: 2, role: 'admin' };

const DEFINITION = {
  id: 'facility-use', title: 'Request facility use', description: 'Book a room for an event.',
  fields: [
    { key: 'room',  label: 'Room', type: 'select', required: true, options: [{ value: 'annex', label: 'Annex' }] },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

const INSTANCE_ROW = {
  id: 10, workflow: 'Facility Use', title: 'Annex — May 3', status: 'active',
  stepTitle: 'Awaiting elder approval', myTaskId: null, myActions: [],
};

const MY_TASK_ROW = {
  ...INSTANCE_ROW, id: 11, myTaskId: 55,
  myActions: [{ id: 'approve', label: 'Approve', tone: 'good' }, { id: 'decline', label: 'Decline', tone: 'bad', requiresNote: true }],
};

const DETAIL = {
  success: true,
  instance: {
    workflow: 'Facility Use', title: 'Annex — May 3', status: 'active', stepId: 'elder-review',
    stepTitle: 'Awaiting elder approval', fields: [{ key: 'room', label: 'Room', value: 'Annex' }],
    outcome: null, outcomeTone: 'neutral', outcomeLabel: '',
  },
  definition: null, visited: [], events: [
    { id: 1, summary: 'Started by Ray Harris', note: '', actor: 'Ray Harris', createdAt: '2025-05-01 10:00:00' },
  ],
  myTask: null, tasks: [{ id: 55, status: 'pending', assigneeName: '', assigneeRole: 'elder' }],
};

function mockApi(overrides = {}) {
  const routes = {
    definitions: { success: true, definitions: [DEFINITION] },
    list:        { success: true, instances: [] },
    detail:      DETAIL,
    start:       { success: true, id: 11 },
    act:         { success: true, ...DETAIL },
    ...overrides,
  };
  const fetchMock = vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    let body;
    if (url.includes('/definitions'))            body = routes.definitions;
    else if (method === 'POST' && url.includes('/tasks/')) body = routes.act;
    else if (method === 'POST')                  body = routes.start;
    else if (/\/workflows\/\d+$/.test(url))      body = routes.detail;
    else                                          body = routes.list;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('WorkflowPanel — visibility', () => {
  test('renders nothing for a signed-out visitor', () => {
    mockApi();
    const { container } = render(<WorkflowPanel page="facility" user={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing on a page with no workflows and nothing in progress', async () => {
    mockApi({ definitions: { success: true, definitions: [] }, list: { success: true, instances: [] } });
    const { container } = render(<WorkflowPanel page="facility" user={MEMBER} />);
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });

  test('shows the panel once a definition exists, even with nothing running', async () => {
    mockApi({ list: { success: true, instances: [] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    expect(await screen.findByText('Requests & approvals')).toBeInTheDocument();
    expect(screen.getByText('Nothing in progress here.')).toBeInTheDocument();
  });

  test('a load failure is shown as an error banner, not a blank panel', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Not signed in' }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
  });
});

describe('WorkflowPanel — starting a workflow', () => {
  test('a single definition gets a button named after it, not a generic label', async () => {
    mockApi();
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    expect(await screen.findByRole('button', { name: 'Request facility use' })).toBeInTheDocument();
  });

  test('opens the start form with its fields, and a select with no options warns about it', async () => {
    mockApi();
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Request facility use' }));

    expect(screen.getByText('Book a room for an event.')).toBeInTheDocument();
    expect(screen.getByText('Room')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  test('warns when a select field has nothing to choose from', async () => {
    mockApi({ definitions: { success: true, definitions: [{
      ...DEFINITION, fields: [{ key: 'room', label: 'Room', type: 'select', options: [] }],
    }] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Request facility use' }));
    expect(screen.getByText(/Nothing to choose from yet/i)).toBeInTheDocument();
  });

  test('submitting starts the workflow and opens its detail', async () => {
    const fetchMock = mockApi();
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Request facility use' }));

    fireEvent.change(screen.getByLabelText(/Notes/i, { selector: 'textarea' }) || screen.getByRole('textbox'), { target: { value: 'Youth group meeting' } });
    fireEvent.click(screen.getByRole('button', { name: /Start workflow/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/workflows', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Annex — May 3')).toBeInTheDocument();
  });

  test('a refused start shows the error and stays on the form', async () => {
    mockApi({ start: { success: false, error: 'Missing required field: room' } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Request facility use' }));
    fireEvent.click(screen.getByRole('button', { name: /Start workflow/i }));

    expect(await screen.findByText('Missing required field: room')).toBeInTheDocument();
    expect(screen.getByText('Book a room for an event.')).toBeInTheDocument();
  });

  test('starting can be cancelled', async () => {
    mockApi();
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Request facility use' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Book a room for an event.')).not.toBeInTheDocument();
  });
});

describe('WorkflowPanel — the instance list', () => {
  test('lists in-progress instances with their step', async () => {
    mockApi({ list: { success: true, instances: [INSTANCE_ROW] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    expect(await screen.findByText('Annex — May 3')).toBeInTheDocument();
    expect(screen.getByText('Awaiting elder approval')).toBeInTheDocument();
    // "In progress" also names an option in the status picker
    expect(screen.getByText('In progress', { selector: 'span' })).toBeInTheDocument();
  });

  test('a finished instance shows its outcome instead', async () => {
    mockApi({ list: { success: true, instances: [{
      ...INSTANCE_ROW, status: 'completed', outcomeLabel: 'Approved', outcomeTone: 'good',
    }] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    // "Finished" also names an option in the status picker
    expect(screen.getByText('Finished', { selector: 'span' })).toBeInTheDocument();
  });

  test('an instance with a task for the viewer shows its actions inline', async () => {
    mockApi({ list: { success: true, instances: [MY_TASK_ROW] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    await screen.findByText('Waiting on you');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  test('a note-requiring action reveals a textbox rather than firing immediately', async () => {
    const fetchMock = mockApi({ list: { success: true, instances: [MY_TASK_ROW] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    expect(screen.getByText(/add a note/i)).toBeInTheDocument();
    const declineButton = screen.getByRole('button', { name: 'Decline' });
    expect(declineButton).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Room is already booked' } });
    expect(declineButton).not.toBeDisabled();
    fireEvent.click(declineButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/workflows/tasks/55', expect.objectContaining({ method: 'POST' })
    ));
    const [, opts] = fetchMock.mock.calls.find(c => c[0] === '/api/workflows/tasks/55');
    expect(JSON.parse(opts.body)).toEqual({ action: 'decline', note: 'Room is already booked' });
  });

  test('an action with no note requirement fires immediately', async () => {
    const fetchMock = mockApi({ list: { success: true, instances: [MY_TASK_ROW] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/workflows/tasks/55', expect.objectContaining({ method: 'POST' })
    ));
  });

  test('the status and scope pickers refetch the list', async () => {
    const fetchMock = mockApi({ list: { success: true, instances: [] } });
    render(<WorkflowPanel page="facility" user={ADMIN} />);
    await screen.findByText('Nothing in progress here.');

    fireEvent.change(screen.getByLabelText('Workflow status'), { target: { value: 'completed' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('status=completed'), expect.objectContaining({ credentials: 'include' })
    ));
  });

  test('only an admin sees the "whose workflows" scope picker', async () => {
    mockApi({ list: { success: true, instances: [] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    await screen.findByText('Nothing in progress here.');
    expect(screen.queryByLabelText('Whose workflows')).not.toBeInTheDocument();
  });
});

describe('WorkflowPanel — opening the detail view', () => {
  test('clicking an instance shows its full detail', async () => {
    mockApi({ list: { success: true, instances: [INSTANCE_ROW] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByText('Annex — May 3'));

    expect(await screen.findByText('← Back')).toBeInTheDocument();
    expect(screen.getByText('Room:')).toBeInTheDocument();
    expect(screen.getByText('Annex')).toBeInTheDocument();
    expect(screen.getByText('Started by Ray Harris')).toBeInTheDocument();
  });

  test('shows who the workflow is waiting on when it is not the viewer', async () => {
    mockApi({ list: { success: true, instances: [INSTANCE_ROW] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByText('Annex — May 3'));
    expect(await screen.findByText(/Waiting on anyone who is elder/)).toBeInTheDocument();
  });

  test("the viewer's own pending task offers its actions in the detail view", async () => {
    mockApi({
      list: { success: true, instances: [INSTANCE_ROW] },
      detail: { ...DETAIL, myTask: { id: 55, actions: [{ id: 'approve', label: 'Approve', tone: 'good' }] } },
    });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByText('Annex — May 3'));
    expect(await screen.findByText('Waiting on you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  test('going back returns to the list', async () => {
    mockApi({ list: { success: true, instances: [INSTANCE_ROW] } });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByText('Annex — May 3'));
    fireEvent.click(await screen.findByText('← Back'));
    expect(await screen.findByText('Annex — May 3')).toBeInTheDocument();
    expect(screen.getByText('Awaiting elder approval')).toBeInTheDocument();
  });

  test('a generated preview table is shown for review', async () => {
    mockApi({
      list: { success: true, instances: [INSTANCE_ROW] },
      detail: { ...DETAIL, instance: { ...DETAIL.instance, preview: { columns: ['Date', 'Leader'], rows: [['May 4', '— none'], ['May 11', 'Tom Nelson']] } } },
    });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByText('Annex — May 3'));

    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('(2 rows)')).toBeInTheDocument();
    expect(screen.getByText('Tom Nelson')).toBeInTheDocument();
  });

  test('a completed instance shows its outcome badge instead of the current step', async () => {
    mockApi({
      list: { success: true, instances: [INSTANCE_ROW] },
      detail: { ...DETAIL, instance: { ...DETAIL.instance, status: 'completed', outcome: 'approved', outcomeTone: 'good', outcomeLabel: 'Approved' } },
    });
    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByText('Annex — May 3'));
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  test('a failed detail fetch is reported', async () => {
    const fetchMock = mockApi({ list: { success: true, instances: [INSTANCE_ROW] } });
    fetchMock.mockImplementationOnce((...args) => Promise.resolve({ json: () => Promise.resolve({ success: true, definitions: [DEFINITION] }) }));
    fetchMock.mockImplementationOnce(() => Promise.resolve({ json: () => Promise.resolve({ success: true, instances: [INSTANCE_ROW] }) }));
    fetchMock.mockImplementationOnce(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Instance not found' }) }));

    render(<WorkflowPanel page="facility" user={MEMBER} />);
    fireEvent.click(await screen.findByText('Annex — May 3'));
    expect(await screen.findByText('Instance not found')).toBeInTheDocument();
  });
});
