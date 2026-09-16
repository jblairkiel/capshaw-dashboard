// Turning a table on screen into a spreadsheet, without a round trip to the
// server: the rows are already here, so the export is made in the browser.

function escapeCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // Quote everything — a name with a comma and a name without should not be
  // written differently, and quoting always is simpler to read back.
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers, rows) {
  return [headers, ...rows].map(r => r.map(escapeCell).join(',')).join('\r\n');
}

// Returns false where the browser cannot hand a file over (older browsers, and
// the test DOM), so a caller can leave the button disabled rather than throw.
export function downloadCsv(filename, csv) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;

  const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
