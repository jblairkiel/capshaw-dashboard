import { useState } from 'react';

// A person's directory photo, falling back to their initials. The photo is
// fetched from the profile API, which checks the viewer may see this person.
export default function PersonPhoto({ person, size = 48, className = '' }) {
  const [failed, setFailed] = useState(false);
  const show = person?.has_photo && !failed;

  const initials = (person?.name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

  return show ? (
    <img
      src={`/api/profile/person/${person.id}/photo`}
      alt={person.name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`rounded-lg object-cover bg-gray-100 shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      aria-hidden="true"
      className={`rounded-lg bg-church-navy text-church-gold font-semibold flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
    >
      {initials}
    </div>
  );
}
