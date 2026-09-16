import { useState } from 'react';
import Dialog from './Dialog';
import WorkflowPanel from './workflow/WorkflowPanel';

// Requests and approvals belong to a page, but they are not what anybody came
// to the page for. Keeping them behind a button at the top means the page
// itself stays the roster — or the guest list — and the paperwork is one click
// away when it is wanted.
export default function WorkflowDialogButton({
  page, user, label, title,
  // Starting one for a particular thing: the guest whose row was clicked.
  prefill = null, startImmediately = false, className, icon = true, onClosed,
}) {
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className || 'btn-primary text-sm flex items-center gap-1.5'}
      >
        {icon && (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        )}
        {label}
      </button>

      {open && (
        <Dialog
          title={title}
          onClose={() => { setOpen(false); onClosed?.(); }}
          width="max-w-3xl"
        >
          <WorkflowPanel
            page={page}
            user={user}
            title={title}
            embedded
            prefill={prefill}
            startImmediately={startImmediately}
          />
        </Dialog>
      )}
    </>
  );
}
