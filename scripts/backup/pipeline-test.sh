#!/usr/bin/env bash
# ─── The backup pipeline, end to end, against a real container ────────────────
#
# What the droplet relies on, run start to finish on a throwaway copy of the
# app: fill it with sample data, take a backup with capshaw-backup.sh, send it
# off-server through an encrypted rclone remote, lose everything (the volume
# and the local backups), restore from the off-server copy with
# capshaw-restore.sh, and check the members' data came back exactly.
#
# Off-server means Backblaze B2 when B2_KEY_ID, B2_APPLICATION_KEY and
# B2_BUCKET are set: everything this run writes goes under ci/<run id>/ in that
# bucket and is deleted at the end. Without them (a fork's pull request, a
# laptop) it uses a local folder instead, which tests everything except the
# network hop to Backblaze.
#
#   CAPSHAW_IMAGE=capshaw-dashboard:ci scripts/backup/pipeline-test.sh
#
# Run by .github/workflows/backup-pipeline.yml. Needs docker compose, rclone,
# curl and jq.
set -Eeuo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
: "${CAPSHAW_IMAGE:?set CAPSHAW_IMAGE to the image to test}"
export CAPSHAW_IMAGE
RUN_ID=${GITHUB_RUN_ID:-local-$(date -u +%Y%m%d%H%M%S)}-${GITHUB_RUN_ATTEMPT:-1}

work=$(mktemp -d)
step() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

# A compose project of its own, so a run never touches a real installation's
# containers or volume on the same machine.
export COMPOSE_PROJECT_NAME=capshaw-backup-ci

# ── Where "off-server" is ────────────────────────────────────────────────────
export RCLONE_CONFIG="$work/rclone.conf"
if [ -n "${B2_KEY_ID:-}" ] && [ -n "${B2_APPLICATION_KEY:-}" ] && [ -n "${B2_BUCKET:-}" ]; then
  target_kind="Backblaze B2 (bucket ${B2_BUCKET}, prefix ci/${RUN_ID})"
  target="b2:${B2_BUCKET}/ci/${RUN_ID}"
  cat > "$RCLONE_CONFIG" <<EOF
[b2]
type = b2
account = ${B2_KEY_ID}
key = ${B2_APPLICATION_KEY}
hard_delete = true
EOF
else
  target_kind="a local folder (no B2 credentials in this run)"
  target="local:$work/bucket"
  mkdir -p "$work/bucket"
  printf '[local]\ntype = local\n' > "$RCLONE_CONFIG"
fi
# Fresh encryption passwords every run: nothing this run uploads can be read
# by anyone, the run included, once it is over.
cat >> "$RCLONE_CONFIG" <<EOF

[capshaw-offsite]
type = crypt
remote = ${target}
filename_encryption = standard
directory_name_encryption = true
password = $(rclone obscure "$(head -c 32 /dev/urandom | base64)")
password2 = $(rclone obscure "$(head -c 32 /dev/urandom | base64)")
EOF

cleanup() {
  local status=$?
  set +e
  if [ "$status" -ne 0 ]; then
    echo; echo "Container log (last 80 lines):"; compose logs --tail 80 app 2>/dev/null
  fi
  compose down -v >/dev/null 2>&1
  case "$target" in b2:*) rclone purge "$target" --b2-hard-delete >/dev/null 2>&1 && echo "Removed ${target} from the bucket" ;; esac
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

# The settings capshaw-backup.sh and capshaw-restore.sh read on the droplet.
export CAPSHAW_BACKUP_CONFIG="$work/backup.env"
cat > "$CAPSHAW_BACKUP_CONFIG" <<EOF
APP_DIR=$REPO
RUNNER=docker
BACKUP_DIR=$work/backups
KEEP_DAYS=14
RCLONE_REMOTE=capshaw-offsite:
REMOTE_KEEP_DAYS=90
EOF
# docker-compose.yml reads the checkout's .env for the app's settings. Give the
# app a throwaway one instead, through an override, so a run never reads (or
# needs) a real .env. COMPOSE_FILE carries the override into the backup and
# restore scripts too.
printf 'SESSION_SECRET=backup-pipeline-test-only-%s\n' "$RUN_ID" > "$work/app.env"
override="$work/compose.override.yml"
printf 'services:\n  app:\n    env_file: !override\n      - %s\n' "$work/app.env" > "$override"
export COMPOSE_FILE="$REPO/docker-compose.yml:$override"
compose() { docker compose "$@"; }

wait_healthy() {
  for _ in $(seq 1 60); do
    curl -fsS -m 3 http://127.0.0.1:3001/api/health >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "the app did not report healthy within a minute"
}

# What a restore has to bring back: the congregation's records and files.
# Tables the app writes to on its own as it starts (sessions, visits, the job
# schedule) are left out, since they legitimately differ after a restart.
fingerprint() {
  compose exec -T app node -e '
    const db = require("./server/db");
    const fs = require("fs"), path = require("path"), crypto = require("crypto");
    const tables = ["users", "directory", "church_groups", "church_group_members",
      "workflow_instances", "workflow_tasks", "visitors", "visitor_visits",
      "attendance", "contributions", "member_attendance", "songs"];
    const out = { rows: {}, files: {} };
    for (const t of tables) {
      const rows = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all();
      out.rows[t] = { count: rows.length,
        sha: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16) };
    }
    for (const dir of ["/data/photos", "/data/uploads"]) {
      const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
      for (const f of walk(dir).sort()) {
        out.files[f] = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
      }
    }
    console.log(JSON.stringify(out));
  '
}

