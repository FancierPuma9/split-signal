# Split Signal: one container serving the game server and the built client.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable

# Dependencies first, so code changes don't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/puzzles/package.json packages/puzzles/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @split-signal/client build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    SPLIT_SIGNAL_DB=/data/split-signal.db
COPY --from=build --chown=node:node /app /app
# The stats database lives on a volume so it survives rebuilds.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://localhost:3001/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
WORKDIR /app/packages/server
# The server runs its TypeScript source directly through tsx, as in development.
CMD ["node", "--import", "tsx", "src/index.ts"]
