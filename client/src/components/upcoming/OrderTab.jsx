import OrderOfService from '../OrderOfService';
import { StatusBadge } from './shared';
import { dayLabel } from './api';

// ─── Order of Worship ─────────────────────────────────────────────────────────
//
// The services coming up, each as its song leader submitted it — or a note
// that it has not been yet — and underneath, the printed order of service the
// worship organizer uploads, as it always was.

export function PlanOutline({ items }) {
  return (
    <ol className="divide-y divide-gray-50">
      {items.map((item, i) => (
        <li key={i} className="grid grid-cols-[1.5rem_1fr] sm:grid-cols-[1.5rem_10rem_1fr] gap-x-2 gap-y-0.5 py-1.5 text-sm">
          <span className="text-church-gold text-xs font-bold pt-0.5">{i + 1}.</span>
          <span className="text-gray-500">{item.partName}</span>
          <span className="col-start-2 sm:col-start-3 text-church-navy min-w-0">
            {item.song && (
              <span className="font-medium">
                {item.song.title}
                {item.song.number && <span className="ml-1.5 text-xs text-gray-400 font-normal">{[item.song.hymnal, item.song.number].filter(Boolean).join(' ')}</span>}
              </span>
            )}
            {item.person && <span className={item.song ? 'ml-2 text-gray-600' : ''}>{item.person}</span>}
            {item.detail && <span className="ml-2 text-gray-500 italic">“{item.detail}”</span>}
            {item.note && <span className="block text-xs text-gray-500">{item.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ServiceCard({ slot, canOrganize, busy, onOpen, onConfirm }) {
  const { plan } = slot;
  return (
    <section className="card p-0 overflow-hidden" aria-label={`${slot.service}, ${dayLabel(slot.date)}`}>
      <header className="flex items-start justify-between gap-3 flex-wrap px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="min-w-0">
          <h3 className="font-semibold text-church-navy">{slot.service}</h3>
          <p className="text-sm text-gray-500">
            {dayLabel(slot.date)}
            {slot.leader && <> · Song leader: <span className="text-gray-700">{slot.leader}</span></>}
          </p>
        </div>
        <StatusBadge status={plan?.status} />
      </header>

      <div className="px-4 py-3">
        {plan ? (
          <>
            <PlanOutline items={plan.items} />
            {plan.notes && <p className="mt-2 text-sm text-gray-600 bg-church-cream/50 rounded-lg px-3 py-2">{plan.notes}</p>}
            <p className="mt-2 text-xs text-gray-400">
              Submitted by {plan.submittedByName || 'the song leader'}
              {plan.status === 'confirmed' && plan.confirmedByName && <> · confirmed by {plan.confirmedByName}</>}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">The song leader has not submitted this service yet.</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {plan && canOrganize && plan.status === 'submitted' && (
            <button onClick={() => onConfirm(plan)} disabled={busy} className="btn-primary text-sm py-1.5 disabled:opacity-50">Confirm</button>
          )}
          {(plan ? slot.canEdit : slot.canSubmit) && (
            <button
              onClick={() => onOpen(slot.date, slot.service)}
              className="px-3 py-1.5 text-sm rounded-lg border border-church-navy text-church-navy hover:bg-church-cream"
            >
              {plan ? 'Change it' : 'Submit this service'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export default function OrderTab({ overview, user, busy, onOpen, onConfirm }) {
  return (
    <div className="space-y-4">
      {overview.upcoming.length === 0 ? (
        <div className="card text-sm text-gray-500">
          No services are set up to happen every week. Whoever keeps the records can say which services happen on which day, on the Record Keeping page.
        </div>
      ) : overview.upcoming.map(slot => (
        <ServiceCard
          key={`${slot.date}|${slot.service}`}
          slot={slot}
          canOrganize={overview.canOrganize}
          busy={busy}
          onOpen={onOpen}
          onConfirm={onConfirm}
        />
      ))}

      <div className="pt-2">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Printed order of service</h3>
        <OrderOfService user={user} />
      </div>
    </div>
  );
}
