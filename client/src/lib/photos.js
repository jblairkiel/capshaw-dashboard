// Which photo of a person to show, and where to fetch it from. See
// components/PersonPhoto.jsx.

export const HAS_PHOTO = {
  face:   p => p?.has_photo,
  own:    p => p?.has_own_photo,
  family: p => p?.has_family_photo,
};
const VERSION = {
  face:   p => p?.photo_version,
  own:    p => p?.own_photo_version,
  family: p => p?.family_photo_version,
};

export function photoUrl(person, kind = 'face') {
  const params = new URLSearchParams();
  if (kind !== 'face') params.set('kind', kind);
  // A replaced photo is a different version, so the browser fetches it afresh
  // instead of showing the one it cached.
  const v = VERSION[kind](person);
  if (v) params.set('v', v);
  const query = params.toString();
  return `/api/profile/person/${person.id}/photo${query ? `?${query}` : ''}`;
}


// ─── Cropping a person out of the family photo ───────────────────────────────
// A crop is a square in the photo's own pixels: { x, y, size }.

// A square half the photo's shorter side, in the middle: somewhere to start.
export function defaultCrop(width, height) {
  const size = Math.round(Math.min(width, height) / 2);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

// Keeps a crop inside the photo and no smaller than a face can be made out at.
export function clampCrop({ x, y, size }, width, height, minSize = 24) {
  const s = Math.round(Math.max(Math.min(minSize, width, height), Math.min(size, width, height)));
  return {
    x: Math.round(Math.min(Math.max(0, x), width - s)),
    y: Math.round(Math.min(Math.max(0, y), height - s)),
    size: s,
  };
}

// Draws the cropped square onto a canvas and hands it back as a JPEG file,
// ready to upload as the person's own photo. The family photo comes from this
// site, so the canvas is never tainted.
export const CROP_OUTPUT_SIZE = 480;
export function cropToFile(image, crop, name = 'photo.jpg') {
  const canvas = document.createElement('canvas');
  const out = Math.min(CROP_OUTPUT_SIZE, crop.size * 2);
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, out, out);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('The photo could not be cropped'));
      resolve(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  });
}
