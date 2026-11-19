#!/usr/bin/env bash
# ─── One-time server setup, run on the droplet ────────────────────────────────
#
#   server-setup.sh preflight   read-only: what is there, what is missing
#   server-setup.sh nginx       real visitor address + server_tokens off
#   server-setup.sh backups     backup install steps 3-6 (scripts/backup/README.md)
#   server-setup.sh restore-drill  practice restore into a scratch copy, then remove it
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
      || { echo "::error::$(whoami) has no rclone remote called ${RCLONE_REMOTE%%:*}. Remotes: $(rclone listremotes | tr '\n' ' ')"; exit 1; }
    echo "  RUNNER=$RUNNER  RCLONE_REMOTE=$RCLONE_REMOTE  KEEP_DAYS=$KEEP_DAYS  REMOTE_KEEP_DAYS=$REMOTE_KEEP_DAYS"
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

# ── restore-drill ─────────────────────────────────────────────────────────────
# A full practice restore, end to end, without touching the live site: take a
# backup now with the nightly job itself, restore the newest off-server copy
# with capshaw-restore.sh into a scratch copy of the portal (its own compose
# project, volume and loopback port), check every record and file came back,
# then delete the scratch copy. The live container, its volume and nginx are
# only ever read. Logs show counts and match/mismatch, never names or rows.
DRILL_PROJECT=capshaw-restore-drill
DRILL_PORT=${DRILL_PORT:-3901}

# Tables the app writes to by itself (sign-ins, page views, the job schedule,
# reminder claims at start-up), so a difference there is expected: it is
# reported but does not fail the drill.
DRILL_VOLATILE="sessions portal_page_views portal_visits scheduled_jobs mail_outbox worship_reminders notifications action_log scraped_meta"

# Every table's row count and a hash of its rows, and a hash of every file the
# backup covers, as JSON on stdout. Only ever compared, never shown.
DRILL_FINGERPRINT='
  const db = require("./server/db"), paths = require("./server/lib/paths");
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const h = (b) => crypto.createHash("sha256").update(b).digest("hex");
  const out = { rows: {}, files: {} };
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name").all("table", "sqlite_%")) {
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    out.rows[name] = { count: rows.length, sha: h(JSON.stringify(rows)) };
  }
  const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
  for (const [kind, dir] of Object.entries({ photos: paths.photos, uploads: paths.uploads,
      screenshots: paths.screenshots, mailAttachments: paths.mailAttachments })) {
    for (const f of walk(dir)) out.files[kind + "/" + path.relative(dir, f)] = h(fs.readFileSync(f));
  }
  if (fs.existsSync(paths.scrapeCache)) out.files["scrape-cache/members.json"] = h(fs.readFileSync(paths.scrapeCache));
  console.log(JSON.stringify(out));
'

# Compares two fingerprints with node inside the image (the droplet itself may
# not have node). Prints counts per kind only; exits 1 if anything outside
# DRILL_VOLATILE differs or any file is missing or changed.
DRILL_COMPARE='
  const [a, b] = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const label = process.env.LABEL, volatile = process.env.VOLATILE.split(" ");
  const tables = [...new Set([...Object.keys(a.rows), ...Object.keys(b.rows)])].sort();
  let same = 0, rows = 0; const bad = [], soft = [];
  for (const t of tables) {
    const x = a.rows[t], y = b.rows[t];
    if (x && y && x.sha === y.sha) { same++; rows += x.count; continue; }
    const note = `${t} (${x ? x.count : "missing"} vs ${y ? y.count : "missing"} rows)`;
    (volatile.includes(t) ? soft : bad).push(note);
  }
  console.log(`  tables: ${same} of ${tables.length} identical, ${rows} rows`);
  for (const n of soft) console.log(`  differs, written by the app on its own: ${n}`);
  for (const n of bad) console.log(`  MISMATCH ${n}`);
  const kinds = {}; let fileBad = 0;
  for (const f of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) {
    const s = (kinds[f.split("/")[0]] ||= { a: 0, b: 0, same: 0 });
    if (f in a.files) s.a++;
    if (f in b.files) s.b++;
    if (a.files[f] && a.files[f] === b.files[f]) s.same++; else fileBad++;
  }
  for (const [k, s] of Object.entries(kinds))
    console.log(`  ${(k + " files").padEnd(22)} ${label} ${s.a}, restored ${s.b}, byte-for-byte identical ${s.same}`);
  process.exit(bad.length || fileBad ? 1 : 0);
