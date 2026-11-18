#!/usr/bin/env bash
# ─── Nightly backup, run on the droplet ───────────────────────────────────────
#
# Takes a backup archive from the running app, checks it, keeps the last
# KEEP_DAYS of them on the droplet, and copies each one off the droplet with
# rclone. Run it by hand to take a backup now; the systemd timer beside it runs
# it every night. Settings come from /etc/capshaw-backup.env (see
# backup.env.example). Full instructions: scripts/backup/README.md.
set -Eeuo pipefail

CONFIG=${CAPSHAW_BACKUP_CONFIG:-/etc/capshaw-backup.env}
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && { set -a; . "$CONFIG"; set +a; }

APP_DIR=${APP_DIR:-/var/www/capshaw-dashboard}
RUNNER=${RUNNER:-docker}                 # docker | pm2
BACKUP_DIR=${BACKUP_DIR:-/var/backups/capshaw}
KEEP_DAYS=${KEEP_DAYS:-14}
RCLONE_REMOTE=${RCLONE_REMOTE:-}         # e.g. capshaw-offsite:capshaw-backups
REMOTE_KEEP_DAYS=${REMOTE_KEEP_DAYS:-90}
HEALTHCHECK_URL=${HEALTHCHECK_URL:-}     # optional: pinged on success, /fail on failure

log() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

fail() {
  trap - ERR
  rm -f "${partial:-}"
  log "BACKUP FAILED: $*"
  [ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL/fail" >/dev/null 2>&1 || true
  exit 1
}
trap 'fail "line $LINENO exited with status $?"' ERR

# The backup command, run wherever the app's data is.
app_backup() {
  case "$RUNNER" in
    docker) docker compose -f "$APP_DIR/docker-compose.yml" exec -T app node server/tools/backup.js "$@" ;;
    pm2)    env -C "$APP_DIR" node server/tools/backup.js "$@" ;;
    *)      fail "RUNNER must be docker or pm2, not '$RUNNER'" ;;
  esac
}

# One run at a time: a slow upload must not overlap tomorrow's backup.
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || fail "another backup is still running"

name="capshaw-$(date -u +%Y-%m-%dT%H%M%SZ).tar.gz"
partial="$BACKUP_DIR/.$name.partial"

log "Taking $name"
umask 077
app_backup create - > "$partial"
app_backup verify - --quiet < "$partial"
mv "$partial" "$BACKUP_DIR/$name"
log "Saved $BACKUP_DIR/$name ($(du -h "$BACKUP_DIR/$name" | cut -f1))"

# Local retention. Only our own archives, by name, so nothing else in the
# directory is ever touched.
find "$BACKUP_DIR" -maxdepth 1 -name 'capshaw-*.tar.gz' -mtime +"$((KEEP_DAYS - 1))" -print -delete \
  | sed 's/^/  pruned /' >&2 || true

if [ -n "$RCLONE_REMOTE" ]; then
  log "Copying to $RCLONE_REMOTE"
  rclone copyto "$BACKUP_DIR/$name" "$RCLONE_REMOTE/$name" --retries 5 --low-level-retries 10
  # Read it back: a copy that is listed with the right size is a copy that landed.
  remote_size=$(rclone size --json "$RCLONE_REMOTE/$name" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  local_size=$(stat -c %s "$BACKUP_DIR/$name")
  [ "$remote_size" = "$local_size" ] || fail "off-server copy is $remote_size bytes, expected $local_size"
  rclone delete "$RCLONE_REMOTE" --min-age "${REMOTE_KEEP_DAYS}d" --include 'capshaw-*.tar.gz' -v 2>&1 \
    | sed -n 's/.*INFO *: *\(.*\): Deleted.*/  pruned remote \1/p' >&2 || true
  log "Off-server copy confirmed ($remote_size bytes)"
else
  log "WARNING: RCLONE_REMOTE is not set, so this backup only exists on this droplet"
fi

[ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" >/dev/null 2>&1 || true
log "Backup complete"
