import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, test, expect } from 'vitest';

// Typing into a controlled input, the way the rest of these tests do it.
const type   = (input, value) => fireEvent.change(input, { target: { value } });
const choose = (select, value) => fireEvent.change(select, { target: { value } });

import SermonsView     from '../components/SermonsView';
import VisitorTracker  from '../components/VisitorTracker';
import JobAssignments  from '../components/JobAssignments';
import PersonPhoto     from '../components/PersonPhoto';

// The scraped data views: each one takes what the scraper found and lets a
// member search it. They share a "nothing loaded yet" state, which is what a
// signed-in member sees before the first update.

const sermon = over => ({
  date: '04/13/25', title: 'Faith That Works', speaker: 'Ray Harris',
  type: 'Expository', series: 'James', service: 'AM', ...over,
});

// ─── SermonsView ──────────────────────────────────────────────────────────────

describe('SermonsView', () => {
  const SERMONS = [
    sermon(),
    sermon({ date: '04/06/25', title: 'The Good Shepherd', speaker: 'Tom Nelson', type: 'Topical', series: 'Psalms', service: 'PM' }),
    sermon({ date: '03/30/25', title: 'Living Water',      speaker: 'Ray Harris', type: 'Topical', series: 'John' }),
  ];

  test('prompts for an update when nothing has been loaded', () => {
    render(<SermonsView data={null} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  test('lists every sermon with its details', () => {
    render(<SermonsView data={SERMONS} />);
    expect(screen.getByText('Faith That Works')).toBeInTheDocument();
    expect(screen.getByText('The Good Shepherd')).toBeInTheDocument();
    expect(screen.getByText('3 results')).toBeInTheDocument();
  });

  test('says "1 result" rather than "1 results"', async () => {
    render(<SermonsView data={SERMONS} />);
    type(screen.getByPlaceholderText(/Search title/i), 'Good Shepherd');
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });

  test('searches the title, the speaker and the series alike', async () => {
    render(<SermonsView data={SERMONS} />);
    const search = screen.getByPlaceholderText(/Search title/i);

    for (const [term, expected] of [['Living', 'Living Water'], ['Nelson', 'The Good Shepherd'], ['James', 'Faith That Works']]) {
      type(search, term);
      expect(screen.getByText('1 result')).toBeInTheDocument();
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
  });

  test('ignores the case of the search', async () => {
    render(<SermonsView data={SERMONS} />);
    type(screen.getByPlaceholderText(/Search title/i), 'FAITH');
    expect(screen.getByText('Faith That Works')).toBeInTheDocument();
  });

  test('offers every speaker and type that appears, and filters on the choice', async () => {
    render(<SermonsView data={SERMONS} />);
    const [speakerSelect, typeSelect] = screen.getAllByRole('combobox');

    expect(within(speakerSelect).getAllByRole('option').map(o => o.textContent))
      .toEqual(['All', 'Ray Harris', 'Tom Nelson']);

    choose(speakerSelect, 'Tom Nelson');
    expect(screen.getByText('1 result')).toBeInTheDocument();

    choose(speakerSelect, 'All');
    choose(typeSelect, 'Topical');
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });

  test('combines a search with the filters', async () => {
    render(<SermonsView data={SERMONS} />);
    const [speakerSelect] = screen.getAllByRole('combobox');

    choose(speakerSelect, 'Ray Harris');
    type(screen.getByPlaceholderText(/Search title/i), 'Shepherd');
    expect(screen.getByText('0 results')).toBeInTheDocument();
    expect(screen.getByText(/No sermons match your filter/i)).toBeInTheDocument();
  });

  test('leaves a blank speaker or type out of the filter lists', () => {
    render(<SermonsView data={[sermon({ speaker: '', type: '' })]} />);
    const [speakerSelect, typeSelect] = screen.getAllByRole('combobox');
    expect(within(speakerSelect).getAllByRole('option')).toHaveLength(1);
    expect(within(typeSelect).getAllByRole('option')).toHaveLength(1);
  });

  test('an empty list is not an error', () => {
    render(<SermonsView data={[]} />);
    expect(screen.getByText('0 results')).toBeInTheDocument();
    expect(screen.getByText(/No sermons match your filter/i)).toBeInTheDocument();
  });
});

// ─── VisitorTracker ───────────────────────────────────────────────────────────

describe('VisitorTracker', () => {
  const VISITORS = [
    { name: 'Pat Lane', visits: [{ date: '04/13/25', service: 'AM' }, { date: '03/30/25', service: 'PM' }] },
    { name: 'Sam Ford', visits: [{ date: '04/06/25', service: 'AM' }] },
  ];

  test('prompts for an update when nothing has been loaded', () => {
    render(<VisitorTracker data={null} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  test('lists each guest with how many times they have visited and when they last did', () => {
    render(<VisitorTracker data={VISITORS} />);
    expect(screen.getByText('Pat Lane')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Last visit: 04/13/25')).toBeInTheDocument();
    expect(screen.getByText('2 guests')).toBeInTheDocument();
  });

  test('says "1 guest" rather than "1 guests"', async () => {
    render(<VisitorTracker data={VISITORS} />);
    type(screen.getByPlaceholderText(/Search guests/i), 'Pat');
    expect(screen.getByText('1 guest')).toBeInTheDocument();
  });

  test('a guest with no recorded visits shows a dash rather than "undefined"', () => {
    render(<VisitorTracker data={[{ name: 'Jo Reed', visits: [] }]} />);
    expect(screen.getByText('Last visit: —')).toBeInTheDocument();
  });

  test('the visit history is hidden until the guest is opened', async () => {
    render(<VisitorTracker data={VISITORS} />);
    expect(screen.queryByText('03/30/25')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Pat Lane/ }));
    expect(screen.getByText('03/30/25')).toBeInTheDocument();
    expect(screen.getByText('PM')).toBeInTheDocument();
  });

  test('opening one guest leaves the others closed', async () => {
    render(<VisitorTracker data={VISITORS} />);
    fireEvent.click(screen.getByRole('button', { name: /Pat Lane/ }));
    expect(screen.queryByText('04/06/25')).not.toBeInTheDocument();
  });

  test('a guest can be closed again', async () => {
    render(<VisitorTracker data={VISITORS} />);
    const row = screen.getByRole('button', { name: /Pat Lane/ });

    fireEvent.click(row);
    expect(screen.getByText('03/30/25')).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.queryByText('03/30/25')).not.toBeInTheDocument();
  });

  test('searching by name narrows the list', async () => {
    render(<VisitorTracker data={VISITORS} />);
    type(screen.getByPlaceholderText(/Search guests/i), 'sam');
    expect(screen.getByText('Sam Ford')).toBeInTheDocument();
    expect(screen.queryByText('Pat Lane')).not.toBeInTheDocument();
  });

  test('a search that matches nobody says so', async () => {
    render(<VisitorTracker data={VISITORS} />);
    type(screen.getByPlaceholderText(/Search guests/i), 'nobody');
    expect(screen.getByText(/No visitors match your search/i)).toBeInTheDocument();
  });
});

// ─── JobAssignments ───────────────────────────────────────────────────────────

describe('JobAssignments', () => {
  const DATA = {
    month: 'April 2025',
    assignments: [
      { date: 'April 6',  service: 'AM', job: 'Song Leader',        name: 'Tom Nelson' },
      { date: 'April 6',  service: 'AM', job: 'Opening Prayer',     name: 'Ray Harris' },
      { date: 'April 13', service: 'PM', job: 'Song Leader',        name: 'Lee Park' },
      { date: 'April 6',  service: 'AM', job: 'Visuals',            name: 'Jo Reed' },
      { date: '',         service: '',   job: 'Visual Preparation', name: 'Sam Ford' },
    ],
  };

  test('prompts for an update when nothing has been loaded', () => {
    render(<JobAssignments data={null} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  test('shows the month the roster covers', () => {
    render(<JobAssignments data={DATA} />);
    expect(screen.getByText('April 2025')).toBeInTheDocument();
  });

  test('groups the assignments under their date', () => {
    render(<JobAssignments data={DATA} />);
    expect(screen.getByRole('heading', { name: 'April 6' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'April 13' })).toBeInTheDocument();
    expect(screen.getByText('Opening Prayer')).toBeInTheDocument();
  });

  test('the AV rotation is shown on its own, not among the other jobs', () => {
    render(<JobAssignments data={DATA} />);
    expect(screen.getByRole('heading', { name: 'AV Operator' })).toBeInTheDocument();
    expect(screen.getByText('Monthly prep: Sam Ford')).toBeInTheDocument();
    // The operator appears once — in the AV column, not in the date groups
    expect(screen.getAllByText('Jo Reed')).toHaveLength(1);
    expect(screen.queryByText('Visuals')).not.toBeInTheDocument();
  });

  test('says so when nobody is on the AV rotation', () => {
    render(<JobAssignments data={{ month: 'April 2025', assignments: [DATA.assignments[0]] }} />);
    expect(screen.getByText(/No AV assignments found/i)).toBeInTheDocument();
  });

  test('omits the monthly prep line when there is none', () => {
    render(<JobAssignments data={{ assignments: [DATA.assignments[3]] }} />);
    expect(screen.queryByText(/Monthly prep/i)).not.toBeInTheDocument();
  });

  test('filters by job, by name and by service alike', async () => {
    render(<JobAssignments data={DATA} />);
    const filter = screen.getByPlaceholderText(/Filter by job/i);

    type(filter, 'Opening');
    expect(screen.getByText('Opening Prayer')).toBeInTheDocument();
    expect(screen.queryByText('Lee Park')).not.toBeInTheDocument();
    type(filter, 'Lee');
    expect(screen.getByText('Lee Park')).toBeInTheDocument();
    expect(screen.queryByText('Tom Nelson')).not.toBeInTheDocument();
    type(filter, 'PM');
    expect(screen.getByRole('heading', { name: 'April 13' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'April 6' })).not.toBeInTheDocument();
  });

  test('a date whose rows all filter out is dropped, heading and all', async () => {
    render(<JobAssignments data={DATA} />);
    type(screen.getByPlaceholderText(/Filter by job/i), 'Opening');
    expect(screen.queryByRole('heading', { name: 'April 13' })).not.toBeInTheDocument();
  });

  test('a filter that matches nothing says so — but keeps the AV column', async () => {
    render(<JobAssignments data={DATA} />);
    type(screen.getByPlaceholderText(/Filter by job/i), 'zzz');
    expect(screen.getByText(/No assignments match your filter/i)).toBeInTheDocument();
    // The AV rotation is deliberately unaffected by the filter
    expect(screen.getByText('Jo Reed')).toBeInTheDocument();
  });

  test('a roster with no assignments at all renders empty rather than breaking', () => {
    render(<JobAssignments data={{}} />);
    expect(screen.getByText(/No assignments match your filter/i)).toBeInTheDocument();
    expect(screen.getByText(/No AV assignments found/i)).toBeInTheDocument();
  });
});

// ─── PersonPhoto ──────────────────────────────────────────────────────────────

describe('PersonPhoto', () => {
  test('shows the photo when the person has one', () => {
    render(<PersonPhoto person={{ id: 7, name: 'Ray Harris', has_photo: 1 }} />);
    const img = screen.getByRole('img', { name: 'Ray Harris' });
    expect(img).toHaveAttribute('src', '/api/profile/person/7/photo');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  test('falls back to initials when the person has no photo', () => {
    render(<PersonPhoto person={{ id: 7, name: 'Ray Harris', has_photo: 0 }} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('RH')).toBeInTheDocument();
  });

  test('falls back to initials when the photo will not load', () => {
    render(<PersonPhoto person={{ id: 7, name: 'Ray Harris', has_photo: 1 }} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('RH')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('takes at most two initials, however many names there are', () => {
    render(<PersonPhoto person={{ id: 1, name: 'Mary Ann Harris Nelson' }} />);
    expect(screen.getByText('MA')).toBeInTheDocument();
  });

  test('a single name gives a single initial', () => {
    render(<PersonPhoto person={{ id: 1, name: 'Ray' }} />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  test('somebody with no name at all still renders', () => {
    render(<PersonPhoto person={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  test('honours the requested size', () => {
    render(<PersonPhoto person={{ id: 1, name: 'Ray Harris', has_photo: 1 }} size={96} />);
    expect(screen.getByRole('img')).toHaveAttribute('width', '96');
  });
});
