import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import HowItWorksView from '../components/HowItWorksView';

// The words come from the server, which decides who gets the admin sections;
// the page's job is to lay out whatever it is sent, with contents that jump to
// each section and a download for the PDF.

const CHART = {
  title: 'A service, start to finish', start: 'a',
  nodes: [{ id: 'a', kind: 'step', label: 'The song leader submits it' }, { id: 'b', kind: 'outcome', tone: 'good', label: 'Its songs are recorded' }],
  edges: [{ from: 'a', to: 'b' }],
};

const EVERYONE = [
  { id: 'getting-started', title: 'Getting started', audience: 'everyone', blocks: [
    { p: 'Sign in with **Google** or an email address.' },
    { list: ['**My Church → My Inbox** — anything waiting on you'] },
  ] },
  { id: 'upcoming-service', title: 'Upcoming Service', audience: 'everyone', blocks: [
    { chart: CHART },
    { table: { head: ['Tab', 'What it is'], rows: [['Song Requests', 'Ask for a song']] } },
    { note: 'Nobody\'s individual giving is recorded.' },
  ] },
  { id: 'guests', title: 'Guests and following up', audience: 'everyone', blocks: [
    { workflow: 'visitor-follow-up', intro: 'The **Follow up** button asks somebody.', chart: { ...CHART, title: 'Guest Follow-Up' } },
  ] },
];
const ADMINS = [
  { id: 'admin-accounts', title: 'Accounts and access', audience: 'admins', blocks: [{ steps: ['Open the waiting account', 'Approve it'] }] },
];

function mockDocs({ admin = false } = {}) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ success: true, admin, sections: admin ? [...EVERYONE, ...ADMINS] : EVERYONE }),
  })));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('HowItWorksView', () => {
  test('lays out every kind of block it is sent', async () => {
    mockDocs();
    render(<HowItWorksView />);
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
    expect(screen.getByText('Google').tagName).toBe('STRONG');
    expect(screen.getByText('My Church → My Inbox')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Flowchart for A service, start to finish' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Flowchart for Guest Follow-Up' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'What it is' })).toBeInTheDocument();
    expect(screen.getByText('Nobody\'s individual giving is recorded.')).toBeInTheDocument();
    // Nothing on this page is in progress, so no "where it is now" key.
    expect(screen.queryByText('Where it is now')).toBeNull();
  });

  test('the contents list every section and jump to it', async () => {
    mockDocs();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<HowItWorksView />);
    const contents = await screen.findByRole('navigation', { name: 'Contents' });
    expect(within(contents).getAllByRole('link').map(a => a.textContent)).toEqual(['Getting started', 'Upcoming Service', 'Guests and following up']);
    fireEvent.click(within(contents).getByRole('link', { name: 'Guests and following up' }));
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.contexts[0].id).toBe('how-guests');
  });

  test('a member sees no admin part, and downloads the PDF', async () => {
    mockDocs();
    render(<HowItWorksView />);
    const pdf = await screen.findByRole('link', { name: 'Download PDF' });
    expect(pdf).toHaveAttribute('href', '/api/how-it-works/pdf');
    expect(screen.queryByText('For admins')).toBeNull();
    expect(screen.queryByText('Admins only')).toBeNull();
  });

  test('an admin gets the admin sections, marked as theirs', async () => {
    mockDocs({ admin: true });
    render(<HowItWorksView />);
    const section = await screen.findByRole('region', { name: 'Accounts and access' });
    expect(within(section).getByText('Admins only')).toBeInTheDocument();
    expect(within(section).getByText('Approve it')).toBeInTheDocument();
    expect(screen.getAllByText('For admins').length).toBe(2); // in the contents, and above the section
    expect(screen.getByText(/members see only the first part/)).toBeInTheDocument();
  });

  test('a failed load says so', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Database is away' }) })));
    render(<HowItWorksView />);
    expect(await screen.findByText('Database is away')).toBeInTheDocument();
  });
});
