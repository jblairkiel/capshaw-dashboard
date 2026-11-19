#!/usr/bin/env bash
# ─── One-time server setup, run on the droplet ────────────────────────────────
#
#   server-setup.sh preflight   read-only: what is there, what is missing
#   server-setup.sh nginx       real visitor address + server_tokens off
#   server-setup.sh backups     backup install steps 3-6 (scripts/backup/README.md)
#   server-setup.sh revoke-cloud-key   take the cloud session key off claude-deploy
#
# Run by the "Server setup" workflow (.github/workflows/server-setup.yml) as the
# deploy user, or by hand. Every step is safe to run twice: whatever is already
# in place is left as it is.
#
# This repository is public, and so are its workflow logs. Nothing here prints
# a config file, a secret, a bucket or remote name, the names of the other
# sites this nginx serves (shown as site-1, site-2...), or anything about the
# members: no row counts, names or addresses. Pass/fail, sizes and counts of
# the box's own things (sites, archives, remotes) only.
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
  if [ "$(id -u)" = 0 ]; then echo "  running as root (the backup job will run as root too)"
  else id -nG | grep -qw docker && ok "in the docker group" || warn "not in the docker group"; fi
  [ -d "$APP_DIR" ] && ok "$APP_DIR owned by $(stat -c %U "$APP_DIR"), at $(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')" \
    || warn "$APP_DIR is missing"
  echo "  droplet time zone: $(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo '?')"

  log "nginx"
  if sudo -n true 2>/dev/null; then
    local site; site=$(capshaw_site)
    [ -n "$site" ] && ok "portal site file found" || warn "no nginx site file for $DOMAIN"
    if [ -n "$site" ]; then
      echo "  proxy_set_header Host lines in it: $(sudo grep -c 'proxy_set_header[[:space:]]\+Host[[:space:]]' "$site" || true)"
      echo "  forwarding lines now (header and value only):"
      forwarding_lines "$site" | sed 's/^/    /'
      [ "$(want_site "$site" | sha256sum)" = "$(sudo cat "$site" | sha256sum)" ] \
        && ok "already forwards the visitor's address correctly" || echo "  needs the nginx step"
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
    echo "  rclone remotes for $(whoami): $(rclone listremotes 2>/dev/null | grep -c . || true)"
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

# The proxy_set_header lines for the visitor's address, header and value only:
# safe for a public log.
forwarding_lines() {
  sudo grep -E '^[[:space:]]*proxy_set_header[[:space:]]+(Host|X-Real-IP|X-Forwarded-For|X-Forwarded-Proto)[[:space:]]' "$1" \
    | awk '{ $1 = $1; print }' || true
}

