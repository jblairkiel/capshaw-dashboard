#!/usr/bin/env bash
# ─── One-time server setup, run on the droplet ────────────────────────────────
#
#   server-setup.sh preflight   read-only: what is there, what is missing
#   server-setup.sh nginx       real visitor address + server_tokens off
#   server-setup.sh backups     backup install steps 3-6 (scripts/backup/README.md)
#
# Run by the "Server setup" workflow (.github/workflows/server-setup.yml) as the
# deploy user, or by hand. Every step is safe to run twice: whatever is already
# in place is left as it is.
#
# This repository is public, and so are its workflow logs. Nothing here prints
# a config file, a secret, a bucket name or the names of the other sites this
# nginx serves: those are counted and checked, and shown as site-1, site-2...
set -Eeuo pipefail

# Every check below talks to this droplet's own nginx (--resolve to 127.0.0.1).
# A proxy in the environment would quietly send those requests to whatever the
# name resolves to instead, which is the live site, so never use one here.
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
curl() { command curl --noproxy '*' "$@"; }

APP_DIR=${APP_DIR:-/var/www/capshaw-dashboard}
DOMAIN=${DOMAIN:-capshaw.jblairkiel.com}
BACKUP_CONFIG=/etc/capshaw-backup.env
NGINX_KEEP=/root/nginx-backups
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

log()  { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*"; }
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '::error::%s\n' "$*"; exit 1; }
need_sudo() { sudo -n true 2>/dev/null || die "$(whoami) cannot use sudo without a password, which this step needs."; }

# The file nginx actually reads for the portal (sites-enabled is usually a link).
capshaw_site() {
  local f
  for f in /etc/nginx/sites-enabled/capshaw /etc/nginx/sites-available/capshaw; do
    [ -e "$f" ] && { readlink -f "$f"; return; }
  done
  sudo grep -lsr "server_name[^;]*\b${DOMAIN//./\\.}\b" /etc/nginx/sites-enabled /etc/nginx/conf.d | head -1 | xargs -r readlink -f
}

# ── preflight ─────────────────────────────────────────────────────────────────
preflight() {
  log "Who and where"
  echo "  user: $(whoami)   groups: $(id -nG)"
  if sudo -n true 2>/dev/null; then ok "passwordless sudo"; else warn "no passwordless sudo (nginx and backup steps need it)"; fi
  id -nG | grep -qw docker && ok "in the docker group" || warn "not in the docker group"
  [ -d "$APP_DIR" ] && ok "$APP_DIR owned by $(stat -c %U "$APP_DIR"), at $(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')" \
    || warn "$APP_DIR is missing"
  echo "  droplet time zone: $(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo '?')"

  log "nginx"
  if sudo -n true 2>/dev/null; then
    local site; site=$(capshaw_site)
    [ -n "$site" ] && ok "portal site file found" || warn "no nginx site file for $DOMAIN"
    if [ -n "$site" ]; then
      echo "  proxy_set_header Host lines in it: $(sudo grep -c 'proxy_set_header[[:space:]]\+Host[[:space:]]' "$site" || true)"
      sudo grep -q 'X-Real-IP' "$site" && ok "already forwards X-Real-IP" || echo "  does not forward the visitor's address yet"
    fi
    echo "  enabled site files: $(sudo find /etc/nginx/sites-enabled -mindepth 1 -maxdepth 1 | wc -l)"
    echo "  server names served: $(server_names | wc -l)"
    sudo nginx -T 2>/dev/null | grep -qE '^[[:space:]]*server_tokens[[:space:]]+off' && ok "server_tokens off" || echo "  server_tokens is not off"
    sudo nginx -t >/dev/null 2>&1 && ok "nginx -t passes" || warn "nginx -t fails before any change"
  fi
  curl -sskI "https://$DOMAIN/" --resolve "$DOMAIN:443:127.0.0.1" | grep -i '^server:' | sed 's/^/  /' || true

  log "Backups"
  command -v rclone >/dev/null && ok "rclone $(rclone version 2>/dev/null | head -1 | awk '{print $2}')" || warn "rclone is not installed"
  if command -v rclone >/dev/null; then
    echo "  rclone remotes for $(whoami): $(rclone listremotes 2>/dev/null | tr '\n' ' ')"
    local u
    for u in root deploy claude-deploy; do
      local home; home=$(getent passwd "$u" | cut -d: -f6) || continue
      [ "$u" = "$(whoami)" ] && continue
      sudo -n test -f "$home/.config/rclone/rclone.conf" 2>/dev/null && echo "  $u also has an rclone config"
    done
  fi
  [ -f "$BACKUP_CONFIG" ] && ok "$BACKUP_CONFIG exists" || echo "  $BACKUP_CONFIG not there yet"
  [ -d /var/backups/capshaw ] && echo "  local archives: $(ls /var/backups/capshaw/capshaw-*.tar.gz 2>/dev/null | wc -l)" || echo "  /var/backups/capshaw not there yet"
  systemctl is-enabled capshaw-backup.timer >/dev/null 2>&1 && ok "nightly timer enabled" || echo "  nightly timer not installed"
  [ -x "$APP_DIR/scripts/backup/capshaw-backup.sh" ] && ok "backup scripts present in the checkout" || warn "backup scripts missing from $APP_DIR"
}

