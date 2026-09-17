// Guest follow-ups, in every state the Follow-ups board tells apart: somebody
// still being waited on, somebody reached by phone or email, and one nobody
// ever got hold of. Runs after the guests, since it needs somebody to follow
// up on.
//
// Written as the workflow engine leaves them rather than started through it:
// starting one sends mail and puts a task in a real member's inbox, which is
// not a thing sample data should do. Reaching a guest also writes back to
// their record, so that is done here too — the same two rows the engine
// would have left.
const { MARK } = require('../people');

module.exports = {
  id:    'follow-ups',
  label: 'Guest Follow-ups',
  area:  'visitors',
  page:  'Guests · Follow-ups',
  order: 25,
  describe: 'Follow-ups in each state — waiting on somebody, reached, never reached — with who did what.',
  tables: ['workflow_instances', 'workflow_tasks', 'workflow_events'],

  generate({ insert, random, scale, db }) {
    // Only guests this batch made: a real guest's record is not ours to write
    // a follow-up onto.
    const guests = db.prepare(`
      SELECT v.id, v.name FROM visitors v
       WHERE v.id IN (SELECT row_id FROM seed_records WHERE table_name = 'visitors')
       ORDER BY v.id DESC LIMIT ?
    `).all(6 * scale);
    if (!guests.length) return;

    const members = db.prepare("SELECT name FROM directory WHERE gender = 'male' ORDER BY id DESC LIMIT 20")
      .all().map(r => r.name);
    const who = () => (members.length ? random.pick(members) : 'Sample Member');

    const ago = days => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    };

    // One of each, then whatever else the scale asks for.
    const shapes = ['active', 'reached', 'never', 'reached'];

    guests.forEach((guest, at) => {
      const shape    = shapes[at % shapes.length];
      const asked    = who();
      const started  = random.int(4, 30);
      const finished = Math.max(1, started - random.int(1, 3));
      const method   = random.chance(0.5) ? 'phone' : 'email';

      const data = {
        visitorId:    String(guest.id),
        visitorName:  guest.name,
        assigneeName: asked,
        notes:        MARK,
        ...(shape === 'reached'
          ? { contactedBy: asked, contactMethod: method, contactedAt: ago(finished), contactNote: MARK }
          : {}),
      };

      const status  = shape === 'active' ? 'active' : 'completed';
      const outcome = shape === 'reached' ? 'contacted' : shape === 'never' ? 'no-contact' : '';

      const instance = insert('workflow_instances', {
        definition_id: 'visitor-follow-up',
        title:  `Follow up with ${guest.name}`,
        status,
        step_id: shape === 'active' ? 'reach-out' : '',
        outcome,
        data:   JSON.stringify(data),
        created_at: ago(started),
        updated_at: ago(finished),
        completed_at: status === 'completed' ? ago(finished) : null,
      }, `Follow up with ${guest.name}`);

      // What was actually done, which is what the board reads back.
      const rounds = shape === 'active'
        ? []
        : shape === 'never'
          ? [['no-answer', 'Nobody answered'], ['give-up', 'Tried three times']]
          : random.chance(0.4)
            ? [['no-answer', ''], [method === 'phone' ? 'phoned' : 'emailed', 'Had a good chat']]
            : [[method === 'phone' ? 'phoned' : 'emailed', '']];

      rounds.forEach(([action, note], round) => {
        insert('workflow_tasks', {
          instance_id: instance,
          step_id: round === 0 ? 'reach-out' : 'try-again',
          assignee_role: '', status: 'done', action, note,
          created_at: ago(started), completed_at: ago(finished),
        }, `${guest.name} — ${action}`);

        insert('workflow_events', {
          instance_id: instance,
          step_id: round === 0 ? 'reach-out' : 'try-again',
          action, summary: `${asked} — ${action}`, note,
          created_at: ago(finished),
        }, `${guest.name} — ${action}`);
      });

      if (shape === 'active') {
        insert('workflow_tasks', {
          instance_id: instance, step_id: 'reach-out',
          assignee_role: 'visitors', status: 'pending', action: '', note: MARK,
          created_at: ago(started),
        }, `${guest.name} — waiting on ${asked}`);
      }

      // Reaching a guest is recorded against the guest, the same as the
      // workflow does it. The guest row is this batch's own, so this writes
      // only onto something that will be removed with it.
      if (shape === 'reached') {
        db.prepare(`
          UPDATE visitors
             SET last_contacted_at = ?, last_contact_method = ?, last_contacted_by = ?,
                 status = CASE WHEN trim(coalesce(status, '')) = '' THEN 'Contacted' ELSE status END
           WHERE id = ?
        `).run(ago(finished), method, asked, guest.id);
      }
    });
  },
};
