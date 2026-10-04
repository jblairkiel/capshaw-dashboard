// Mail about accounts themselves: confirming an address, telling the office
// somebody is waiting, and telling a person they are in. Kept apart from
// notify.js, which is about workflows, so neither grows into the other.
//
// Every message goes through the outbox in mailer.js, which means a mail
// server that is slow, misconfigured, or absent never blocks a registration —
// the message waits and goes out on the next sweep.
//
// What goes to the person whose account it is skips the test-mode redirect
// (`realRecipient`): a confirmation or reset link only works for the person
// who asked for it. The note to the admins follows Admin → Email Delivery like
// everything else.

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

// A reset link opens the portal itself, which shows the "choose a new password"
// form and sends the token back with the new password.
function resetUrl(token) {
  return `${clientUrl()}/?reset=${encodeURIComponent(token)}`;
}

const RESET_TTL_MINUTES = 60;

const SIGNATURE = [
  '',
  'Capshaw Church of Christ',
  '8941 Wall Triana Hwy · Harvest, AL',
].join('\n');

// ─── What each email says ─────────────────────────────────────────────────────
//
// The wording, apart from who it goes to — so the Emails page can show each
// one with sample data (server/mail/catalog.js) without sending anything.

const compose = {};

compose.confirmAddress = ({ name, token }) => ({
  subject: 'Confirm your email for the Capshaw member portal',
  body: [
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
  ].join('\n'),
});

compose.addressAlreadyRegistered = ({ name, provider }) => {
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
    provider === 'google' || provider === 'facebook'
      ? 'There is no password to remember: just use that button.'
      : 'If you have forgotten your password, choose "Forgot your password?" on\nthe sign-in page and we will email you a link to choose a new one.',
    '',
    'If this was not you, nothing has changed and there is nothing to do.',
    SIGNATURE,
  ].join('\n');
  return { subject: 'You already have a Capshaw member portal account', body };
};

compose.resetPassword = ({ name, token }) => ({
  subject: 'Choose a new password for the Capshaw member portal',
  body: [
    `Hello ${name || 'there'},`,
    '',
    'Somebody — we hope it was you — asked to reset the password for your',
    'Capshaw Church of Christ member portal account.',
    '',
    'To choose a new password, open this link:',
    '',
    `  ${resetUrl(token)}`,
    '',
    `The link works once, for the next ${RESET_TTL_MINUTES} minutes.`,
    '',
    'If this was not you, simply ignore this message. Your password has not',
    'changed, and nobody can change it without this link.',
    SIGNATURE,
  ].join('\n'),
});

// Asked for a reset on an address whose account signs in with Google or
// Facebook: there is no password here to reset, so say how they do sign in.
compose.noPasswordToReset = ({ name, provider }) => {
  const via = provider === 'facebook' ? 'Facebook' : 'Google';
  return {
    subject: 'Signing in to the Capshaw member portal',
    body: [
      `Hello ${name || 'there'},`,
      '',
      'Somebody asked to reset the password for this address on the Capshaw',
      'Church of Christ member portal.',
      '',
      `Your account there signs in with ${via}, so it has no password of its`,
      `own to reset. Use the "Sign in with ${via}" button instead:`,
      '',
      `  ${clientUrl()}`,
      '',
      'If this was not you, nothing has changed and there is nothing to do.',
      SIGNATURE,
    ].join('\n'),
  };
};

compose.awaitingApproval = ({ user }) => ({
  subject: `Waiting for approval: ${user.name}`,
  body: [
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
  ].join('\n'),
});

compose.approved = ({ user, personName }) => {
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
  return { subject: 'Your Capshaw member portal account is ready', body };
};

// ─── To the person registering ────────────────────────────────────────────────

function confirmAddress({ name, email, token }) {
  return mailer.send({
    to: [{ email, name: name || '' }],
    ...compose.confirmAddress({ name, token }),
    context: 'account:verify',
    realRecipient: true,
  });
}

// Sent instead of a second account when somebody registers with an address
// that already has one. It means the reply to "register" can be identical
// either way, so the form cannot be used to find out who is a member here.
function addressAlreadyRegistered({ email, name, provider }) {
  return mailer.send({
    to: [{ email, name: name || '' }],
    ...compose.addressAlreadyRegistered({ name, provider }),
    context: 'account:duplicate',
    realRecipient: true,
  });
}

// ─── Forgotten passwords ──────────────────────────────────────────────────────

function resetPassword({ name, email, token }) {
  return mailer.send({
    to: [{ email, name: name || '' }],
    ...compose.resetPassword({ name, token }),
    context: 'account:reset',
    realRecipient: true,
  });
}

function noPasswordToReset({ name, email, provider }) {
  return mailer.send({
    to: [{ email, name: name || '' }],
    ...compose.noPasswordToReset({ name, provider }),
    context: 'account:reset-no-password',
    realRecipient: true,
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

  return mailer.send({
    to: recipients,
    ...compose.awaitingApproval({ user }),
    context: `account:${user.id}:awaiting-approval`,
  });
}

// ─── To the person, once an admin has decided ─────────────────────────────────

function approved({ user, personName }) {
  if (!user.email) return [];

  return mailer.send({
    to: [{ email: user.email, name: user.name }],
    ...compose.approved({ user, personName }),
    context: `account:${user.id}:approved`,
    realRecipient: true,
  });
}

module.exports = {
  compose,
  verifyUrl,
  resetUrl,
  RESET_TTL_MINUTES,
  confirmAddress,
  addressAlreadyRegistered,
  resetPassword,
  noPasswordToReset,
  awaitingApproval,
  approved,
  admins,
};