'

live_compose()  { docker compose -f "$APP_DIR/docker-compose.yml" "$@"; }
drill_compose() { docker compose -p "$DRILL_PROJECT" -f "$DRILL_DIR/docker-compose.yml" "$@"; }
drill_fingerprint() { "$1" exec -T app node -e "$DRILL_FINGERPRINT"; }  # live_compose | drill_compose
drill_compare() {  # drill_compare <a.json> <b.json> <label for a>
  { printf '['; cat "$1"; printf ','; cat "$2"; printf ']'; } | docker run --rm -i --entrypoint node -e LABEL="$3" -e VOLATILE="$DRILL_VOLATILE" \
    "$DRILL_IMAGE" -e "$DRILL_COMPARE"
}

restore_drill() {
  need_sudo
  cd "$APP_DIR"
  [ -f "$BACKUP_CONFIG" ] || die "$BACKUP_CONFIG is missing; run the backups task first."
  systemctl cat capshaw-backup.service >/dev/null 2>&1 || die "The nightly backup job is not installed; run the backups task first."
  local remote
  # shellcheck disable=SC1090
  remote=$(set -a; . "$BACKUP_CONFIG"; echo "${RCLONE_REMOTE:-}")
  [ -n "$remote" ] || die "RCLONE_REMOTE is empty in $BACKUP_CONFIG"

  DRILL_DIR="$WORK/$DRILL_PROJECT"
  mkdir -p "$DRILL_DIR"

  log "Before: the live portal and every other site on this nginx"
  local live_cid
  live_cid=$(live_compose ps -q app)
  [ -n "$live_cid" ] || die "The live app container is not running."
  DRILL_IMAGE=$(docker inspect -f '{{.Config.Image}}' "$live_cid")
  echo "  live container $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$live_cid"), image tag ${DRILL_IMAGE##*:}"
  site_statuses > "$WORK/sites-before"
  print_masked "$WORK/sites-before"
  if docker ps -a --format '{{.Names}}' | grep -q "^$DRILL_PROJECT"; then die "A scratch copy from an earlier drill is still there; remove it first."; fi
  if ss -ltn | awk '{print $4}' | grep -qE "[:.]$DRILL_PORT\$"; then die "Port $DRILL_PORT is in use."; fi
  echo "  memory free: $(free -m | awk '/^Mem:/ {print $7}') MB"
  echo "  disk free: $(df -h --output=avail /var/lib/docker 2>/dev/null | tail -1 | tr -d ' ')"

  # From here on the scratch copy is removed however the drill ends.
  trap 'set +e; drill_compose down -v --remove-orphans >/dev/null 2>&1; rm -rf "$WORK"' EXIT

  log "Step 1: a backup now, by the nightly job itself (capshaw-backup.service)"
  drill_fingerprint live_compose > "$WORK/live-before.json"
  local started; started=$(date '+%F %T')
  sudo systemctl start capshaw-backup.service || die "The nightly backup job failed."
  sudo journalctl -u capshaw-backup.service --since "$started" --no-pager -o cat \
    | grep -E 'Off-server copy confirmed|Backup complete|pruned' | sed 's/^/  /' || true
  drill_fingerprint live_compose > "$WORK/live.json"
  if drill_compare "$WORK/live-before.json" "$WORK/live.json" before >/dev/null; then ok "live data did not change while the backup ran"
  else echo "  live data changed while the backup ran (someone using the site); comparing against just after"; fi
  echo "  newest off-server archive: $(rclone lsf "$remote" --include 'capshaw-*.tar.gz' | sort | tail -1)"

  log "Step 2: an empty scratch copy of the portal (own project, own volume, 127.0.0.1:$DRILL_PORT)"
  # Only SESSION_SECRET: no mail server, no church-site sign-in, no API keys,
  # so the scratch copy has no way to send mail or act for anyone.
  printf 'SESSION_SECRET=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n')" > "$DRILL_DIR/app.env"
  chmod 600 "$DRILL_DIR/app.env"
  cat > "$DRILL_DIR/docker-compose.yml" <<YAML
services:
  app:
    image: $DRILL_IMAGE
    init: true
    env_file: [ ./app.env ]
    environment: { NODE_ENV: production, PORT: "3001" }
    ports: [ "127.0.0.1:$DRILL_PORT:3001" ]
    volumes: [ "capshaw-data:/data" ]
