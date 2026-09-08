# Single image: Express API + the dashboard's static build, served same-origin.
# Built on the Mac for linux/amd64 and shipped to the NAS by scripts/deploy.sh.
# Lives at the repo root because the build spans both pnpm workspace packages.

# ---- deps: full install (dev deps needed for tsc / vite) ---------------------
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY dashboard/package.json dashboard/
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
# Vite inlines these at build time, so they land in the image. Accepted: the
# image is built on the Mac, loaded straight onto the NAS, never pushed anywhere.
ARG VITE_API_KEY
ARG VITE_MAPBOX_TOKEN
ENV VITE_API_KEY=$VITE_API_KEY VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
COPY backend backend
COPY dashboard dashboard
COPY biome.json ./
RUN pnpm -r build

# ---- runtime: prod deps + compiled output only -------------------------------
FROM node:24-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --prod --filter fitness-extractor-backend
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/dashboard/dist dashboard/dist
ENV PORT=3000 STATIC_DIR=/app/dashboard/dist
EXPOSE 3000
# index.ts looks for ../.env relative to cwd; none exists here, so it uses env.
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
