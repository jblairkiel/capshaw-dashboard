import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import MobileNav from '../components/MobileNav';

// The same shape App.jsx builds for an admin: five groups, fifteen items. As a
// row of whitespace-nowrap dropdowns this forced a 375px phone to 681px wide.
const GROUPS = [
  { id: 'worship',      label: 'Worship',      items: [
    { id: 'order', label: 'Order of Service' }, { id: 'songs', label: 'Song Tracker' },
    { id: 'announcements', label: 'Announcements' } ] },
  { id: 'congregation', label: 'Congregation', items: [
    { id: 'assignments', label: 'Job Assignments' }, { id: 'attendance', label: 'Attendance' } ] },
  { id: 'resources',    label: 'Resources',    items: [{ id: 'calendar', label: 'Calendar' }] },
  { id: 'me',           label: 'My Info',      items: [{ id: 'profile', label: 'My Info & Preferences' }] },
  { id: 'admin',        label: 'Admin',        items: [
    { id: 'users', label: 'Users & Roles' }, { id: 'database', label: 'Database' },
    { id: 'directory', label: 'Directory' } ] },
];

const panel = () => document.getElementById('mobile-nav-panel');

describe('MobileNav', () => {
  test('starts closed, showing where you are rather than a list', () => {
    render(<MobileNav groups={GROUPS} activeTab="assignments" onSelect={vi.fn()} />);
    expect(panel()).toBeNull();
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Job Assignments');
    expect(button).toHaveTextContent('Congregation');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('says "Menu" when no tab belongs to a group', () => {
    render(<MobileNav groups={GROUPS} activeTab="nothing" onSelect={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('Menu');
  });

  test('opens every group as a folder, with all items reachable', () => {
    render(<MobileNav groups={GROUPS} activeTab="assignments" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));

    for (const group of GROUPS) {
      expect(within(panel()).getByText(group.label)).toBeInTheDocument();
      for (const item of group.items) {
        expect(within(panel()).getByRole('button', { name: item.label })).toBeInTheDocument();
      }
    }
  });

  test('marks the current item', () => {
    render(<MobileNav groups={GROUPS} activeTab="assignments" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(within(panel()).getByRole('button', { name: 'Job Assignments' }).className).toMatch(/font-semibold/);
    expect(within(panel()).getByRole('button', { name: 'Attendance' }).className).not.toMatch(/font-semibold/);
  });

  test('selecting an item reports it and closes the folder', () => {
    const onSelect = vi.fn();
    render(<MobileNav groups={GROUPS} activeTab="assignments" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Directory' }));

    expect(onSelect).toHaveBeenCalledWith('directory');
    expect(panel()).toBeNull();
  });

  test('closes on Escape', () => {
    render(<MobileNav groups={GROUPS} activeTab="assignments" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(panel()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel()).toBeNull();
  });

  test('closes when you tap outside it', () => {
    render(
      <div>
        <MobileNav groups={GROUPS} activeTab="assignments" onSelect={vi.fn()} />
        <button>elsewhere</button>
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /Job Assignments/ }));
    expect(panel()).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(panel()).toBeNull();
  });

  test('stays open when you tap inside it', () => {
    render(<MobileNav groups={GROUPS} activeTab="assignments" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(within(panel()).getByText('Worship'));
    expect(panel()).not.toBeNull();
  });

  test('renders only the groups it is given, so a member sees no Admin folder', () => {
    const memberGroups = GROUPS.filter(g => g.id !== 'admin');
    render(<MobileNav groups={memberGroups} activeTab="assignments" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(within(panel()).queryByText('Admin')).toBeNull();
    expect(within(panel()).queryByRole('button', { name: 'Database' })).toBeNull();
  });
});
