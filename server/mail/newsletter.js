// The weekly newsletter, emailed to a mailing list with the PDF attached. The
// PDF is the same file Export PDF gives (server/lib/bulletinPdf.js), written
// once and attached to every copy.

const db     = require('../db');
const mailer = require('./mailer');
const groups = require('./groups');

const compose = {};

compose.newsletter = ({ bulletin, listName }) => ({
  subject: `${bulletin.masthead} — ${bulletin.sundayLabel}`,
  body: [
    `This week's newsletter, for ${bulletin.sundayLabel}, is attached as a PDF.`,
    '',
    ...(bulletin.reminders?.length
      ? ['Coming up:', ...bulletin.reminders.slice(0, 6).map(r => `  • ${r}`), '']
      : []),
    `You are getting this because you are on the ${listName} list.`,
    '',
    'Capshaw Church of Christ',
    '8941 Wall Triana Hwy · Harvest, AL',
  ].join('\n'),
});

// The lists a newsletter can go to, with how many on each can be reached.
function lists() {
  return groups.listGroups().map(g => {
    const { recipients, missing } = groups.recipientsFor(g.key);
    return { key: g.key, name: g.name, reachable: recipients.length, missing: missing.length };
  });
}

// What has already gone out for a week, so nobody sends it to a list twice
// without meaning to.
function sentFor(sunday) {
  return db.prepare(`
    SELECT context, COUNT(*) AS n, MIN(created_at) AS at FROM mail_outbox
     WHERE context LIKE ? GROUP BY context ORDER BY at
  `).all(`bulletin:${sunday}:%`).map(r => ({ list: r.context.split(':')[2], count: r.n, at: r.at }));
}

function sendNewsletter({ bulletin, pdf, filename, listKey }) {
  const { recipients, missing, group } = groups.recipientsFor(listKey);
  if (!group) return { error: 'No such mailing list' };
  if (!recipients.length) return { error: `Nobody on the ${group.name} list has an email address on file` };

  const attachment = mailer.saveAttachment({ buffer: pdf, filename, contentType: 'application/pdf' });
  const queued = mailer.send({
    to: recipients,
    ...compose.newsletter({ bulletin, listName: group.name }),
    context: `bulletin:${bulletin.sunday}:${group.key}`,
    attachments: [attachment],
  });
  return { queued: queued.length, missing, list: { key: group.key, name: group.name } };
}

module.exports = { compose, lists, sentFor, sendNewsletter };
