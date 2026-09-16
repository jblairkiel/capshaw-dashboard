# ─── The portal as one image ──────────────────────────────────────────────────
#
# Built in three stages so the thing that ships carries neither a compiler nor
# a source tree: the client is built in one, the server's dependencies —
# including the native SQLite addon — are compiled in another, and the runtime
# stage copies out only what is needed to serve.
#
# The base image is the same in every stage on purpose. better-sqlite3 is a
# native addon: a binary built against a different Node or a different libc
# loads happily and then aborts the process from a statement destructor during
# garbage collection, which is the failure the SSH deploy has to test for by
# hand. Here the binary is built against the same image that runs it, so the
# question cannot arise.
#
# 22-bookworm-slim rather than alpine: package.json needs Node >=22.12, and
# glibc is what better-sqlite3 publishes prebuilds for. Alpine's musl would
# mean compiling from source on every build for no gain.
ARG NODE_IMAGE=node:22-bookworm-slim

# ─── 1. The React build ───────────────────────────────────────────────────────

FROM ${NODE_IMAGE} AS client

WORKDIR /build/client

# Dependencies first, and only the manifests: this layer is then reused on
# every build that did not change them, which is most of them.
COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ─── 2. The server's dependencies ─────────────────────────────────────────────

FROM ${NODE_IMAGE} AS deps

# better-sqlite3 falls back to compiling when there is no prebuild for this
# platform, and needs a toolchain to do it. None of this reaches the final
# image — the stage is thrown away once node_modules has been copied out.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Prove the addon works in the image that built it, rather than finding out
# from a health check after this image has replaced a working one. Exercising
# it and collecting it is what catches an ABI mismatch: merely requiring it
# would not.
RUN node --expose-gc -e "\
  const Database = require('better-sqlite3'); \
  const db = new Database(':memory:'); \
  for (let i = 0; i < 200; i++) db.prepare('SELECT ' + i).get(); \
  if (global.gc) { global.gc(); global.gc(); } \
  db.close(); \
  console.log('better-sqlite3 ' + require('better-sqlite3/package.json').version + \
              ' OK on Node ' + process.versions.node + ' (ABI ' + process.versions.modules + ')'); \
"

# ─── 3. What actually ships ───────────────────────────────────────────────────

FROM ${NODE_IMAGE} AS runtime

# Everything this installation writes lives under one directory, so a
# deployment mounts one volume rather than four. See server/lib/paths.js.
ENV NODE_ENV=production \
    PORT=3001 \
    CAPSHAW_DATA_DIR=/data \
    CAPSHAW_UPLOAD_DIR=/data/uploads

WORKDIR /app

# node_modules from the stage that compiled them, the server, and the built
# client. No source for the client, no toolchain, no test suites — see
# .dockerignore for what never enters the build context at all.
COPY --from=deps   /build/node_modules ./node_modules
COPY --from=client /build/client/dist  ./client/dist
COPY package.json ./
COPY server/ ./server/

# The image runs as the `node` user the base image already provides, so a
# compromise inside the container is not root inside the container. The data
# directory is created and handed over here; a named volume mounted over it
# inherits this ownership, while a bind mount from the host keeps the host's,
# which is why the README says to chown it.
RUN mkdir -p /data /data/uploads && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 3001

# Node 22 has fetch built in, so the check needs nothing installed. /api/health
# is deliberately outside the sign-in gate, so this asks the real app whether
# it is serving rather than whether the process exists.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# No process manager: the container is the unit that gets restarted, and
# `docker run --init` (or `init: true` in compose) reaps zombies and forwards
# signals, which is all PM2 was doing here.
CMD ["node", "server/index.js"]
