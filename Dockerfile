# Local image for the Omega harness API + web UI.
#
# Build:  docker build -t omega-harness:local .
# Run:    docker compose up -d --build
#
# The harness stores its embedded Postgres (PGlite) under /data, so mount a
# volume there to persist projects/tasks across container restarts.

# syntax=docker/dockerfile:1

FROM node:20-bookworm AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV DATABASE_URL=postgresql://localhost:5432/omega
WORKDIR /app
RUN corepack enable

# Workspace manifests first for install-layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json foreman-plugins.json ./
COPY apps ./apps
COPY packages ./packages
COPY foreman-plugins ./foreman-plugins
COPY proto ./proto
COPY scripts ./scripts
COPY .agents/skills ./.agents/skills

RUN pnpm install --frozen-lockfile

# Build the server and everything it imports, plus the web UI.
RUN pnpm -r --filter "@omega/server..." --filter "@omega/web..." build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
# Prisma detects the query-engine binary target from the installed OpenSSL; the
# slim image ships without the openssl CLI, so install it or Prisma looks for
# the linux-*-openssl-1.1.x engine that this build never produced.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV HOST=0.0.0.0
ENV PORT=4000
ENV DATABASE_URL=postgresql://localhost:5432/omega
ENV DATABASE_DIR=/data/pglite
ENV WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 4000
CMD ["node", "apps/server/dist/index.js"]
