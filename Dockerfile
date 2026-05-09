# syntax=docker/dockerfile:1.7

# ---------- base ----------
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
ENV CI=true

# ---------- deps ----------
# Install all workspace dependencies. Copy only manifests first so this layer
# caches across source-only changes.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/psx-insight/package.json artifacts/psx-insight/
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/
COPY scripts/package.json scripts/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/db/package.json lib/db/
COPY lib/integrations-anthropic-ai/package.json lib/integrations-anthropic-ai/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY . .
# Vite reads PORT/BASE_PATH at build time only; values are baked into the bundle
# but the API server uses its own runtime PORT.
ENV PORT=3000
ENV BASE_PATH=/
ENV NODE_ENV=production
RUN pnpm --filter @workspace/psx-insight run build \
 && pnpm --filter @workspace/api-server run build

# ---------- runtime ----------
FROM base AS runtime
ENV NODE_ENV=production
# Frontend bundle served as static files.
COPY --from=build /app/artifacts/psx-insight/dist/public /app/public
# API server bundle (esbuild output is mostly self-contained).
COPY --from=build /app/artifacts/api-server/dist /app/api-dist
# DB workspace + its deps so `drizzle-kit push` can run as a release command.
COPY --from=build /app/lib/db /app/lib/db
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./

ENV STATIC_DIR=/app/public
EXPOSE 3000
CMD ["node", "--enable-source-maps", "/app/api-dist/index.mjs"]
