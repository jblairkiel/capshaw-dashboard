import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import AttendanceView from '../components/AttendanceView';
import AnniversariesView from '../components/AnniversariesView';
import LeadershipView from '../components/LeadershipView';

// ─── AttendanceView ───────────────────────────────────────────────────────────

describe('AttendanceView', () => {
  test('shows no-data prompt when data is null', () => {
    render(<AttendanceView data={null} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  test('renders attendance records', () => {
    const data = [
      { date: '04/13/25', service: 'AM', count: 142 },
      { date: '04/06/25', service: 'AM', count: 138 },
    ];
    render(<AttendanceView data={data} />);
    expect(screen.getAllByText('142').length).toBeGreaterThan(0);
    expect(screen.getAllByText('138').length).toBeGreaterThan(0);
  });

  describe('exporting', () => {
    const DATA = [
      { date: '04/13/25', service: 'Sun AM',          count: 142 },
      { date: '04/09/25', service: 'Wed Bible Study', count: 63 },
    ];

    // The export hands the browser a file; what the test can see of that is the
    // contents it was given and the name it was asked to save them under.
    // (jsdom's own Blob will not read its contents back, hence the stand-in.)
    function captureDownload() {
      const saved = {};
      vi.stubGlobal('Blob', class FakeBlob {
        constructor(parts) { saved.text = parts.join(''); }
      });
      vi.stubGlobal('URL', {
        createObjectURL: () => 'blob:csv',
        revokeObjectURL: () => {},
      });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function record() { saved.filename = this.download; });
      return { saved, click };
    }

    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    test('exports what is on screen, headings and all', () => {
      const { saved } = captureDownload();
      render(<AttendanceView data={DATA} />);

      fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

      expect(saved.filename).toBe('attendance-all-services.csv');
      expect(saved.text).toBe(
        '"Date","Service","Count"\r\n"04/13/25","Sun AM","142"\r\n"04/09/25","Wed Bible Study","63"'
      );
    });

    test('exports the chosen service only, and says so in the filename', () => {
      const { saved } = captureDownload();
      render(<AttendanceView data={DATA} />);

      fireEvent.click(screen.getByRole('button', { name: 'Wed Bible Study' }));
      fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

      expect(saved.filename).toBe('attendance-wed-bible-study.csv');
      expect(saved.text).toContain('"Wed Bible Study"');
      expect(saved.text).not.toContain('Sun AM');
    });

    test('there is nothing to export from an empty roll', () => {
      render(<AttendanceView data={[]} />);
      expect(screen.getByRole('button', { name: /Export CSV/i })).toBeDisabled();
    });
  });
});

// ─── AnniversariesView ────────────────────────────────────────────────────────

describe('AnniversariesView', () => {
  test('shows no-data prompt when data is null', () => {
    render(<AnniversariesView data={null} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  test('renders anniversary couple names', () => {
    const data = [
      { month: 'January', date: '1/15', names: 'John & Jane Smith', monthNum: 1, day: 15 },
    ];
    render(<AnniversariesView data={data} />);
    expect(screen.getByText('John & Jane Smith')).toBeInTheDocument();
  });
});

// ─── LeadershipView ───────────────────────────────────────────────────────────

describe('LeadershipView', () => {
  const ELDERS = [
    { id: 1, name: 'Ray Harris', phone: '256-555-0110', email: 'ray@example.com', notes: '', duties: ['Shepherding group 1'] },
  ];

  const DEACONS = [
    { id: 1, name: 'James Wilson', duties: ['Oversees benevolence', 'Grounds'] },
    { id: 2, name: 'Alan Reed',    duties: ['Building maintenance'] },
    { id: 3, name: 'Carl Dunn',    duties: [] },
  ];

  function mockLeadership({ elders = ELDERS, deacons = DEACONS, canManage = false, bulletins = [] } = {}) {
    const fetchMock = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ success: true, elders, deacons, bulletins, canManage }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  // The names in the deacons grid, top to bottom.
  function deaconOrder() {
    const table = screen.getByRole('button', { name: 'Sort by Deacon' }).closest('table');
    return within(table).getAllByRole('row')
      .slice(1)                                   // past the header row
      .map(r => within(r).getAllByRole('cell')[0].textContent);
  }

  async function renderView(options) {
    mockLeadership(options);
    render(<LeadershipView />);
    await screen.findByRole('button', { name: 'Sort by Deacon' });
  }

  test('lists the elders as well as the deacons', async () => {
    await renderView();
    expect(screen.getByText('Ray Harris')).toBeInTheDocument();
    expect(screen.getByText(/256-555-0110/)).toBeInTheDocument();
    expect(screen.getByText('1 elder')).toBeInTheDocument();
    expect(screen.getByText('James Wilson')).toBeInTheDocument();
  });

  test('gives each deacon a row and his duties as a list', async () => {
    await renderView();

    const row = screen.getByText('James Wilson').closest('tr');
    expect(within(row).getAllByRole('listitem').map(li => li.textContent))
      .toEqual(['•Oversees benevolence', '•Grounds']);
    expect(screen.getByText('3 deacons')).toBeInTheDocument();
  });

  test('a deacon with nothing recorded shows a dash rather than an empty list', async () => {
    await renderView();
    const row = screen.getByText('Carl Dunn').closest('tr');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  test('sorts by name, and reverses when the heading is clicked again', async () => {
    await renderView();
    expect(deaconOrder()).toEqual(['Alan Reed', 'Carl Dunn', 'James Wilson']);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Deacon' }));
    expect(deaconOrder()).toEqual(['James Wilson', 'Carl Dunn', 'Alan Reed']);
  });

  test('sorts by how much each deacon looks after', async () => {
    await renderView();
    const sorter = screen.getAllByRole('button', { name: 'Sort by Responsibilities' })[1];

    fireEvent.click(sorter);
    expect(deaconOrder()).toEqual(['Carl Dunn', 'Alan Reed', 'James Wilson']);

    fireEvent.click(sorter);
    expect(deaconOrder()).toEqual(['James Wilson', 'Alan Reed', 'Carl Dunn']);
  });

  test('filters on a name or on a responsibility alike', async () => {
    await renderView();
    const filter = screen.getAllByPlaceholderText(/Filter by name/i)[1];

    fireEvent.change(filter, { target: { value: 'wilson' } });
    expect(deaconOrder()).toEqual(['James Wilson']);
    expect(screen.getByText('1 deacon')).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'maintenance' } });
    expect(deaconOrder()).toEqual(['Alan Reed']);
  });

  test('a filter that matches nobody says so', async () => {
    await renderView();
    fireEvent.change(screen.getAllByPlaceholderText(/Filter by name/i)[1], { target: { value: 'zzz' } });
    expect(screen.getByText(/No deacons match your filter/i)).toBeInTheDocument();
  });

  test('says when there are no deacons at all', async () => {
    await renderView({ deacons: [] });
    expect(screen.getByText(/No deacons recorded yet/i)).toBeInTheDocument();
  });

  test('renders bulletin labels', async () => {
    mockLeadership({ bulletins: [{ url: '/files/bulletin.pdf', label: 'April 13, 2025' }] });
    render(<LeadershipView />);
    expect(await screen.findByText('April 13, 2025')).toBeInTheDocument();
  });

  test('only the leadership area gets the Add and Edit buttons', async () => {
    await renderView({ canManage: false });
    expect(screen.queryByRole('button', { name: /add an elder/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit ray harris/i })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
    await renderView({ canManage: true });
    expect(screen.getAllByRole('button', { name: /add an elder/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /edit ray harris/i })).toHaveLength(1);
  });

  test('editing an elder sends the responsibilities as a list, one per line', async () => {
    const fetchMock = mockLeadership({ canManage: true });
    render(<LeadershipView />);
    fireEvent.click(await screen.findByRole('button', { name: /edit ray harris/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Responsibilities/), {
      target: { value: 'Shepherding group 1\nBenevolence' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, opts]) => String(url).includes('/api/leadership/elders/1') && opts?.method === 'PATCH');
      expect(JSON.parse(call[1].body).duties).toEqual(['Shepherding group 1', 'Benevolence']);
    });
  });
});