# ── nginx ─────────────────────────────────────────────────────────────────────
server_names() {
  sudo nginx -T 2>/dev/null \
    | grep -v '^[[:space:]]*#' \
    | grep -o 'server_name[[:space:]][^;]*' | sed 's/^server_name[[:space:]]*//' \
    | tr ' \t' '\n\n' | grep -E '^[A-Za-z0-9.-]+\.[A-Za-z]+$' | sort -u
}

# "<name> <http code> <https code>" for every site, so the before and after can
# be compared. Asked of this nginx directly, not through DNS.
site_statuses() {
  local n
  while read -r n; do
    printf '%s %s %s\n' "$n" \
      "$(curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve "$n:80:127.0.0.1"  "http://$n/")" \
      "$(curl -sk -o /dev/null -m 10 -w '%{http_code}' --resolve "$n:443:127.0.0.1" "https://$n/")"
  done < <(server_names)
}

print_masked() {
  local i=0 n a b
  while read -r n a b; do
    i=$((i + 1))
    if [ "$n" = "$DOMAIN" ]; then label=portal; else label="site-$i"; fi
    printf '  %-8s http %s  https %s\n' "$label" "$a" "$b"
  done < "$1"
}

nginx_apply() {
  need_sudo
  local site; site=$(capshaw_site)
  [ -n "$site" ] || die "Could not find the nginx site for $DOMAIN."
  local ts; ts=$(date -u +%Y%m%dT%H%M%SZ)
  local work=$WORK

  log "Backing up all of /etc/nginx to $NGINX_KEEP/nginx-$ts.tar.gz"
  sudo install -d -m 700 "$NGINX_KEEP"
  sudo tar czf "$NGINX_KEEP/nginx-$ts.tar.gz" -C /etc nginx
  sudo cp -p "$site" "$NGINX_KEEP/capshaw-site-$ts"
  sudo nginx -t >/dev/null 2>&1 || die "nginx -t already fails before any change; leaving it alone."

  log "Every site, before"
  site_statuses > "$work/before"
  print_masked "$work/before"

  local tokens_file=/etc/nginx/conf.d/capshaw-server-tokens.conf changed=0
  rollback() {
    log "Rolling back"
    sudo cp -p "$NGINX_KEEP/capshaw-site-$ts" "$site"
    sudo rm -f "$tokens_file.new-$ts"
    [ -f "$work/added-tokens" ] && sudo rm -f "$tokens_file"
    sudo nginx -t && sudo systemctl reload nginx
  }

  if sudo grep -q 'X-Real-IP' "$site"; then
    ok "portal already forwards the visitor's address"
  else
    local hosts; hosts=$(sudo grep -c 'proxy_set_header[[:space:]]\+Host[[:space:]]' "$site" || true)
    [ "$hosts" -ge 1 ] || die "The portal site has no 'proxy_set_header Host' line to add beside; change it by hand."
    # Right after each "proxy_set_header Host ..." line, at the same indent.
    sudo awk '
      { print }
      /^[[:space:]]*proxy_set_header[[:space:]]+Host[[:space:]]/ {
        match($0, /^[[:space:]]*/); ind = substr($0, 1, RLENGTH)
        print ind "proxy_set_header X-Real-IP         $remote_addr;"
        print ind "proxy_set_header X-Forwarded-For   $remote_addr;"
        print ind "proxy_set_header X-Forwarded-Proto $scheme;"
      }' "$site" | sudo tee "$work/site.new" >/dev/null
    sudo cp "$work/site.new" "$site"
    ok "added the three headers to $hosts location block(s) of the portal site only"
    changed=1
  fi

  if sudo nginx -T 2>/dev/null | grep -qE '^[[:space:]]*server_tokens[[:space:]]+off'; then
    ok "server_tokens already off"
  else
    grep -qE '^[[:space:]]*include[[:space:]]+/etc/nginx/conf\.d/\*\.conf' /etc/nginx/nginx.conf \
      || { rollback; die "nginx.conf does not include conf.d/*.conf; set server_tokens off by hand."; }
    echo 'server_tokens off;   # added by scripts/ops/server-setup.sh: hide the nginx version' \
      | sudo tee "$tokens_file" >/dev/null
    touch "$work/added-tokens"
    ok "server_tokens off, in its own file"
    changed=1
  fi

  [ "$changed" = 1 ] || { log "Nothing to change"; return 0; }

  if ! sudo nginx -t; then rollback; die "nginx -t failed with the change, so it was put back; nginx kept serving the old config throughout."; fi
  sudo systemctl reload nginx
  sleep 2

  log "Every site, after"
  site_statuses > "$work/after"
  print_masked "$work/after"
  if ! diff -q "$work/before" "$work/after" >/dev/null; then
    rollback
    die "A site answered differently after the change, so it was put back."
  fi
  ok "every site answers exactly as before"
  log "Saved: $NGINX_KEEP/nginx-$ts.tar.gz (whole /etc/nginx) and capshaw-site-$ts"
}

