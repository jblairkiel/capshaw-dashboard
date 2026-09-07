import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import MyProfileView from '../components/MyProfileView';
import WorshipPreferences from '../components/WorshipPreferences';
import { WORSHIP_ROLES } from '../lib/worship';

const RAY = {
  id: 1, name: 'Ray Harris', address: '12 Oak St', city: 'Harvest', state: 'AL', zip: '35749',
  phone: '', cell: '(256) 555-0101', email: 'ray@example.com', notes: '',
  worship: { preferences: { 'Song Leader': 'preferred' }, notes: 'Away in July' },
};
const SAM = {
  id: 2, name: 'Sam Harris', address: '12 Oak St', city: 'Harvest', state: 'AL', zip: '35749',
  phone: '', cell: '', email: '', notes: '',
  worship: { preferences: {}, notes: '' },
};

function mockProfile(overrides = {}) {
  const payload = {
    success: true, linked: true, person: RAY, household: [RAY, SAM],
    roles: WORSHIP_ROLES, levels: ['preferred', 'willing', 'unavailable'],
    notifications: { monthlyReport: true },
    canEdit: true, canEditAll: false, ...overrides,
  };
  const fetchMock = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(payload) })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ─── MyProfileView ────────────────────────────────────────────────────────────

describe('MyProfileView', () => {
  beforeEach(() => { mockProfile(); });

  test('shows your own entry and the rest of your household', async () => {
    render(<MyProfileView user={{ email: 'ray@example.com' }} />);
    expect(await screen.findByText('Ray Harris')).toBeInTheDocument();
    expect(screen.getByText('Sam Harris')).toBeInTheDocument();
    expect(screen.getByText(/my household/i)).toBeInTheDocument();
  });

  test('marks which entry is you', async () => {
    render(<MyProfileView user={{}} />);
    expect(await screen.findByText('You')).toBeInTheDocument();
  });

  test('your own contact details are editable', async () => {
    render(<MyProfileView user={{}} />);
    const cell = await screen.findByDisplayValue('(256) 555-0101');
    expect(cell).not.toBeDisabled();
  });

  test('saving details PATCHes the profile endpoint', async () => {
    const fetchMock = mockProfile();
    render(<MyProfileView user={{}} />);
    const cell = await screen.findByDisplayValue('(256) 555-0101');

    fireEvent.change(cell, { target: { value: '(256) 555-0142' } });
    fireEvent.click(screen.getByRole('button', { name: /save details/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/profile/person/1',
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });

  test('tells an unlinked account how to get matched', async () => {
    mockProfile({ linked: false, person: null, household: [] });
    render(<MyProfileView user={{ email: 'nobody@example.com' }} />);
    expect(await screen.findByText(/isn't matched to a directory entry/i)).toBeInTheDocument();
    expect(screen.getByText(/nobody@example.com/)).toBeInTheDocument();
  });

  test('is read-only for an account that cannot edit', async () => {
    mockProfile({ canEdit: false });
    render(<MyProfileView user={{}} />);
    expect(await screen.findByText(/read-only for now/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save details/i })).not.toBeInTheDocument();
  });

  test('surfaces a server error instead of rendering an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Nope' }) })
    ));
    render(<MyProfileView user={{}} />);
    expect(await screen.findByText('Nope')).toBeInTheDocument();
  });
});

// ─── WorshipPreferences ───────────────────────────────────────────────────────

describe('WorshipPreferences', () => {
  test('renders a control for every worship role', () => {
    render(<WorshipPreferences person={SAM} onSave={vi.fn()} />);
    for (const role of WORSHIP_ROLES) {
      expect(screen.getByRole('group', { name: `${role} preference` })).toBeInTheDocument();
    }
  });

  test('shows the level already chosen as pressed', () => {
    render(<WorshipPreferences person={RAY} onSave={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Song Leader preference' });
    const gladTo = within(group).getByRole('button', { name: /glad to/i });
    expect(gladTo).toHaveAttribute('aria-pressed', 'true');
  });

  test('sends chosen levels and nulls for the rest', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<WorshipPreferences person={SAM} onSave={onSave} />);

    const group = screen.getByRole('group', { name: 'Usher preference' });
    fireEvent.click(within(group).getByRole('button', { name: /willing/i }));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const body = onSave.mock.calls[0][0];
    expect(body.preferences.Usher).toBe('willing');
    // Every other role is explicitly cleared so the server drops it.
    expect(body.preferences['Song Leader']).toBeNull();
  });

  test('clicking the active level again clears it', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<WorshipPreferences person={RAY} onSave={onSave} />);

    const group = screen.getByRole('group', { name: 'Song Leader preference' });
    fireEvent.click(within(group).getByRole('button', { name: /glad to/i }));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].preferences['Song Leader']).toBeNull();
  });

  test('hides the save button and disables the controls when read-only', () => {
    render(<WorshipPreferences person={RAY} onSave={vi.fn()} disabled />);
    expect(screen.queryByRole('button', { name: /save preferences/i })).not.toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Usher preference' });
    expect(within(group).getByRole('button', { name: /willing/i })).toBeDisabled();
  });

  test('shows a save failure rather than pretending it worked', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('Server said no')));
    render(<WorshipPreferences person={SAM} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
    expect(await screen.findByText('Server said no')).toBeInTheDocument();
  });
});

// ─── Email preferences ────────────────────────────────────────────────────────

describe('MyProfileView — email preferences', () => {
  beforeEach(() => { mockProfile(); });

  test('shows the monthly summary as on by default', async () => {
    render(<MyProfileView user={{}} />);
    const box = await screen.findByRole('checkbox', { name: /monthly schedule summary/i });
    expect(box).toBeChecked();
  });

  test('explains that opting out does not stop personal assignment emails', async () => {
    render(<MyProfileView user={{}} />);
    expect(await screen.findByText(/does not stop the\s+emails about jobs you are personally given/i))
      .toBeInTheDocument();
  });

  test('opting out PATCHes the preference', async () => {
    const fetchMock = mockProfile();
    render(<MyProfileView user={{}} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /monthly schedule summary/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/profile/notifications',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ monthlyReport: false }) })
      );
    });
  });

  test('shows it as off for somebody who has opted out', async () => {
    mockProfile({ notifications: { monthlyReport: false } });
    render(<MyProfileView user={{}} />);
    expect(await screen.findByRole('checkbox', { name: /monthly schedule summary/i })).not.toBeChecked();
  });

  test('is offered even to an account not yet linked to the directory', async () => {
    mockProfile({ linked: false, person: null, household: [] });
    render(<MyProfileView user={{ email: 'nobody@example.com' }} />);
    expect(await screen.findByRole('checkbox', { name: /monthly schedule summary/i })).toBeInTheDocument();
  });
});
