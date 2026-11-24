// A phone number as a tel: link: digits only, keeping a leading + for an
// international number, so a tap on a phone dials it whatever way it was typed.
// Nothing to dial (an empty field, or words) gives null, and the number is
// shown as plain text instead.
export function telHref(number) {
  const trimmed = String(number || '').trim();
  const digits  = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}