# Sign-in attempts from two different addresses on this droplet. Run only once
# the headers are live: before them, every visitor shares one limit, and this
# would lock everybody out for 15 minutes.
ratelimit_check() {
  need_sudo
  sudo nginx -T 2>/dev/null | grep -q 'X-Forwarded-For[[:space:]]\+\$remote_addr' \
    || die "The live nginx does not forward X-Forwarded-For yet; not testing, it would lock out every member."
  local url="https://$DOMAIN/api/auth/login"
  attempt() {  # attempt <source address> [extra curl args]
    local src=$1; shift
    curl -sk -o /dev/null -m 10 -w '%{http_code}' --interface "$src" \
      --resolve "$DOMAIN:443:127.0.0.1" -H "Origin: https://$DOMAIN" -H 'Content-Type: application/json' \
      --data '{"email":"rate-limit-check@invalid.example","password":"not-a-real-password"}' "$@" "$url"
  }
  log "Per-visitor sign-in limit (20 per 15 minutes), against a made-up account"
  local codes="" i
  for i in $(seq 1 20); do codes+="$(attempt 127.0.0.2) "; done
  echo "  visitor A (127.0.0.2), 20 wrong passwords: $codes"
  local a21 b1 spoof
  a21=$(attempt 127.0.0.2); echo "  visitor A, attempt 21:                    $a21   (expect 429)"
  b1=$(attempt 127.0.0.3);  echo "  visitor B (127.0.0.3), first attempt:     $b1   (expect 401)"
  spoof=$(attempt 127.0.0.2 -H 'X-Forwarded-For: 6.6.6.6'); echo "  visitor A typing X-Forwarded-For 6.6.6.6: $spoof   (expect 429)"
  echo "  Server header: $(curl -skI --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" | grep -i '^server:' | tr -d '\r')"
  [ "$a21" = 429 ] && [ "$b1" = 401 ] && [ "$spoof" = 429 ] || die "Rate limiting is not per visitor yet."
  ok "each visitor has their own sign-in limit, and a typed header does not get around it"
}

