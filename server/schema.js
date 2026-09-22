// The complete SQLite schema for the dashboard, in one place.
//
// server/db.js applies it to the real data file; server/tests/helpers/memoryDb.js
// applies it to a throwaway :memory: database. Keeping both on this one module
// means a table added for a feature is present in its tests without anyone
// having to remember to copy it across.

function initSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS question_sets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    passage    TEXT    NOT NULL,
    grade      TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS questions (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id   INTEGER NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
    question TEXT    NOT NULL,
    answer   TEXT    NOT NULL,
    type     TEXT    NOT NULL,
    hint     TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT    NOT NULL DEFAULT 'announcement',
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '',
    event_date TEXT,
    event_time TEXT,
    location   TEXT,
    priority   TEXT    NOT NULL DEFAULT 'normal',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lesson_plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    passage    TEXT    NOT NULL,
    grade      TEXT    NOT NULL,
    duration   INTEGER NOT NULL,
    focuses    TEXT    NOT NULL DEFAULT '',
    plan_json  TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS custom_game_questions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT    NOT NULL,
    question   TEXT    NOT NULL,
    options    TEXT,
    answer     TEXT    NOT NULL,
    hint       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    provider    TEXT    NOT NULL,
    provider_id TEXT    NOT NULL,
    email       TEXT,
    name        TEXT    NOT NULL,
    photo       TEXT,
    role        TEXT    NOT NULL DEFAULT 'pending',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT,
    UNIQUE(provider, provider_id)
  );

  CREATE INDEX IF NOT EXISTS idx_questions_set  ON questions(set_id);
  CREATE INDEX IF NOT EXISTS idx_sets_grade     ON question_sets(grade);

  CREATE TABLE IF NOT EXISTS songs (
    id      INTEGER PRIMARY KEY,
    title   TEXT    NOT NULL,
    hymnal  TEXT    NOT NULL DEFAULT '',
    number  TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS song_services (
    id      INTEGER PRIMARY KEY,
    date    TEXT    NOT NULL,
    service TEXT    NOT NULL,
    leader  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_songs (
    service_id INTEGER NOT NULL REFERENCES song_services(id) ON DELETE CASCADE,
    song_id    INTEGER NOT NULL REFERENCES songs(id),
    position   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (service_id, song_id)
  );

  CREATE TABLE IF NOT EXISTS song_of_week (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id    INTEGER NOT NULL REFERENCES songs(id),
    week_start TEXT    NOT NULL UNIQUE,
    notes      TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_service_songs_song ON service_songs(song_id);
  CREATE INDEX IF NOT EXISTS idx_song_services_date ON song_services(date);

  -- ── Scraped / editable congregation data ────────────────────────────────────

  CREATE TABLE IF NOT EXISTS attendance (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    date    TEXT    NOT NULL,
    service TEXT    NOT NULL DEFAULT '',
    count   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sermons (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    date    TEXT    NOT NULL,
    title   TEXT    NOT NULL DEFAULT '',
    speaker TEXT    NOT NULL DEFAULT '',
    type    TEXT    NOT NULL DEFAULT '',
    series  TEXT    NOT NULL DEFAULT '',
    service TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS job_assignments (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    month   TEXT    NOT NULL DEFAULT '',
    date    TEXT    NOT NULL DEFAULT '',
    service TEXT    NOT NULL DEFAULT '',
    job     TEXT    NOT NULL DEFAULT '',
    name    TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS visitors (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visitor_visits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    date       TEXT    NOT NULL DEFAULT '',
    service    TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS anniversaries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    month     TEXT    NOT NULL DEFAULT '',
    date      TEXT    NOT NULL DEFAULT '',
    names     TEXT    NOT NULL DEFAULT '',
    month_num INTEGER NOT NULL DEFAULT 0,
    day       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS deacons (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deacon_duties (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    deacon_id INTEGER NOT NULL REFERENCES deacons(id) ON DELETE CASCADE,
    duty      TEXT    NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bulletins (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    url   TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS scraped_meta (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    last_updated  TEXT    NOT NULL DEFAULT '',
    last_warnings TEXT    NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date        ON attendance(date);
  CREATE INDEX IF NOT EXISTS idx_sermons_date           ON sermons(date);
  CREATE INDEX IF NOT EXISTS idx_job_assignments_month  ON job_assignments(month);
  CREATE INDEX IF NOT EXISTS idx_visitor_visits_visitor ON visitor_visits(visitor_id);

  CREATE TABLE IF NOT EXISTS directory (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL DEFAULT '',
    address       TEXT NOT NULL DEFAULT '',
    city          TEXT NOT NULL DEFAULT '',
    state         TEXT NOT NULL DEFAULT '',
    zip           TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    cell          TEXT NOT NULL DEFAULT '',
    email         TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    -- JSON array of field names a person or admin edited by hand. The scraper
    -- refuses to overwrite these, so local corrections survive every re-sync.
    edited_fields TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS idx_directory_name ON directory(name);

  -- ── Worship role preferences ────────────────────────────────────────────────
  -- One row per person per role they have an opinion about. Absent means
  -- "no preference given".

  CREATE TABLE IF NOT EXISTS worship_preferences (
    directory_id INTEGER NOT NULL REFERENCES directory(id) ON DELETE CASCADE,
    role         TEXT    NOT NULL,
    level        TEXT    NOT NULL DEFAULT 'willing',
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (directory_id, role)
  );

  CREATE TABLE IF NOT EXISTS worship_profile (
    directory_id INTEGER PRIMARY KEY REFERENCES directory(id) ON DELETE CASCADE,
    notes        TEXT    NOT NULL DEFAULT '',
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  -- ── Workflows ───────────────────────────────────────────────────────────────
  -- Definitions live in code (server/workflows/definitions); only running
  -- instances and their history are stored here.

  CREATE TABLE IF NOT EXISTS workflow_instances (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    definition_id TEXT    NOT NULL,
    title         TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'active',   -- active | completed | cancelled
    step_id       TEXT    NOT NULL DEFAULT '',         -- '' once finished
    outcome       TEXT    NOT NULL DEFAULT '',         -- terminal outcome id
    data          TEXT    NOT NULL DEFAULT '{}',       -- JSON captured at start, plus anything steps add
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at  TEXT
  );

  -- One row per thing somebody has to do. A task is aimed either at a named
  -- person or at anyone holding a role.
  CREATE TABLE IF NOT EXISTS workflow_tasks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id      INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    step_id          TEXT    NOT NULL,
    assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assignee_role    TEXT    NOT NULL DEFAULT '',
    status           TEXT    NOT NULL DEFAULT 'pending', -- pending | done | cancelled
    action           TEXT    NOT NULL DEFAULT '',
    note             TEXT    NOT NULL DEFAULT '',
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at     TEXT,
    completed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  -- Append-only audit trail: who did what, and when.
  CREATE TABLE IF NOT EXISTS workflow_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id   INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    step_id       TEXT    NOT NULL DEFAULT '',
    action        TEXT    NOT NULL DEFAULT '',
    summary       TEXT    NOT NULL DEFAULT '',
    note          TEXT    NOT NULL DEFAULT '',
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Who may see an instance. Membership is earned by starting it, being
  -- assigned a task on it, or acting on it — and is never revoked, so the
  -- history stays readable to the people who took part.
  CREATE TABLE IF NOT EXISTS workflow_participants (
    instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (instance_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_wf_tasks_instance ON workflow_tasks(instance_id);
  CREATE INDEX IF NOT EXISTS idx_wf_tasks_assignee ON workflow_tasks(assignee_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_wf_tasks_role     ON workflow_tasks(assignee_role, status);
  CREATE INDEX IF NOT EXISTS idx_wf_events_inst    ON workflow_events(instance_id);
  CREATE INDEX IF NOT EXISTS idx_wf_inst_status    ON workflow_instances(status);
  -- ── Mail ────────────────────────────────────────────────────────────────────
  -- Distribution groups are lists this app sends to. They are not mailboxes:
  -- an address people can write *to* (elders@…) has to exist at the mail
  -- provider, which is outside this application.

  CREATE TABLE IF NOT EXISTS mail_groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT    NOT NULL UNIQUE,      -- 'elders', 'group-3'
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- A member is either a directory person (so the address follows the
  -- directory as it is corrected) or a plain address for somebody not in it.
  CREATE TABLE IF NOT EXISTS mail_group_members (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     INTEGER NOT NULL REFERENCES mail_groups(id) ON DELETE CASCADE,
    directory_id INTEGER REFERENCES directory(id) ON DELETE CASCADE,
    email        TEXT    NOT NULL DEFAULT '',
    added_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Every message is queued here first and sent from the queue, so a slow or
  -- unavailable mail server never blocks the request that caused it, and
  -- there is a record of what the site tried to send.
  CREATE TABLE IF NOT EXISTS mail_outbox (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email     TEXT    NOT NULL,
    to_name      TEXT    NOT NULL DEFAULT '',
    intended_for TEXT    NOT NULL DEFAULT '',  -- who it would go to but for the test redirect
    subject      TEXT    NOT NULL,
    body         TEXT    NOT NULL DEFAULT '',
    context      TEXT    NOT NULL DEFAULT '',  -- e.g. 'workflow:12'
    status       TEXT    NOT NULL DEFAULT 'pending',  -- pending | sent | failed
    attempts     INTEGER NOT NULL DEFAULT 0,
    error        TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    sent_at      TEXT
  );

  -- ── Service types ───────────────────────────────────────────────────────────
  -- The services the congregation meets for, as a list an admin keeps rather
  -- than free text typed afresh on every attendance record. Attendance points
  -- at one of these by name, so renaming one here is a rename everywhere it is
  -- offered; the records already written keep the name they were saved with.

  CREATE TABLE IF NOT EXISTS service_types (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    -- Retired rather than deleted: a service the church no longer holds should
    -- stop being offered without erasing the attendance recorded under it.
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ── Areas of responsibility ─────────────────────────────────────────────────
  -- One row per area an account looks after. Admins are never listed here:
  -- their access comes from the role, so demoting one leaves nothing behind.
  -- See server/lib/areas.js for the catalogue.

  CREATE TABLE IF NOT EXISTS user_areas (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    area       TEXT    NOT NULL,
    granted_at TEXT    NOT NULL DEFAULT (datetime('now')),
    granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, area)
  );

  CREATE INDEX IF NOT EXISTS idx_user_areas_area ON user_areas(area);

  -- ── Sample data ─────────────────────────────────────────────────────────────
  -- Filling the site up to look at it is easy; getting the filling back out
  -- afterwards is the hard part, and guessing at which rows were made up is how
  -- somebody's real record gets deleted. So every row sample data creates is
  -- written down here as it is made: which table, which id, and what it was.
  -- Removing a batch is then reading this back, not recognising anything.

  CREATE TABLE IF NOT EXISTS seed_batches (
    id          TEXT    PRIMARY KEY,           -- 'sample-2026-09-17-4f21'
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    created_by  TEXT    NOT NULL DEFAULT '',   -- the admin who asked for it
    note        TEXT    NOT NULL DEFAULT '',   -- what it was made for
    generators  TEXT    NOT NULL DEFAULT '[]', -- which parts of the site it filled
    scale       INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS seed_records (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    batch      TEXT    NOT NULL REFERENCES seed_batches(id) ON DELETE CASCADE,
    table_name TEXT    NOT NULL,
    row_id     INTEGER NOT NULL,
    label      TEXT    NOT NULL DEFAULT '',    -- how the row read when it was made
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_seed_records_batch ON seed_records(batch);
  CREATE INDEX IF NOT EXISTS idx_seed_records_row   ON seed_records(table_name, row_id);

  -- ── Action history ──────────────────────────────────────────────────────────
  -- Append-only: every create, edit and delete anybody makes through the
  -- portal, so an admin can answer "who changed this, and when?" without
  -- guessing. Never written to from the client — only by the routes that
  -- perform the change.

  CREATE TABLE IF NOT EXISTS action_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name  TEXT    NOT NULL DEFAULT '',
    area       TEXT    NOT NULL DEFAULT '',
    action     TEXT    NOT NULL DEFAULT '',   -- create | update | delete | other
    entity     TEXT    NOT NULL DEFAULT '',   -- what kind of thing changed
    entity_id  TEXT    NOT NULL DEFAULT '',
    summary    TEXT    NOT NULL DEFAULT '',
    details    TEXT    NOT NULL DEFAULT '{}', -- JSON: before/after where useful
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_action_log_created ON action_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_action_log_area    ON action_log(area, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_action_log_user    ON action_log(user_id, created_at DESC);

  -- ── Elders ──────────────────────────────────────────────────────────────────
  -- Deacons come off the church website; the eldership is kept here by hand,
  -- by whoever holds the Elders & Deacons area.

  CREATE TABLE IF NOT EXISTS elders (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT    NOT NULL,
    phone TEXT    NOT NULL DEFAULT '',
    email TEXT    NOT NULL DEFAULT '',
    notes TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS elder_duties (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    elder_id INTEGER NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
    duty     TEXT    NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_elder_duties_elder ON elder_duties(elder_id);

  -- ── Who may sign up for which serving job ───────────────────────────────────
  -- A row means the Serving Schedule area has decided this person may put
  -- their own name against that job. No row means they cannot.

  CREATE TABLE IF NOT EXISTS job_eligibility (
    directory_id INTEGER NOT NULL REFERENCES directory(id) ON DELETE CASCADE,
    job          TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (directory_id, job)
  );

  -- ── Time away from the serving jobs ─────────────────────────────────────────
  -- A range of days somebody has blocked out: holidays, a hospital stay, a
  -- month with the grandchildren. Both ends are inclusive, and a single day is
  -- a range whose ends are the same date. Stored as YYYY-MM-DD so ranges sort
  -- and compare as plain strings.
  --
  -- The schedule reads these rather than the roster reading around them: the
  -- month builder never puts somebody down for a day they are away, and
  -- neither the man himself nor the schedule keeper can sign him up for one by
  -- accident.

  CREATE TABLE IF NOT EXISTS job_blackouts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    directory_id INTEGER NOT NULL REFERENCES directory(id) ON DELETE CASCADE,
    starts_on    TEXT    NOT NULL,
    ends_on      TEXT    NOT NULL,
    reason       TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_job_blackouts_person ON job_blackouts(directory_id, starts_on);

  CREATE INDEX IF NOT EXISTS idx_mail_members_group ON mail_group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_mail_outbox_status ON mail_outbox(status, id);

  -- ── The weekly newsletter ───────────────────────────────────────────────────
  -- One row per Sunday, holding only the half of the newsletter that no other
  -- page keeps: the prayer lists, the offering, the quote and who leads each
  -- fellowship group. Everything else it prints — the reminders, last week's
  -- attendance, the anniversaries, the elders and deacons, the distribution
  -- groups — is read from the tables that already own it at the moment the
  -- newsletter is built, so correcting an announcement corrects the newsletter
  -- too. See server/lib/bulletinData.js.
  --
  -- The prayer lists are stored as typed: one entry per line. They are a
  -- person's words rather than records to query, and a textarea is both what
  -- the screen offers and what reads back correctly a year later.

  CREATE TABLE IF NOT EXISTS bulletin_issues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sunday      TEXT    NOT NULL UNIQUE,        -- ISO date of the Sunday it is for
    quote       TEXT    NOT NULL DEFAULT '',
    quote_ref   TEXT    NOT NULL DEFAULT '',
    updates     TEXT    NOT NULL DEFAULT '',
    ongoing     TEXT    NOT NULL DEFAULT '',
    shut_ins    TEXT    NOT NULL DEFAULT '',
    pregnancies TEXT    NOT NULL DEFAULT '',
    evangelists TEXT    NOT NULL DEFAULT '',
    offering    TEXT    NOT NULL DEFAULT '',
    building    TEXT    NOT NULL DEFAULT '',
    -- JSON, keyed by the mail group's key: { "group-1": { leader, note } }.
    -- A map rather than a table because it is written and read whole, always
    -- alongside the rest of the issue.
    group_notes TEXT    NOT NULL DEFAULT '{}',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bulletin_issues_sunday ON bulletin_issues(sunday DESC);

  -- ── Church groups ───────────────────────────────────────────────────────────
  -- The small groups the congregation is divided into. Two vocabularies meet
  -- here, and they are deliberately kept apart:
  --
  --   · the Church Groups area — whoever looks after *every* group: making
  --     them, generating a whole set at once, and saying who leads each one.
  --     That is a grant on the account, in user_areas.
  --   · a part inside *one* group — leader, co-leader or host — which says
  --     nothing at all about any other group. That is the role column below.
  --
  -- Every group is tied to a distribution list in mail_groups, so "who is in
  -- my group" and "who gets my group's email" cannot drift apart: membership
  -- is kept here and mirrored there whenever it changes.

  CREATE TABLE IF NOT EXISTS church_groups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    key           TEXT    NOT NULL UNIQUE,   -- 'group-3', and the mail_groups key too
    name          TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    meets         TEXT    NOT NULL DEFAULT '',  -- 'Second Sunday, 5pm'
    location      TEXT    NOT NULL DEFAULT '',
    -- The address people write *to*. It has to exist at the mail provider,
    -- which is outside this application — it is kept here so the page can show
    -- it and so a message to the group can be copied to the list itself.
    email         TEXT    NOT NULL DEFAULT '',
    mail_group_id INTEGER REFERENCES mail_groups(id) ON DELETE SET NULL,
    -- Retired rather than deleted: a group that stopped meeting should stop
    -- being offered without erasing the events it held.
    active        INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per person in a group, pointing at the directory so an address
  -- corrected there is corrected for the group and its mailing list at once.
  CREATE TABLE IF NOT EXISTS church_group_members (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     INTEGER NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
    directory_id INTEGER NOT NULL REFERENCES directory(id) ON DELETE CASCADE,
    role         TEXT    NOT NULL DEFAULT 'member',  -- leader | co-leader | host | member
    added_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    added_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(group_id, directory_id)
  );

  CREATE INDEX IF NOT EXISTS idx_church_group_members_group  ON church_group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_church_group_members_person ON church_group_members(directory_id);

  -- ── Group meetings ──────────────────────────────────────────────────────────
  -- A group's own gathering, written by its leader. Separate from the
  -- announcements table on purpose: that one is the congregation's board and
  -- anybody signed in can read all of it, whereas these belong to one group
  -- and carry replies, an RSVP and a sign-up list with them.

  CREATE TABLE IF NOT EXISTS group_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id       INTEGER NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
    title          TEXT    NOT NULL,
    description    TEXT    NOT NULL DEFAULT '',
    event_date     TEXT    NOT NULL DEFAULT '',   -- YYYY-MM-DD, as text everywhere
    event_time     TEXT    NOT NULL DEFAULT '',
    end_time       TEXT    NOT NULL DEFAULT '',
    location       TEXT    NOT NULL DEFAULT '',
    host_name      TEXT    NOT NULL DEFAULT '',
    rsvp_enabled   INTEGER NOT NULL DEFAULT 1,
    rsvp_deadline  TEXT    NOT NULL DEFAULT '',
    -- 0 means no limit, which is the usual case — a house with room for twenty
    -- is the exception worth recording.
    capacity       INTEGER NOT NULL DEFAULT 0,
    signup_enabled INTEGER NOT NULL DEFAULT 0,
    signup_title   TEXT    NOT NULL DEFAULT 'What to bring',
    -- draft   — being written, only the leaders see it, nobody is told
    -- published — the group has been told about it
    -- cancelled — it is off, and the group has been told that too
    status         TEXT    NOT NULL DEFAULT 'draft',
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    published_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_group_events_group ON group_events(group_id, event_date);

  -- One answer per account per meeting. Overwritten rather than added to, so
  -- changing your mind corrects your answer instead of counting you twice.
  CREATE TABLE IF NOT EXISTS group_event_rsvps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     INTEGER NOT NULL REFERENCES group_events(id) ON DELETE CASCADE,
    -- The account that answered, when the answer came through the portal.
    -- Empty for one a leader wrote down for somebody: plenty of the
    -- congregation will never sign in, and they still say whether they are
    -- coming — to their leader, at church, on the way out.
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    -- Who the answer is *about*, which is a directory person either way. The
    -- roll is kept in directory people (see church_group_members), so this is
    -- what ties an answer to somebody on it.
    directory_id INTEGER REFERENCES directory(id) ON DELETE CASCADE,
    person_name  TEXT    NOT NULL DEFAULT '',
    response     TEXT    NOT NULL DEFAULT 'yes',   -- yes | no | maybe
    -- People they are bringing beyond themselves, so a head count is the
    -- answers plus their guests rather than the answers alone.
    guests       INTEGER NOT NULL DEFAULT 0,
    note         TEXT    NOT NULL DEFAULT '',
    responded_at TEXT    NOT NULL DEFAULT (datetime('now')),
    -- One answer per account. Rows a leader wrote down carry no account at
    -- all, and SQLite counts each NULL as distinct, so they are not caught by
    -- this — one answer per *person* is kept by server/lib/groupEvents.js,
    -- which looks for an existing answer before writing one.
    UNIQUE(event_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_group_event_rsvps_event ON group_event_rsvps(event_id);

  -- What a leader is asking the group to cover: one row per thing needed,
  -- with how many of it. The list is optional — a meeting with nothing to
  -- bring simply has none of these.
  CREATE TABLE IF NOT EXISTS group_event_signup_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   INTEGER NOT NULL REFERENCES group_events(id) ON DELETE CASCADE,
    label      TEXT    NOT NULL,
    notes      TEXT    NOT NULL DEFAULT '',
    needed     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_group_signup_items_event ON group_event_signup_items(event_id);

  -- Who has taken one of those on. A person may take more than one thing, so
  -- there is no unique constraint across the item — only one claim per person
  -- per item, which the route enforces.
  CREATE TABLE IF NOT EXISTS group_event_signups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL REFERENCES group_event_signup_items(id) ON DELETE CASCADE,
    -- Same pair as an answer above: the account if it came through the portal,
    -- and the directory person it is really about.
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    directory_id INTEGER REFERENCES directory(id) ON DELETE CASCADE,
    user_name    TEXT    NOT NULL DEFAULT '',
    detail       TEXT    NOT NULL DEFAULT '',   -- 'a pan of lasagne'
    quantity     INTEGER NOT NULL DEFAULT 1,
    claimed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(item_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_group_signups_item ON group_event_signups(item_id);

  -- ── Comments on events ──────────────────────────────────────────────────────
  -- One thread per event, whichever kind of event it is: a group's meeting or
  -- a dated row on the congregation's announcement board. The subject is named
  -- by a pair — what kind of thing, and which one — rather than by a column
  -- per kind, so a third kind of event later needs no new table.
  --
  -- A removed comment is kept with deleted_at set instead of being dropped:
  -- a thread that silently loses a message reads as though it never had one.

  CREATE TABLE IF NOT EXISTS event_comments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT    NOT NULL,            -- group-event | announcement
    subject_id   INTEGER NOT NULL,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name  TEXT    NOT NULL DEFAULT '',
    body         TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    edited_at    TEXT,
    deleted_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_event_comments_subject
    ON event_comments(subject_type, subject_id, id);

  -- ── Notifications ───────────────────────────────────────────────────────────
  -- What one person has to be told about, in the portal itself rather than only
  -- in their email: a meeting posted for their group, a reply on an event they
  -- are part of, somebody answering their invitation.
  --
  -- A notification is written after the change it describes has already been
  -- saved, and never in the same breath as sending mail — the two go to the
  -- same people for different reasons, and a mail server that is down must not
  -- cost somebody the entry in their bell.

  CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL,            -- see server/lib/notifications.js
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL DEFAULT '',
    -- Where it happened, so the bell can open the thing it is about.
    subject_type TEXT    NOT NULL DEFAULT '',
    subject_id   INTEGER,
    page         TEXT    NOT NULL DEFAULT '',  -- the tab id to open
    -- Who caused it. Kept as a name as well as an id so an entry still reads
    -- properly after the account behind it is removed.
    actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name   TEXT    NOT NULL DEFAULT '',
    read_at      TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications(user_id, read_at, id DESC);
`);
  // ─── Migrations ───────────────────────────────────────────────────────────────
  // CREATE TABLE IF NOT EXISTS leaves existing installs untouched, so columns
  // added after a table shipped need an explicit ALTER.

  function addColumn(table, column, definition) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // Which directory person this login belongs to. Set automatically when the
  // sign-in email matches a directory entry, or assigned by an admin.
  addColumn('users', 'directory_id', 'INTEGER REFERENCES directory(id) ON DELETE SET NULL');
  addColumn('directory', 'edited_fields', "TEXT NOT NULL DEFAULT '[]'");
  // Filename of this person's photo inside server/data/photos, or '' if none.
  addColumn('directory', 'photo', "TEXT NOT NULL DEFAULT ''");
  // Everyone gets the monthly schedule summary unless they turn it off on My
  // Info, so a new account is opted in by default.
  addColumn('users', 'wants_monthly_report', 'INTEGER NOT NULL DEFAULT 1');

  // ── Email + password accounts (provider = 'local') ───────────────────────────
  // Accounts that came from Google or Facebook leave every column below empty:
  // their address is confirmed by the provider and there is no password here to
  // protect. See server/lib/passwords.js for what is actually stored.

  // scrypt digest of the password, salt and cost parameters included. Never the
  // password itself, and never anything reversible.
  addColumn('users', 'password_hash', "TEXT NOT NULL DEFAULT ''");
  // When the person proved they can read the address they signed up with. Null
  // means the confirmation email has not been answered, and they cannot sign in.
  addColumn('users', 'email_verified_at', 'TEXT');
  // SHA-256 of the outstanding confirmation token — never the token, so a copy
  // of this table cannot be used to confirm anybody's address.
  addColumn('users', 'email_verify_hash', "TEXT NOT NULL DEFAULT ''");
  addColumn('users', 'email_verify_expires_at', 'TEXT');
  // Throttles "send it again" so the button cannot be used to mail somebody
  // repeatedly.
  addColumn('users', 'email_verify_sent_at', 'TEXT');
  // Consecutive failed sign-ins, and the time the account stops accepting
  // attempts for a while. Reset the moment a correct password arrives.
  addColumn('users', 'failed_logins', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('users', 'locked_until', 'TEXT');
  // Who let this account in, and when. An approval is the moment an account
  // gains access to the congregation's information, so it is worth a record.
  addColumn('users', 'approved_at', 'TEXT');
  addColumn('users', 'approved_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');

  // Whether this person may be rostered for the men's worship jobs. Chosen on
  // My Info (or by the directory area on their behalf) — not guessed from a
  // name. '' means nobody has said.
  addColumn('directory', 'gender', "TEXT NOT NULL DEFAULT ''");

  // What the church site's own tracker records about a guest, kept apart from
  // `notes`, which is ours: a re-scrape replaces this and never touches that.
  addColumn('visitors', 'comments', "TEXT NOT NULL DEFAULT ''");

  // ── Guest details ────────────────────────────────────────────────────────────
  // The scraper only ever knew a guest's name and the dates they came. Anything
  // learned since — how to reach them, who invited them, what was said — is
  // typed in here by whoever holds the Guest Tracker area.
  addColumn('visitors', 'phone',       "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'email',       "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'address',     "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'city',        "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'state',       "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'zip',         "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'invited_by',  "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'status',      "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'notes',       "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'created_at',  "TEXT NOT NULL DEFAULT ''");

  // ── Follow-up ────────────────────────────────────────────────────────────────
  // Written by the follow-up workflow when somebody actually reaches the guest,
  // so the guest list can show who has been contacted without anybody opening a
  // workflow to find out. The workflow's own history stays the record of what
  // happened; this is the summary of it.
  addColumn('visitors', 'last_contacted_at',     "TEXT NOT NULL DEFAULT ''");
  addColumn('visitors', 'last_contact_method',   "TEXT NOT NULL DEFAULT ''");   // email | phone
  addColumn('visitors', 'last_contacted_by',     "TEXT NOT NULL DEFAULT ''");

  // Who was really at the keyboard, when that is not who the change is
  // attributed to: an admin viewing the portal as a member. Empty for every
  // ordinary change, which is what makes the ones that are not stand out.
  addColumn('action_log', 'acting_user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
  addColumn('action_log', 'acting_user_name', "TEXT NOT NULL DEFAULT ''");

  // ── An answer belongs to a person, not only to an account ───────────────────
  //
  // group_event_rsvps and group_event_signups first shipped with a NOT NULL
  // user_id, which quietly said that only somebody with a sign-in can be
  // counted as coming or as bringing the pudding. That is not this
  // congregation: plenty of the roll will never sign in, and their leader
  // still needs to write them down.
  //
  // CREATE TABLE IF NOT EXISTS leaves an existing table alone and SQLite
  // cannot relax a NOT NULL in place, so the table is rebuilt: a new one
  // beside it, the rows copied across, then the swap. Rebuilt only when it is
  // still the old shape, so this is a no-op on every start after the first.

  function participantColumnIsRequired(table) {
    const column = db.prepare(`PRAGMA table_info(${table})`).all().find(c => c.name === 'user_id');
    return !!column && column.notnull === 1;
  }

  if (participantColumnIsRequired('group_event_rsvps')) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE group_event_rsvps__rebuilt (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id     INTEGER NOT NULL REFERENCES group_events(id) ON DELETE CASCADE,
          user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
          directory_id INTEGER REFERENCES directory(id) ON DELETE CASCADE,
          person_name  TEXT    NOT NULL DEFAULT '',
          response     TEXT    NOT NULL DEFAULT 'yes',
          guests       INTEGER NOT NULL DEFAULT 0,
          note         TEXT    NOT NULL DEFAULT '',
          responded_at TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(event_id, user_id)
        );

        -- Everybody who has already answered is carried over with the
        -- directory person their account belongs to filled in, so an answer
        -- given before this and one written down after it are the same thing.
        INSERT INTO group_event_rsvps__rebuilt
          (id, event_id, user_id, directory_id, person_name, response, guests, note, responded_at)
        SELECT r.id, r.event_id, r.user_id,
               (SELECT u.directory_id FROM users u WHERE u.id = r.user_id),
               r.person_name, r.response, r.guests, r.note, r.responded_at
          FROM group_event_rsvps r;

        DROP TABLE group_event_rsvps;
        ALTER TABLE group_event_rsvps__rebuilt RENAME TO group_event_rsvps;

        CREATE INDEX IF NOT EXISTS idx_group_event_rsvps_event  ON group_event_rsvps(event_id);
        CREATE INDEX IF NOT EXISTS idx_group_event_rsvps_person ON group_event_rsvps(event_id, directory_id);
      `);
    })();
  }

  if (participantColumnIsRequired('group_event_signups')) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE group_event_signups__rebuilt (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id      INTEGER NOT NULL REFERENCES group_event_signup_items(id) ON DELETE CASCADE,
          user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
          directory_id INTEGER REFERENCES directory(id) ON DELETE CASCADE,
          user_name    TEXT    NOT NULL DEFAULT '',
          detail       TEXT    NOT NULL DEFAULT '',
          quantity     INTEGER NOT NULL DEFAULT 1,
          claimed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(item_id, user_id)
        );

        INSERT INTO group_event_signups__rebuilt
          (id, item_id, user_id, directory_id, user_name, detail, quantity, claimed_at)
        SELECT s.id, s.item_id, s.user_id,
               (SELECT u.directory_id FROM users u WHERE u.id = s.user_id),
               s.user_name, s.detail, s.quantity, s.claimed_at
          FROM group_event_signups s;

        DROP TABLE group_event_signups;
        ALTER TABLE group_event_signups__rebuilt RENAME TO group_event_signups;

        CREATE INDEX IF NOT EXISTS idx_group_signups_item   ON group_event_signups(item_id);
        CREATE INDEX IF NOT EXISTS idx_group_signups_person ON group_event_signups(item_id, directory_id);
      `);
    })();
  }

  // Only now, below the rebuild, is directory_id certain to exist: on an
  // install still carrying the first shape, an index naming it up in the
  // declarative block above would fail on a column that is not there yet and
  // take the whole start-up with it.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_group_event_rsvps_person ON group_event_rsvps(event_id, directory_id);
    CREATE INDEX IF NOT EXISTS idx_group_signups_person     ON group_event_signups(item_id, directory_id);
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_directory ON users(directory_id);`);
  // Sign-in looks an account up by address, and two accounts must never share
  // one: 'local' rows store the folded address in provider_id, so the existing
  // UNIQUE(provider, provider_id) already enforces that.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);

  // ─── From the old role ladder to areas ────────────────────────────────────────
  // 'worship-coordinator' was a rung above member that existed only to own the
  // worship roster. That is now the Serving Schedule area, so anybody holding
  // the old role becomes a member who holds it — same access, nothing silently
  // widened or lost.
  const coordinators = db.prepare("SELECT id FROM users WHERE role = 'worship-coordinator'").all();
  if (coordinators.length) {
    const grant  = db.prepare("INSERT OR IGNORE INTO user_areas (user_id, area) VALUES (?, 'serving-schedule')");
    const demote = db.prepare("UPDATE users SET role = 'approved' WHERE id = ?");
    db.transaction(() => {
      for (const c of coordinators) { grant.run(c.id); demote.run(c.id); }
    })();
  }

  // ─── Guests the old visitor parser invented ───────────────────────────────────
  // It paired each heading on the tracker with the table after it, so every
  // guest arrived named after the section holding their dates — "Visit
  // History", "Comments" — rather than after themselves. Those rows are pure
  // scrape artifacts: they are removed here, and their visits go with them, so
  // the next scrape can put the real guests in their place. Anything somebody
  // has since typed into (details, comments of our own) is left alone, however
  // it is named.
  const ARTIFACT_NAMES = [
    'Visit History', 'Visits', 'Visit', 'History', 'Comments', 'Comment',
    'Notes', 'Note', 'Visitor Tracker', 'Visitors', 'Visitor', 'Attendance',
  ];
  const removeArtifact = db.prepare(`
    DELETE FROM visitors
     WHERE lower(trim(name)) = lower(?)
       AND trim(coalesce(phone, ''))      = ''
       AND trim(coalesce(email, ''))      = ''
       AND trim(coalesce(address, ''))    = ''
       AND trim(coalesce(invited_by, '')) = ''
       AND trim(coalesce(status, ''))     = ''
       AND trim(coalesce(notes, ''))      = ''
  `);
  db.transaction(() => { for (const name of ARTIFACT_NAMES) removeArtifact.run(name); })();

  // ─── Seed the service types ───────────────────────────────────────────────────
  // From the attendance already on record first, so every existing row still
  // matches something on the list. A database with no attendance in it yet gets
  // the services this congregation actually holds, which an admin can rename,
  // reorder or retire from Church Office.

  const haveServiceTypes = db.prepare('SELECT COUNT(*) AS n FROM service_types').get().n;
  if (!haveServiceTypes) {
    const fromRecords = db.prepare(
      "SELECT DISTINCT trim(service) AS name FROM attendance WHERE trim(coalesce(service, '')) <> '' ORDER BY name"
    ).all().map(r => r.name);

    const DEFAULT_SERVICE_TYPES = [
      'Sunday Bible Study', 'Sunday AM Worship', 'Sunday PM Worship',
      'Wednesday Bible Study', 'Gospel Meeting', 'Monthly Singing',
    ];

    const insertServiceType = db.prepare(
      'INSERT OR IGNORE INTO service_types (name, sort_order) VALUES (?, ?)'
    );
    (fromRecords.length ? fromRecords : DEFAULT_SERVICE_TYPES)
      .forEach((name, i) => insertServiceType.run(name, i));
  }

  // ─── Seed the distribution groups ─────────────────────────────────────────────
  // Created empty; an admin fills in who is in each from Admin → Email Groups.

  const DEFAULT_MAIL_GROUPS = [
    { key: 'elders',        name: 'Elders',        description: 'The eldership' },
    { key: 'deacons',       name: 'Deacons',       description: 'The deacons' },
    { key: 'men',           name: 'Men',           description: 'Men of the congregation' },
    { key: 'women',         name: 'Women',         description: 'Women of the congregation' },
    { key: 'announcements', name: 'Announcements', description: 'Everyone who wants congregation announcements' },
    ...Array.from({ length: 6 }, (_, i) => ({
      key: `group-${i + 1}`,
      name: `Group ${i + 1}`,
      description: `Fellowship group ${i + 1}`,
    })),
  ];

  const insertGroup = db.prepare(
    'INSERT OR IGNORE INTO mail_groups (key, name, description, sort_order) VALUES (?, ?, ?, ?)'
  );
  DEFAULT_MAIL_GROUPS.forEach((g, i) => insertGroup.run(g.key, g.name, g.description, i));

}

module.exports = { initSchema };
