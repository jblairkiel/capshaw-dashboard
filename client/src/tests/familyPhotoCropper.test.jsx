import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { OwnPhotoEditor } from '../components/PhotoEditor';
import { defaultCrop, clampCrop } from '../lib/photos';

// Cropping one person out of the family photo, saved as their own photo.

const person = { id: 7, name: 'Jo Harris', has_photo: true, has_family_photo: true, has_own_photo: false, photo_version: 'fam', family_photo_version: 'fam' };

let drawn;
beforeEach(() => {
  drawn = null;
  // jsdom has no canvas: record what would be drawn and hand back a blob.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: (...args) => { drawn = args; } }));
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['jpeg'], { type: 'image/jpeg' })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function loadPhoto(width, height) {
  const img = screen.getByAltText('Harris family');
  Object.defineProperty(img, 'naturalWidth',  { value: width });
  Object.defineProperty(img, 'naturalHeight', { value: height });
  fireEvent.load(img);
}

describe('crop geometry', () => {
  test('starts with a square half the shorter side, centred', () => {
    expect(defaultCrop(1000, 400)).toEqual({ x: 400, y: 100, size: 200 });
  });

  test('keeps the square inside the photo and not too small', () => {
    expect(clampCrop({ x: -50, y: 900, size: 100 }, 1000, 400)).toEqual({ x: 0, y: 300, size: 100 });
    expect(clampCrop({ x: 0, y: 0, size: 5000 }, 1000, 400)).toEqual({ x: 0, y: 0, size: 400 });
    expect(clampCrop({ x: 10, y: 10, size: 2 }, 1000, 400).size).toBe(24);
  });
});

describe('Crop from family photo', () => {
  test('is offered only when there is a family photo', () => {
    const { rerender } = render(<OwnPhotoEditor person={person} canEdit onSaved={() => {}} />);
    expect(screen.getByText('Crop from family photo')).toBeTruthy();
    rerender(<OwnPhotoEditor person={{ ...person, has_family_photo: false }} canEdit onSaved={() => {}} />);
    expect(screen.queryByText('Crop from family photo')).toBeNull();
  });

  test('moving the square with the keys and saving uploads that part of the family photo as their photo', async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, person: { ...person, has_own_photo: true } }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<OwnPhotoEditor person={person} canEdit onSaved={onSaved} />);

    fireEvent.click(screen.getByText('Crop from family photo'));
    expect(screen.getByAltText('Harris family').getAttribute('src')).toBe('/api/profile/person/7/photo?kind=family&v=fam');
    loadPhoto(1000, 400);

    const square = screen.getByRole('slider', { name: 'Square around Jo' });
    fireEvent.keyDown(square, { key: 'ArrowLeft', shiftKey: true });   // 10px × 5
    fireEvent.keyDown(square, { key: '-' });                           // 10px smaller
    expect(square.getAttribute('aria-valuetext')).toBe('190 pixels at 350, 100');

    fireEvent.click(screen.getByText("Use as Jo's photo"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ has_own_photo: true })));

    expect(drawn.slice(1)).toEqual([350, 100, 190, 190, 0, 0, 380, 380]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/profile/person/7/photo');
    expect(opts.method).toBe('PUT');
    expect(opts.body.get('photo').type).toBe('image/jpeg');
    // The dialog closes once it is saved.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a refused save is shown in the dialog, which stays open', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'You can only change photos in your own household' }) })));
    render(<OwnPhotoEditor person={person} canEdit onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Crop from family photo'));
    loadPhoto(600, 400);
    fireEvent.click(screen.getByText("Use as Jo's photo"));
    expect(await screen.findAllByText('You can only change photos in your own household')).not.toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('cancel closes without uploading', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<OwnPhotoEditor person={person} canEdit onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Crop from family photo'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
