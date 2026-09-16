// Mail about accounts themselves: confirming an address, telling the office
// somebody is waiting, and telling a person they are in. Kept apart from
// notify.js, which is about workflows, so neither grows into the other.
//
// Every message goes through the outbox in mailer.js, which means a mail
// server that is slow, misconfigured, or absent never blocks a registration —
// the message waits and goes out on the next sweep.

const db     = require('../db');
const mailer = require('./mailer');

const isProd = process.env.NODE_ENV === 'production';

function clientUrl() {
  return isProd ? 'https://capshaw.jblairkiel.com' : 'http://localhost:5173';
}

// The confirmation link is answered by the API, which marks the address
// confirmed and then sends the browser on to the portal. In development the
// Vite dev server proxies /api to the API, so one origin works for both.
function verifyUrl(token) {
  return `${clientUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
}

const SIGNATURE = [
  '',
  'Capshaw Church of Christ',
  '8941 Wall Triana Hwy · Harvest, AL',
].join('\n');

// ─── To the person registering ────────────────────────────────────────────────

function confirmAddress({ name, email, token }) {
  const body = [
    `Hello ${name || 'there'},`,
    '',
    'Somebody — we hope it was you — asked for a Capshaw Church of Christ',
    'member portal account with this email address.',
    '',
    'Please confirm the address by opening this link:',
    '',
    `  ${verifyUrl(token)}`,
    '',
    'The link is good for 48 hours.',
    '',
    'Confirming your address is only the first step. Once it is done, the',
    'church office is told you are waiting, and someone there will approve',
    'your account and connect it to your entry in the member directory. You',
    'will get another email from us the moment that happens — until then,',
    'signing in will tell you your account is still waiting.',
    '',
    'If this was not you, simply ignore this message. Nothing was created that',
    'anybody can use, and no one can sign in with this address unless they can',
    'read this mailbox.',
    SIGNATURE,
  ].join('\n');

  return mailer.send({
    to: [{ email, name: name || '' }],
    subject: 'Confirm your email for the Capshaw member portal',
    body,
    context: 'account:verify',
  });
}

// Sent instead of a second account when somebody registers with an address
// that already has one. It means the reply to "register" can be identical
// either way, so the form cannot be used to find out who is a member here.
function addressAlreadyRegistered({ email, name, provider }) {
  const howTheySignIn = provider === 'google'
    ? 'You already have an account here, and it signs in with Google. Use the\n"Sign in with Google" button rather than a password.'
    : provider === 'facebook'
      ? 'You already have an account here, and it signs in with Facebook. Use the\n"Sign in with Facebook" button rather than a password.'
      : 'You already have an account here with an email address and password.';

  const body = [
    `Hello ${name || 'there'},`,
    '',
    'Somebody just tried to register for the Capshaw Church of Christ member',
    'portal with this address.',
    '',
    howTheySignIn,
    '',
    `The portal is here: ${clientUrl()}`,
    '',
    'If you have forgotten your password, reply to this message and the church',
    'office will sort it out with you.',
    '',
    'If this was not you, nothing has changed and there is nothing to do.',
    SIGNATURE,
  ].join('\n');

  return mailer.send({
    to: [{ email, name: name || '' }],
    subject: 'You already have a Capshaw member portal account',
    body,
    context: 'account:duplicate',
  });
}

// ─── To the church office ─────────────────────────────────────────────────────

function admins() {
  return db.prepare("SELECT name, email FROM users WHERE role = 'admin' AND email IS NOT NULL AND trim(email) <> ''")
    .all()
    .map(u => ({ email: u.email, name: u.name }));
}

// Sent when the address is confirmed, not when the account is created: until
// then there is nothing for an admin to decide, and an unanswered registration
// should not put work in anybody's inbox.
function awaitingApproval({ user }) {
  const recipients = admins();
  if (!recipients.length) {
    console.log(`[accounts] ${user.email} is waiting for approval but no admin has an address on file`);
    return [];
  }

  const body = [
    `${user.name} has confirmed their email address and is waiting to be let`,
    'into the member portal.',
    '',
    `  Name:  ${user.name}`,
    `  Email: ${user.email}`,
    '  Signed up with: an email address and password',
    '',
    'They cannot sign in at all until somebody approves them. Approving is',
    'also where you say who they are: either pick their existing entry in the',
    'member directory or create one for them, so their household and worship',
    'preferences are theirs to keep up to date.',
    '',
    `Approve them here: ${clientUrl()} → Church Office → Members & Access`,
    SIGNATURE,
  ].join('\n');

  return mailer.send({
    to: recipients,
    subject: `Waiting for approval: ${user.name}`,
    body,
    context: `account:${user.id}:awaiting-approval`,
  });
}

// ─── To the person, once an admin has decided ─────────────────────────────────

function approved({ user, personName }) {
  if (!user.email) return [];

  const linkedNote = personName
    ? [
        `Your account is connected to ${personName} in the member directory, so`,
        'you can keep your household\'s details and worship preferences up to',
        'date from "My Household & Preferences".',
        '',
      ]
    : [];

  const body = [
    `Hello ${user.name},`,
    '',
    'Your Capshaw Church of Christ member portal account has been approved.',
    'You can sign in now with your email address and password:',
    '',
    `  ${clientUrl()}`,
    '',
    ...linkedNote,
    'We are glad to have you here.',
    SIGNATURE,
  ].join('\n');

  return mailer.send({
    to: [{ email: user.email, name: user.name }],
    subject: 'Your Capshaw member portal account is ready',
    body,
    context: `account:${user.id}:approved`,
  });
}

module.exports = {
  verifyUrl,
  confirmAddress,
  addressAlreadyRegistered,
  awaitingApproval,
  approved,
  admins,
};