# The site file as it should be: any existing X-Real-IP / X-Forwarded-For /
# X-Forwarded-Proto line is dropped wherever it is, and the three correct ones
# go right after each "proxy_set_header Host" line, at the same indent. Run on
# a file that is already right, it gives the same file back.
want_site() {
  sudo awk '
    /^[[:space:]]*proxy_set_header[[:space:]]+(X-Real-IP|X-Forwarded-For|X-Forwarded-Proto)[[:space:]]/ { next }
    { print }
    /^[[:space:]]*proxy_set_header[[:space:]]+Host[[:space:]]/ {
      match($0, /^[[:space:]]*/); ind = substr($0, 1, RLENGTH)
      print ind "proxy_set_header X-Real-IP         $remote_addr;"
      print ind "proxy_set_header X-Forwarded-For   $remote_addr;"
      print ind "proxy_set_header X-Forwarded-Proto $scheme;"
    }' "$1"
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

  local hosts; hosts=$(sudo grep -c '^[[:space:]]*proxy_set_header[[:space:]]\+Host[[:space:]]' "$site" || true)
  [ "$hosts" -ge 1 ] || die "The portal site has no 'proxy_set_header Host' line to add beside; change it by hand."
  want_site "$site" > "$work/site.new"
  # Every forwarding line that was there must have had a Host line to go back
  # beside, or the rewrite would drop it from a block with none.
  local h had now
  for h in X-Real-IP X-Forwarded-For X-Forwarded-Proto; do
    had=$(sudo grep -c "^[[:space:]]*proxy_set_header[[:space:]]\+$h[[:space:]]" "$site" || true)
    now=$(grep -c "^[[:space:]]*proxy_set_header[[:space:]]\+$h[[:space:]]" "$work/site.new" || true)
    [ "$now" = "$hosts" ] && [ "$had" -le "$hosts" ] || die "$h appears $had time(s) for $hosts Host line(s); change the site by hand."
  done
  echo "  forwarding lines before:"; forwarding_lines "$site" | sed 's/^/    /'
  if sudo cmp -s "$work/site.new" "$site"; then
    ok "portal already forwards the visitor's address correctly"
  else
    sudo cp "$work/site.new" "$site"
    echo "  forwarding lines after:"; forwarding_lines "$site" | sed 's/^/    /'
    ok "set the three headers in $hosts location block(s) of the portal site only"
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
  local site; site=$(capshaw_site)
  [ -n "$site" ] && [ "$(want_site "$site" | sha256sum)" = "$(sudo cat "$site" | sha256sum)" ] \
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
    sudo chown "$(id -un)": "$BACKUP_CONFIG"
    sudo chmod 600 "$BACKUP_CONFIG"
    ok "wrote $BACKUP_CONFIG from the example"
  fi
  sudo install -d -o "$(id -un)" -m 700 /var/backups/capshaw
  ok "/var/backups/capshaw"
  # shellcheck disable=SC1090
  ( set -a; . "$BACKUP_CONFIG"; set +a
    [ -n "${RCLONE_REMOTE:-}" ] || { echo "::error::RCLONE_REMOTE is empty in $BACKUP_CONFIG"; exit 1; }
    rclone listremotes | grep -qx "${RCLONE_REMOTE%%:*}:" \
      || { echo "::error::$(whoami) has no rclone remote named in RCLONE_REMOTE ($(rclone listremotes | grep -c . || true) remote(s) configured)"; exit 1; }
    echo "  RUNNER=$RUNNER  RCLONE_REMOTE set  KEEP_DAYS=$KEEP_DAYS  REMOTE_KEEP_DAYS=$REMOTE_KEEP_DAYS"
  )

  log "Step 4: the first backup, by hand"
  scripts/backup/capshaw-backup.sh 2>&1 | tee "$WORK/first-backup.log"
  grep -q 'Off-server copy confirmed' "$WORK/first-backup.log" || die "The backup did not confirm its off-server copy."
  grep -q 'Backup complete' "$WORK/first-backup.log" || die "The backup did not complete."

  log "Step 5: schedule it"
  sed "s/^User=deploy$/User=$(id -un)/" scripts/backup/capshaw-backup.service \
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
  [ -n "$name" ] || die "No archives off-server."
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

# ── time zone ─────────────────────────────────────────────────────────────────
# The whole box's clock zone: cron jobs and systemd timers written as a wall
# clock time ("3:15") follow it, so list what will shift (schedules only, not
# the commands or which site they belong to), then change it.
timezone_set() {
  need_sudo
  local want=${TZ_WANT:-America/Chicago}
  timedatectl list-timezones | grep -qx "$want" || die "Unknown time zone $want."
  log "Time zone now: $(timedatectl show -p Timezone --value)"
  echo "  cron entries that run at a set time of day (these will now follow $want):"
  { sudo cat /etc/crontab /etc/cron.d/* 2>/dev/null; for u in $(cut -d: -f1 /etc/passwd); do sudo crontab -l -u "$u" 2>/dev/null || true; done; } \
    | grep -vE '^[[:space:]]*(#|$|[A-Za-z_]+=)' | awk '$1 !~ /^@/ && $1 !~ /[*\/]/ && $2 !~ /[*\/]/ { print "    minute " $1 " hour " $2 " (" $3 " " $4 " " $5 ")" }' | sort | uniq -c || true
  log "Setting $want"
  sudo timedatectl set-timezone "$want"
  log "Time zone now: $(timedatectl show -p Timezone --value)   local time: $(date)"
  systemctl list-timers capshaw-backup.timer --no-pager | sed 's/^/  /'
}

# ── revoke the cloud session key ──────────────────────────────────────────────
# The key cloud Claude sessions were given (VPS_SSH_KEY_B64) could never reach
# the droplet, because those sessions only get out on port 443. Take it off
# claude-deploy's authorized keys. Matched by fingerprint, so no other key
# (the GitHub deploy key, anyone's own) is touched, whatever its comment says.
# A public key's fingerprint is not a secret, so it is safe in this file.
REVOKE_USER=${REVOKE_USER:-claude-deploy}
REVOKE_FP=${REVOKE_FP:-SHA256:gCtwbJF6oDClD7MjgQBfp1oqoIOLCBcYx8p8ffeREV0}

# One fingerprint per line of an authorized_keys file, "-" for a line that is
# not a key (blank, comment, unreadable), so line N of the output is line N.
key_fingerprints() {
  local line one=$WORK/one.pub
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) echo -; continue ;; esac
    printf '%s\n' "$line" > "$one"
    ssh-keygen -lf "$one" 2>/dev/null | awk '{print $2}' | grep . || echo -
  done < <(sudo cat "$1")
}

# The authorized_keys files sshd reads for a user.
authorized_files() {
  local u=$1 home; home=$(getent passwd "$u" | cut -d: -f6)
  sudo sshd -T -C "user=$u,host=localhost,addr=127.0.0.1" 2>/dev/null \
    | awk 'tolower($1)=="authorizedkeysfile" { for (i = 2; i <= NF; i++) print $i }' \
    | sed -e "s|%h|$home|g" -e "s|%u|$u|g" -e "s|%%|%|g" \
    | while read -r f; do case "$f" in /*) echo "$f" ;; *) echo "$home/$f" ;; esac; done \
    | grep . || printf '%s\n' "$home/.ssh/authorized_keys" "$home/.ssh/authorized_keys2"
}

revoke_cloud_key() {
  need_sudo
  command -v ssh-keygen >/dev/null || die "ssh-keygen is not installed."
  getent passwd "$REVOKE_USER" >/dev/null || die "There is no user $REVOKE_USER."
  log "Revoking key $REVOKE_FP from $REVOKE_USER"

  # This job's own SSH login must survive: never remove the key it came in on.
  local mine=""
  if [ -n "${SSH_CONNECTION:-}" ]; then
    local port; port=$(echo "$SSH_CONNECTION" | awk '{print $2}')
    mine=$(sudo journalctl -q -u ssh -u sshd --since '-30 min' 2>/dev/null \
      | grep "Accepted publickey for $(whoami) from .* port $port " | tail -1 | grep -o 'SHA256:[A-Za-z0-9+/]*' || true)
  fi
  if [ -n "$mine" ]; then echo "  this job signed in with a different key: $([ "$mine" != "$REVOKE_FP" ] && echo yes || echo NO)"
  else echo "  (could not read which key this job signed in with; relying on the counts below)"; fi
  [ "$mine" != "$REVOKE_FP" ] || die "This job signed in with the key it was asked to remove; stopping."

  local f ts removed_total=0; ts=$(date -u +%Y%m%dT%H%M%SZ)
  while read -r f; do
    sudo test -f "$f" || { echo "  $f: not there"; continue; }
    key_fingerprints "$f" > "$WORK/fps"
    local total match
    total=$(grep -vcx -- - "$WORK/fps" || true)
    match=$(grep -cxF -- "$REVOKE_FP" "$WORK/fps" || true)
    echo "  $f: $total key(s), $match of them the cloud key"
    [ "$match" -gt 0 ] || continue
    # claude-deploy may have no other key, and then it simply can't sign in by
    # key any more, which is fine. Only stop if this job is that user.
    [ "$total" -gt "$match" ] || [ "$(whoami)" != "$REVOKE_USER" ] \
      || die "That would leave $REVOKE_USER, the user this job signed in as, with no keys in $f; stopping."
    # Keep every line whose fingerprint is not the cloud key's, in order.
    sudo cat "$f" | paste -d '\t' "$WORK/fps" - | awk -F '\t' -v fp="$REVOKE_FP" '$1 != fp { sub(/^[^\t]*\t/, ""); print }' > "$WORK/keys.new"
    sudo cp -p "$f" "$f.before-revoke-$ts"
    sudo sh -c "cat '$WORK/keys.new' > '$f'"     # in place: owner and mode stay as they were
    key_fingerprints "$f" > "$WORK/fps.after"
    local left still
    left=$(grep -vcx -- - "$WORK/fps.after" || true)
    still=$(grep -cxF -- "$REVOKE_FP" "$WORK/fps.after" || true)
    [ "$still" = 0 ] && [ "$left" = $((total - match)) ] || { sudo cp -p "$f.before-revoke-$ts" "$f"; die "The file did not come out as expected, so it was put back."; }
    # Every other key is still there, byte for byte, in the same order.
    diff <(grep -vxF -- "$REVOKE_FP" "$WORK/fps") "$WORK/fps.after" >/dev/null \
      || { sudo cp -p "$f.before-revoke-$ts" "$f"; die "Another key changed, so the file was put back."; }
    ok "removed $match line(s); $left other key(s) left exactly as they were (file still $(sudo stat -c '%U %a' "$f"))"
    echo "  saved the old file as $f.before-revoke-$ts"
    removed_total=$((removed_total + match))
  done < <(authorized_files "$REVOKE_USER" | sort -u)
  [ "$removed_total" -gt 0 ] && ok "the cloud key no longer opens $REVOKE_USER" || ok "the cloud key was not in $REVOKE_USER's keys; nothing to do"

  log "Is the same key anywhere else? (reported, not changed)"
  local u found=0
  for u in $(awk -F: '$7 !~ /(nologin|false)$/ {print $1}' /etc/passwd); do
    [ "$u" = "$REVOKE_USER" ] && continue
    while read -r f; do
      sudo test -f "$f" || continue
      if key_fingerprints "$f" | grep -qxF -- "$REVOKE_FP"; then warn "$u still has it"; found=1; fi
    done < <(authorized_files "$u" | sort -u)
  done
  [ "$found" = 0 ] && ok "no other user has it"

  log "Every site still answers"
  site_statuses > "$WORK/sites"
  print_masked "$WORK/sites"
}

case "${1:-}" in
  preflight)  preflight ;;
  nginx)      nginx_apply; ratelimit_check ;;
  ratelimit)  ratelimit_check ;;
  backups)    backups ;;
  restore-check) restore_check ;;
  timezone)   timezone_set ;;
  revoke-cloud-key) revoke_cloud_key ;;
  *) sed -n '4,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
