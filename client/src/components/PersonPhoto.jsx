import { useState, useEffect } from 'react';
import { HAS_PHOTO, photoUrl } from '../lib/photos';

// A person's photo, falling back to their initials. The photo is fetched from
// the profile API, which checks the viewer may see this person; a page with its
// own right to see everybody's (Member Attendance) passes `src`.
//
// `kind` picks which picture: 'face' (the default) is the person's own photo
// when they have one and their family's otherwise — the server decides, so
// people with only a family photo keep showing it. 'own' and 'family' ask for
// one in particular, for the photo editor.
export default function PersonPhoto({ person, size = 48, className = '', src, kind = 'face', rounded = 'rounded-lg' }) {
  const url = src || (person ? photoUrl(person, kind) : '');
  const [failedUrl, setFailedUrl] = useState(null);
  useEffect(() => { setFailedUrl(null); }, [url]);
  const show = HAS_PHOTO[kind]?.(person) && failedUrl !== url;

  const initials = (person?.name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

  return show ? (
    <img
      src={url}
      alt={person.name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailedUrl(url)}
      className={`${rounded} object-cover bg-gray-100 shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      aria-hidden="true"
      className={`${rounded} bg-church-navy text-church-gold font-semibold flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
    >
      {initials}
    </div>
  );
}
