# Nightly backups

Every night the droplet takes a backup of everything the portal writes, checks
it, keeps two weeks of copies on the droplet, and sends an encrypted copy off
the droplet. A restore is one command, and nothing it replaces is deleted.

| What | Where |
|---|---|
| What is backed up | The database (a consistent snapshot, taken while the site keeps running), family photos, uploaded orders of service, bug-report screenshots, mail attachments, the cached scrape |
| What is **not** | `.env` (secrets). Keep a copy of it in a password manager. Without `SESSION_SECRET` everyone is signed out, nothing worse; the other values can be re-issued |
| When | 3:15 AM droplet time, every night (`capshaw-backup.timer`) |
| On the droplet | `/var/backups/capshaw/`, the last 14 days (`KEEP_DAYS`) |
| Off the droplet | An rclone remote, the last 90 days (`REMOTE_KEEP_DAYS`), encrypted before it leaves |
| If it fails | The systemd journal says why, and `HEALTHCHECK_URL` (optional) emails you |

Each archive is checked twice before it counts: the database snapshot must
pass SQLite's `integrity_check` when it is taken, and the finished archive is
unpacked again and its database matched against the checksum in its manifest.
The off-server copy is then read back and compared by size.

## Files

| File | What it is |
|---|---|
| `server/tools/backup.js` | `create`, `verify` and `restore` an archive. Runs inside the container (or beside the app under PM2) |
| `scripts/backup/capshaw-backup.sh` | The nightly job: take, verify, rotate, copy off-server |
| `scripts/backup/capshaw-restore.sh` | Pick an archive (local or off-server), verify, stop the app, restore, start, wait for healthy |
| `scripts/backup/capshaw-backup.{service,timer}` | Runs the nightly job under systemd |
| `scripts/backup/backup.env.example` | Settings; copied to `/etc/capshaw-backup.env` |

## Install on the droplet

About 15 minutes, once. Everything is run as the deploy user (the one the
GitHub deploy connects as, which owns `/var/www/capshaw-dashboard` and is in the
`docker` group), with `sudo` where shown. The scripts arrive with the next
deploy's `git pull`, and the backup command is inside the image from the same
deploy onward, so install **after** a deploy that includes this change.

### 1. Somewhere off the droplet to send it

Any storage rclone supports works. Backblaze B2 is the cheap, simple choice:
the first 10 GB is free and a year of this portal's backups is well under that.

1. Sign up at backblaze.com → **B2 Cloud Storage** → **Create a Bucket**.
   Name it (for example `capshaw-backups-<something-random>`), make it
   **Private**, and leave the other settings as they are.
2. **Application Keys** → **Add a New Application Key**: allow access to that
   bucket only, **Read and Write**. Copy the `keyID` and `applicationKey`;
   the second is shown once.

DigitalOcean Spaces, S3, Wasabi, or Google Drive work the same way with a
different `rclone config` provider in the next step.

### 2. rclone, with encryption

```bash
sudo apt-get install -y rclone        # or: curl https://rclone.org/install.sh | sudo bash
rclone config
```

Make two remotes in the interactive prompt:

1. `n` → name **`b2`** → storage **`b2`** → paste the keyID as `account` and the
   applicationKey as `key` → accept the defaults for the rest.
2. `n` → name **`capshaw-offsite`** → storage **`crypt`** → remote
   **`b2:<your-bucket-name>/capshaw`** → filename encryption `standard` →
   choose your own password and a second (salt) password.

**Write both crypt passwords down somewhere that is not the droplet** (a
password manager). If the droplet is lost, they are the only way to decrypt the
off-server backups: the bucket only ever holds ciphertext, with the file names
encrypted too.

Check it:

```bash
rclone mkdir capshaw-offsite:
rclone lsf capshaw-offsite:           # empty, and no error
```

### 3. Settings

```bash
cd /var/www/capshaw-dashboard
sudo cp scripts/backup/backup.env.example /etc/capshaw-backup.env
sudo chown "$USER": /etc/capshaw-backup.env && chmod 600 /etc/capshaw-backup.env
nano /etc/capshaw-backup.env          # RUNNER=pm2 if the droplet still runs PM2
sudo install -d -o "$USER" -m 700 /var/backups/capshaw
```

Optional but recommended: make a free check at healthchecks.io with a 1 day
period and 2 hour grace, and put its ping URL in `HEALTHCHECK_URL`. You then
get an email if a night's backup fails **or never runs at all**, which nothing
on the droplet itself can tell you.

### 4. Take the first one by hand

```bash
scripts/backup/capshaw-backup.sh
```

It ends with `Off-server copy confirmed` and `Backup complete`. Anything else
says what went wrong. `rclone lsf capshaw-offsite:` now lists it.