# ── backups: README steps 3-6 ─────────────────────────────────────────────────
backups() {
  need_sudo
  cd "$APP_DIR"
  [ -x scripts/backup/capshaw-backup.sh ] || die "The backup scripts are not in $APP_DIR yet; deploy first."
  command -v rclone >/dev/null || die "rclone is not installed."

  log "Step 3: settings"
  if [ -f "$BACKUP_CONFIG" ]; then
    ok "$BACKUP_CONFIG already there, left as it is"
  else
    sudo cp scripts/backup/backup.env.example "$BACKUP_CONFIG"
    # The container deploy is what runs now; PM2 only if that is what is serving.
    if ! docker compose -f "$APP_DIR/docker-compose.yml" ps -q app 2>/dev/null | grep -q .; then
      sudo sed -i 's/^RUNNER=docker$/RUNNER=pm2/' "$BACKUP_CONFIG"
    fi
    sudo chown "$USER": "$BACKUP_CONFIG"
    sudo chmod 600 "$BACKUP_CONFIG"
    ok "wrote $BACKUP_CONFIG from the example"
  fi
  sudo install -d -o "$USER" -m 700 /var/backups/capshaw
  ok "/var/backups/capshaw"
  # shellcheck disable=SC1090
  ( set -a; . "$BACKUP_CONFIG"; set +a
    [ -n "${RCLONE_REMOTE:-}" ] || { echo "::error::RCLONE_REMOTE is empty in $BACKUP_CONFIG"; exit 1; }
    rclone listremotes | grep -qx "${RCLONE_REMOTE%%:*}:" \
      || { echo "::error::$(whoami) has no rclone remote called ${RCLONE_REMOTE%%:*}. Remotes: $(rclone listremotes | tr '\n' ' ')"; exit 1; }
    echo "  RUNNER=$RUNNER  RCLONE_REMOTE=$RCLONE_REMOTE  KEEP_DAYS=$KEEP_DAYS  REMOTE_KEEP_DAYS=$REMOTE_KEEP_DAYS"
  )

  log "Step 4: the first backup, by hand"
  scripts/backup/capshaw-backup.sh 2>&1 | tee "$WORK/first-backup.log"
  grep -q 'Off-server copy confirmed' "$WORK/first-backup.log" || die "The backup did not confirm its off-server copy."
  grep -q 'Backup complete' "$WORK/first-backup.log" || die "The backup did not complete."

  log "Step 5: schedule it"
  sed "s/^User=deploy$/User=$USER/" scripts/backup/capshaw-backup.service \
    | sudo tee /etc/systemd/system/capshaw-backup.service >/dev/null
  sudo cp scripts/backup/capshaw-backup.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now capshaw-backup.timer
  systemctl list-timers capshaw-backup.timer --no-pager | sed 's/^/  /'

  log "Step 6: read the newest off-server copy back and check it (does not touch live data)"
  scripts/backup/capshaw-restore.sh --list | sed 's/^/  /'
  restore_check
}

# What capshaw-restore.sh does before it would stop the app: download the newest
# off-server archive, decrypt it, and verify it with the app's own checker. It
# stops there; swapping it in is a separate, deliberate step.
restore_check() {
  # shellcheck disable=SC1090
  set -a; . "$BACKUP_CONFIG"; set +a
  local work=$WORK name
  name=$(rclone lsf "$RCLONE_REMOTE" --include 'capshaw-*.tar.gz' | sort | tail -1)
  [ -n "$name" ] || die "No archives in $RCLONE_REMOTE."
  log "Downloading $name"
  rclone copyto "$RCLONE_REMOTE/$name" "$work/$name"
  echo "  $(du -h "$work/$name" | cut -f1) downloaded and decrypted"
  case "${RUNNER:-docker}" in
    docker)
      local cid image
      cid=$(docker compose -f "$APP_DIR/docker-compose.yml" ps -q app)
      image=$(docker inspect -f '{{.Config.Image}}' "$cid")
      CAPSHAW_IMAGE=$image docker compose -f "$APP_DIR/docker-compose.yml" run --rm --no-deps -T app \
        node server/tools/backup.js verify - < "$work/$name" ;;
    pm2) env -C "$APP_DIR" node server/tools/backup.js verify - < "$work/$name" ;;
  esac
  ok "the off-server copy downloads, decrypts and verifies"
}

case "${1:-}" in
  preflight)  preflight ;;
  nginx)      nginx_apply; ratelimit_check ;;
  ratelimit)  ratelimit_check ;;
  backups)    backups ;;
  restore-check) restore_check ;;
  *) sed -n '4,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