volumes:
  capshaw-data:
YAML
  # capshaw-restore.sh reads its settings from a file; give it one that points
  # only at the scratch copy (the real file's HEALTH_URL would be live's).
  cat > "$DRILL_DIR/backup.env" <<CONF
RUNNER=docker
RCLONE_REMOTE=$remote
BACKUP_DIR=$DRILL_DIR/no-local-archives
HEALTH_URL=http://127.0.0.1:$DRILL_PORT/api/health
CONF
  drill_compose up -d app >/dev/null 2>&1
  local i healthy=0
  for i in $(seq 1 60); do
    curl -fsS -m 3 "http://127.0.0.1:$DRILL_PORT/api/health" >/dev/null 2>&1 && { healthy=1; break; }
    sleep 1
  done
  [ "$healthy" = 1 ] || die "The empty scratch copy did not start."
  [ "$(drill_compose ps -q app)" != "$live_cid" ] || die "The scratch project resolved to the live container; stopping."
  drill_fingerprint drill_compose > "$WORK/empty.json"
  echo "  scratch copy up and empty: $(docker run --rm -i --entrypoint node "$DRILL_IMAGE" -e '
    const f = JSON.parse(require("fs").readFileSync(0, "utf8"));
    console.log(`${f.rows.users.count} users, ${Object.keys(f.files).length} files`)' < "$WORK/empty.json")"

  log "Step 3: restore the newest off-server copy into it (scripts/backup/capshaw-restore.sh latest-remote)"
  local restore_status=0
  CAPSHAW_BACKUP_CONFIG="$DRILL_DIR/backup.env" COMPOSE_PROJECT_NAME="$DRILL_PROJECT" \
    COMPOSE_FILE="$DRILL_DIR/docker-compose.yml" CAPSHAW_IMAGE="$DRILL_IMAGE" ASSUME_YES=1 \
    scripts/backup/capshaw-restore.sh latest-remote > "$WORK/restore.log" 2>&1 || restore_status=$?
  grep -E 'Downloading|Backup is sound|rows, integrity|file\(s\)|restored the backup|Stopping|Starting|healthy|STOPPED|failed' "$WORK/restore.log" \
    | sed -E 's/ from [^ ]+$/ from off-server/; s/^/  /'
  [ "$restore_status" = 0 ] || die "capshaw-restore.sh did not finish."
  curl -fsS -m 5 "http://127.0.0.1:$DRILL_PORT/api/health" >/dev/null || die "The scratch copy is not healthy after the restore."
  ok "scratch copy healthy on the restored data"
  drill_fingerprint drill_compose > "$WORK/restored.json"

  log "Step 4: the restored copy against live"
  drill_compare "$WORK/live.json" "$WORK/restored.json" live || die "The restored copy does not match live."
  ok "every record and every file came back"

  log "Step 5: remove the scratch copy"
  drill_compose down -v --remove-orphans >/dev/null 2>&1
  trap 'rm -rf "$WORK"' EXIT
  ! docker ps -a --format '{{.Names}}' | grep -q "^$DRILL_PROJECT" || die "A scratch container is still there."
  ! docker volume ls -q | grep -q "^$DRILL_PROJECT" || die "The scratch volume is still there."
  ok "scratch container, volume and network removed"

  log "After: the live portal and every other site"
  [ "$(live_compose ps -q app)" = "$live_cid" ] || die "The live container changed during the drill."
  echo "  live container $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$live_cid"), the same one as before"
  drill_fingerprint live_compose > "$WORK/live-after.json"
  if drill_compare "$WORK/live.json" "$WORK/live-after.json" before >/dev/null; then ok "live data untouched by the drill"
  else echo "  live data moved on during the drill (someone using the site)"; fi
  site_statuses > "$WORK/sites-after"
  print_masked "$WORK/sites-after"
  diff -q "$WORK/sites-before" "$WORK/sites-after" >/dev/null || die "A site answers differently than before the drill."
  ok "every site answers exactly as before"
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

case "${1:-}" in
  preflight)  preflight ;;
  nginx)      nginx_apply; ratelimit_check ;;
  ratelimit)  ratelimit_check ;;
  backups)    backups ;;
  restore-check) restore_check ;;
  restore-drill) restore_drill ;;
  timezone)   timezone_set ;;
  *) sed -n '4,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
