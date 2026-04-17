import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
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

  test('renders deacon names', () => {
    const deacons = [
      { name: 'James Wilson', duties: ['Oversees benevolence'] },
    ];
    render(<LeadershipView deacons={deacons} bulletins={[]} />);
    expect(screen.getByText('James Wilson')).toBeInTheDocument();
  });

  test('renders bulletin labels', () => {
    const bulletins = [
      { url: '/files/bulletin.pdf', label: 'April 13, 2025' },
    ];
    render(<LeadershipView deacons={[]} bulletins={bulletins} />);
    expect(screen.getByText('April 13, 2025')).toBeInTheDocument();
  });
});
