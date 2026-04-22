import { render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import LoginPage from '../components/LoginPage';
import AnnouncementsView from '../components/AnnouncementsView';

// ─── LoginPage ────────────────────────────────────────────────────────────────

describe('LoginPage', () => {
  test('renders Google sign-in link pointing to /api/auth/google', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /sign in with google/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/api/auth/google');
  });

  test('renders Facebook sign-in link pointing to /api/auth/facebook', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /sign in with facebook/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/api/auth/facebook');
  });
});

// ─── AnnouncementsView — permission gating ────────────────────────────────────

describe('AnnouncementsView — permission gating', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ success: true, items: [] }) })
    ));
  });

  test('hides "Add Item" button when user.role=pending', async () => {
    render(<AnnouncementsView user={{ role: 'pending' }} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
  });

  test('shows "Add Item" button when user.role=approved', async () => {
    render(<AnnouncementsView user={{ role: 'approved' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument());
  });

  test('shows "Add Item" button when user.role=admin', async () => {
    render(<AnnouncementsView user={{ role: 'admin' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument());
  });
});
