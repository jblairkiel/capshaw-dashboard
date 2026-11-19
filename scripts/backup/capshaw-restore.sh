#!/usr/bin/env bash
# ─── Restore a backup, run on the droplet ─────────────────────────────────────
#
#   capshaw-restore.sh --list                 what is available, here and off-server
#   capshaw-restore.sh latest                 the newest archive on this droplet
#   capshaw-restore.sh latest-remote          the newest off-server archive
#   capshaw-restore.sh <file.tar.gz>          a specific archive
#   capshaw-restore.sh remote:<name.tar.gz>   a specific off-server archive
#
# Checks the archive first, stops the app, swaps the data in, starts the app
# and waits for it to report healthy. Nothing is deleted: whatever the restore
# replaced is moved to <data dir>/pre-restore-<timestamp>/. Full instructions:
# scripts/backup/README.md.
set -Eeuo pipefail

CONFIG=${CAPSHAW_BACKUP_CONFIG:-/etc/capshaw-backup.env}
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && { set -a; . "$CONFIG"; set +a; }

APP_DIR=${APP_DIR:-/var/www/capshaw-dashboard}
RUNNER=${RUNNER:-docker}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/capshaw}
RCLONE_REMOTE=${RCLONE_REMOTE:-}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3001/api/health}

log() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "RESTORE STOPPED: $*"; exit 1; }

# The droplet's compose file, unless COMPOSE_FILE already says which to use
# (the pipeline test points it at a throwaway project).
compose_args=()
[ -n "${COMPOSE_FILE:-}" ] || compose_args=(-f "$APP_DIR/docker-compose.yml")
compose() { docker compose "${compose_args[@]}" "$@"; }

# The deploy passes CAPSHAW_IMAGE on its command line rather than writing it to
# .env, so a one-off `compose run` would otherwise reach for the default local
# tag. Use whatever image the app container is running now.
if [ "$RUNNER" = docker ] && [ -z "${CAPSHAW_IMAGE:-}" ]; then
  cid=$(compose ps -aq app 2>/dev/null || true)
  [ -n "$cid" ] && CAPSHAW_IMAGE=$(docker inspect -f '{{.Config.Image}}' "$cid") && export CAPSHAW_IMAGE
fi

# The backup command against the stopped app's data: a one-off container on
# the same volume for docker, plain node for pm2.
offline_backup() {
  case "$RUNNER" in
    docker) compose run --rm --no-deps -T app node server/tools/backup.js "$@" ;;
    pm2)    env -C "$APP_DIR" node server/tools/backup.js "$@" ;;
    *)      die "RUNNER must be docker or pm2, not '$RUNNER'" ;;
  esac
}
stop_app()  { case "$RUNNER" in docker) compose stop app ;;  pm2) pm2 stop capshaw-dashboard ;; esac; }
start_app() { case "$RUNNER" in docker) compose start app ;; pm2) pm2 start capshaw-dashboard ;; esac; }

target=${1:-}
[ -n "$target" ] || { sed -n '4,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

if [ "$target" = "--list" ]; then
  echo "On this droplet ($BACKUP_DIR):"
  ls -1t "$BACKUP_DIR"/capshaw-*.tar.gz 2>/dev/null | head -20 | sed 's/^/  /' || echo "  (none)"
  if [ -n "$RCLONE_REMOTE" ]; then
    echo "Off-server ($RCLONE_REMOTE):"
    rclone lsf "$RCLONE_REMOTE" --include 'capshaw-*.tar.gz' | sort -r | head -20 | sed 's/^/  /'
  fi
  exit 0
fi

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

case "$target" in
  latest)
    archive=$(ls -1t "$BACKUP_DIR"/capshaw-*.tar.gz 2>/dev/null | head -1)
    [ -n "$archive" ] || die "no archives in $BACKUP_DIR" ;;
  latest-remote|remote:*)
    [ -n "$RCLONE_REMOTE" ] || die "RCLONE_REMOTE is not set in $CONFIG"
    if [ "$target" = latest-remote ]; then
      name=$(rclone lsf "$RCLONE_REMOTE" --include 'capshaw-*.tar.gz' | sort | tail -1)
      [ -n "$name" ] || die "no archives in $RCLONE_REMOTE"
    else
      name=${target#remote:}
    fi
    log "Downloading $name from $RCLONE_REMOTE"
    rclone copyto "$RCLONE_REMOTE/$name" "$workdir/$name"
    archive="$workdir/$name" ;;
  *)
    archive=$target
    [ -f "$archive" ] || die "no such file: $archive" ;;
esac

log "Checking $archive"
offline_backup verify - < "$archive" || die "the archive did not verify, nothing was changed"

if [ "${ASSUME_YES:-}" != 1 ]; then
  printf 'This replaces the live data with %s and restarts the app. Type RESTORE to continue: ' "$(basename "$archive")" >&2
  read -r answer
  [ "$answer" = RESTORE ] || die "not confirmed, nothing was changed"
fi

log "Stopping the app"
stop_app
# From here on, whatever happens, try to leave the app running.
trap 'trap - ERR; log "Restore failed partway; starting the app again. Anything already replaced is in the pre-restore folder in the data directory"; start_app || true; exit 1' ERR

offline_backup restore - --yes < "$archive"

log "Starting the app"
start_app
trap - ERR

for _ in $(seq 1 30); do
  if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "App is healthy on the restored data"
    exit 0
  fi
  sleep 2
done
die "the app did not report healthy within a minute — check 'docker compose logs app'"
