import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import DirectoryView from '../components/DirectoryView';
import { OwnPhotoEditor, FamilyPhotoEditor } from '../components/PhotoEditor';
import { photoUrl } from '../lib/photos';
import { choicesFor, familiesByName } from '../lib/memberMatch';

// Family photos and individual ones. Anybody without a photo of their own is
// shown with their family's, so directories that only ever had family photos
// look exactly as they did.

afterEach(() => { vi.unstubAllGlobals(); });

const row = over => ({
  id: 1, name: 'Ray Harris', address: '1 Oak St', city: 'Harvest', state: 'AL', zip: '35749',
  phone: '', cell: '', email: '', notes: '', photo: '', own_photo: '', ...over,
});

function stubFetch(handler) {
  const fetchMock = vi.fn((url, opts = {}) => Promise.resolve({ json: () => Promise.resolve(handler(url, opts)) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('photoUrl', () => {
  test('asks for the face by default, and for a kind when told', () => {
    expect(photoUrl({ id: 4 })).toBe('/api/profile/person/4/photo');
    expect(photoUrl({ id: 4, photo_version: 'abc' })).toBe('/api/profile/person/4/photo?v=abc');
    expect(photoUrl({ id: 4, family_photo_version: 'fam' }, 'family')).toBe('/api/profile/person/4/photo?kind=family&v=fam');
  });
});

describe('DirectoryView photos', () => {
  test('a family photo heads the card, and each person shows their own photo or the family one', async () => {
    stubFetch(() => ({
      success: true,
      rows: [
        row({ id: 1, name: 'Ray Harris', photo: 'family000000aaaa.jpg', own_photo: 'ray000000000bbbb.png' }),
        row({ id: 2, name: 'Jo Harris',  photo: 'family000000aaaa.jpg' }),
        row({ id: 3, name: 'Tom Nelson', address: '2 Elm St', zip: '35750' }),
      ],
    }));
    render(<DirectoryView />);

    const banner = await screen.findByAltText('Harris family');
    expect(banner.getAttribute('src')).toBe('/api/profile/person/1/photo?kind=family&v=family000000');

    expect(screen.getByAltText('Ray Harris').getAttribute('src')).toBe('/api/profile/person/1/photo?v=ray000000000');
    // No photo of her own, so the family's stands in.
    expect(screen.getByAltText('Jo Harris').getAttribute('src')).toBe('/api/profile/person/2/photo?v=family000000');
    // No photos at all: initials, and no banner.
    expect(screen.queryByAltText('Tom Nelson')).toBeNull();
    expect(screen.queryByAltText('Nelson family')).toBeNull();
    expect(screen.getByText('TN')).toBeTruthy();
  });

  test('the family photo can be put up from the card', async () => {
    const fetchMock = stubFetch((url, opts) => {
      if (opts.method === 'PUT') {
        return { success: true, household: [
          { ...row({ id: 3, name: 'Tom Nelson', address: '2 Elm St', zip: '35750' }), photo: undefined, own_photo: undefined,
            has_photo: true, has_family_photo: true, has_own_photo: false, photo_version: 'new', family_photo_version: 'new' },
        ] };
      }
      return { success: true, rows: [row({ id: 3, name: 'Tom Nelson', address: '2 Elm St', zip: '35750' })] };
    });
    render(<DirectoryView />);

    fireEvent.click(await screen.findByTitle('Add a family photo'));
    const dialog = screen.getByRole('region', { name: 'Family photo' });
    expect(within(dialog).getByText('No family photo yet')).toBeTruthy();

    const file = new File(['x'], 'us.png', { type: 'image/png' });
    fireEvent.change(within(dialog).getByLabelText('Add a family photo'), { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/profile/person/3/family-photo', expect.objectContaining({ method: 'PUT' })));
    const body = fetchMock.mock.calls.find(([u]) => u.endsWith('/family-photo'))[1].body;
    expect(body.get('photo')).toBe(file);
    expect(await screen.findAllByAltText('Nelson family')).not.toHaveLength(0);
  });
});

describe('OwnPhotoEditor', () => {
  const person = { id: 7, name: 'Jo Harris', has_photo: true, has_family_photo: true, has_own_photo: false, photo_version: 'fam' };

  test('says the family photo is standing in, and uploads one of just them', async () => {
    const onSaved = vi.fn();
    const fetchMock = stubFetch(() => ({ success: true, person: { ...person, has_own_photo: true } }));
    render(<OwnPhotoEditor person={person} canEdit onSaved={onSaved} />);

    expect(screen.getByText(/No photo of just Jo, so the family photo is shown instead/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Add a photo of Jo'), { target: { files: [new File(['x'], 'jo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ has_own_photo: true })));
    expect(fetchMock).toHaveBeenCalledWith('/api/profile/person/7/photo', expect.objectContaining({ method: 'PUT' }));
  });

  test('with their own photo, offers to go back to the family photo', async () => {
    const fetchMock = stubFetch(() => ({ success: true, person }));
    render(<OwnPhotoEditor person={{ ...person, has_own_photo: true }} canEdit onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Use the family photo'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/profile/person/7/photo', expect.objectContaining({ method: 'DELETE' })));
  });

  test('offers no buttons to somebody who cannot edit', () => {
    render(<OwnPhotoEditor person={person} canEdit={false} onSaved={() => {}} />);
    expect(screen.queryByText('Add a photo of Jo')).toBeNull();
  });

  test('shows the server\'s refusal', async () => {
    stubFetch(() => ({ success: false, error: 'You can only change photos in your own household' }));
    render(<OwnPhotoEditor person={person} canEdit onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Add a photo of Jo'), { target: { files: [new File(['x'], 'jo.png', { type: 'image/png' })] } });
    expect(await screen.findByText('You can only change photos in your own household')).toBeTruthy();
  });
});

describe('FamilyPhotoEditor', () => {
  test('replaces and removes the household\'s photo', async () => {
    const onSaved = vi.fn();
    const fetchMock = stubFetch(() => ({ success: true, household: [] }));
    render(<FamilyPhotoEditor person={{ id: 2, name: 'Jo Harris', has_family_photo: true }} householdSize={3} canEdit onSaved={onSaved} />);
    expect(screen.getByText(/\(3 people\)/)).toBeTruthy();
    fireEvent.click(screen.getByText('Remove family photo'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/profile/person/2/family-photo', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('Member Match with individual photos', () => {
  test('a relative shown in their own photo is never a wrong answer for their family', () => {
    const rounds = [
      { photo: 'harris.jpg', members: [{ id: 1, name: 'Jo Harris',  family: 'harris.jpg' }] },
      { photo: 'ray.jpg',    members: [{ id: 2, name: 'Ray Harris', family: 'harris.jpg' }] },
      { photo: 'pat.jpg',    members: [{ id: 3, name: 'Pat Nolan',  family: 'pat.jpg' }] },
    ];
    const families = familiesByName(rounds);
    for (let i = 0; i < 20; i++) {
      const choices = choicesFor({ photo: 'harris.jpg', targetName: 'Jo Harris' }, families);
      expect(choices).not.toContain('Ray Harris');
      expect(choices).toContain('Pat Nolan');
    }
  });
});