### 5. Schedule it

```bash
sed "s/^User=deploy$/User=$USER/" scripts/backup/capshaw-backup.service \
  | sudo tee /etc/systemd/system/capshaw-backup.service >/dev/null
sudo cp scripts/backup/capshaw-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now capshaw-backup.timer
systemctl list-timers capshaw-backup.timer      # shows the next run
```

The timer uses the droplet's clock; `timedatectl` shows its time zone, and
`sudo timedatectl set-timezone America/Chicago` makes 3:15 AM mean Capshaw's
3:15 AM.

### 6. Prove the restore, once

A backup nobody has restored is a hope. On the droplet:

```bash
scripts/backup/capshaw-restore.sh --list          # local and off-server archives
scripts/backup/capshaw-restore.sh latest-remote   # type RESTORE when asked
```

It downloads and checks the archive before it touches anything, stops the app
for a few seconds, swaps the data in, starts it and waits for it to report
healthy. Restoring the backup you just took changes nothing visible, which is
the point: it shows the off-server copy, its passwords and the restore all work.

## Day to day

| | |
|---|---|
| Did last night's run work? | `journalctl -u capshaw-backup --since yesterday` |
| Take one now | `scripts/backup/capshaw-backup.sh` (or `sudo systemctl start capshaw-backup`) |
| What is there | `scripts/backup/capshaw-restore.sh --list` |
| Check an archive without restoring | `docker compose exec -T app node server/tools/backup.js verify - < /var/backups/capshaw/<file>` (add `--counts` for per-table row counts; leave it off anywhere the output is shared) |

## Restoring

**A mistake today** (a bad import, something deleted): restore last night's
copy from the droplet. Anything changed since that backup is lost, so check the
time in the file name first.

```bash
scripts/backup/capshaw-restore.sh --list
scripts/backup/capshaw-restore.sh latest                     # or a specific file:
scripts/backup/capshaw-restore.sh /var/backups/capshaw/capshaw-2026-11-17T091503Z.tar.gz
```

**The droplet is gone.** On a new droplet: follow the README's droplet setup
(Docker, the checkout, `.env` from your password manager), then steps 2 and 3
above using the **same** crypt passwords, `docker compose up -d`, and:

```bash
scripts/backup/capshaw-restore.sh latest-remote
# or an older one:  scripts/backup/capshaw-restore.sh remote:capshaw-2026-11-01T091503Z.tar.gz
```

**Undoing a restore.** Nothing is deleted. What the restore replaced is in a
`pre-restore-<time>` folder inside the data volume. To put it back, stop the
app and move those files back over the restored ones. Once you are happy with a
restore, those folders can be removed:

```bash
docker compose exec app sh -c 'ls -d /data/pre-restore-*'
docker compose exec app sh -c 'rm -rf /data/pre-restore-<time>'
```

**By hand, with no scripts at all.** An archive is an ordinary `.tar.gz`.
`tar xzf capshaw-….tar.gz` gives `capshaw-backup/database.db` (the SQLite
file, openable with any SQLite tool), the photo and upload folders, and
`manifest.json` saying what is inside. With the app stopped, copying those into
the data directory (`/data` in the container, `server/data` and
`server/uploads` under PM2) and deleting any `bible_questions.db-wal` and
`-shm` beside the old database is a complete restore.

## The pipeline test

`.github/workflows/backup-pipeline.yml` runs the whole thing in CI on every
change to the backup code, and once a week: it fills a throwaway container
with sample data, runs `capshaw-backup.sh`, checks that Backblaze holds only
ciphertext, plants a 120-day-old archive and checks the next run prunes it,
deletes the volume and the local backups, runs `capshaw-restore.sh
latest-remote`, and compares every member record and file with what was
backed up. `scripts/backup/pipeline-test.sh` is the test, and runs the same
on any machine with Docker (`CAPSHAW_IMAGE=<image> scripts/backup/pipeline-test.sh`).

It talks to Backblaze when three repository secrets are set, and to a local
folder otherwise. To turn on the Backblaze half:

1. Backblaze → **Application Keys** → **Add a New Application Key**: name it
   `capshaw-ci`, allow access to the backups bucket only, **Read and Write**,
   and set **File name prefix** to `ci/`. That key can only touch `ci/`, so
   CI can never read or delete the droplet's real backups.
2. GitHub → the repository → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**, three times:
   `B2_KEY_ID`, `B2_APPLICATION_KEY` (from that key) and `B2_BUCKET`.
3. **Actions** → **Backup pipeline** → **Run workflow**. The run's summary says
   which target it used.

Each run writes under `ci/<run id>/` with encryption passwords made up for
that run, and deletes it when it finishes.
