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