summary() { jq -r '"users=\(.rows.users.count)  directory=\(.rows.directory.count)  church_groups=\(.rows.church_groups.count)  attendance=\(.rows.attendance.count)  files=\(.files | length)"' <<<"$1"; }

step "Off-server target: ${target_kind}"
rclone mkdir capshaw-offsite:
[ -z "$(rclone lsf capshaw-offsite:)" ] || die "the run's prefix is not empty"
pass "encrypted remote reachable and empty"

step "Start the app and fill it with sample data"
compose up -d --no-build app >/dev/null 2>&1
wait_healthy
compose exec -T app node -e '
  const seed = require("./server/seed");
  seed.generate({ scale: 1, note: "backup pipeline test" });
  const db = require("./server/db");
  const add = db.prepare("INSERT INTO users (provider, provider_id, email, name, role) VALUES (?, ?, ?, ?, ?)");
  add.run("local", "ci-1", "pipeline-canary@example.org", "Pipeline Canary", "admin");
  add.run("local", "ci-2", "second.member@example.org", "Second Member", "member");
  const fs = require("fs");
  fs.mkdirSync("/data/photos", { recursive: true });
  for (const n of ["smith", "jones", "miller"]) fs.writeFileSync(`/data/photos/${n}.jpg`, require("crypto").randomBytes(30000));
  fs.writeFileSync("/data/uploads/order-of-service.docx", require("crypto").randomBytes(9000));
'
before=$(fingerprint)
echo "  $(summary "$before")"
[ "$(jq '.rows.users.count' <<<"$before")" -ge 2 ] || die "seeding did not add users"
pass "sample data in place"

step "Nightly backup (scripts/backup/capshaw-backup.sh)"
"$REPO/scripts/backup/capshaw-backup.sh"
remote=$(rclone lsf capshaw-offsite: --include 'capshaw-*.tar.gz')
[ "$(wc -l <<<"$remote")" -eq 1 ] || die "expected one archive off-server, found: $remote"
pass "one archive off-server: $remote"

step "The storage provider only holds ciphertext"
raw=$(rclone lsf -R "$target" --files-only)
echo "  raw object names: $(tr '\n' ' ' <<<"$raw")"
grep -q capshaw <<<"$raw" && die "an object name is readable: $raw"
# The archive is gzip, so look for the gzip magic and for a seeded address
# in what the provider stores; neither may appear.
rclone cat "$target/$(head -1 <<<"$raw")" > "$work/raw.bin"
head -c 2 "$work/raw.bin" | od -An -tx1 | grep -q '1f 8b' && die "the stored object is a plain gzip archive"
zcat -f "$work/raw.bin" 2>/dev/null | grep -aq pipeline-canary && die "member data is readable in the stored object"
pass "names and contents encrypted ($(stat -c %s "$work/raw.bin") bytes stored)"

step "Retention: an off-server copy older than 90 days is pruned"
old="capshaw-$(date -u -d '-120 days' +%Y-%m-%dT031500Z).tar.gz"
cp "$work/backups/$remote" "$work/$old" && touch -d '-120 days' "$work/$old"
rclone copyto "$work/$old" "capshaw-offsite:$old"
rclone lsf capshaw-offsite: | grep -qx "$old" || die "could not plant the old archive"
"$REPO/scripts/backup/capshaw-backup.sh" 2>&1 | grep -E 'pruned remote|Off-server copy confirmed|Backup complete' | sed 's/^/  /'
rclone lsf capshaw-offsite: | grep -qx "$old" && die "the 120-day-old archive was not pruned"
[ "$(rclone lsf capshaw-offsite: --include 'capshaw-*.tar.gz' | wc -l)" -eq 2 ] || die "expected the two fresh archives to remain"
pass "old copy pruned, the two fresh ones kept"

step "Disaster: the volume and the local backups are gone"
compose down -v >/dev/null 2>&1
rm -rf "$work/backups"
compose up -d --no-build app >/dev/null 2>&1
wait_healthy
empty=$(fingerprint)
echo "  $(summary "$empty")"
[ "$(jq '.rows.users.count' <<<"$empty")" -eq 0 ] || die "the fresh install is not empty"
pass "fresh install, nothing in it"

step "Restore from off-server (scripts/backup/capshaw-restore.sh latest-remote)"
ASSUME_YES=1 "$REPO/scripts/backup/capshaw-restore.sh" latest-remote 2>&1 | grep -v -- '-app-run-' | sed 's/^/  /'
after=$(fingerprint)
echo "  $(summary "$after")"

step "Everything came back"
if [ "$(jq -S . <<<"$before")" != "$(jq -S . <<<"$after")" ]; then
  diff <(jq -S . <<<"$before") <(jq -S . <<<"$after") | head -40
  die "restored data differs from what was backed up"
fi
jq -r '.rows | to_entries[] | "  \(.key): \(.value.count) rows, identical"' <<<"$after"
pass "$(jq '.files | length' <<<"$after") files byte-for-byte identical"
compose exec -T app node -e 'const db=require("./server/db"); const u=db.prepare("SELECT name FROM users WHERE email=?").get("pipeline-canary@example.org"); if(!u) process.exit(1); console.log("  canary account: " + u.name)'
pass "backup → ${target_kind%% (*} → restore round trip passed"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Backup pipeline: passed"
    echo
    echo "Off-server target: ${target_kind}"
    echo
    echo "| | Before backup | After restore |"
    echo "|---|---|---|"
    jq -r --argjson a "$after" '.rows | to_entries[] | "| \(.key) | \(.value.count) | \($a.rows[.key].count) |"' <<<"$before"
    echo "| files | $(jq '.files|length' <<<"$before") | $(jq '.files|length' <<<"$after") |"
  } >> "$GITHUB_STEP_SUMMARY"
fi
