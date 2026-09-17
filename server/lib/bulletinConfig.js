// ─── The parts of the newsletter that are facts about the congregation ────────
//
// The masthead, the service times and the footer do not come from a table
// because nothing in the portal edits them — they change when the building
// moves, which is to say not on a weekly basis. They live here rather than
// inside the renderers so that the .docx and the .pdf cannot drift apart, and
// so that changing the phone number is a one-line edit in an obvious place.
module.exports = {
  masthead: 'Capshaw Church of Christ Newsletter',

  serviceTimes: 'Sunday AM Classes – 9:00; Sunday AM Worship – 9:50; Wednesday PM Classes – 7:00',

  address: ['8941 Wall Triana Hwy,', 'Harvest, AL 35749'],
  phone:   '(256) 771-0390',
  website: 'www.capshawchurch.org',
  social: [
    ['Youtube',   '@CapshawChurch'],
    ['Instagram', 'capshawchurch'],
    ['Facebook',  'Capshaw church of Christ'],
  ],

  // Distribution groups are addressed at this domain. The local part is the
  // group's key with its hyphen removed, so 'group-1' is group1@… — which is
  // what the printed table has always said.
  mailDomain: 'capshawchurch.org',

  // Which groups the "Key Email Contacts" table lists, in the order the draft
  // prints them. A group not named here is a list the app sends to but the
  // newsletter does not advertise.
  contactGroups: ['announcements', 'elders', 'group-1', 'group-2', 'group-3', 'group-4', 'group-5', 'group-6'],

  // The table's wording where it differs from the group's name in the portal.
  contactLabels: {
    elders: 'Elder Correspondence',
  },
};
