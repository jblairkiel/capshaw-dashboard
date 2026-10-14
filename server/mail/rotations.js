// ─── Telling whoever is next on a rotation ────────────────────────────────────
//
// When a rotation moves on — somebody takes a turn, or is sent to the back —
// whoever is now next up is emailed and gets a notification in the portal, so
// they can get ready. Reordering the queue tells nobody, since that is usually
// somebody setting it up; a coordinator can tell the person next up at any time
// with "Let them know". The rotation remembers who it last told
// (notified_directory_id), so one wait means one email.

const mailer = require('./mailer');
const { link } = require('./notify');
const notifications = require('../lib/notifications');
const rotations = require('../lib/rotations');

const compose = {};

compose.nextUp = ({ name, rotation, coordinators = [] }) => {
  const greeting = String(name || '').split(/\s+/)[0] || 'Hello';
  const whoToAsk = coordinators.length
    ? `${coordinators.map(c => c.name).join(' or ')} will be in touch about when. If you cannot do it this time, please let them know.`
    : 'If you cannot do it this time, please let whoever keeps the rotation know.';
  return {
    subject: `You are next up: ${rotation.name}`,
    body: [
      `${greeting},`,
      '',
      `You are next up on the "${rotation.name}" rotation.`,
      ...(rotation.description ? ['', rotation.description] : []),
      '',
      whoToAsk,
      '',
      'See the rotation, and who comes after you, here:',
      link('rotations', { rotation: rotation.id }),
      '',
      'You are getting this because your name is on this rotation.',
    ].join('\n'),
  };
};

// Tells whoever is next up, if they have not been told already (or regardless,
// with `force`). Returns who was told, or null. Never the reason a change
// fails: anything that goes wrong here is logged and dropped.
function tellNextUp(rotationId, { actor = null, force = false } = {}) {
  try {
    const due = rotations.whoToTell(rotationId, { force });
    if (!due) return null;
    const { rotation, person } = due;
    rotations.markTold(rotation.id, person.directoryId);

    const email = rotations.emailFor(person.directoryId);
    if (email) {
      mailer.send({
        to: [{ email, name: person.name }],
        ...compose.nextUp({ name: person.name, rotation, coordinators: rotations.coordinatorsOf(rotation.id).map(c => ({ name: c.name })) }),
        context: `rotation:${rotation.id}:next-up`,
      });
    }
    const accounts = notifications.accountsForDirectory([person.directoryId]);
    notifications.notify({
      users: accounts,
      kind: 'rotation-next-up',
      title: `You are next up: ${rotation.name}`,
      body: rotation.description || '',
      subjectType: 'rotation',
      subjectId: rotation.id,
      actor,
    });
    return { ...person, emailed: !!email, notified: accounts.length > 0 };
  } catch (err) {
    console.error('[rotations] could not tell whoever is next:', err.message);
    return null;
  }
}

module.exports = { compose, tellNextUp };
