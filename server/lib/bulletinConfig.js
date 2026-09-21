// ─── The parts of the newsletter that are facts about the congregation ────────
//
// The masthead, the service times, the eldership's evangelist and the footer do
// not come from a table because nothing in the portal edits them — they change
// when the building moves or the preacher does, which is to say not weekly.
// They live here rather than inside the renderers so that the .docx and the
// .pdf cannot drift apart, and so that changing the phone number is a one-line
// edit in an obvious place.
const path = require('path');

module.exports = {
  masthead: 'Capshaw Church of Christ Newsletter',

  // The banner artwork behind the masthead, as it appeared in the newsletter
  // this layout reproduces. Under server/ so the container copies it with the
  // rest of the source.
  mastheadImage: path.join(__dirname, '..', 'assets', 'masthead.jpg'),

  // How far ahead the Reminders list looks. "Coming up" is the point of that
  // section, and the newsletter this reproduces announced a VBS kickoff seven
  // weeks out, so the window is generous rather than a single week.
  reminderHorizonDays: 60,

  serviceTimes: 'Sunday AM Classes – 9:00; Sunday AM Worship – 9:50; Wednesday PM Classes – 7:00',

  // ─── The duty roster ────────────────────────────────────────────────────────
  //
  // The roster prints two weeks side by side, and prints a row for every job
  // whether or not anybody is against it yet — an empty row is how a gap gets
  // noticed and filled. These are the rows it always shows, in order; a job
  // that turns up in the serving schedule without being named here is added
  // after them rather than dropped.
  //
  // They are deliberately not server/workflows/scheduling.js's SERVICE_ROLES:
  // that list is what the schedule builder creates slots for, and the printed
  // roster has always shown more (Announcements and Visuals are nobody's slot).
  dutyJobs: {
    sunday: [
      'Announcements', 'Song Leader', 'Opening Prayer', 'Scripture Reading',
      'Sermon', 'Closing Prayer', 'Communion Leader', 'Communion Assists',
      'Ushers', 'Visuals',
    ],
    wednesday: ['Song Leader', 'Speaker', 'Closing Prayer'],
  },

  // ─── Leadership ─────────────────────────────────────────────────────────────

  // The congregation's evangelist. There is no table for this — one man, named
  // on the newsletter beneath the elders.
  evangelist: { name: 'Buc Chumbley', phone: '(256) 777-1065' },

  // How much of a deacon's responsibilities the newsletter prints. Sixteen
  // deacons each carrying a full description turned that block into a wall of
  // running text; clipping the longest of them keeps the list readable without
  // dropping the responsibilities altogether. The Elders & Deacons page still
  // holds the whole thing — this is the newsletter's summary of it.
  deaconDutyMaxLength: 30,

  // ─── Contacts ───────────────────────────────────────────────────────────────

  // Distribution groups are addressed at this domain. The local part is the
  // group's key with its hyphen removed, so 'group-1' is group1@…
  mailDomain: 'capshawchurch.org',

  // Which groups the "Key Email Contacts" panel lists, in the order it prints
  // them. The fellowship groups are reachable by mail but are not advertised
  // here — the panel is the two addresses a member actually writes to.
  contactGroups: ['announcements', 'elders'],

  // The panel's wording where it differs from the group's name in the portal.
  contactLabels: {
    announcements: 'Announcements',
    elders:        'Elder correspondence',
  },

  // Whoever to write to about the site itself. Not a distribution group —
  // these are people, listed by name.
  websiteAdmins: [
    { name: 'Blair Kiel',    email: 'jblairkiel@gmail.com' },
    { name: 'Darren Winland', email: 'darrenwinland@gmail.com' },
  ],

  // ─── Find us ────────────────────────────────────────────────────────────────

  address: ['8941 Wall Triana Hwy,', 'Harvest, AL 35749'],
  phone:   '(256) 771-0390',
  website: 'www.capshawchurch.org',
  social: [
    ['Youtube',   '@CapshawChurch'],
    ['Instagram', 'capshawchurch'],
    ['Facebook',  'Capshaw church of Christ'],
  ],

  // ─── Type sizes, per edition ────────────────────────────────────────────────
  //
  // The newsletter is set small so that a week fits on two pages, which does
  // not suit everybody who has to read it. The large-print edition is the same
  // newsletter at a size the RNIB would recognise — 16pt body text rather than
  // 9 — and it is longer for it.
  //
  // Sizes are named by the job they do rather than scaled by a single factor:
  // the masthead is already large and does not want multiplying, while the body
  // text has to nearly double. Both renderers read these, so the .docx and the
  // .pdf cannot drift apart.
  type: {
    normal: {
      banner: 25, date: 12, quote:  9.5, panelTitle: 20,
      section: 13, cardHead: 11, body: 10, small: 8.5, lead: 9,
      times: 9.5, roster: 9, rosterTitle: 10,
    },
    large: {
      banner: 26, date: 17, quote: 14, panelTitle: 22,
      section: 19, cardHead: 18, body: 16, small: 15, lead: 16,
      times: 15, roster: 16, rosterTitle: 17,
    },
  },

  // ─── The palette the printed newsletter uses ────────────────────────────────
  // Sampled from it, and shared by both renderers so the two files match.
  colors: {
    navy:   '0E2841',   // headings, the spine, the Find Us panel
    card:   'E8E8E8',   // the grey cards down the left column
    rule:   'D1D1D1',   // the duty roster's title row
    peach:  'FBE3D6',   // the service-times bar
    link:   '467886',   // an email address
    white:  'FFFFFF',
  },
};
