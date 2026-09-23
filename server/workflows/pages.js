// Where each workflow lives in the UI. Workflows are started and actioned on
// the page they are about — the worship schedule belongs with the roster, a
// visitor follow-up with the visitors — rather than on one page of their own.
// The inbox is the only place that gathers them all, and it uses `page` to
// send people back to where a task came from.

const PAGES = [
  { id: 'assignments', label: 'Job Assignments' },
  { id: 'visitors',    label: 'Visitors' },
];

const PAGE_IDS = new Set(PAGES.map(p => p.id));

function isPage(id) {
  return PAGE_IDS.has(id);
}

module.exports = { PAGES, isPage };
