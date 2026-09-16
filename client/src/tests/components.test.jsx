import { render, screen, within, fireEvent } from '@testing-library/react';
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
  test('shows no-data prompt when both props are null', () => {
    render(<LeadershipView deacons={null} bulletins={null} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  const DEACONS = [
    { name: 'James Wilson', duties: ['Oversees benevolence', 'Grounds'] },
    { name: 'Alan Reed',    duties: ['Building maintenance'] },
    { name: 'Carl Dunn',    duties: [] },
  ];

  // The names of the deacons in the grid, top to bottom.
  function order() {
    return screen.getAllByRole('row')
      .slice(1)                                   // past the header row
      .map(r => within(r).getAllByRole('cell')[0].textContent);
  }

  test('renders deacon names', () => {
    const deacons = [
      { name: 'James Wilson', duties: ['Oversees benevolence'] },
    ];
    render(<LeadershipView deacons={deacons} bulletins={[]} />);
    expect(screen.getByText('James Wilson')).toBeInTheDocument();
  });

  test('gives each deacon a row and his duties as a list', () => {
    render(<LeadershipView deacons={DEACONS} bulletins={[]} />);

    const row = screen.getByText('James Wilson').closest('tr');
    expect(within(row).getAllByRole('listitem').map(li => li.textContent))
      .toEqual(['•Oversees benevolence', '•Grounds']);
    expect(screen.getByText('3 deacons')).toBeInTheDocument();
  });

  test('a deacon with nothing recorded shows a dash rather than an empty list', () => {
    render(<LeadershipView deacons={DEACONS} bulletins={[]} />);
    const row = screen.getByText('Carl Dunn').closest('tr');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  test('sorts by name, and reverses when the heading is clicked again', () => {
    render(<LeadershipView deacons={DEACONS} bulletins={[]} />);
    expect(order()).toEqual(['Alan Reed', 'Carl Dunn', 'James Wilson']);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Deacon' }));
    expect(order()).toEqual(['James Wilson', 'Carl Dunn', 'Alan Reed']);
  });

  test('sorts by how much each deacon looks after', () => {
    render(<LeadershipView deacons={DEACONS} bulletins={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Responsibilities' }));
    expect(order()).toEqual(['Carl Dunn', 'Alan Reed', 'James Wilson']);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Responsibilities' }));
    expect(order()).toEqual(['James Wilson', 'Alan Reed', 'Carl Dunn']);
  });

  test('filters on a name or on a responsibility alike', () => {
    render(<LeadershipView deacons={DEACONS} bulletins={[]} />);
    const filter = screen.getByPlaceholderText(/Filter by name/i);

    fireEvent.change(filter, { target: { value: 'wilson' } });
    expect(order()).toEqual(['James Wilson']);
    expect(screen.getByText('1 deacon')).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'maintenance' } });
    expect(order()).toEqual(['Alan Reed']);
  });

  test('a filter that matches nobody says so', () => {
    render(<LeadershipView deacons={DEACONS} bulletins={[]} />);
    fireEvent.change(screen.getByPlaceholderText(/Filter by name/i), { target: { value: 'zzz' } });
    expect(screen.getByText(/No deacons match your filter/i)).toBeInTheDocument();
  });

  test('says when there are no deacons at all', () => {
    render(<LeadershipView deacons={[]} bulletins={[]} />);
    expect(screen.getByText(/No deacon data found/i)).toBeInTheDocument();
  });

  test('renders bulletin labels', () => {
    const bulletins = [
      { url: '/files/bulletin.pdf', label: 'April 13, 2025' },
    ];
    render(<LeadershipView deacons={[]} bulletins={bulletins} />);
    expect(screen.getByText('April 13, 2025')).toBeInTheDocument();
  });
});
